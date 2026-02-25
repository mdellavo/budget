from __future__ import annotations

import json
from collections.abc import Sequence
from datetime import datetime
from decimal import Decimal

from sqlalchemy import and_, delete, func, or_, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .models import (
    Account,
    CardHolder,
    Category,
    CsvImport,
    Merchant,
    Subcategory,
    Transaction,
)


class AnalyticsQueries:
    def __init__(self, db: AsyncSession, user_id: int | None = None) -> None:
        self.db = db
        self.user_id = user_id

    def _user_filter(self):
        if self.user_id is not None:
            return [Transaction.user_id == self.user_id]
        return []

    async def get_recurring_transactions(self) -> list:
        stmt = (
            select(
                Transaction.date,
                Transaction.amount,
                Transaction.merchant_id,
                Transaction.description,
                Merchant.name.label("merchant_name"),
                Category.name.label("category_name"),
            )
            .outerjoin(Merchant, Transaction.merchant_id == Merchant.id)
            .outerjoin(Subcategory, Transaction.subcategory_id == Subcategory.id)
            .outerjoin(Category, Subcategory.category_id == Category.id)
            .where(Transaction.is_recurring == True, *self._user_filter())  # noqa: E712
            .order_by(Transaction.date)
        )
        rows = (await self.db.execute(stmt)).all()
        return rows

    async def list_months(self) -> list[str]:
        stmt = (
            select(func.strftime("%Y-%m", Transaction.date).label("month"))
            .where(*self._user_filter())
            .group_by(func.strftime("%Y-%m", Transaction.date))
            .order_by(text("month DESC"))
        )
        rows = (await self.db.execute(stmt)).all()
        return [r.month for r in rows]

    async def get_month_stats(self, month: str) -> dict:
        month_filter = func.strftime("%Y-%m", Transaction.date) == month
        user_filters = self._user_filter()
        transaction_count = (
            await self.db.scalar(
                select(func.count(Transaction.id)).where(month_filter, *user_filters)
            )
            or 0
        )
        income = await self.db.scalar(
            select(func.coalesce(func.sum(Transaction.amount), 0)).where(
                month_filter, Transaction.amount > 0, *user_filters
            )
        ) or Decimal(0)
        expenses = await self.db.scalar(
            select(func.coalesce(func.sum(Transaction.amount), 0)).where(
                month_filter, Transaction.amount < 0, *user_filters
            )
        ) or Decimal(0)
        return {
            "transaction_count": transaction_count,
            "income": income,
            "expenses": expenses,
        }

    async def get_category_breakdown(self, month: str) -> list:
        month_filter = func.strftime("%Y-%m", Transaction.date) == month
        rows = (
            await self.db.execute(
                select(
                    func.coalesce(Category.name, "Uncategorized").label("category"),
                    func.coalesce(Subcategory.name, "Uncategorized").label(
                        "subcategory"
                    ),
                    func.sum(Transaction.amount).label("total"),
                )
                .select_from(Transaction)
                .outerjoin(Subcategory, Transaction.subcategory_id == Subcategory.id)
                .outerjoin(Category, Subcategory.category_id == Category.id)
                .where(month_filter, Transaction.amount < 0, *self._user_filter())
                .group_by(Category.name, Subcategory.name)
                .order_by(func.sum(Transaction.amount).asc())
            )
        ).all()
        return rows

    async def get_category_trends(
        self,
        date_from: str | None = None,
        date_to: str | None = None,
    ) -> list:
        month_col = func.strftime("%Y-%m", Transaction.date)
        stmt = (
            select(
                month_col.label("month"),
                func.coalesce(Category.name, "Uncategorized").label("category"),
                func.sum(Transaction.amount).label("total"),
            )
            .select_from(Transaction)
            .outerjoin(Subcategory, Transaction.subcategory_id == Subcategory.id)
            .outerjoin(Category, Subcategory.category_id == Category.id)
            .where(Transaction.amount < 0, *self._user_filter())
            .group_by(month_col, Category.name)
            .order_by(month_col, Category.name)
        )
        if date_from:
            stmt = stmt.where(month_col >= date_from)
        if date_to:
            stmt = stmt.where(month_col <= date_to)
        return (await self.db.execute(stmt)).all()

    async def get_overview_summary(self) -> dict:
        user_filters = self._user_filter()
        transaction_count = (
            await self.db.scalar(
                select(func.count(Transaction.id)).where(*user_filters)
            )
            or 0
        )
        net = await self.db.scalar(
            select(func.coalesce(func.sum(Transaction.amount), 0)).where(*user_filters)
        ) or Decimal(0)
        income = await self.db.scalar(
            select(func.coalesce(func.sum(Transaction.amount), 0)).where(
                Transaction.amount > 0, *user_filters
            )
        ) or Decimal(0)
        expenses = net - income
        return {
            "transaction_count": transaction_count,
            "net": net,
            "income": income,
            "expenses": expenses,
        }

    async def get_income_by_merchant(self) -> list:
        rows = (
            await self.db.execute(
                select(
                    func.coalesce(Merchant.name, "Other Income").label("name"),
                    func.sum(Transaction.amount).label("total"),
                )
                .select_from(Transaction)
                .outerjoin(Merchant, Transaction.merchant_id == Merchant.id)
                .where(Transaction.amount > 0, *self._user_filter())
                .group_by(Merchant.name)
                .order_by(func.sum(Transaction.amount).desc())
            )
        ).all()
        return rows

    async def get_expenses_by_category(self) -> list:
        rows = (
            await self.db.execute(
                select(
                    func.coalesce(Category.name, "Uncategorized").label("name"),
                    func.sum(Transaction.amount).label("total"),
                )
                .select_from(Transaction)
                .outerjoin(Subcategory, Transaction.subcategory_id == Subcategory.id)
                .outerjoin(Category, Subcategory.category_id == Category.id)
                .where(Transaction.amount < 0, *self._user_filter())
                .group_by(Category.name)
                .order_by(func.sum(Transaction.amount))
            )
        ).all()
        return rows


