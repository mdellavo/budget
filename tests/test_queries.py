"""Tests for query helper classes in budget/query.py.

Each test gets a fresh in-memory SQLite database via the engine/db_session fixtures.
"""

from datetime import date
from decimal import Decimal

from budget.models import Merchant, Transaction
from budget.query import (
    AccountQueries,
    AnalyticsQueries,
    CategoryQueries,
    CsvImportQueries,
    MerchantQueries,
    TransactionQueries,
)

# ---------------------------------------------------------------------------
# AccountQueries
# ---------------------------------------------------------------------------


class TestAccountQueries:
    async def test_find_or_create_new(self, db_session):
        aq = AccountQueries(db_session)
        acct = await aq.find_or_create("Checking")
        await db_session.commit()
        assert acct.id is not None
        assert acct.name == "Checking"

    async def test_find_or_create_no_duplicate(self, db_session):
        aq = AccountQueries(db_session)
        a1 = await aq.find_or_create("Checking")
        await db_session.commit()
        a2 = await aq.find_or_create("Checking")
        await db_session.commit()
        assert a1.id == a2.id

    async def test_list_empty(self, db_session):
        aq = AccountQueries(db_session)
        items, has_more, cursor = await aq.list(
            name=None,
            institution=None,
            account_type=None,
            sort_by="name",
            sort_dir="asc",
            limit=50,
            after_id=None,
        )
        assert items == []
        assert has_more is False
        assert cursor is None

    async def test_list_name_filter(self, db_session, make_account):
        await make_account("Checking")
        await make_account("Savings")
        aq = AccountQueries(db_session)
        items, _, _ = await aq.list(
            name="check",
            institution=None,
            account_type=None,
            sort_by="name",
            sort_dir="asc",
            limit=50,
            after_id=None,
        )
        assert len(items) == 1
        assert items[0].name == "Checking"

    async def test_list_cursor_pagination(self, db_session, make_account):
        for i in range(1, 6):
            await make_account(f"Account {i:02d}")
        aq = AccountQueries(db_session)
        page1, has_more, cursor = await aq.list(
            name=None,
            institution=None,
            account_type=None,
            sort_by="name",
            sort_dir="asc",
            limit=3,
            after_id=None,
        )
        assert len(page1) == 3
        assert has_more is True
        assert cursor is not None
        page2, has_more2, _ = await aq.list(
            name=None,
            institution=None,
            account_type=None,
            sort_by="name",
            sort_dir="asc",
            limit=3,
            after_id=cursor,
        )
        assert len(page2) == 2
        assert has_more2 is False
        # no overlap
        ids1 = {r.id for r in page1}
        ids2 = {r.id for r in page2}
        assert ids1.isdisjoint(ids2)


# ---------------------------------------------------------------------------
# CsvImportQueries
# ---------------------------------------------------------------------------