class CategoryQueries:
    def __init__(self, db: AsyncSession, user_id: int | None = None) -> None:
        self.db = db
        self.user_id = user_id

    async def list_with_stats(
        self,
        date_from,
        date_to,
        category: str | None,
        subcategory: str | None,
        sort_by: str,
        sort_dir: str,
    ) -> list:
        conditions = []
        if self.user_id is not None:
            conditions.append(Transaction.user_id == self.user_id)
        if date_from:
            conditions.append(Transaction.date >= date_from)
        if date_to:
            conditions.append(Transaction.date <= date_to)
        if category:
            conditions.append(Category.name.ilike(f"%{category}%"))
        if subcategory:
            conditions.append(Subcategory.name.ilike(f"%{subcategory}%"))

        cat_expr = func.coalesce(Category.name, "Uncategorized")
        sub_expr = func.coalesce(Subcategory.name, "Uncategorized")
        count_expr = func.count(Transaction.id)
        total_expr = func.coalesce(func.sum(Transaction.amount), 0)

        sort_map = {
            "category": cat_expr,
            "subcategory": sub_expr,
            "transaction_count": count_expr,
            "total_amount": total_expr,
        }
        order_expr = sort_map[sort_by]
        order_clause = order_expr.desc() if sort_dir == "desc" else order_expr.asc()

        rows = (
            await self.db.execute(
                select(
                    cat_expr.label("category"),
                    sub_expr.label("subcategory"),
                    count_expr.label("transaction_count"),
                    total_expr.label("total_amount"),
                )
                .select_from(Transaction)
                .outerjoin(Subcategory, Transaction.subcategory_id == Subcategory.id)
                .outerjoin(Category, Subcategory.category_id == Category.id)
                .where(*conditions)
                .group_by(Category.name, Subcategory.name)
                .order_by(order_clause)
            )
        ).all()
        return rows

    async def list_all(self) -> list:
        rows = (
            await self.db.execute(
                select(Category.name.label("cat"), Subcategory.name.label("sub"))
                .join(Subcategory, Subcategory.category_id == Category.id)
                .order_by(Category.name, Subcategory.name)
            )
        ).all()
        return rows

    async def find_or_create_for_enrichment(
        self, name: str, cache: dict[str, int]
    ) -> int:
        if name not in cache:
            stmt = select(Category).where(Category.name == name)
            if self.user_id is not None:
                stmt = stmt.where(Category.user_id == self.user_id)
            res = await self.db.execute(stmt)
            c = res.scalar_one_or_none()
            if c is None:
                c = Category(name=name, user_id=self.user_id)
                self.db.add(c)
                await self.db.flush()
            cache[name] = c.id
        return cache[name]

    async def find_or_create_subcategory_for_enrichment(
        self, category_id: int, name: str, cache: dict[tuple, int]
    ) -> int:
        key = (category_id, name)
        if key not in cache:
            res = await self.db.execute(
                select(Subcategory).where(
                    Subcategory.category_id == category_id,
                    Subcategory.name == name,
                )
            )
            sc = res.scalar_one_or_none() or Subcategory(
                category_id=category_id, name=name
            )
            if sc.id is None:
                self.db.add(sc)
                await self.db.flush()
            cache[key] = sc.id
        return cache[key]


class CardHolderQueries:
    def __init__(self, db: AsyncSession, user_id: int | None = None) -> None:
        self.db = db
        self.user_id = user_id

    async def get_by_id(self, cardholder_id: int) -> CardHolder | None:
        return await self.db.get(CardHolder, cardholder_id)

    async def find_or_create_for_enrichment(
        self, card_number: str, cache: dict[str, int]
    ) -> int:
        if card_number in cache:
            return cache[card_number]
        stmt = select(CardHolder).where(CardHolder.card_number == card_number)
        if self.user_id is not None:
            stmt = stmt.where(CardHolder.user_id == self.user_id)
        existing = (await self.db.execute(stmt)).scalar_one_or_none()
        if existing:
            cache[card_number] = existing.id
            return existing.id
        ch = CardHolder(card_number=card_number, user_id=self.user_id)
        self.db.add(ch)
        await self.db.flush()
        cache[card_number] = ch.id
        return ch.id

    async def get_with_stats(self, cardholder_id: int):  # type: ignore[return]
        txn_count_expr = (
            select(func.count(Transaction.id))
            .where(Transaction.cardholder_id == CardHolder.id)
            .correlate(CardHolder)
            .scalar_subquery()
        )
        txn_total_expr = (
            select(func.coalesce(func.sum(Transaction.amount), 0))
            .where(Transaction.cardholder_id == CardHolder.id)
            .correlate(CardHolder)
            .scalar_subquery()
        )
        row = (
            await self.db.execute(
                select(
                    CardHolder.id,
                    CardHolder.name,
                    CardHolder.card_number,
                    txn_count_expr.label("transaction_count"),
                    txn_total_expr.label("total_amount"),
                ).where(CardHolder.id == cardholder_id)
            )
        ).one_or_none()
        return row

    async def update(
        self, cardholder: CardHolder, name: str | None, card_number: str | None
    ) -> None:
        cardholder.name = name
        cardholder.card_number = card_number

    async def paginate(
        self,
        name: str | None,
        card_number: str | None,
        sort_by: str,
        sort_dir: str,
        limit: int,
        after_id: int | None,
    ) -> tuple[list, bool, int | None]:
        txn_count_expr = (
            select(func.count(Transaction.id))
            .where(Transaction.cardholder_id == CardHolder.id)
            .correlate(CardHolder)
            .scalar_subquery()
        )
        txn_total_expr = (
            select(func.coalesce(func.sum(Transaction.amount), 0))
            .where(Transaction.cardholder_id == CardHolder.id)
            .correlate(CardHolder)
            .scalar_subquery()
        )
        sort_expr = {
            "name": CardHolder.name,
            "card_number": CardHolder.card_number,
            "transaction_count": txn_count_expr,
            "total_amount": txn_total_expr,
        }[sort_by]

        if sort_dir == "desc":
            order_clauses = [sort_expr.desc().nulls_last(), CardHolder.id.desc()]
        else:
            order_clauses = [sort_expr.asc().nulls_last(), CardHolder.id.asc()]

        conditions = []
        if self.user_id is not None:
            conditions.append(CardHolder.user_id == self.user_id)
        if name:
            conditions.append(CardHolder.name.ilike(f"%{name}%"))
        if card_number:
            conditions.append(CardHolder.card_number.ilike(f"%{card_number}%"))

        if after_id is not None:
            cur = await self.db.get(CardHolder, after_id)
            if sort_by == "transaction_count":
                cursor_val = await self.db.scalar(
                    select(func.count(Transaction.id)).where(
                        Transaction.cardholder_id == after_id
                    )
                )
            elif sort_by == "total_amount":
                cursor_val = await self.db.scalar(
                    select(func.coalesce(func.sum(Transaction.amount), 0)).where(
                        Transaction.cardholder_id == after_id
                    )
                )
            else:
                cursor_val = getattr(cur, sort_by)

            id_cmp = (
                (CardHolder.id < after_id)
                if sort_dir == "desc"
                else (CardHolder.id > after_id)
            )
            if cursor_val is None:
                conditions.append(and_(sort_expr.is_(None), id_cmp))
            else:
                beyond = (
                    (sort_expr < cursor_val)
                    if sort_dir == "desc"
                    else (sort_expr > cursor_val)
                )
                tied = and_(sort_expr == cursor_val, id_cmp)
                conditions.append(or_(beyond, tied, sort_expr.is_(None)))

        rows = (
            await self.db.execute(
                select(
                    CardHolder.id,
                    CardHolder.name,
                    CardHolder.card_number,
                    txn_count_expr.label("transaction_count"),
                    txn_total_expr.label("total_amount"),
                )
                .where(*conditions)
                .order_by(*order_clauses)
                .limit(limit + 1)
            )
        ).all()

        has_more = len(rows) > limit
        items = rows[:limit]
        next_cursor = items[-1].id if has_more and items else None
        return items, has_more, next_cursor