class TestCsvImportQueries:
    async def test_upsert_new(self, db_session, make_account):
        acct = await make_account()
        csq = CsvImportQueries(db_session)
        ci = await csq.upsert(
            acct.id, "data.csv", 10, {"date": 0, "amount": 1, "description": 2}, None
        )
        await db_session.commit()
        assert ci.id is not None
        assert ci.status == "in-progress"
        assert ci.enriched_rows == 0
        assert ci.row_count == 10

    async def test_upsert_reimport_resets(
        self, db_session, make_account, make_transaction
    ):
        acct = await make_account()
        csq = CsvImportQueries(db_session)
        existing = await csq.upsert(
            acct.id, "data.csv", 5, {"date": 0, "amount": 1, "description": 2}, None
        )
        await db_session.commit()
        # Add a transaction linked to this import
        await make_transaction(account_id=acct.id, csv_import_id=existing.id)
        # Re-import
        refreshed = await csq.get_by_id(existing.id)
        ci2 = await csq.upsert(
            acct.id,
            "data.csv",
            8,
            {"date": 0, "amount": 1, "description": 2},
            refreshed,
        )
        await db_session.commit()
        assert ci2.id == existing.id
        assert ci2.enriched_rows == 0
        assert ci2.row_count == 8
        assert ci2.status == "in-progress"
        # Old transactions deleted
        from sqlalchemy import select

        count = await db_session.scalar(
            select(__import__("sqlalchemy").func.count(Transaction.id)).where(
                Transaction.csv_import_id == existing.id
            )
        )
        assert count == 0

    async def test_mark_complete(self, db_session, make_account):
        acct = await make_account()
        csq = CsvImportQueries(db_session)
        ci = await csq.upsert(
            acct.id, "data.csv", 5, {"date": 0, "amount": 1, "description": 2}, None
        )
        await db_session.commit()
        await csq.mark_complete(ci.id)
        await db_session.commit()
        await db_session.refresh(ci)
        assert ci.status == "complete"

    async def test_increment_enriched(self, db_session, make_account):
        acct = await make_account()
        csq = CsvImportQueries(db_session)
        ci = await csq.upsert(
            acct.id, "data.csv", 20, {"date": 0, "amount": 1, "description": 2}, None
        )
        await db_session.commit()
        await csq.increment_enriched(ci.id, 10)
        await db_session.commit()
        await csq.increment_enriched(ci.id, 5)
        await db_session.commit()
        await db_session.refresh(ci)
        assert ci.enriched_rows == 15

    async def test_find_by_filename_found(self, db_session, make_account):
        acct = await make_account()
        csq = CsvImportQueries(db_session)
        ci = await csq.upsert(
            acct.id, "bank.csv", 5, {"date": 0, "amount": 1, "description": 2}, None
        )
        await db_session.commit()
        found = await csq.find_by_filename("bank.csv")
        assert found is not None
        assert found.id == ci.id

    async def test_find_by_filename_not_found(self, db_session):
        csq = CsvImportQueries(db_session)
        result = await csq.find_by_filename("nonexistent.csv")
        assert result is None


# ---------------------------------------------------------------------------
# MerchantQueries
# ---------------------------------------------------------------------------


class TestMerchantQueries:
    async def test_find_or_create_for_enrichment_new(self, db_session):
        mq = MerchantQueries(db_session)
        cache: dict = {}
        mid = await mq.find_or_create_for_enrichment("Starbucks", "Seattle, WA", cache)
        await db_session.commit()
        assert mid is not None
        assert "Starbucks" in cache

    async def test_find_or_create_for_enrichment_cache_hit(self, db_session):
        mq = MerchantQueries(db_session)
        cache: dict = {}
        mid1 = await mq.find_or_create_for_enrichment("Starbucks", None, cache)
        await db_session.commit()
        mid2 = await mq.find_or_create_for_enrichment("Starbucks", None, cache)
        assert mid1 == mid2

    async def test_find_or_create_updates_null_location(self, db_session):
        mq = MerchantQueries(db_session)
        cache: dict = {}
        mid = await mq.find_or_create_for_enrichment("Target", None, cache)
        await db_session.commit()
        # Second call with location provided — should update
        mid2 = await mq.find_or_create_for_enrichment("Target", "Austin, TX", cache)
        await db_session.commit()
        assert mid == mid2
        m = await db_session.get(Merchant, mid)
        assert m.location == "Austin, TX"

    async def test_merge(
        self, db_session, make_account, make_merchant, make_transaction
    ):
        acct = await make_account()
        m1 = await make_merchant("AMZN")
        m2 = await make_merchant("AMAZON.COM")
        await make_transaction(acct.id, merchant_id=m1.id)
        tx2 = await make_transaction(acct.id, merchant_id=m2.id)
        mq = MerchantQueries(db_session)
        await mq.merge(m1, [m2.id], "Amazon", None)
        await db_session.commit()
        # m2 should be deleted
        assert await db_session.get(Merchant, m2.id) is None
        # tx2 should now point to m1
        await db_session.refresh(tx2)
        assert tx2.merchant_id == m1.id
        # m1 name updated
        await db_session.refresh(m1)
        assert m1.name == "Amazon"

    async def test_list_for_duplicate_detection(
        self, db_session, make_account, make_merchant, make_transaction
    ):
        acct = await make_account()
        m = await make_merchant("Starbucks")
        await make_transaction(acct.id, merchant_id=m.id)
        await make_transaction(acct.id, merchant_id=m.id)
        mq = MerchantQueries(db_session)
        rows = await mq.list_for_duplicate_detection()
        assert len(rows) == 1
        assert rows[0].name == "Starbucks"
        assert rows[0].transaction_count == 2

    async def test_list_location_filter(self, db_session, make_merchant):
        await make_merchant("Starbucks", "Seattle, WA")
        await make_merchant("Target", "Austin, TX")
        await make_merchant("Amazon")  # no location
        mq = MerchantQueries(db_session)
        items, _, _ = await mq.list(
            name=None,
            location="seattle",
            sort_by="name",
            sort_dir="asc",
            limit=50,
            after_id=None,
        )
        assert len(items) == 1
        assert items[0].name == "Starbucks"