class AccountQueries:
    def __init__(self, db: AsyncSession, user_id: int | None = None) -> None:
        self.db = db
        self.user_id = user_id

    async def get_by_id(self, account_id: int) -> Account | None:
        return await self.db.get(Account, account_id)

    async def get_stats(self, account_id: int) -> tuple[int, Decimal]:
        count = (
            await self.db.scalar(
                select(func.count(Transaction.id)).where(
                    Transaction.account_id == account_id
                )
            )
            or 0
        )
        total = await self.db.scalar(
            select(func.coalesce(func.sum(Transaction.amount), 0)).where(
                Transaction.account_id == account_id
            )
        ) or Decimal(0)
        return count, total

    async def find_by_name(self, name: str) -> Account | None:
        stmt = select(Account).where(Account.name == name)
        if self.user_id is not None:
            stmt = stmt.where(Account.user_id == self.user_id)
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()

    async def find_or_create(self, name: str) -> Account:
        account = await self.find_by_name(name)
        if account is None:
            account = Account(name=name, user_id=self.user_id)
            self.db.add(account)
            await self.db.flush()
        return account

    async def list(
        self,
        name: str | None,
        institution: str | None,
        account_type: str | None,
        sort_by: str,
        sort_dir: str,
        limit: int,
        after_id: int | None,
    ) -> tuple[list, bool, int | None]:
        txn_count_expr = (
            select(func.count(Transaction.id))
            .where(Transaction.account_id == Account.id)
            .correlate(Account)
            .scalar_subquery()
        )
        txn_total_expr = (
            select(func.coalesce(func.sum(Transaction.amount), 0))
            .where(Transaction.account_id == Account.id)
            .correlate(Account)
            .scalar_subquery()
        )
        sort_expr = {
            "name": Account.name,
            "institution": Account.institution,
            "account_type": Account.account_type,
            "created_at": Account.created_at,
            "transaction_count": txn_count_expr,
            "total_amount": txn_total_expr,
        }[sort_by]

        if sort_dir == "desc":
            order_clauses = [sort_expr.desc().nulls_last(), Account.id.desc()]
        else:
            order_clauses = [sort_expr.asc().nulls_last(), Account.id.asc()]

        conditions = []
        if self.user_id is not None:
            conditions.append(Account.user_id == self.user_id)
        if name:
            conditions.append(Account.name.ilike(f"%{name}%"))
        if institution:
            conditions.append(Account.institution.ilike(f"%{institution}%"))
        if account_type:
            conditions.append(Account.account_type.ilike(f"%{account_type}%"))

        if after_id is not None:
            cur = await self.db.get(Account, after_id)
            if sort_by == "transaction_count":
                cursor_val = await self.db.scalar(
                    select(func.count(Transaction.id)).where(
                        Transaction.account_id == after_id
                    )
                )
            elif sort_by == "total_amount":
                cursor_val = await self.db.scalar(
                    select(func.coalesce(func.sum(Transaction.amount), 0)).where(
                        Transaction.account_id == after_id
                    )
                )
            else:
                cursor_val = getattr(cur, sort_by)

            id_cmp = (
                (Account.id < after_id)
                if sort_dir == "desc"
                else (Account.id > after_id)
            )
            if cursor_val is None:
                conditions.append(and_(sort_expr.is_(None), id_cmp))
            else:
                beyond = (
                    (sort_expr < cursor_val)
                    if sort_dir == "desc"
                    else (sort_expr > cursor_val)
                )
                tied = and_(sort_expr == cursor_val, id_cmp)
                conditions.append(or_(beyond, tied, sort_expr.is_(None)))

        rows = (
            await self.db.execute(
                select(
                    Account.id,
                    Account.name,
                    Account.institution,
                    Account.account_type,
                    Account.created_at,
                    txn_count_expr.label("transaction_count"),
                    txn_total_expr.label("total_amount"),
                )
                .where(*conditions)
                .order_by(*order_clauses)
                .limit(limit + 1)
            )
        ).all()

        has_more = len(rows) > limit
        items = rows[:limit]
        next_cursor = items[-1].id if has_more and items else None
        return items, has_more, next_cursor


class CsvImportQueries:
    def __init__(self, db: AsyncSession, user_id: int | None = None) -> None:
        self.db = db
        self.user_id = user_id

    async def get_by_id(self, import_id: int) -> CsvImport | None:
        return await self.db.get(CsvImport, import_id)

    async def find_by_filename(self, filename: str) -> CsvImport | None:
        stmt = select(CsvImport).where(CsvImport.filename == filename)
        if self.user_id is not None:
            stmt = stmt.where(CsvImport.user_id == self.user_id)
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()

    async def list(
        self,
        filename: str | None,
        account: str | None,
        sort_by: str,
        sort_dir: str,
        limit: int,
        after_id: int | None,
    ) -> tuple[list, bool, int | None]:
        txn_count_expr = (
            select(func.count(Transaction.id))
            .where(Transaction.csv_import_id == CsvImport.id)
            .correlate(CsvImport)
            .scalar_subquery()
        )
        account_name_expr = (
            select(Account.name)
            .where(Account.id == CsvImport.account_id)
            .correlate(CsvImport)
            .scalar_subquery()
        )
        sort_expr = {
            "filename": CsvImport.filename,
            "account": account_name_expr,
            "imported_at": CsvImport.imported_at,
            "row_count": CsvImport.row_count,
            "transaction_count": txn_count_expr,
        }[sort_by]

        if sort_dir == "desc":
            order_clauses = [sort_expr.desc().nulls_last(), CsvImport.id.desc()]
        else:
            order_clauses = [sort_expr.asc().nulls_last(), CsvImport.id.asc()]

        conditions = []
        if self.user_id is not None:
            conditions.append(CsvImport.user_id == self.user_id)
        if filename:
            conditions.append(CsvImport.filename.ilike(f"%{filename}%"))
        if account:
            conditions.append(account_name_expr.ilike(f"%{account}%"))

        if after_id is not None:
            cur = await self.db.get(CsvImport, after_id)
            if sort_by == "transaction_count":
                cursor_val = await self.db.scalar(
                    select(func.count(Transaction.id)).where(
                        Transaction.csv_import_id == after_id
                    )
                )
            elif sort_by == "account":
                cursor_val = await self.db.scalar(
                    select(Account.name).where(Account.id == cur.account_id)
                )
            else:
                cursor_val = getattr(cur, sort_by)

            id_cmp = (
                (CsvImport.id < after_id)
                if sort_dir == "desc"
                else (CsvImport.id > after_id)
            )
            if cursor_val is None:
                conditions.append(and_(sort_expr.is_(None), id_cmp))
            else:
                beyond = (
                    (sort_expr < cursor_val)
                    if sort_dir == "desc"
                    else (sort_expr > cursor_val)
                )
                tied = and_(sort_expr == cursor_val, id_cmp)
                conditions.append(or_(beyond, tied, sort_expr.is_(None)))

        rows = (
            await self.db.execute(
                select(
                    CsvImport.id,
                    CsvImport.filename,
                    CsvImport.imported_at,
                    CsvImport.row_count,
                    CsvImport.enriched_rows,
                    CsvImport.status,
                    account_name_expr.label("account"),
                    txn_count_expr.label("transaction_count"),
                )
                .where(*conditions)
                .order_by(*order_clauses)
                .limit(limit + 1)
            )
        ).all()

        has_more = len(rows) > limit
        items = rows[:limit]
        next_cursor = items[-1].id if has_more and items else None
        return items, has_more, next_cursor

    async def upsert(
        self,
        account_id: int,
        filename: str,
        row_count: int,
        column_mapping: dict,
        existing: CsvImport | None,
    ) -> CsvImport:
        if existing:
            await self.db.execute(
                delete(Transaction).where(Transaction.csv_import_id == existing.id)
            )
            existing.account_id = account_id
            existing.imported_at = datetime.utcnow()
            existing.row_count = row_count
            existing.enriched_rows = 0
            existing.status = "in-progress"
            existing.column_mapping = json.dumps(column_mapping)
            csv_import = existing
        else:
            csv_import = CsvImport(
                account_id=account_id,
                filename=filename,
                row_count=row_count,
                column_mapping=json.dumps(column_mapping),
                status="in-progress",
                user_id=self.user_id,
            )
            self.db.add(csv_import)
        await self.db.flush()
        return csv_import

    async def mark_complete(self, import_id: int) -> None:
        await self.db.execute(
            update(CsvImport).where(CsvImport.id == import_id).values(status="complete")
        )

    async def mark_aborted(self, import_id: int) -> None:
        await self.db.execute(
            update(CsvImport).where(CsvImport.id == import_id).values(status="aborted")
        )
        await self.db.commit()

    async def increment_enriched(self, import_id: int, count: int) -> None:
        await self.db.execute(
            update(CsvImport)
            .where(CsvImport.id == import_id)
            .values(enriched_rows=CsvImport.enriched_rows + count)
        )

    async def reset_for_reenrichment(self, import_id: int) -> None:
        await self.db.execute(
            update(CsvImport)
            .where(CsvImport.id == import_id)
            .values(status="in-progress", enriched_rows=0)
        )