# ---------------------------------------------------------------------------
# CategoryQueries
# ---------------------------------------------------------------------------


class TestCategoryQueries:
    async def test_find_or_create_for_enrichment_new(self, db_session):
        cq = CategoryQueries(db_session)
        cache: dict = {}
        cid = await cq.find_or_create_for_enrichment("Food & Drink", cache)
        await db_session.commit()
        assert cid is not None
        assert cache["Food & Drink"] == cid

    async def test_find_or_create_for_enrichment_cache_hit(self, db_session):
        cq = CategoryQueries(db_session)
        cache: dict = {}
        cid1 = await cq.find_or_create_for_enrichment("Food & Drink", cache)
        await db_session.commit()
        cid2 = await cq.find_or_create_for_enrichment("Food & Drink", cache)
        assert cid1 == cid2

    async def test_find_or_create_subcategory_for_enrichment(self, db_session):
        cq = CategoryQueries(db_session)
        cat_cache: dict = {}
        sub_cache: dict = {}
        cid = await cq.find_or_create_for_enrichment("Food & Drink", cat_cache)
        await db_session.commit()
        sid = await cq.find_or_create_subcategory_for_enrichment(
            cid, "Restaurants", sub_cache
        )
        await db_session.commit()
        assert sid is not None
        assert (cid, "Restaurants") in sub_cache

    async def test_find_or_create_subcategory_cache_hit(self, db_session):
        cq = CategoryQueries(db_session)
        cat_cache: dict = {}
        sub_cache: dict = {}
        cid = await cq.find_or_create_for_enrichment("Shopping", cat_cache)
        await db_session.commit()
        sid1 = await cq.find_or_create_subcategory_for_enrichment(
            cid, "Online Shopping", sub_cache
        )
        await db_session.commit()
        sid2 = await cq.find_or_create_subcategory_for_enrichment(
            cid, "Online Shopping", sub_cache
        )
        assert sid1 == sid2

    async def test_list_all(self, db_session):
        cq = CategoryQueries(db_session)
        cat_cache: dict = {}
        sub_cache: dict = {}
        cid = await cq.find_or_create_for_enrichment("Food & Drink", cat_cache)
        await db_session.commit()
        await cq.find_or_create_subcategory_for_enrichment(
            cid, "Restaurants", sub_cache
        )
        await cq.find_or_create_subcategory_for_enrichment(
            cid, "Coffee & Tea", sub_cache
        )
        await db_session.commit()
        rows = await cq.list_all()
        assert len(rows) == 2
        sub_names = {r.sub for r in rows}
        assert sub_names == {"Restaurants", "Coffee & Tea"}

    async def test_list_with_stats_category_filter(
        self, db_session, make_account, make_category, make_transaction
    ):
        acct = await make_account()
        cat1, sub1 = await make_category("Food & Drink", "Restaurants")
        cat2, sub2 = await make_category("Shopping", "Online Shopping")
        await make_transaction(
            acct.id, amount=Decimal("-30.00"), subcategory_id=sub1.id
        )
        await make_transaction(
            acct.id, amount=Decimal("-50.00"), subcategory_id=sub2.id
        )
        cq = CategoryQueries(db_session)
        rows = await cq.list_with_stats(
            date_from=None,
            date_to=None,
            category="food",
            subcategory=None,
            sort_by="category",
            sort_dir="asc",
        )
        assert len(rows) == 1
        assert rows[0].category == "Food & Drink"

    async def test_list_with_stats_date_range(
        self, db_session, make_account, make_category, make_transaction
    ):
        acct = await make_account()
        cat, sub = await make_category("Food & Drink", "Restaurants")
        await make_transaction(
            acct.id,
            amount=Decimal("-30.00"),
            txn_date=date(2024, 1, 15),
            subcategory_id=sub.id,
        )
        await make_transaction(
            acct.id,
            amount=Decimal("-50.00"),
            txn_date=date(2024, 3, 10),
            subcategory_id=sub.id,
        )
        cq = CategoryQueries(db_session)
        rows = await cq.list_with_stats(
            date_from=date(2024, 2, 1),
            date_to=None,
            category=None,
            subcategory=None,
            sort_by="category",
            sort_dir="asc",
        )
        assert len(rows) == 1
        assert rows[0].transaction_count == 1
        assert rows[0].total_amount == Decimal("-50.00")