class MerchantQueries:
    def __init__(self, db: AsyncSession, user_id: int | None = None) -> None:
        self.db = db
        self.user_id = user_id

    async def get_by_id(self, merchant_id: int) -> Merchant | None:
        return await self.db.get(Merchant, merchant_id)

    async def get_stats(self, merchant_id: int) -> tuple[int, Decimal]:
        count = (
            await self.db.scalar(
                select(func.count(Transaction.id)).where(
                    Transaction.merchant_id == merchant_id
                )
            )
            or 0
        )
        total = await self.db.scalar(
            select(func.coalesce(func.sum(Transaction.amount), 0)).where(
                Transaction.merchant_id == merchant_id
            )
        ) or Decimal(0)
        return count, total

    async def paginate(
        self,
        name: str | None,
        location: str | None,
        sort_by: str,
        sort_dir: str,
        limit: int,
        after_id: int | None,
    ) -> tuple[list, bool, int | None]:
        txn_count_expr = (
            select(func.count(Transaction.id))
            .where(Transaction.merchant_id == Merchant.id)
            .correlate(Merchant)
            .scalar_subquery()
        )
        txn_total_expr = (
            select(func.coalesce(func.sum(Transaction.amount), 0))
            .where(Transaction.merchant_id == Merchant.id)
            .correlate(Merchant)
            .scalar_subquery()
        )
        sort_expr = {
            "name": Merchant.name,
            "transaction_count": txn_count_expr,
            "total_amount": txn_total_expr,
        }[sort_by]

        if sort_dir == "desc":
            order_clauses = [sort_expr.desc().nulls_last(), Merchant.id.desc()]
        else:
            order_clauses = [sort_expr.asc().nulls_last(), Merchant.id.asc()]

        conditions = []
        if self.user_id is not None:
            conditions.append(Merchant.user_id == self.user_id)
        if name:
            conditions.append(Merchant.name.ilike(f"%{name}%"))
        if location:
            conditions.append(Merchant.location.ilike(f"%{location}%"))

        if after_id is not None:
            cur = await self.db.get(Merchant, after_id)
            if sort_by == "transaction_count":
                cursor_val = await self.db.scalar(
                    select(func.count(Transaction.id)).where(
                        Transaction.merchant_id == after_id
                    )
                )
            elif sort_by == "total_amount":
                cursor_val = await self.db.scalar(
                    select(func.coalesce(func.sum(Transaction.amount), 0)).where(
                        Transaction.merchant_id == after_id
                    )
                )
            else:
                cursor_val = cur.name

            id_cmp = (
                (Merchant.id < after_id)
                if sort_dir == "desc"
                else (Merchant.id > after_id)
            )
            if cursor_val is None:
                conditions.append(and_(sort_expr.is_(None), id_cmp))
            else:
                beyond = (
                    (sort_expr < cursor_val)
                    if sort_dir == "desc"
                    else (sort_expr > cursor_val)
                )
                tied = and_(sort_expr == cursor_val, id_cmp)
                conditions.append(or_(beyond, tied, sort_expr.is_(None)))

        rows = (
            await self.db.execute(
                select(
                    Merchant.id,
                    Merchant.name,
                    Merchant.location,
                    txn_count_expr.label("transaction_count"),
                    txn_total_expr.label("total_amount"),
                )
                .where(*conditions)
                .order_by(*order_clauses)
                .limit(limit + 1)
            )
        ).all()

        has_more = len(rows) > limit
        items = rows[:limit]
        next_cursor = items[-1].id if has_more and items else None
        return items, has_more, next_cursor

    async def update(self, merchant: Merchant, name: str, location: str | None) -> None:
        merchant.name = name
        merchant.location = location

    async def list_for_duplicate_detection(self) -> list:
        txn_count_expr = (
            select(func.count(Transaction.id))
            .where(Transaction.merchant_id == Merchant.id)
            .correlate(Merchant)
            .scalar_subquery()
        )
        conditions = []
        if self.user_id is not None:
            conditions.append(Merchant.user_id == self.user_id)
        rows = (
            await self.db.execute(
                select(
                    Merchant.id,
                    Merchant.name,
                    Merchant.location,
                    txn_count_expr.label("transaction_count"),
                )
                .where(*conditions)
                .order_by(Merchant.id)
            )
        ).all()
        return rows

    async def get_by_ids(self, ids: list[int]) -> list[Merchant]:
        rows = (
            (await self.db.execute(select(Merchant).where(Merchant.id.in_(ids))))
            .scalars()
            .all()
        )
        return list(rows)

    async def merge(
        self,
        winner: Merchant,
        loser_ids: list[int],
        canonical_name: str,
        canonical_location: str | None,
    ) -> None:
        winner.name = canonical_name
        winner.location = canonical_location
        await self.db.execute(
            update(Transaction)
            .where(Transaction.merchant_id.in_(loser_ids))
            .values(merchant_id=winner.id)
        )
        await self.db.execute(delete(Merchant).where(Merchant.id.in_(loser_ids)))
        await self.db.flush()

    async def find_or_create_for_enrichment(
        self,
        name: str,
        location: str | None,
        cache: dict[str, tuple[int, bool]],
    ) -> int:
        if name not in cache:
            stmt = select(Merchant).where(Merchant.name == name)
            if self.user_id is not None:
                stmt = stmt.where(Merchant.user_id == self.user_id)
            res = await self.db.execute(stmt)
            m = res.scalar_one_or_none()
            if m is None:
                m = Merchant(name=name, location=location, user_id=self.user_id)
                self.db.add(m)
                await self.db.flush()
                cache[name] = (m.id, location is not None)
            else:
                if m.location is None and location is not None:
                    m.location = location
                    await self.db.flush()
                cache[name] = (m.id, m.location is not None)
        else:
            cached_id, has_location = cache[name]
            if not has_location and location is not None:
                await self.db.execute(
                    update(Merchant)
                    .where(Merchant.id == cached_id)
                    .values(location=location)
                )
                await self.db.flush()
                cache[name] = (cached_id, True)
        return cache[name][0]


class TransactionQueries:
    def __init__(self, db: AsyncSession, user_id: int | None = None) -> None:
        self.db = db
        self.user_id = user_id

    def build_conditions(
        self,
        *,
        date_from=None,
        date_to=None,
        description=None,
        amount_min=None,
        amount_max=None,
        merchant=None,
        category=None,
        subcategory=None,
        account=None,
        import_id=None,
        is_recurring=None,
        uncategorized=None,
        cardholder=None,
    ) -> list:
        conditions = []
        if self.user_id is not None:
            conditions.append(Transaction.user_id == self.user_id)
        if date_from:
            conditions.append(Transaction.date >= date_from)
        if date_to:
            conditions.append(Transaction.date <= date_to)
        if description:
            conditions.append(Transaction.description.ilike(f"%{description}%"))
        if amount_min is not None:
            conditions.append(Transaction.amount >= amount_min)
        if amount_max is not None:
            conditions.append(Transaction.amount <= amount_max)
        if merchant:
            merchant_ids = select(Merchant.id).where(
                Merchant.name.ilike(f"%{merchant}%")
            )
            conditions.append(Transaction.merchant_id.in_(merchant_ids))
        if category:
            cat_sub_ids = (
                select(Subcategory.id)
                .join(Category, Subcategory.category_id == Category.id)
                .where(Category.name.ilike(f"%{category}%"))
            )
            conditions.append(Transaction.subcategory_id.in_(cat_sub_ids))
        if subcategory:
            sub_ids = select(Subcategory.id).where(
                Subcategory.name.ilike(f"%{subcategory}%")
            )
            conditions.append(Transaction.subcategory_id.in_(sub_ids))
        if account:
            account_ids = select(Account.id).where(Account.name.ilike(f"%{account}%"))
            conditions.append(Transaction.account_id.in_(account_ids))
        if import_id is not None:
            conditions.append(Transaction.csv_import_id == import_id)
        if is_recurring is not None:
            conditions.append(Transaction.is_recurring == is_recurring)
        if uncategorized:
            conditions.append(Transaction.subcategory_id.is_(None))
        if cardholder:
            ch_ids = select(CardHolder.id).where(
                or_(
                    CardHolder.card_number.ilike(f"%{cardholder}%"),
                    CardHolder.name.ilike(f"%{cardholder}%"),
                )
            )
            conditions.append(Transaction.cardholder_id.in_(ch_ids))
        return conditions

    async def count(self, conditions: list) -> int:
        return (
            await self.db.scalar(select(func.count(Transaction.id)).where(*conditions))
            or 0
        )

    async def list(
        self,
        conditions: list,
        sort_by: str,
        sort_dir: str,
        limit: int,
        after_id: int | None,
    ) -> tuple[list, bool, int | None]:
        sort_expr = {
            "date": Transaction.date,
            "amount": Transaction.amount,
            "description": Transaction.description,
            "merchant": select(Merchant.name)
            .where(Merchant.id == Transaction.merchant_id)
            .correlate(Transaction)
            .scalar_subquery(),
            "category": select(Category.name)
            .where(
                Category.id
                == select(Subcategory.category_id)
                .where(Subcategory.id == Transaction.subcategory_id)
                .correlate(Transaction)
                .scalar_subquery()
            )
            .correlate(Transaction)
            .scalar_subquery(),
            "account": select(Account.name)
            .where(Account.id == Transaction.account_id)
            .correlate(Transaction)
            .scalar_subquery(),
        }[sort_by]

        if sort_dir == "desc":
            order_clauses = [sort_expr.desc().nulls_last(), Transaction.id.desc()]
        else:
            order_clauses = [sort_expr.asc().nulls_last(), Transaction.id.asc()]

        # Copy conditions to avoid mutating the caller's list
        conds = list(conditions)

        if after_id is not None:
            cur = await self.get_by_id(after_id)
            assert cur is not None, f"Transaction {after_id} not found"
            cursor_val = {
                "date": cur.date,
                "amount": cur.amount,
                "description": cur.description,
                "merchant": cur.merchant.name if cur.merchant else None,
                "category": cur.subcategory.category.name if cur.subcategory else None,
                "account": cur.account.name,
            }[sort_by]

            id_cmp = (
                (Transaction.id < after_id)
                if sort_dir == "desc"
                else (Transaction.id > after_id)
            )
            if cursor_val is None:
                conds.append(and_(sort_expr.is_(None), id_cmp))
            else:
                beyond = (
                    (sort_expr < cursor_val)
                    if sort_dir == "desc"
                    else (sort_expr > cursor_val)
                )
                tied = and_(sort_expr == cursor_val, id_cmp)
                conds.append(or_(beyond, tied, sort_expr.is_(None)))

        result = await self.db.execute(
            select(Transaction)
            .where(*conds)
            .options(
                selectinload(Transaction.account),
                selectinload(Transaction.merchant),
                selectinload(Transaction.subcategory).selectinload(
                    Subcategory.category
                ),
                selectinload(Transaction.cardholder),
            )
            .order_by(*order_clauses)
            .limit(limit + 1)
        )
        rows = result.scalars().all()

        has_more = len(rows) > limit
        items = list(rows[:limit])
        next_cursor = items[-1].id if has_more and items else None
        return items, has_more, next_cursor

    async def get_by_id(self, transaction_id: int) -> Transaction | None:
        return (
            await self.db.execute(
                select(Transaction)
                .where(Transaction.id == transaction_id)
                .options(
                    selectinload(Transaction.account),
                    selectinload(Transaction.merchant),
                    selectinload(Transaction.subcategory).selectinload(
                        Subcategory.category
                    ),
                    selectinload(Transaction.cardholder),
                )
            )
        ).scalar_one_or_none()

    async def get_by_ids(self, ids: Sequence[int]) -> Sequence[Transaction]:
        result = await self.db.execute(
            select(Transaction)
            .where(Transaction.id.in_(ids))
            .options(
                selectinload(Transaction.account),
                selectinload(Transaction.merchant),
                selectinload(Transaction.subcategory).selectinload(
                    Subcategory.category
                ),
                selectinload(Transaction.cardholder),
            )
        )
        return list(result.scalars().all())

    async def find_or_create_merchant(self, name: str) -> Merchant:
        stmt = select(Merchant).where(Merchant.name.ilike(name))
        if self.user_id is not None:
            stmt = stmt.where(Merchant.user_id == self.user_id)
        merchant = (await self.db.execute(stmt)).scalar_one_or_none()
        if merchant is None:
            merchant = Merchant(name=name, user_id=self.user_id)
            self.db.add(merchant)
            await self.db.flush()
        return merchant

    async def find_or_create_category(self, name: str) -> Category:
        stmt = select(Category).where(Category.name.ilike(name))
        if self.user_id is not None:
            stmt = stmt.where(Category.user_id == self.user_id)
        category = (await self.db.execute(stmt)).scalar_one_or_none()
        if category is None:
            category = Category(name=name, user_id=self.user_id)
            self.db.add(category)
            await self.db.flush()
        return category

    async def find_or_create_subcategory(
        self, category_id: int, name: str
    ) -> Subcategory:
        subcategory = (
            await self.db.execute(
                select(Subcategory).where(
                    Subcategory.category_id == category_id,
                    Subcategory.name.ilike(name),
                )
            )
        ).scalar_one_or_none()
        if subcategory is None:
            subcategory = Subcategory(category_id=category_id, name=name)
            self.db.add(subcategory)
            await self.db.flush()
        return subcategory