# ---------------------------------------------------------------------------
# TransactionQueries
# ---------------------------------------------------------------------------


class TestTransactionQueries:
    async def test_build_conditions_date_range(self, db_session):
        txq = TransactionQueries(db_session)
        conds = txq.build_conditions(
            date_from=date(2024, 1, 1),
            date_to=date(2024, 1, 31),
        )
        assert len(conds) == 2

    async def test_build_conditions_merchant_substring(self, db_session):
        txq = TransactionQueries(db_session)
        conds = txq.build_conditions(merchant="starbucks")
        assert len(conds) == 1

    async def test_build_conditions_uncategorized(self, db_session):
        txq = TransactionQueries(db_session)
        conds = txq.build_conditions(uncategorized=True)
        assert len(conds) == 1

    async def test_build_conditions_is_recurring(self, db_session):
        txq = TransactionQueries(db_session)
        conds = txq.build_conditions(is_recurring=True)
        assert len(conds) == 1

    async def test_build_conditions_description(self, db_session):
        txq = TransactionQueries(db_session)
        conds = txq.build_conditions(description="coffee")
        assert len(conds) == 1

    async def test_build_conditions_amount_range(self, db_session):
        txq = TransactionQueries(db_session)
        conds = txq.build_conditions(
            amount_min=Decimal("-100"), amount_max=Decimal("-10")
        )
        assert len(conds) == 2

    async def test_build_conditions_category(self, db_session):
        txq = TransactionQueries(db_session)
        conds = txq.build_conditions(category="Food")
        assert len(conds) == 1

    async def test_build_conditions_account(self, db_session):
        txq = TransactionQueries(db_session)
        conds = txq.build_conditions(account="Checking")
        assert len(conds) == 1

    async def test_build_conditions_import_id(self, db_session):
        txq = TransactionQueries(db_session)
        conds = txq.build_conditions(import_id=42)
        assert len(conds) == 1

    async def test_list_filter_by_description(
        self, db_session, make_account, make_transaction
    ):
        acct = await make_account()
        await make_transaction(acct.id, description="Coffee Run")
        await make_transaction(acct.id, description="Grocery Shopping")
        txq = TransactionQueries(db_session)
        conds = txq.build_conditions(description="coffee")
        items, _, _ = await txq.list(
            conds, sort_by="date", sort_dir="desc", limit=50, after_id=None
        )
        assert len(items) == 1
        assert "Coffee" in items[0].description

    async def test_count_all(self, db_session, make_account, make_transaction):
        acct = await make_account()
        await make_transaction(acct.id)
        await make_transaction(acct.id)
        txq = TransactionQueries(db_session)
        n = await txq.count([])
        assert n == 2

    async def test_count_with_date_filter(
        self, db_session, make_account, make_transaction
    ):
        acct = await make_account()
        await make_transaction(acct.id, txn_date=date(2024, 1, 10))
        await make_transaction(acct.id, txn_date=date(2024, 2, 10))
        txq = TransactionQueries(db_session)
        conds = txq.build_conditions(date_from=date(2024, 2, 1))
        n = await txq.count(conds)
        assert n == 1

    async def test_list_sorted_by_date_desc(
        self, db_session, make_account, make_transaction
    ):
        acct = await make_account()
        await make_transaction(acct.id, txn_date=date(2024, 1, 1))
        await make_transaction(acct.id, txn_date=date(2024, 3, 1))
        await make_transaction(acct.id, txn_date=date(2024, 2, 1))
        txq = TransactionQueries(db_session)
        items, _, _ = await txq.list(
            [], sort_by="date", sort_dir="desc", limit=50, after_id=None
        )
        dates = [tx.date for tx in items]
        assert dates == sorted(dates, reverse=True)

    async def test_list_cursor_pagination(
        self, db_session, make_account, make_transaction
    ):
        acct = await make_account()
        for i in range(1, 6):
            await make_transaction(acct.id, txn_date=date(2024, 1, i))
        txq = TransactionQueries(db_session)
        page1, has_more, cursor = await txq.list(
            [], sort_by="date", sort_dir="desc", limit=3, after_id=None
        )
        assert len(page1) == 3
        assert has_more is True
        page2, has_more2, _ = await txq.list(
            [], sort_by="date", sort_dir="desc", limit=3, after_id=cursor
        )
        assert len(page2) == 2
        assert has_more2 is False
        ids1 = {tx.id for tx in page1}
        ids2 = {tx.id for tx in page2}
        assert ids1.isdisjoint(ids2)

    async def test_get_by_id_missing(self, db_session):
        txq = TransactionQueries(db_session)
        result = await txq.get_by_id(99999)
        assert result is None

    async def test_get_by_id_with_relations(
        self, db_session, make_account, make_merchant, make_category, make_transaction
    ):
        acct = await make_account()
        merchant = await make_merchant("Starbucks")
        cat, sub = await make_category("Food & Drink", "Coffee & Tea")
        tx = await make_transaction(
            acct.id, merchant_id=merchant.id, subcategory_id=sub.id
        )
        txq = TransactionQueries(db_session)
        result = await txq.get_by_id(tx.id)
        assert result is not None
        assert result.merchant.name == "Starbucks"
        assert result.subcategory.name == "Coffee & Tea"
        assert result.subcategory.category.name == "Food & Drink"
        assert result.account.name == "Checking"

    async def test_find_or_create_merchant(self, db_session):
        txq = TransactionQueries(db_session)
        m = await txq.find_or_create_merchant("Target")
        await db_session.commit()
        assert m.id is not None
        m2 = await txq.find_or_create_merchant("Target")
        assert m.id == m2.id

    async def test_find_or_create_category(self, db_session):
        txq = TransactionQueries(db_session)
        cat = await txq.find_or_create_category("Shopping")
        await db_session.commit()
        cat2 = await txq.find_or_create_category("Shopping")
        assert cat.id == cat2.id

    async def test_find_or_create_subcategory(self, db_session):
        txq = TransactionQueries(db_session)
        cat = await txq.find_or_create_category("Shopping")
        await db_session.commit()
        sub = await txq.find_or_create_subcategory(cat.id, "Online Shopping")
        await db_session.commit()
        sub2 = await txq.find_or_create_subcategory(cat.id, "Online Shopping")
        assert sub.id == sub2.id


# ---------------------------------------------------------------------------
# AnalyticsQueries
# ---------------------------------------------------------------------------


class TestAnalyticsQueries:
    async def test_list_months(self, db_session, make_account, make_transaction):
        acct = await make_account()
        await make_transaction(acct.id, txn_date=date(2024, 3, 15))
        await make_transaction(acct.id, txn_date=date(2024, 1, 10))
        await make_transaction(acct.id, txn_date=date(2024, 3, 20))
        aq = AnalyticsQueries(db_session)
        months = await aq.list_months()
        assert months == ["2024-03", "2024-01"]  # desc order

    async def test_get_month_stats(self, db_session, make_account, make_transaction):
        acct = await make_account()
        await make_transaction(
            acct.id, amount=Decimal("1000.00"), txn_date=date(2024, 1, 5)
        )
        await make_transaction(
            acct.id, amount=Decimal("-200.00"), txn_date=date(2024, 1, 10)
        )
        await make_transaction(
            acct.id, amount=Decimal("-50.00"), txn_date=date(2024, 1, 20)
        )
        aq = AnalyticsQueries(db_session)
        stats = await aq.get_month_stats("2024-01")
        assert stats["transaction_count"] == 3
        assert stats["income"] == Decimal("1000.00")
        assert stats["expenses"] == Decimal("-250.00")

    async def test_get_overview_summary(
        self, db_session, make_account, make_transaction
    ):
        acct = await make_account()
        await make_transaction(
            acct.id, amount=Decimal("2000.00"), txn_date=date(2024, 1, 1)
        )
        await make_transaction(
            acct.id, amount=Decimal("-500.00"), txn_date=date(2024, 1, 2)
        )
        aq = AnalyticsQueries(db_session)
        summary = await aq.get_overview_summary()
        assert summary["transaction_count"] == 2
        assert summary["income"] == Decimal("2000.00")
        assert summary["expenses"] == Decimal("-500.00")
        assert summary["net"] == Decimal("1500.00")

    async def test_get_category_breakdown(
        self, db_session, make_account, make_category, make_transaction
    ):
        acct = await make_account()
        cat, sub = await make_category("Food & Drink", "Restaurants")
        await make_transaction(
            acct.id,
            amount=Decimal("-50.00"),
            txn_date=date(2024, 1, 15),
            subcategory_id=sub.id,
        )
        await make_transaction(
            acct.id, amount=Decimal("1000.00"), txn_date=date(2024, 1, 5)
        )  # income, excluded
        aq = AnalyticsQueries(db_session)
        rows = await aq.get_category_breakdown("2024-01")
        assert len(rows) == 1
        assert rows[0].category == "Food & Drink"
        assert rows[0].subcategory == "Restaurants"
        assert rows[0].total == Decimal("-50.00")

    async def test_get_income_by_merchant(
        self, db_session, make_account, make_merchant, make_transaction
    ):
        acct = await make_account()
        m = await make_merchant("Employer Inc")
        await make_transaction(acct.id, amount=Decimal("3000.00"), merchant_id=m.id)
        await make_transaction(acct.id, amount=Decimal("-100.00"))  # expense, excluded
        aq = AnalyticsQueries(db_session)
        rows = await aq.get_income_by_merchant()
        assert len(rows) == 1
        assert rows[0].name == "Employer Inc"
        assert rows[0].total == Decimal("3000.00")

    async def test_get_expenses_by_category(
        self, db_session, make_account, make_category, make_transaction
    ):
        acct = await make_account()
        cat, sub = await make_category("Food & Drink", "Restaurants")
        await make_transaction(acct.id, amount=Decimal("-75.00"), subcategory_id=sub.id)
        await make_transaction(acct.id, amount=Decimal("1000.00"))  # income, excluded
        aq = AnalyticsQueries(db_session)
        rows = await aq.get_expenses_by_category()
        assert len(rows) == 1
        assert rows[0].name == "Food & Drink"
        assert rows[0].total == Decimal("-75.00")

    async def test_get_recurring_transactions(
        self, db_session, make_account, make_merchant, make_transaction
    ):
        acct = await make_account()
        m = await make_merchant("Netflix")
        await make_transaction(acct.id, merchant_id=m.id, is_recurring=True)
        await make_transaction(acct.id, is_recurring=False)  # non-recurring, excluded
        aq = AnalyticsQueries(db_session)
        rows = await aq.get_recurring_transactions()
        assert len(rows) == 1
        assert rows[0].merchant_name == "Netflix"
