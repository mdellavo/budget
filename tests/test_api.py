"""Tests for FastAPI endpoints in budget/main.py.

All tests use the `client` fixture (httpx AsyncClient with ASGITransport).
AI endpoints use `mocker` to patch module-level singletons.
"""

import io
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from budget.database import Base
from budget.jobs import _run_enrichment
from budget.main import _classify_gap, parse_amount, parse_date
from budget.models import Account, CsvImport, Transaction

# ---------------------------------------------------------------------------
# Merchants
# ---------------------------------------------------------------------------


class TestMerchants:
    async def test_list_empty(self, client):
        r = await client.get("/merchants")
        assert r.status_code == 200
        data = r.json()
        assert data["items"] == []
        assert data["has_more"] is False

    async def test_list_with_data(self, client, make_merchant):
        await make_merchant("Starbucks", "Seattle, WA")
        r = await client.get("/merchants")
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) == 1
        item = items[0]
        assert item["name"] == "Starbucks"
        assert item["location"] == "Seattle, WA"
        assert "transaction_count" in item
        assert "total_amount" in item

    async def test_list_name_filter(self, client, make_merchant):
        await make_merchant("Starbucks")
        await make_merchant("Target")
        r = await client.get("/merchants", params={"name": "star"})
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) == 1
        assert items[0]["name"] == "Starbucks"

    async def test_get_by_id_found(self, client, make_merchant):
        m = await make_merchant("Amazon")
        r = await client.get(f"/merchants/{m.id}")
        assert r.status_code == 200
        data = r.json()
        assert data["name"] == "Amazon"
        assert data["id"] == m.id

    async def test_get_by_id_not_found(self, client):
        r = await client.get("/merchants/99999")
        assert r.status_code == 404

    async def test_patch_merchant(self, client, make_merchant):
        m = await make_merchant("AMZN")
        r = await client.patch(
            f"/merchants/{m.id}", json={"name": "Amazon", "location": "Seattle, WA"}
        )
        assert r.status_code == 200
        data = r.json()
        assert data["name"] == "Amazon"
        assert data["location"] == "Seattle, WA"

    async def test_patch_merchant_not_found(self, client):
        r = await client.patch("/merchants/99999", json={"name": "X", "location": None})
        assert r.status_code == 404

    async def test_merge_success(
        self, client, make_account, make_merchant, make_transaction
    ):
        acct = await make_account()
        m1 = await make_merchant("AMZN")
        m2 = await make_merchant("AMAZON.COM")
        await make_transaction(acct.id, merchant_id=m1.id)
        await make_transaction(acct.id, merchant_id=m2.id)
        r = await client.post(
            "/merchants/merge",
            json={
                "canonical_name": "Amazon",
                "canonical_location": None,
                "merchant_ids": [m1.id, m2.id],
            },
        )
        assert r.status_code == 200
        data = r.json()
        assert data["name"] == "Amazon"
        assert data["transaction_count"] == 2

    async def test_merge_bad_ids(self, client):
        r = await client.post(
            "/merchants/merge",
            json={
                "canonical_name": "Amazon",
                "canonical_location": None,
                "merchant_ids": [99998, 99999],
            },
        )
        assert r.status_code == 404

    async def test_merge_too_few_ids(self, client, make_merchant):
        m = await make_merchant("Solo")
        r = await client.post(
            "/merchants/merge",
            json={
                "canonical_name": "Solo",
                "canonical_location": None,
                "merchant_ids": [m.id],
            },
        )
        assert r.status_code == 400

    async def test_list_location_filter(self, client, make_merchant):
        await make_merchant("Starbucks", "Seattle, WA")
        await make_merchant("Target", "Austin, TX")
        r = await client.get("/merchants", params={"location": "seattle"})
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) == 1
        assert items[0]["name"] == "Starbucks"


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------


class TestCategories:
    async def test_list_with_categorized_transactions(
        self, client, make_account, make_category, make_transaction
    ):
        acct = await make_account()
        cat, sub = await make_category("Food & Drink", "Restaurants")
        await make_transaction(acct.id, amount=Decimal("-30.00"), subcategory_id=sub.id)
        await make_transaction(acct.id, amount=Decimal("-20.00"), subcategory_id=sub.id)
        r = await client.get("/categories")
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) == 1
        item = items[0]
        assert item["category"] == "Food & Drink"
        assert item["subcategory"] == "Restaurants"
        assert item["transaction_count"] == 2
        assert float(item["total_amount"]) == pytest.approx(-50.0)

    async def test_list_empty_when_no_transactions(self, client):
        r = await client.get("/categories")
        assert r.status_code == 200
        assert r.json()["items"] == []

    async def test_list_category_name_filter(
        self, client, make_account, make_category, make_transaction
    ):
        acct = await make_account()
        _, food_sub = await make_category("Food & Drink", "Restaurants")
        _, shop_sub = await make_category("Shopping", "Online Shopping")
        await make_transaction(acct.id, subcategory_id=food_sub.id)
        await make_transaction(acct.id, subcategory_id=shop_sub.id)
        r = await client.get("/categories", params={"category": "food"})
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) == 1
        assert items[0]["category"] == "Food & Drink"

    async def test_list_subcategory_name_filter(
        self, client, make_account, make_category, make_transaction
    ):
        acct = await make_account()
        _, rest_sub = await make_category("Food & Drink", "Restaurants")
        _, coffee_sub = await make_category("Food & Coffee", "Coffee & Tea")
        await make_transaction(acct.id, subcategory_id=rest_sub.id)
        await make_transaction(acct.id, subcategory_id=coffee_sub.id)
        r = await client.get("/categories", params={"subcategory": "coffee"})
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) == 1
        assert items[0]["subcategory"] == "Coffee & Tea"


# ---------------------------------------------------------------------------
# Accounts
# ---------------------------------------------------------------------------


class TestAccounts:
    async def test_list_accounts(self, client, make_account):
        await make_account("Checking")
        await make_account("Savings")
        r = await client.get("/accounts")
        assert r.status_code == 200
        data = r.json()
        assert len(data["items"]) == 2
        assert data["has_more"] is False

    async def test_list_accounts_pagination(self, client, make_account):
        for i in range(1, 6):
            await make_account(f"Account {i:02d}")
        r = await client.get("/accounts", params={"limit": 3})
        assert r.status_code == 200
        data = r.json()
        assert len(data["items"]) == 3
        assert data["has_more"] is True
        assert data["next_cursor"] is not None


# ---------------------------------------------------------------------------
# Imports
# ---------------------------------------------------------------------------


class TestImports:
    async def _make_csv_import(self, db_session, make_account):
        acct = await make_account("Import Account")
        ci = CsvImport(
            user_id=1,
            account_id=acct.id,
            filename="test.csv",
            row_count=10,
            enriched_rows=5,
            status="in-progress",
        )
        db_session.add(ci)
        await db_session.commit()
        return ci

    async def test_list_imports(self, client, db_session, make_account):
        await self._make_csv_import(db_session, make_account)
        r = await client.get("/imports")
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) == 1
        assert items[0]["filename"] == "test.csv"

    async def test_import_progress_found(self, client, db_session, make_account):
        ci = await self._make_csv_import(db_session, make_account)
        r = await client.get(f"/imports/{ci.id}/progress")
        assert r.status_code == 200
        data = r.json()
        assert data["csv_import_id"] == ci.id
        assert data["row_count"] == 10
        assert data["enriched_rows"] == 5
        assert data["complete"] is False

    async def test_import_progress_complete_flag(
        self, client, db_session, make_account
    ):
        acct = await make_account("Import Account 2")
        ci = CsvImport(
            user_id=1,
            account_id=acct.id,
            filename="done.csv",
            row_count=5,
            enriched_rows=5,
            status="complete",
        )
        db_session.add(ci)
        await db_session.commit()
        r = await client.get(f"/imports/{ci.id}/progress")
        assert r.status_code == 200
        assert r.json()["complete"] is True

    async def test_import_progress_not_found(self, client):
        r = await client.get("/imports/99999/progress")
        assert r.status_code == 404

    async def test_list_filename_filter(self, client, db_session, make_account):
        acct = await make_account()
        ci1 = CsvImport(
            user_id=1,
            account_id=acct.id,
            filename="january.csv",
            row_count=10,
            enriched_rows=10,
            status="complete",
        )
        ci2 = CsvImport(
            user_id=1,
            account_id=acct.id,
            filename="february.csv",
            row_count=5,
            enriched_rows=5,
            status="complete",
        )
        db_session.add(ci1)
        db_session.add(ci2)
        await db_session.commit()
        r = await client.get("/imports", params={"filename": "jan"})
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) == 1
        assert items[0]["filename"] == "january.csv"


# ---------------------------------------------------------------------------
# Delete Import
# ---------------------------------------------------------------------------


class TestDeleteImport:
    async def _make_csv_import(self, db_session, make_account, status="complete"):
        acct = await make_account("Delete Import Account")
        ci = CsvImport(
            user_id=1,
            account_id=acct.id,
            filename="todelete.csv",
            row_count=5,
            enriched_rows=5,
            status=status,
        )
        db_session.add(ci)
        await db_session.commit()
        return ci

    async def test_delete_removes_import_and_transactions(
        self, client, db_session, make_account, make_transaction
    ):
        ci = await self._make_csv_import(db_session, make_account)
        acct_id = ci.account_id
        t1 = await make_transaction(acct_id, csv_import_id=ci.id)
        t2 = await make_transaction(acct_id, csv_import_id=ci.id)

        r = await client.delete(f"/imports/{ci.id}")
        assert r.status_code == 204

        # Import no longer in list
        r2 = await client.get("/imports")
        assert all(item["id"] != ci.id for item in r2.json()["items"])

        # Transactions deleted
        t1_row = await db_session.get(Transaction, t1.id)
        t2_row = await db_session.get(Transaction, t2.id)
        assert t1_row is None
        assert t2_row is None

    async def test_delete_returns_404_for_missing(self, client):
        r = await client.delete("/imports/99999")
        assert r.status_code == 404

    async def test_delete_clears_linked_transaction_id(
        self, client, db_session, make_account, make_transaction
    ):
        ci = await self._make_csv_import(db_session, make_account)
        acct_id = ci.account_id

        # A transaction in this import
        t_in = await make_transaction(acct_id, csv_import_id=ci.id)

        # A transaction NOT in this import, but linked to t_in
        t_ext = await make_transaction(acct_id)
        t_ext.linked_transaction_id = t_in.id
        await db_session.commit()

        r = await client.delete(f"/imports/{ci.id}")
        assert r.status_code == 204

        await db_session.refresh(t_ext)
        assert t_ext.linked_transaction_id is None

    async def test_delete_in_progress_import(self, client, db_session, make_account):
        ci = await self._make_csv_import(db_session, make_account, status="in-progress")
        r = await client.delete(f"/imports/{ci.id}")
        assert r.status_code == 204


# ---------------------------------------------------------------------------
# Transactions
# ---------------------------------------------------------------------------


class TestTransactions:
    async def test_list_empty(self, client):
        r = await client.get("/transactions")
        assert r.status_code == 200
        data = r.json()
        assert data["items"] == []
        assert data["total_count"] == 0

    async def test_list_with_data(self, client, make_account, make_transaction):
        acct = await make_account()
        await make_transaction(acct.id, amount=Decimal("-50.00"), description="Coffee")
        r = await client.get("/transactions")
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) == 1
        item = items[0]
        assert item["description"] == "Coffee"
        assert float(item["amount"]) == pytest.approx(-50.0)
        assert "account" in item
        assert item["raw_description"] is None

    async def test_list_raw_description_populated(
        self, client, make_account, make_transaction
    ):
        acct = await make_account()
        await make_transaction(
            acct.id,
            description="Starbucks Coffee",
            raw_description="STARBUCKS #4821 SEATTLE WA",
        )
        r = await client.get("/transactions")
        assert r.status_code == 200
        item = r.json()["items"][0]
        assert item["description"] == "Starbucks Coffee"
        assert item["raw_description"] == "STARBUCKS #4821 SEATTLE WA"

    async def test_list_filter_date_range(self, client, make_account, make_transaction):
        acct = await make_account()
        await make_transaction(acct.id, txn_date=date(2024, 1, 10))
        await make_transaction(acct.id, txn_date=date(2024, 3, 10))
        r = await client.get("/transactions", params={"date_from": "2024-02-01"})
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) == 1

    async def test_list_filter_merchant(
        self, client, make_account, make_merchant, make_transaction
    ):
        acct = await make_account()
        m = await make_merchant("Starbucks")
        await make_transaction(acct.id, merchant_id=m.id)
        await make_transaction(acct.id)  # no merchant
        r = await client.get("/transactions", params={"merchant": "star"})
        assert r.status_code == 200
        assert len(r.json()["items"]) == 1

    async def test_list_filter_is_recurring(
        self, client, make_account, make_transaction
    ):
        acct = await make_account()
        await make_transaction(acct.id, is_recurring=True)
        await make_transaction(acct.id, is_recurring=False)
        r = await client.get("/transactions", params={"is_recurring": "true"})
        assert r.status_code == 200
        assert len(r.json()["items"]) == 1

    async def test_patch_transaction_update_description(
        self, client, make_account, make_transaction
    ):
        acct = await make_account()
        tx = await make_transaction(acct.id, description="Old Description")
        r = await client.patch(
            f"/transactions/{tx.id}",
            json={
                "description": "New Description",
                "merchant_name": None,
                "category": None,
                "subcategory": None,
                "notes": None,
            },
        )
        assert r.status_code == 200
        assert r.json()["description"] == "New Description"

    async def test_patch_transaction_set_merchant_and_category(
        self, client, make_account, make_transaction
    ):
        acct = await make_account()
        tx = await make_transaction(acct.id)
        r = await client.patch(
            f"/transactions/{tx.id}",
            json={
                "description": "Coffee",
                "merchant_name": "Starbucks",
                "category": "Food & Drink",
                "subcategory": "Coffee & Tea",
                "notes": None,
            },
        )
        assert r.status_code == 200
        data = r.json()
        assert data["merchant"] == "Starbucks"
        assert data["category"] == "Food & Drink"
        assert data["subcategory"] == "Coffee & Tea"

    async def test_patch_transaction_clear_merchant(
        self, client, make_account, make_merchant, make_transaction
    ):
        acct = await make_account()
        m = await make_merchant("Starbucks")
        tx = await make_transaction(acct.id, merchant_id=m.id)
        r = await client.patch(
            f"/transactions/{tx.id}",
            json={
                "description": "Coffee",
                "merchant_name": None,
                "category": None,
                "subcategory": None,
                "notes": None,
            },
        )
        assert r.status_code == 200
        assert r.json()["merchant"] is None

    async def test_patch_transaction_not_found(self, client):
        r = await client.patch(
            "/transactions/99999",
            json={
                "description": "X",
                "merchant_name": None,
                "category": None,
                "subcategory": None,
                "notes": None,
            },
        )
        assert r.status_code == 404

    async def test_list_filter_description(
        self, client, make_account, make_transaction
    ):
        acct = await make_account()
        await make_transaction(acct.id, description="Morning Coffee")
        await make_transaction(acct.id, description="Grocery Run")
        r = await client.get("/transactions", params={"description": "coffee"})
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) == 1
        assert "Coffee" in items[0]["description"]

    async def test_list_filter_amount_range(
        self, client, make_account, make_transaction
    ):
        acct = await make_account()
        await make_transaction(acct.id, amount=Decimal("-5.00"))
        await make_transaction(acct.id, amount=Decimal("-50.00"))
        await make_transaction(acct.id, amount=Decimal("-200.00"))
        r = await client.get(
            "/transactions", params={"amount_min": "-100", "amount_max": "-10"}
        )
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) == 1
        assert float(items[0]["amount"]) == pytest.approx(-50.0)

    async def test_list_filter_category(
        self, client, make_account, make_category, make_transaction
    ):
        acct = await make_account()
        _, food_sub = await make_category("Food & Drink", "Restaurants")
        _, shop_sub = await make_category("Shopping", "Online Shopping")
        await make_transaction(acct.id, subcategory_id=food_sub.id)
        await make_transaction(acct.id, subcategory_id=shop_sub.id)
        r = await client.get("/transactions", params={"category": "food"})
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) == 1
        assert items[0]["category"] == "Food & Drink"

    async def test_list_filter_account(self, client, make_account, make_transaction):
        checking = await make_account("Checking")
        savings = await make_account("Savings")
        await make_transaction(checking.id)
        await make_transaction(savings.id)
        r = await client.get("/transactions", params={"account": "check"})
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) == 1
        assert items[0]["account"] == "Checking"

    async def test_list_filter_uncategorized(
        self, client, make_account, make_category, make_transaction
    ):
        acct = await make_account()
        _, sub = await make_category("Food & Drink", "Restaurants")
        await make_transaction(acct.id, subcategory_id=sub.id)
        await make_transaction(acct.id)  # no category
        r = await client.get("/transactions", params={"uncategorized": "true"})
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) == 1
        assert items[0]["category"] is None

    async def test_list_filter_import_id(
        self, client, db_session, make_account, make_transaction
    ):
        acct = await make_account()
        ci = CsvImport(
            user_id=1,
            account_id=acct.id,
            filename="import.csv",
            row_count=1,
            enriched_rows=0,
            status="in-progress",
        )
        db_session.add(ci)
        await db_session.commit()
        await make_transaction(acct.id, csv_import_id=ci.id)
        await make_transaction(acct.id)
        r = await client.get("/transactions", params={"import_id": ci.id})
        assert r.status_code == 200
        assert len(r.json()["items"]) == 1

    async def test_re_enrich_empty_ids(self, client):
        r = await client.post("/transactions/re-enrich", json={"transaction_ids": []})
        assert r.status_code == 200
        assert r.json() == {"items": []}

    async def test_re_enrich_skips_no_raw_description(
        self, client, make_account, make_transaction
    ):
        acct = await make_account()
        tx = await make_transaction(acct.id, description="Coffee")  # no raw_description
        r = await client.post(
            "/transactions/re-enrich", json={"transaction_ids": [tx.id]}
        )
        assert r.status_code == 200
        assert r.json() == {"items": []}

    async def test_re_enrich_success(
        self, client, db_session, make_account, make_transaction, mocker
    ):
        acct = await make_account()
        tx = await make_transaction(
            acct.id,
            description="STARBUCKS #4821",
            raw_description="STARBUCKS #4821 SEATTLE WA",
        )
        mocker.patch(
            "budget.main.enricher._enrich_batch",
            return_value=(
                [
                    {
                        "index": 0,
                        "description": "Starbucks Coffee",
                        "merchant_name": "Starbucks",
                        "merchant_location": "Seattle, WA",
                        "category": "Food & Drink",
                        "subcategory": "Coffee & Tea",
                        "is_recurring": True,
                    }
                ],
                0,
                0,
            ),
        )
        r = await client.post(
            "/transactions/re-enrich", json={"transaction_ids": [tx.id]}
        )
        assert r.status_code == 200
        data = r.json()
        assert len(data["items"]) == 1
        item = data["items"][0]
        assert item["id"] == tx.id
        # Scalar fields are correct in the response
        assert item["description"] == "Starbucks Coffee"
        assert item["is_recurring"] is True
        # Verify merchant/category were persisted to DB (refresh bypasses identity map)
        await db_session.refresh(tx)
        assert tx.description == "Starbucks Coffee"
        assert tx.is_recurring is True
        assert tx.merchant_id is not None
        assert tx.subcategory_id is not None

    async def test_re_enrich_ai_error_returns_502(
        self, client, make_account, make_transaction, mocker
    ):
        acct = await make_account()
        tx = await make_transaction(
            acct.id, raw_description="STARBUCKS #4821 SEATTLE WA"
        )
        mocker.patch(
            "budget.main.enricher._enrich_batch",
            side_effect=RuntimeError("API timeout"),
        )
        r = await client.post(
            "/transactions/re-enrich", json={"transaction_ids": [tx.id]}
        )
        assert r.status_code == 502
        assert "AI enrichment failed" in r.json()["detail"]

    async def test_list_filter_cardholder(
        self, client, make_account, make_cardholder, make_transaction
    ):
        acct = await make_account()
        ch = await make_cardholder("1234")
        await make_transaction(acct.id, cardholder_id=ch.id, description="Card tx")
        await make_transaction(acct.id, description="No card tx")
        r = await client.get("/transactions", params={"cardholder": "1234"})
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) == 1
        assert items[0]["description"] == "Card tx"
        assert items[0]["card_number"] == "1234"

    async def test_patch_transaction_set_card_number(
        self, client, make_account, make_transaction
    ):
        acct = await make_account()
        tx = await make_transaction(acct.id)
        r = await client.patch(
            f"/transactions/{tx.id}",
            json={
                "description": "Test",
                "merchant_name": None,
                "category": None,
                "subcategory": None,
                "notes": None,
                "card_number": "1234",
            },
        )
        assert r.status_code == 200
        data = r.json()
        assert data["card_number"] == "1234"

    async def test_patch_transaction_clear_card_number(
        self, client, make_account, make_cardholder, make_transaction
    ):
        acct = await make_account()
        ch = await make_cardholder("1234")
        tx = await make_transaction(acct.id, cardholder_id=ch.id)
        r = await client.patch(
            f"/transactions/{tx.id}",
            json={
                "description": "Test",
                "merchant_name": None,
                "category": None,
                "subcategory": None,
                "notes": None,
                "card_number": None,
            },
        )
        assert r.status_code == 200
        assert r.json()["card_number"] is None


# ---------------------------------------------------------------------------
# CardHolders
# ---------------------------------------------------------------------------


class TestCardHolders:
    async def test_list_empty(self, client):
        r = await client.get("/cardholders")
        assert r.status_code == 200
        data = r.json()
        assert data["items"] == []
        assert data["has_more"] is False

    async def test_list_with_data(
        self, client, make_account, make_cardholder, make_transaction
    ):
        acct = await make_account()
        ch = await make_cardholder("1234", name="Alice")
        await make_transaction(acct.id, cardholder_id=ch.id, amount=Decimal("-25.00"))
        r = await client.get("/cardholders")
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) == 1
        item = items[0]
        assert item["card_number"] == "1234"
        assert item["name"] == "Alice"
        assert item["transaction_count"] == 1
        assert float(item["total_amount"]) == pytest.approx(-25.0)

    async def test_list_filter_card_number(self, client, make_cardholder):
        await make_cardholder("1234")
        await make_cardholder("5678")
        r = await client.get("/cardholders", params={"card_number": "12"})
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) == 1
        assert items[0]["card_number"] == "1234"

    async def test_list_filter_name(self, client, make_cardholder):
        await make_cardholder("1234", name="Alice")
        await make_cardholder("5678", name="Bob")
        r = await client.get("/cardholders", params={"name": "alic"})
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) == 1
        assert items[0]["name"] == "Alice"

    async def test_patch_cardholder(self, client, make_cardholder):
        ch = await make_cardholder("1234", name="Old Name")
        r = await client.patch(
            f"/cardholders/{ch.id}",
            json={"name": "New Name", "card_number": "5678"},
        )
        assert r.status_code == 200
        data = r.json()
        assert data["name"] == "New Name"
        assert data["card_number"] == "5678"
        assert "transaction_count" in data
        assert "total_amount" in data

    async def test_patch_cardholder_not_found(self, client):
        r = await client.patch(
            "/cardholders/99999", json={"name": "X", "card_number": None}
        )
        assert r.status_code == 404

    async def test_transaction_response_includes_cardholder_fields(
        self, client, make_account, make_cardholder, make_transaction
    ):
        acct = await make_account()
        ch = await make_cardholder("9999", name="Bob")
        await make_transaction(acct.id, cardholder_id=ch.id)
        r = await client.get("/transactions")
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) == 1
        assert items[0]["card_number"] == "9999"
        assert items[0]["cardholder_name"] == "Bob"


# ---------------------------------------------------------------------------
# Analytics
# ---------------------------------------------------------------------------


class TestAnalytics:
    async def test_monthly_list(self, client, make_account, make_transaction):
        acct = await make_account()
        await make_transaction(acct.id, txn_date=date(2024, 1, 15))
        await make_transaction(acct.id, txn_date=date(2024, 3, 10))
        r = await client.get("/monthly")
        assert r.status_code == 200
        months = r.json()["months"]
        assert "2024-01" in months
        assert "2024-03" in months

    async def test_monthly_report(self, client, make_account, make_transaction):
        acct = await make_account()
        await make_transaction(
            acct.id, amount=Decimal("1000.00"), txn_date=date(2024, 1, 5)
        )
        await make_transaction(
            acct.id, amount=Decimal("-200.00"), txn_date=date(2024, 1, 10)
        )
        r = await client.get("/monthly/2024-01")
        assert r.status_code == 200
        data = r.json()
        assert data["month"] == "2024-01"
        summary = data["summary"]
        assert float(summary["income"]) == pytest.approx(1000.0)
        assert float(summary["expenses"]) == pytest.approx(-200.0)
        assert "category_breakdown" in data
        # pct change fields present (null when no prior month)
        assert "income_pct_change" in summary
        assert "expenses_pct_change" in summary
        assert "net_pct_change" in summary
        assert summary["income_pct_change"] is None
        assert summary["expenses_pct_change"] is None
        assert summary["net_pct_change"] is None

    async def test_monthly_report_pct_change(
        self, client, make_account, make_transaction
    ):
        acct = await make_account()
        # Prior month: income 1000, expenses -500
        await make_transaction(
            acct.id, amount=Decimal("1000.00"), txn_date=date(2024, 1, 5)
        )
        await make_transaction(
            acct.id, amount=Decimal("-500.00"), txn_date=date(2024, 1, 10)
        )
        # Current month: income 1200, expenses -400
        await make_transaction(
            acct.id, amount=Decimal("1200.00"), txn_date=date(2024, 2, 5)
        )
        await make_transaction(
            acct.id, amount=Decimal("-400.00"), txn_date=date(2024, 2, 10)
        )
        r = await client.get("/monthly/2024-02")
        assert r.status_code == 200
        data = r.json()
        summary = data["summary"]
        # income: (1200 - 1000) / 1000 * 100 = 20.0
        assert summary["income_pct_change"] == pytest.approx(20.0)
        # expenses: (|-400| - |-500|) / |-500| * 100 = -20.0
        assert summary["expenses_pct_change"] == pytest.approx(-20.0)
        # net: (800 - 500) / 500 * 100 = 60.0
        assert summary["net_pct_change"] == pytest.approx(60.0)
        # category breakdown: uncategorized expenses -400 vs -500 → -20.0%
        cat = data["category_breakdown"][0]
        assert "pct_change" in cat
        assert cat["pct_change"] == pytest.approx(-20.0)
        assert "pct_change" in cat["subcategories"][0]
        assert cat["subcategories"][0]["pct_change"] == pytest.approx(-20.0)

    async def test_monthly_breakdown_pct_change_null_for_new_category(
        self, client, make_account, make_transaction, make_category
    ):
        acct = await make_account()
        _, sub = await make_category("Dining", "Restaurants")
        # Expenses only in current month (no prior month) → pct_change should be null
        await make_transaction(
            acct.id,
            amount=Decimal("-300.00"),
            txn_date=date(2024, 3, 10),
            subcategory_id=sub.id,
        )
        r = await client.get("/monthly/2024-03")
        assert r.status_code == 200
        cat = r.json()["category_breakdown"][0]
        assert cat["pct_change"] is None
        assert cat["subcategories"][0]["pct_change"] is None

    async def test_overview(self, client, make_account, make_transaction):
        acct = await make_account()
        await make_transaction(
            acct.id, amount=Decimal("2000.00"), txn_date=date(2024, 1, 1)
        )
        await make_transaction(
            acct.id, amount=Decimal("-500.00"), txn_date=date(2024, 1, 2)
        )
        r = await client.get("/overview")
        assert r.status_code == 200
        data = r.json()
        assert data["transaction_count"] == 2
        assert float(data["income"]) == pytest.approx(2000.0)
        assert float(data["expenses"]) == pytest.approx(-500.0)
        assert "sankey" in data
        assert "expense_breakdown" in data

    async def test_recurring(
        self, client, make_account, make_merchant, make_transaction
    ):
        acct = await make_account()
        m = await make_merchant("Netflix")
        # Create monthly-spaced recurring transactions
        for month in [1, 2, 3]:
            await make_transaction(
                acct.id,
                amount=Decimal("-15.99"),
                description="Netflix Subscription",
                txn_date=date(2024, month, 1),
                merchant_id=m.id,
                is_recurring=True,
            )
        r = await client.get("/recurring")
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) == 1
        item = items[0]
        assert item["frequency"] == "monthly"
        assert item["occurrences"] == 3


# ---------------------------------------------------------------------------
# Category Trends
# ---------------------------------------------------------------------------


class TestCategoryTrends:
    async def test_empty_response_when_no_transactions(self, client):
        r = await client.get("/category-trends")
        assert r.status_code == 200
        assert r.json() == {"items": []}

    async def test_returns_items_grouped_by_month_and_category(
        self, client, make_account, make_category, make_transaction
    ):
        acct = await make_account()
        cat, sub = await make_category("Food", "Groceries")
        await make_transaction(
            acct.id,
            amount=Decimal("-50.00"),
            txn_date=date(2024, 1, 10),
            subcategory_id=sub.id,
        )
        await make_transaction(
            acct.id,
            amount=Decimal("-30.00"),
            txn_date=date(2024, 1, 20),
            subcategory_id=sub.id,
        )
        r = await client.get("/category-trends")
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) == 1
        assert items[0]["month"] == "2024-01"
        assert items[0]["category"] == "Food"
        assert float(items[0]["total"]) == pytest.approx(-80.0)

    async def test_groups_across_multiple_months_and_categories(
        self, client, make_account, make_category, make_transaction
    ):
        acct = await make_account()
        cat1, sub1 = await make_category("Food", "Restaurants")
        cat2, sub2 = await make_category("Transport", "Gas")
        await make_transaction(
            acct.id,
            amount=Decimal("-100.00"),
            txn_date=date(2024, 1, 5),
            subcategory_id=sub1.id,
        )
        await make_transaction(
            acct.id,
            amount=Decimal("-40.00"),
            txn_date=date(2024, 1, 10),
            subcategory_id=sub2.id,
        )
        await make_transaction(
            acct.id,
            amount=Decimal("-120.00"),
            txn_date=date(2024, 2, 5),
            subcategory_id=sub1.id,
        )
        r = await client.get("/category-trends")
        assert r.status_code == 200
        items = r.json()["items"]
        months = {(i["month"], i["category"]) for i in items}
        assert ("2024-01", "Food") in months
        assert ("2024-01", "Transport") in months
        assert ("2024-02", "Food") in months

    async def test_date_from_filter(
        self, client, make_account, make_category, make_transaction
    ):
        acct = await make_account()
        _, sub = await make_category("Food", "Groceries")
        await make_transaction(
            acct.id,
            amount=Decimal("-50.00"),
            txn_date=date(2023, 12, 15),
            subcategory_id=sub.id,
        )
        await make_transaction(
            acct.id,
            amount=Decimal("-70.00"),
            txn_date=date(2024, 1, 10),
            subcategory_id=sub.id,
        )
        r = await client.get("/category-trends", params={"date_from": "2024-01"})
        assert r.status_code == 200
        items = r.json()["items"]
        assert all(i["month"] >= "2024-01" for i in items)
        assert len(items) == 1
        assert items[0]["month"] == "2024-01"

    async def test_date_to_filter(
        self, client, make_account, make_category, make_transaction
    ):
        acct = await make_account()
        _, sub = await make_category("Food", "Groceries")
        await make_transaction(
            acct.id,
            amount=Decimal("-50.00"),
            txn_date=date(2024, 1, 10),
            subcategory_id=sub.id,
        )
        await make_transaction(
            acct.id,
            amount=Decimal("-70.00"),
            txn_date=date(2024, 3, 10),
            subcategory_id=sub.id,
        )
        r = await client.get("/category-trends", params={"date_to": "2024-02"})
        assert r.status_code == 200
        items = r.json()["items"]
        assert all(i["month"] <= "2024-02" for i in items)
        assert len(items) == 1
        assert items[0]["month"] == "2024-01"

    async def test_excludes_income_transactions(
        self, client, make_account, make_transaction
    ):
        acct = await make_account()
        # Income transaction — should NOT appear
        await make_transaction(
            acct.id, amount=Decimal("1000.00"), txn_date=date(2024, 1, 1)
        )
        r = await client.get("/category-trends")
        assert r.status_code == 200
        assert r.json() == {"items": []}

    async def test_uncategorized_label(self, client, make_account, make_transaction):
        acct = await make_account()
        # Expense with no subcategory → should appear as "Uncategorized"
        await make_transaction(
            acct.id, amount=Decimal("-25.00"), txn_date=date(2024, 1, 5)
        )
        r = await client.get("/category-trends")
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) == 1
        assert items[0]["category"] == "Uncategorized"


# ---------------------------------------------------------------------------
# Import CSV endpoint
# ---------------------------------------------------------------------------


class TestImportCsv:
    def _csv_file(self, content: str, filename: str = "test.csv"):
        return ("file", (filename, io.BytesIO(content.encode()), "text/csv"))

    async def test_import_csv_success(self, client, mocker):
        mocker.patch(
            "budget.main.detector.detect",
            return_value={"date": 0, "amount": 1, "description": 2},
        )
        mocker.patch("budget.main._enrichment_queue.enqueue")

        csv_content = "Date,Amount,Description\n2024-01-15,-10.00,Coffee\n2024-01-16,-20.00,Lunch\n"
        r = await client.post(
            "/import-csv",
            files=[self._csv_file(csv_content)],
            data={"account_name": "Checking"},
        )
        assert r.status_code == 200
        data = r.json()
        assert data["rows_imported"] == 2
        assert data["status"] == "processing"
        assert data["filename"] == "test.csv"

    async def test_import_csv_non_csv_rejected(self, client):
        r = await client.post(
            "/import-csv",
            files=[("file", ("data.txt", io.BytesIO(b"hello"), "text/plain"))],
            data={"account_name": "Checking"},
        )
        assert r.status_code == 400

    async def test_import_csv_missing_columns_rejected(self, client, mocker):
        mocker.patch(
            "budget.main.detector.detect",
            return_value={"date": None, "amount": None, "description": 0},
        )
        csv_content = "Description,Memo\nCoffee,Note\n"
        r = await client.post(
            "/import-csv",
            files=[self._csv_file(csv_content)],
            data={"account_name": "Checking"},
        )
        assert r.status_code == 422


# ---------------------------------------------------------------------------
# AI endpoints
# ---------------------------------------------------------------------------


class TestAiParseQuery:
    async def test_parse_query(self, client, mocker):
        mocker.patch(
            "budget.main.query_parser.parse",
            return_value={
                "date_from": "2024-01-01",
                "date_to": "2024-01-31",
                "merchant": None,
                "explanation": "Transactions in January 2024",
            },
        )
        r = await client.post(
            "/ai/parse-query", json={"query": "transactions in January"}
        )
        assert r.status_code == 200
        data = r.json()
        assert data["explanation"] == "Transactions in January 2024"
        assert data["filters"]["date_from"] == "2024-01-01"


class TestAiFindDuplicateMerchants:
    async def test_find_duplicates(
        self, client, make_account, make_merchant, make_transaction, mocker
    ):
        acct = await make_account()
        m1 = await make_merchant("AMZN")
        m2 = await make_merchant("AMAZON.COM")
        await make_transaction(acct.id, merchant_id=m1.id)
        await make_transaction(acct.id, merchant_id=m2.id)

        mocker.patch(
            "budget.main.merchant_duplicate_finder.find",
            return_value={
                "groups": [
                    {
                        "canonical_name": "Amazon",
                        "canonical_location": None,
                        "member_ids": [m1.id, m2.id],
                    }
                ]
            },
        )
        r = await client.post("/ai/find-duplicate-merchants")
        assert r.status_code == 200
        data = r.json()
        groups = data["groups"]
        assert len(groups) == 1
        assert groups[0]["canonical_name"] == "Amazon"
        assert len(groups[0]["members"]) == 2

    async def test_find_duplicates_empty_merchants(self, client):
        r = await client.post("/ai/find-duplicate-merchants")
        assert r.status_code == 200
        assert r.json() == {"groups": []}


# ---------------------------------------------------------------------------
# _run_enrichment — raw_description storage
# ---------------------------------------------------------------------------


class TestRunEnrichment:
    """Integration tests for _run_enrichment that verify raw_description is persisted."""

    async def _setup_db(self):
        """Create an isolated in-memory engine with StaticPool so all sessions share data."""
        eng = create_async_engine(
            "sqlite+aiosqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        async with eng.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        return eng

    async def test_stores_raw_description_from_csv(self, mocker):
        eng = await self._setup_db()
        factory = async_sessionmaker(
            bind=eng, class_=AsyncSession, expire_on_commit=False
        )
        mocker.patch("budget.jobs.AsyncSessionLocal", factory)
        mocker.patch(
            "budget.jobs.enricher._enrich_batch",
            return_value=(
                [
                    {
                        "index": 0,
                        "description": "Starbucks Coffee",
                        "merchant_name": None,
                        "merchant_location": None,
                        "category": None,
                        "subcategory": None,
                        "is_recurring": False,
                    }
                ],
                0,
                0,
            ),
        )

        async with factory() as session:
            acct = Account(name="Test Account", user_id=1)
            session.add(acct)
            await session.flush()
            ci = CsvImport(
                user_id=1,
                account_id=acct.id,
                filename="test.csv",
                row_count=1,
                enriched_rows=0,
                status="in-progress",
            )
            session.add(ci)
            await session.commit()
            account_id, ci_id = acct.id, ci.id

        rows = [
            {
                "Date": "2024-01-15",
                "Amount": "-5.00",
                "Description": "STARBUCKS #4821 SEATTLE WA  ",
            }
        ]
        enrich_input = [
            {
                "index": 0,
                "description": "STARBUCKS #4821 SEATTLE WA",
                "amount": "-5.00",
                "date": "2024-01-15",
            }
        ]
        await _run_enrichment(
            enrich_input=enrich_input,
            rows=rows,
            date_col="Date",
            amount_col="Amount",
            desc_col="Description",
            account_id=account_id,
            csv_import_id=ci_id,
            user_id=1,
        )

        async with factory() as session:
            result = await session.execute(
                select(Transaction).where(Transaction.account_id == account_id)
            )
            txs = result.scalars().all()
            assert len(txs) == 1
            assert txs[0].description == "Starbucks Coffee"
            assert txs[0].raw_description == "STARBUCKS #4821 SEATTLE WA"

        await eng.dispose()

    async def test_raw_description_null_when_no_desc_col(self, mocker):
        eng = await self._setup_db()
        factory = async_sessionmaker(
            bind=eng, class_=AsyncSession, expire_on_commit=False
        )
        mocker.patch("budget.jobs.AsyncSessionLocal", factory)
        mocker.patch(
            "budget.jobs.enricher._enrich_batch",
            return_value=(
                [
                    {
                        "index": 0,
                        "description": "Grocery store",
                        "merchant_name": None,
                        "merchant_location": None,
                        "category": None,
                        "subcategory": None,
                        "is_recurring": False,
                    }
                ],
                0,
                0,
            ),
        )

        async with factory() as session:
            acct = Account(name="No Desc Account", user_id=1)
            session.add(acct)
            await session.flush()
            ci = CsvImport(
                user_id=1,
                account_id=acct.id,
                filename="nodesc.csv",
                row_count=1,
                enriched_rows=0,
                status="in-progress",
            )
            session.add(ci)
            await session.commit()
            account_id, ci_id = acct.id, ci.id

        rows = [{"Date": "2024-01-15", "Amount": "-20.00"}]
        enrich_input = [
            {"index": 0, "description": "", "amount": "-20.00", "date": "2024-01-15"}
        ]
        await _run_enrichment(
            enrich_input=enrich_input,
            rows=rows,
            date_col="Date",
            amount_col="Amount",
            desc_col=None,
            account_id=account_id,
            csv_import_id=ci_id,
            user_id=1,
        )

        async with factory() as session:
            result = await session.execute(
                select(Transaction).where(Transaction.account_id == account_id)
            )
            txs = result.scalars().all()
            assert len(txs) == 1
            assert txs[0].raw_description is None

        await eng.dispose()


# ---------------------------------------------------------------------------
# Fingerprint deduplication
# ---------------------------------------------------------------------------


class TestDeduplication:
    """_run_enrichment upserts rows by fingerprint — duplicates are updated, not duplicated."""

    async def _setup_db(self):
        eng = create_async_engine(
            "sqlite+aiosqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        async with eng.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        return eng

    def _batch_result(self, index=0, description="Coffee"):
        return {
            "index": index,
            "description": description,
            "merchant_name": None,
            "merchant_location": None,
            "category": None,
            "subcategory": None,
            "is_recurring": False,
        }

    async def test_duplicate_row_upserted_on_reimport(self, mocker):
        """Re-importing the same row (same fingerprint) updates in-place — no duplicate created."""
        eng = await self._setup_db()
        factory = async_sessionmaker(
            bind=eng, class_=AsyncSession, expire_on_commit=False
        )
        mocker.patch("budget.jobs.AsyncSessionLocal", factory)
        mocker.patch(
            "budget.jobs.enricher._enrich_batch",
            return_value=([self._batch_result()], 0, 0),
        )

        async with factory() as session:
            acct = Account(name="Checking", user_id=1)
            session.add(acct)
            await session.flush()
            ci1 = CsvImport(
                user_id=1,
                account_id=acct.id,
                filename="a.csv",
                row_count=1,
                enriched_rows=0,
                status="in-progress",
            )
            ci2 = CsvImport(
                user_id=1,
                account_id=acct.id,
                filename="b.csv",
                row_count=1,
                enriched_rows=0,
                status="in-progress",
            )
            session.add(ci1)
            session.add(ci2)
            await session.commit()
            acct_id, ci1_id, ci2_id = acct.id, ci1.id, ci2.id

        rows = [{"Date": "2024-01-15", "Amount": "-5.00", "Description": "Coffee"}]
        enrich_input = [
            {
                "index": 0,
                "description": "Coffee",
                "amount": "-5.00",
                "date": "2024-01-15",
            }
        ]

        # First import
        await _run_enrichment(
            enrich_input=enrich_input,
            rows=rows,
            date_col="Date",
            amount_col="Amount",
            desc_col="Description",
            account_id=acct_id,
            csv_import_id=ci1_id,
            user_id=1,
        )
        # Second import with identical row
        await _run_enrichment(
            enrich_input=enrich_input,
            rows=rows,
            date_col="Date",
            amount_col="Amount",
            desc_col="Description",
            account_id=acct_id,
            csv_import_id=ci2_id,
            user_id=1,
        )

        async with factory() as session:
            txs = (
                (
                    await session.execute(
                        select(Transaction).where(Transaction.account_id == acct_id)
                    )
                )
                .scalars()
                .all()
            )
            assert len(txs) == 1

        await eng.dispose()

    async def test_upsert_does_not_create_duplicate(self, mocker):
        """Re-importing a duplicate row upserts it; skipped_duplicates == 1 and transaction count stays 1."""
        eng = await self._setup_db()
        factory = async_sessionmaker(
            bind=eng, class_=AsyncSession, expire_on_commit=False
        )
        mocker.patch("budget.jobs.AsyncSessionLocal", factory)
        mocker.patch(
            "budget.jobs.enricher._enrich_batch",
            return_value=([self._batch_result()], 0, 0),
        )

        async with factory() as session:
            acct = Account(name="Savings", user_id=1)
            session.add(acct)
            await session.flush()
            ci1 = CsvImport(
                user_id=1,
                account_id=acct.id,
                filename="c.csv",
                row_count=1,
                enriched_rows=0,
                status="in-progress",
            )
            ci2 = CsvImport(
                user_id=1,
                account_id=acct.id,
                filename="d.csv",
                row_count=1,
                enriched_rows=0,
                status="in-progress",
            )
            session.add(ci1)
            session.add(ci2)
            await session.commit()
            acct_id, ci1_id, ci2_id = acct.id, ci1.id, ci2.id

        rows = [{"Date": "2024-02-01", "Amount": "-10.00", "Description": "Gym"}]
        enrich_input = [
            {"index": 0, "description": "Gym", "amount": "-10.00", "date": "2024-02-01"}
        ]

        await _run_enrichment(
            enrich_input=enrich_input,
            rows=rows,
            date_col="Date",
            amount_col="Amount",
            desc_col="Description",
            account_id=acct_id,
            csv_import_id=ci1_id,
            user_id=1,
        )
        await _run_enrichment(
            enrich_input=enrich_input,
            rows=rows,
            date_col="Date",
            amount_col="Amount",
            desc_col="Description",
            account_id=acct_id,
            csv_import_id=ci2_id,
            user_id=1,
        )

        async with factory() as session:
            ci2_obj = await session.get(CsvImport, ci2_id)
            assert ci2_obj.skipped_duplicates == 1
            txs = (
                (
                    await session.execute(
                        select(Transaction).where(Transaction.account_id == acct_id)
                    )
                )
                .scalars()
                .all()
            )
            assert len(txs) == 1

        await eng.dispose()

    async def test_fingerprint_stored_on_transaction(self, mocker):
        """Each inserted transaction has a non-null fingerprint."""
        eng = await self._setup_db()
        factory = async_sessionmaker(
            bind=eng, class_=AsyncSession, expire_on_commit=False
        )
        mocker.patch("budget.jobs.AsyncSessionLocal", factory)
        mocker.patch(
            "budget.jobs.enricher._enrich_batch",
            return_value=([self._batch_result()], 0, 0),
        )

        async with factory() as session:
            acct = Account(name="Debit", user_id=1)
            session.add(acct)
            await session.flush()
            ci = CsvImport(
                user_id=1,
                account_id=acct.id,
                filename="f.csv",
                row_count=1,
                enriched_rows=0,
                status="in-progress",
            )
            session.add(ci)
            await session.commit()
            acct_id, ci_id = acct.id, ci.id

        rows = [{"Date": "2024-04-01", "Amount": "-8.00", "Description": "Tea"}]
        enrich_input = [
            {"index": 0, "description": "Tea", "amount": "-8.00", "date": "2024-04-01"}
        ]

        await _run_enrichment(
            enrich_input=enrich_input,
            rows=rows,
            date_col="Date",
            amount_col="Amount",
            desc_col="Description",
            account_id=acct_id,
            csv_import_id=ci_id,
            user_id=1,
        )

        async with factory() as session:
            tx = (
                (
                    await session.execute(
                        select(Transaction).where(Transaction.account_id == acct_id)
                    )
                )
                .scalars()
                .first()
            )
            assert tx is not None
            assert tx.fingerprint is not None
            assert len(tx.fingerprint) == 16

        await eng.dispose()


# ---------------------------------------------------------------------------
# parse_date / parse_amount helpers
# ---------------------------------------------------------------------------


class TestParseDateAmount:
    def test_parse_date_iso(self):
        assert parse_date("2024-01-15") == date(2024, 1, 15)

    def test_parse_date_us_slash(self):
        assert parse_date("01/15/2024") == date(2024, 1, 15)

    def test_parse_date_intl_slash(self):
        # %m/%d/%Y fails for month=15, falls through to %d/%m/%Y
        assert parse_date("15/01/2024") == date(2024, 1, 15)

    def test_parse_date_long_month(self):
        assert parse_date("January 15, 2024") == date(2024, 1, 15)

    def test_parse_date_strips_whitespace(self):
        assert parse_date("  2024-03-20  ") == date(2024, 3, 20)

    def test_parse_date_invalid_raises(self):
        with pytest.raises(ValueError, match="Unrecognised date format"):
            parse_date("not-a-date")

    def test_parse_amount_negative(self):
        assert parse_amount("-10.50") == Decimal("-10.50")

    def test_parse_amount_positive(self):
        assert parse_amount("500.00") == Decimal("500.00")

    def test_parse_amount_dollar_sign(self):
        assert parse_amount("$99.99") == Decimal("99.99")

    def test_parse_amount_parentheses(self):
        assert parse_amount("(25.00)") == Decimal("-25.00")

    def test_parse_amount_comma_thousands(self):
        assert parse_amount("1,234.56") == Decimal("1234.56")

    def test_parse_amount_strips_whitespace(self):
        assert parse_amount("  -5.00  ") == Decimal("-5.00")

    def test_parse_amount_dollar_with_parens(self):
        assert parse_amount("$(50.00)") == Decimal("-50.00")


# ---------------------------------------------------------------------------
# _classify_gap helper
# ---------------------------------------------------------------------------


class TestReEnrichImport:
    async def test_not_found(self, client):
        r = await client.post("/imports/99999/re-enrich")
        assert r.status_code == 404

    async def test_already_in_progress(self, client, db_session, make_account):
        acct = await make_account()
        ci = CsvImport(
            user_id=1,
            account_id=acct.id,
            filename="x.csv",
            row_count=5,
            enriched_rows=0,
            status="in-progress",
        )
        db_session.add(ci)
        await db_session.commit()
        r = await client.post(f"/imports/{ci.id}/re-enrich")
        assert r.status_code == 409

    async def test_success(self, client, db_session, make_account, mocker):
        acct = await make_account()
        ci = CsvImport(
            user_id=1,
            account_id=acct.id,
            filename="z.csv",
            row_count=1,
            enriched_rows=1,
            status="complete",
        )
        db_session.add(ci)
        await db_session.commit()
        mocker.patch("budget.main._enrichment_queue.enqueue")
        r = await client.post(f"/imports/{ci.id}/re-enrich")
        assert r.status_code == 200
        assert r.json()["status"] == "processing"
        assert r.json()["csv_import_id"] == ci.id
        await db_session.refresh(ci)
        assert ci.status == "in-progress"
        assert ci.enriched_rows == 0


class TestAbortImport:
    async def test_not_found(self, client):
        r = await client.post("/imports/99999/abort")
        assert r.status_code == 404

    async def test_cannot_abort_complete(self, client, db_session, make_account):
        acct = await make_account()
        ci = CsvImport(
            user_id=1,
            account_id=acct.id,
            filename="done.csv",
            row_count=5,
            enriched_rows=5,
            status="complete",
        )
        db_session.add(ci)
        await db_session.commit()
        r = await client.post(f"/imports/{ci.id}/abort")
        assert r.status_code == 409

    async def test_cannot_abort_already_aborted(self, client, db_session, make_account):
        acct = await make_account()
        ci = CsvImport(
            user_id=1,
            account_id=acct.id,
            filename="stopped.csv",
            row_count=5,
            enriched_rows=2,
            status="aborted",
        )
        db_session.add(ci)
        await db_session.commit()
        r = await client.post(f"/imports/{ci.id}/abort")
        assert r.status_code == 409

    async def test_success(self, client, db_session, make_account):
        acct = await make_account()
        ci = CsvImport(
            user_id=1,
            account_id=acct.id,
            filename="running.csv",
            row_count=10,
            enriched_rows=3,
            status="in-progress",
        )
        db_session.add(ci)
        await db_session.commit()
        r = await client.post(f"/imports/{ci.id}/abort")
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "aborted"
        assert data["csv_import_id"] == ci.id
        await db_session.refresh(ci)
        assert ci.status == "aborted"

    async def test_progress_has_aborted_field(self, client, db_session, make_account):
        acct = await make_account()
        ci = CsvImport(
            user_id=1,
            account_id=acct.id,
            filename="aborted.csv",
            row_count=10,
            enriched_rows=3,
            status="aborted",
        )
        db_session.add(ci)
        await db_session.commit()
        r = await client.get(f"/imports/{ci.id}/progress")
        assert r.status_code == 200
        data = r.json()
        assert data["aborted"] is True
        assert data["complete"] is False

    async def test_re_enrich_allowed_on_aborted(
        self, client, db_session, make_account, mocker
    ):
        acct = await make_account()
        ci = CsvImport(
            user_id=1,
            account_id=acct.id,
            filename="retry.csv",
            row_count=5,
            enriched_rows=2,
            status="aborted",
        )
        db_session.add(ci)
        await db_session.commit()
        mocker.patch("budget.main._enrichment_queue.enqueue")
        r = await client.post(f"/imports/{ci.id}/re-enrich")
        assert r.status_code == 200
        assert r.json()["status"] == "processing"
        await db_session.refresh(ci)
        assert ci.status == "in-progress"


class TestClassifyGap:
    def test_weekly(self):
        assert _classify_gap(7) == "weekly"

    def test_weekly_boundary_low(self):
        assert _classify_gap(5) == "weekly"

    def test_weekly_boundary_high(self):
        assert _classify_gap(10) == "weekly"

    def test_biweekly(self):
        assert _classify_gap(14) == "biweekly"

    def test_monthly(self):
        assert _classify_gap(30) == "monthly"

    def test_quarterly(self):
        assert _classify_gap(90) == "quarterly"

    def test_annual(self):
        assert _classify_gap(365) == "annual"

    def test_below_all_ranges_returns_none(self):
        assert _classify_gap(1) is None

    def test_between_ranges_returns_none(self):
        # 200 falls between quarterly (60–120) and annual (300–400)
        assert _classify_gap(200) is None


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


class TestAuth:
    # --- POST /auth/login ---

    async def test_login_success(self, client, make_user):
        await make_user(email="alice@example.com", password="hunter2")
        r = await client.post(
            "/auth/login",
            data={"username": "alice@example.com", "password": "hunter2"},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["token_type"] == "bearer"
        assert "access_token" in body
        assert body["user"]["email"] == "alice@example.com"

    async def test_login_wrong_password(self, client, make_user):
        await make_user(email="bob@example.com", password="correct")
        r = await client.post(
            "/auth/login",
            data={"username": "bob@example.com", "password": "wrong"},
        )
        assert r.status_code == 401

    async def test_login_unknown_email(self, client):
        r = await client.post(
            "/auth/login",
            data={"username": "nobody@example.com", "password": "pass"},
        )
        assert r.status_code == 401

    async def test_login_google_only_user(self, client, db_session):
        # User with sentinel password hash cannot log in with a password
        from budget.models import User

        user = User(email="guser@example.com", name="G", password_hash="!google-oauth")
        db_session.add(user)
        await db_session.commit()
        r = await client.post(
            "/auth/login",
            data={"username": "guser@example.com", "password": "anything"},
        )
        assert r.status_code == 401

    # --- POST /auth/google ---

    async def test_google_not_configured(self, client):
        from unittest.mock import patch

        with patch("budget.main.GOOGLE_CLIENT_ID", ""):
            r = await client.post("/auth/google", json={"credential": "tok"})
        assert r.status_code == 503

    async def test_google_invalid_token(self, client):
        from unittest.mock import patch

        with patch("budget.main.GOOGLE_CLIENT_ID", "test-client-id"), patch(
            "budget.main.google_id_token.verify_oauth2_token",
            side_effect=Exception("bad"),
        ):
            r = await client.post("/auth/google", json={"credential": "bad-tok"})
        assert r.status_code == 401

    async def test_google_creates_new_user(self, client):
        from unittest.mock import patch

        fake_id_info = {"sub": "g-123", "email": "new@example.com", "name": "New User"}
        with patch("budget.main.GOOGLE_CLIENT_ID", "test-client-id"), patch(
            "budget.main.google_id_token.verify_oauth2_token", return_value=fake_id_info
        ):
            r = await client.post("/auth/google", json={"credential": "valid-tok"})
        assert r.status_code == 200
        body = r.json()
        assert body["user"]["email"] == "new@example.com"
        assert "access_token" in body

    async def test_google_existing_user_by_google_id(self, client, db_session):
        from unittest.mock import patch

        from budget.models import User

        user = User(
            email="existing@example.com",
            name="Existing",
            password_hash="!google-oauth",
            google_id="g-456",
        )
        db_session.add(user)
        await db_session.commit()
        fake_id_info = {
            "sub": "g-456",
            "email": "existing@example.com",
            "name": "Existing",
        }
        with patch("budget.main.GOOGLE_CLIENT_ID", "test-client-id"), patch(
            "budget.main.google_id_token.verify_oauth2_token", return_value=fake_id_info
        ):
            r = await client.post("/auth/google", json={"credential": "valid-tok"})
            r2 = await client.post("/auth/google", json={"credential": "valid-tok"})
        # Both calls return the same user; no duplicate created
        assert r.status_code == 200
        assert r2.status_code == 200
        assert r.json()["user"]["id"] == r2.json()["user"]["id"]

    async def test_google_links_existing_email_user(
        self, client, make_user, db_session
    ):
        from unittest.mock import patch

        from budget.models import User  # noqa: F401

        user = await make_user(email="link@example.com", password="pass")
        assert user.google_id is None
        fake_id_info = {
            "sub": "g-789",
            "email": "link@example.com",
            "name": "Link User",
        }
        with patch("budget.main.GOOGLE_CLIENT_ID", "test-client-id"), patch(
            "budget.main.google_id_token.verify_oauth2_token", return_value=fake_id_info
        ):
            r = await client.post("/auth/google", json={"credential": "valid-tok"})
        assert r.status_code == 200
        # google_id should now be set on the existing user
        await db_session.refresh(user)
        assert user.google_id == "g-789"


# ---------------------------------------------------------------------------
# Auth enforcement — protected endpoints must reject unauthenticated requests
# ---------------------------------------------------------------------------


class TestAuthRequired:
    """Every protected route should return 401 with no token or a bad token."""

    async def test_no_token_get_accounts(self, unauthed_client):
        r = await unauthed_client.get("/accounts")
        assert r.status_code == 401

    async def test_no_token_get_transactions(self, unauthed_client):
        r = await unauthed_client.get("/transactions")
        assert r.status_code == 401

    async def test_no_token_get_merchants(self, unauthed_client):
        r = await unauthed_client.get("/merchants")
        assert r.status_code == 401

    async def test_no_token_get_categories(self, unauthed_client):
        r = await unauthed_client.get("/categories")
        assert r.status_code == 401

    async def test_no_token_get_recurring(self, unauthed_client):
        r = await unauthed_client.get("/recurring")
        assert r.status_code == 401

    async def test_no_token_get_overview(self, unauthed_client):
        r = await unauthed_client.get("/overview")
        assert r.status_code == 401

    async def test_no_token_get_monthly(self, unauthed_client):
        r = await unauthed_client.get("/monthly")
        assert r.status_code == 401

    async def test_no_token_get_imports(self, unauthed_client):
        r = await unauthed_client.get("/imports")
        assert r.status_code == 401

    async def test_no_token_post_import_csv(self, unauthed_client):
        r = await unauthed_client.post("/import-csv", data={}, files={})
        assert r.status_code == 401

    async def test_no_token_patch_merchant(self, unauthed_client):
        r = await unauthed_client.patch("/merchants/1", json={"name": "X"})
        assert r.status_code == 401

    async def test_no_token_patch_transaction(self, unauthed_client):
        r = await unauthed_client.patch("/transactions/1", json={})
        assert r.status_code == 401

    async def test_no_token_post_merge_merchants(self, unauthed_client):
        r = await unauthed_client.post(
            "/merchants/merge", json={"keep_id": 1, "merge_ids": [2]}
        )
        assert r.status_code == 401

    async def test_no_token_get_cardholders(self, unauthed_client):
        r = await unauthed_client.get("/cardholders")
        assert r.status_code == 401

    async def test_invalid_token_get_accounts(self, unauthed_client):
        r = await unauthed_client.get(
            "/accounts", headers={"Authorization": "Bearer not-a-valid-jwt"}
        )
        assert r.status_code == 401

    async def test_expired_token_get_accounts(self, unauthed_client):
        from datetime import UTC, datetime, timedelta

        from jose import jwt as jose_jwt

        expired_payload = {"sub": "1", "exp": datetime.now(UTC) - timedelta(days=1)}
        token = jose_jwt.encode(
            expired_payload, "dev-secret-change-me", algorithm="HS256"
        )
        r = await unauthed_client.get(
            "/accounts", headers={"Authorization": f"Bearer {token}"}
        )
        assert r.status_code == 401


# ---------------------------------------------------------------------------
# Yearly analytics
# ---------------------------------------------------------------------------


class TestYearly:
    async def test_list_years_empty(self, client):
        r = await client.get("/yearly")
        assert r.status_code == 200
        assert r.json() == {"years": []}

    async def test_list_years(self, client, make_account, make_transaction):
        acct = await make_account()
        await make_transaction(acct.id, txn_date=date(2023, 6, 1))
        await make_transaction(acct.id, txn_date=date(2024, 3, 15))
        r = await client.get("/yearly")
        assert r.status_code == 200
        years = r.json()["years"]
        assert "2023" in years
        assert "2024" in years
        # Most recent year first
        assert years.index("2024") < years.index("2023")

    async def test_get_yearly_report(self, client, make_account, make_transaction):
        acct = await make_account()
        await make_transaction(
            acct.id, amount=Decimal("5000.00"), txn_date=date(2024, 1, 10)
        )
        await make_transaction(
            acct.id, amount=Decimal("-1200.00"), txn_date=date(2024, 6, 15)
        )
        r = await client.get("/yearly/2024")
        assert r.status_code == 200
        data = r.json()
        assert data["year"] == "2024"
        summary = data["summary"]
        assert float(summary["income"]) == pytest.approx(5000.0)
        assert float(summary["expenses"]) == pytest.approx(-1200.0)
        assert float(summary["net"]) == pytest.approx(3800.0)
        assert "category_breakdown" in data
        # pct change fields present (null when no prior year)
        assert "income_pct_change" in summary
        assert "expenses_pct_change" in summary
        assert "net_pct_change" in summary
        assert summary["income_pct_change"] is None
        assert summary["expenses_pct_change"] is None
        assert summary["net_pct_change"] is None

    async def test_get_yearly_report_pct_change(
        self, client, make_account, make_transaction
    ):
        acct = await make_account()
        # Prior year: income 10000, expenses -3000
        await make_transaction(
            acct.id, amount=Decimal("10000.00"), txn_date=date(2023, 6, 1)
        )
        await make_transaction(
            acct.id, amount=Decimal("-3000.00"), txn_date=date(2023, 6, 15)
        )
        # Current year: income 12000, expenses -2400
        await make_transaction(
            acct.id, amount=Decimal("12000.00"), txn_date=date(2024, 6, 1)
        )
        await make_transaction(
            acct.id, amount=Decimal("-2400.00"), txn_date=date(2024, 6, 15)
        )
        r = await client.get("/yearly/2024")
        assert r.status_code == 200
        data = r.json()
        summary = data["summary"]
        # income: (12000 - 10000) / 10000 * 100 = 20.0
        assert summary["income_pct_change"] == pytest.approx(20.0)
        # expenses: (|-2400| - |-3000|) / |-3000| * 100 = -20.0
        assert summary["expenses_pct_change"] == pytest.approx(-20.0)
        # net: (9600 - 7000) / 7000 * 100 = 37.1
        assert summary["net_pct_change"] == pytest.approx(37.1, abs=0.2)
        # category breakdown: uncategorized expenses -2400 vs -3000 → -20.0%
        cat = data["category_breakdown"][0]
        assert "pct_change" in cat
        assert cat["pct_change"] == pytest.approx(-20.0)
        assert "pct_change" in cat["subcategories"][0]
        assert cat["subcategories"][0]["pct_change"] == pytest.approx(-20.0)

    async def test_yearly_breakdown_pct_change_null_for_new_category(
        self, client, make_account, make_transaction, make_category
    ):
        acct = await make_account()
        _, sub = await make_category("Travel", "Flights")
        # Expenses only in current year (no prior year) → pct_change should be null
        await make_transaction(
            acct.id,
            amount=Decimal("-500.00"),
            txn_date=date(2024, 7, 1),
            subcategory_id=sub.id,
        )
        r = await client.get("/yearly/2024")
        assert r.status_code == 200
        cat = r.json()["category_breakdown"][0]
        assert cat["pct_change"] is None
        assert cat["subcategories"][0]["pct_change"] is None

    async def test_get_yearly_report_empty_year(self, client):
        r = await client.get("/yearly/2099")
        assert r.status_code == 200
        data = r.json()
        assert data["year"] == "2099"
        assert float(data["summary"]["income"]) == pytest.approx(0.0)
        assert float(data["summary"]["expenses"]) == pytest.approx(0.0)
        assert data["category_breakdown"] == []

    async def test_get_yearly_report_savings_rate(
        self, client, make_account, make_transaction
    ):
        acct = await make_account()
        await make_transaction(
            acct.id, amount=Decimal("10000.00"), txn_date=date(2024, 1, 1)
        )
        await make_transaction(
            acct.id, amount=Decimal("-2000.00"), txn_date=date(2024, 2, 1)
        )
        r = await client.get("/yearly/2024")
        assert r.status_code == 200
        savings_rate = r.json()["summary"]["savings_rate"]
        assert savings_rate == pytest.approx(80.0, abs=0.1)


# ---------------------------------------------------------------------------
# Monthly / yearly / overview summary period_meta injection
# ---------------------------------------------------------------------------

FAKE_SUMMARY = {
    "narrative": "Test narrative.",
    "insights": ["An insight."],
    "recommendations": ["A recommendation."],
}


class TestMonthlySummaryPeriodMeta:
    async def test_incomplete_month_has_period_meta_false(
        self, client, make_account, make_transaction, mocker
    ):
        """Current month: period_meta.is_complete should be False."""
        from datetime import date as date_type

        today = date_type.today()
        current_month = today.strftime("%Y-%m")
        acct = await make_account()
        await make_transaction(acct.id, txn_date=today)

        mock_summarize = mocker.patch(
            "budget.main.report_summarizer.summarize",
            return_value=FAKE_SUMMARY,
        )
        r = await client.get(f"/monthly/{current_month}/summary")
        assert r.status_code == 200

        _label, report = mock_summarize.call_args.args
        assert report["period_meta"]["is_complete"] is False
        assert (
            report["period_meta"]["days_elapsed"]
            <= report["period_meta"]["days_in_month"]
        )

    async def test_past_month_has_period_meta_true(
        self, client, make_account, make_transaction, mocker
    ):
        """Past month: period_meta.is_complete should be True."""
        acct = await make_account()
        await make_transaction(acct.id, txn_date=date(2024, 1, 15))

        mock_summarize = mocker.patch(
            "budget.main.report_summarizer.summarize",
            return_value=FAKE_SUMMARY,
        )
        r = await client.get("/monthly/2024-01/summary")
        assert r.status_code == 200

        _label, report = mock_summarize.call_args.args
        assert report["period_meta"]["is_complete"] is True
        assert report["period_meta"]["days_in_month"] == 31

    async def test_incomplete_month_not_cached(
        self, client, make_account, make_transaction, mocker
    ):
        """Incomplete month summaries should not be written to cache."""
        from datetime import date as date_type

        today = date_type.today()
        current_month = today.strftime("%Y-%m")
        acct = await make_account()
        await make_transaction(acct.id, txn_date=today)

        mock_summarize = mocker.patch(
            "budget.main.report_summarizer.summarize",
            return_value=FAKE_SUMMARY,
        )
        await client.get(f"/monthly/{current_month}/summary")
        await client.get(f"/monthly/{current_month}/summary")
        # Should re-generate each time since not cached
        assert mock_summarize.call_count == 2

    async def test_past_month_is_cached(
        self, client, make_account, make_transaction, mocker
    ):
        """Past month summaries should be cached after the first call."""
        acct = await make_account()
        await make_transaction(acct.id, txn_date=date(2024, 1, 15))

        mock_summarize = mocker.patch(
            "budget.main.report_summarizer.summarize",
            return_value=FAKE_SUMMARY,
        )
        await client.get("/monthly/2024-01/summary")
        await client.get("/monthly/2024-01/summary")
        assert mock_summarize.call_count == 1


class TestYearlySummaryPeriodMeta:
    async def test_incomplete_year_has_period_meta_false(
        self, client, make_account, make_transaction, mocker
    ):
        """Current year: period_meta.is_complete should be False."""
        from datetime import date as date_type

        today = date_type.today()
        current_year = str(today.year)
        acct = await make_account()
        await make_transaction(acct.id, txn_date=today)

        mock_summarize = mocker.patch(
            "budget.main.report_summarizer.summarize",
            return_value=FAKE_SUMMARY,
        )
        r = await client.get(f"/yearly/{current_year}/summary")
        assert r.status_code == 200

        _label, report = mock_summarize.call_args.args
        assert report["period_meta"]["is_complete"] is False
        assert (
            report["period_meta"]["days_elapsed"]
            <= report["period_meta"]["days_in_year"]
        )

    async def test_past_year_has_period_meta_true(
        self, client, make_account, make_transaction, mocker
    ):
        """Past year: period_meta.is_complete should be True."""
        acct = await make_account()
        await make_transaction(acct.id, txn_date=date(2024, 6, 15))

        mock_summarize = mocker.patch(
            "budget.main.report_summarizer.summarize",
            return_value=FAKE_SUMMARY,
        )
        r = await client.get("/yearly/2024/summary")
        assert r.status_code == 200

        _label, report = mock_summarize.call_args.args
        assert report["period_meta"]["is_complete"] is True
        assert report["period_meta"]["days_in_year"] == 366  # 2024 is a leap year

    async def test_incomplete_year_not_cached(
        self, client, make_account, make_transaction, mocker
    ):
        """Incomplete year summaries should not be written to cache."""
        from datetime import date as date_type

        today = date_type.today()
        current_year = str(today.year)
        acct = await make_account()
        await make_transaction(acct.id, txn_date=today)

        mock_summarize = mocker.patch(
            "budget.main.report_summarizer.summarize",
            return_value=FAKE_SUMMARY,
        )
        await client.get(f"/yearly/{current_year}/summary")
        await client.get(f"/yearly/{current_year}/summary")
        assert mock_summarize.call_count == 2

    async def test_past_year_is_cached(
        self, client, make_account, make_transaction, mocker
    ):
        """Past year summaries should be cached after the first call."""
        acct = await make_account()
        await make_transaction(acct.id, txn_date=date(2024, 6, 15))

        mock_summarize = mocker.patch(
            "budget.main.report_summarizer.summarize",
            return_value=FAKE_SUMMARY,
        )
        await client.get("/yearly/2024/summary")
        await client.get("/yearly/2024/summary")
        assert mock_summarize.call_count == 1


# ---------------------------------------------------------------------------
# Tags
# ---------------------------------------------------------------------------


class TestTags:
    async def test_list_tags_empty(self, client):
        r = await client.get("/tags")
        assert r.status_code == 200
        assert r.json() == {"items": []}

    async def test_list_tags_with_stats(
        self, client, make_account, make_transaction, db_session
    ):
        from budget.models import Tag
        from budget.models import transaction_tags as tt

        acct = await make_account()
        tx = await make_transaction(acct.id, amount=Decimal("-25.00"))

        tag = Tag(user_id=1, name="food")
        db_session.add(tag)
        await db_session.flush()
        await db_session.execute(
            tt.insert().values(transaction_id=tx.id, tag_id=tag.id)
        )
        await db_session.commit()

        r = await client.get("/tags")
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) == 1
        item = items[0]
        assert item["name"] == "food"
        assert item["transaction_count"] == 1
        assert float(item["total_amount"]) == -25.0

    async def test_list_tags_name_filter(self, client, db_session):
        from budget.models import Tag

        db_session.add(Tag(user_id=1, name="food"))
        db_session.add(Tag(user_id=1, name="travel"))
        await db_session.commit()

        r = await client.get("/tags", params={"name": "foo"})
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) == 1
        assert items[0]["name"] == "food"

    async def test_list_tags_sort_by_transaction_count(
        self, client, make_account, make_transaction, db_session
    ):
        from budget.models import Tag
        from budget.models import transaction_tags as tt

        acct = await make_account()
        tx1 = await make_transaction(acct.id)
        tx2 = await make_transaction(acct.id, description="tx2")

        tag_food = Tag(user_id=1, name="food")
        tag_travel = Tag(user_id=1, name="travel")
        db_session.add(tag_food)
        db_session.add(tag_travel)
        await db_session.flush()

        # food gets 2 transactions, travel gets 1
        await db_session.execute(
            tt.insert().values(transaction_id=tx1.id, tag_id=tag_food.id)
        )
        await db_session.execute(
            tt.insert().values(transaction_id=tx2.id, tag_id=tag_food.id)
        )
        await db_session.execute(
            tt.insert().values(transaction_id=tx1.id, tag_id=tag_travel.id)
        )
        await db_session.commit()

        r = await client.get(
            "/tags", params={"sort_by": "transaction_count", "sort_dir": "desc"}
        )
        assert r.status_code == 200
        items = r.json()["items"]
        assert items[0]["name"] == "food"
        assert items[0]["transaction_count"] == 2
        assert items[1]["name"] == "travel"
        assert items[1]["transaction_count"] == 1


# ---------------------------------------------------------------------------
# Category & subcategory classification
# ---------------------------------------------------------------------------


class TestCategoryClassification:
    async def test_list_all_categories_empty(self, client):
        r = await client.get("/categories/all")
        assert r.status_code == 200
        assert r.json() == {"items": []}

    async def test_list_all_categories(self, client, make_category):
        await make_category("Food & Drink", "Restaurants")
        await make_category("Transport", "Fuel")
        r = await client.get("/categories/all")
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) == 2
        names = {i["category_name"] for i in items}
        assert "Food & Drink" in names
        assert "Transport" in names
        for item in items:
            assert "category_id" in item
            assert "subcategory_id" in item
            assert "category_name" in item
            assert "subcategory_name" in item

    async def test_patch_category_classification(self, client, make_category):
        cat, _sub = await make_category("Housing", "Rent")
        r = await client.patch(f"/categories/{cat.id}", json={"classification": "need"})
        assert r.status_code == 200
        data = r.json()
        assert data["id"] == cat.id
        assert data["classification"] == "need"

    async def test_patch_category_classification_none(self, client, make_category):
        cat, _sub = await make_category("Housing", "Rent")
        r = await client.patch(f"/categories/{cat.id}", json={"classification": None})
        assert r.status_code == 200
        assert r.json()["classification"] is None

    async def test_patch_category_not_found(self, client):
        r = await client.patch("/categories/99999", json={"classification": "need"})
        assert r.status_code == 404

    async def test_patch_subcategory_classification(self, client, make_category):
        _cat, sub = await make_category("Entertainment", "Streaming")
        r = await client.patch(
            f"/subcategories/{sub.id}", json={"classification": "want"}
        )
        assert r.status_code == 200
        data = r.json()
        assert data["id"] == sub.id
        assert data["classification"] == "want"

    async def test_patch_subcategory_not_found(self, client):
        r = await client.patch("/subcategories/99999", json={"classification": "want"})
        assert r.status_code == 404


# ---------------------------------------------------------------------------
# Budgets
# ---------------------------------------------------------------------------


class TestBudgets:
    async def test_list_empty(self, client):
        r = await client.get("/budgets")
        assert r.status_code == 200
        data = r.json()
        assert data["items"] == []
        assert "month" in data

    async def test_list_with_month_param(self, client):
        r = await client.get("/budgets", params={"month": "2024-06"})
        assert r.status_code == 200
        assert r.json()["month"] == "2024-06"

    async def test_create_category_budget(self, client, make_category):
        cat, _sub = await make_category("Food & Drink", "Restaurants")
        r = await client.post(
            "/budgets", json={"category_id": cat.id, "amount_limit": "500.00"}
        )
        assert r.status_code == 201
        data = r.json()
        assert data["scope"] == "category"
        assert data["name"] == "Food & Drink"
        assert float(data["amount_limit"]) == pytest.approx(500.0)
        assert "spent" in data
        assert "pct" in data

    async def test_create_subcategory_budget(self, client, make_category):
        _cat, sub = await make_category("Food & Drink", "Restaurants")
        r = await client.post(
            "/budgets", json={"subcategory_id": sub.id, "amount_limit": "200.00"}
        )
        assert r.status_code == 201
        data = r.json()
        assert data["scope"] == "subcategory"
        assert data["name"] == "Restaurants"

    async def test_create_budget_both_ids_rejected(self, client, make_category):
        cat, sub = await make_category()
        r = await client.post(
            "/budgets",
            json={
                "category_id": cat.id,
                "subcategory_id": sub.id,
                "amount_limit": "100.00",
            },
        )
        assert r.status_code == 422

    async def test_create_budget_no_id_rejected(self, client):
        r = await client.post("/budgets", json={"amount_limit": "100.00"})
        assert r.status_code == 422

    async def test_create_budget_non_positive_limit_rejected(
        self, client, make_category
    ):
        cat, _sub = await make_category()
        r = await client.post(
            "/budgets", json={"category_id": cat.id, "amount_limit": "0"}
        )
        assert r.status_code == 422

    async def test_create_budget_duplicate_rejected(self, client, make_category):
        cat, _sub = await make_category()
        await client.post(
            "/budgets", json={"category_id": cat.id, "amount_limit": "100.00"}
        )
        r = await client.post(
            "/budgets", json={"category_id": cat.id, "amount_limit": "200.00"}
        )
        assert r.status_code == 409

    async def test_update_budget(self, client, make_category):
        cat, _sub = await make_category()
        create_r = await client.post(
            "/budgets", json={"category_id": cat.id, "amount_limit": "100.00"}
        )
        budget_id = create_r.json()["id"]
        r = await client.patch(f"/budgets/{budget_id}", json={"amount_limit": "350.00"})
        assert r.status_code == 200
        assert float(r.json()["amount_limit"]) == pytest.approx(350.0)

    async def test_update_budget_non_positive_rejected(self, client, make_category):
        cat, _sub = await make_category()
        create_r = await client.post(
            "/budgets", json={"category_id": cat.id, "amount_limit": "100.00"}
        )
        budget_id = create_r.json()["id"]
        r = await client.patch(f"/budgets/{budget_id}", json={"amount_limit": "-50.00"})
        assert r.status_code == 422

    async def test_update_budget_not_found(self, client):
        r = await client.patch("/budgets/99999", json={"amount_limit": "100.00"})
        assert r.status_code == 404

    async def test_delete_budget(self, client, make_category):
        cat, _sub = await make_category()
        create_r = await client.post(
            "/budgets", json={"category_id": cat.id, "amount_limit": "100.00"}
        )
        budget_id = create_r.json()["id"]
        r = await client.delete(f"/budgets/{budget_id}")
        assert r.status_code == 204
        list_r = await client.get("/budgets")
        assert all(b["id"] != budget_id for b in list_r.json()["items"])

    async def test_delete_budget_not_found(self, client):
        r = await client.delete("/budgets/99999")
        assert r.status_code == 404

    async def test_list_budgets_includes_spending(
        self, client, make_account, make_category, make_transaction
    ):
        today = date.today()
        acct = await make_account()
        cat, sub = await make_category("Food & Drink", "Restaurants")
        await client.post(
            "/budgets", json={"category_id": cat.id, "amount_limit": "300.00"}
        )
        month = today.strftime("%Y-%m")
        await make_transaction(
            acct.id,
            amount=Decimal("-75.00"),
            subcategory_id=sub.id,
            txn_date=today,
        )
        r = await client.get("/budgets", params={"month": month})
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) == 1
        assert float(items[0]["spent"]) == pytest.approx(75.0)
        assert items[0]["pct"] == 25

    async def test_budget_severity_over(
        self, client, make_account, make_category, make_transaction
    ):
        today = date.today()
        acct = await make_account()
        cat, sub = await make_category()
        await client.post(
            "/budgets", json={"category_id": cat.id, "amount_limit": "50.00"}
        )
        month = today.strftime("%Y-%m")
        await make_transaction(
            acct.id, amount=Decimal("-100.00"), subcategory_id=sub.id, txn_date=today
        )
        r = await client.get("/budgets", params={"month": month})
        item = r.json()["items"][0]
        assert item["severity"] == "over"
        assert item["pct"] >= 100

    async def test_wizard_no_data(self, client):
        r = await client.get("/budgets/wizard")
        assert r.status_code == 200
        data = r.json()
        assert data["items"] == []
        assert data["months_analyzed"] == 0
        assert data["avg_monthly_income"] == "0"

    async def test_wizard_with_spending(
        self, client, make_account, make_category, make_transaction
    ):
        acct = await make_account()
        cat, sub = await make_category("Food & Drink", "Restaurants")
        for month in [1, 2, 3]:
            await make_transaction(
                acct.id,
                amount=Decimal("-200.00"),
                subcategory_id=sub.id,
                txn_date=date(2024, month, 15),
            )
            await make_transaction(
                acct.id, amount=Decimal("3000.00"), txn_date=date(2024, month, 1)
            )
        r = await client.get("/budgets/wizard", params={"scope": "category"})
        assert r.status_code == 200
        data = r.json()
        assert data["months_analyzed"] > 0
        assert len(data["items"]) > 0
        item = data["items"][0]
        assert "id" in item
        assert "name" in item
        assert "avg_monthly" in item
        assert "already_budgeted" in item

    async def test_batch_create_budgets(self, client, make_category):
        cat1, _sub1 = await make_category("Food & Drink", "Restaurants")
        cat2, _sub2 = await make_category("Transport", "Fuel")
        r = await client.post(
            "/budgets/batch",
            json={
                "items": [
                    {"category_id": cat1.id, "amount_limit": "400.00"},
                    {"category_id": cat2.id, "amount_limit": "150.00"},
                ]
            },
        )
        assert r.status_code == 201
        data = r.json()
        assert data["created"] == 2
        assert data["skipped"] == 0

    async def test_batch_skips_existing(self, client, make_category):
        cat, _sub = await make_category()
        await client.post(
            "/budgets", json={"category_id": cat.id, "amount_limit": "100.00"}
        )
        r = await client.post(
            "/budgets/batch",
            json={"items": [{"category_id": cat.id, "amount_limit": "200.00"}]},
        )
        assert r.status_code == 201
        data = r.json()
        assert data["created"] == 0
        assert data["skipped"] == 1

    async def test_batch_skips_invalid_items(self, client, make_category):
        cat, sub = await make_category()
        r = await client.post(
            "/budgets/batch",
            json={
                "items": [
                    # Both ids set — invalid
                    {
                        "category_id": cat.id,
                        "subcategory_id": sub.id,
                        "amount_limit": "100.00",
                    },
                    # Zero limit — invalid
                    {"category_id": cat.id, "amount_limit": "0"},
                ]
            },
        )
        assert r.status_code == 201
        data = r.json()
        assert data["created"] == 0
        assert data["skipped"] == 2


class TestBudgetSummary:
    FAKE_SUMMARY = {
        "narrative": "Budget overview for the month.",
        "insights": ["Spending on Food is 80% of limit."],
        "recommendations": ["Reduce dining out."],
    }

    async def test_get_budget_summary_returns_narrative_insights_recommendations(
        self, client, make_category, mocker
    ):
        cat, _sub = await make_category("Food & Drink", "Restaurants")
        await client.post(
            "/budgets", json={"category_id": cat.id, "amount_limit": "300.00"}
        )
        mocker.patch(
            "budget.main.report_summarizer.summarize",
            return_value=self.FAKE_SUMMARY,
        )
        r = await client.get("/budgets/2026-03/summary")
        assert r.status_code == 200
        data = r.json()
        assert data["narrative"] == "Budget overview for the month."
        assert data["insights"] == ["Spending on Food is 80% of limit."]
        assert data["recommendations"] == ["Reduce dining out."]

    async def test_get_budget_summary_cached_on_second_call(
        self, client, make_category, mocker
    ):
        cat, _sub = await make_category("Food & Drink", "Restaurants")
        await client.post(
            "/budgets", json={"category_id": cat.id, "amount_limit": "300.00"}
        )
        mock_summarize = mocker.patch(
            "budget.main.report_summarizer.summarize",
            return_value=self.FAKE_SUMMARY,
        )
        await client.get("/budgets/2026-03/summary")
        await client.get("/budgets/2026-03/summary")
        assert mock_summarize.call_count == 1

    async def test_get_budget_summary_force_bypasses_cache(
        self, client, make_category, mocker
    ):
        cat, _sub = await make_category("Food & Drink", "Restaurants")
        await client.post(
            "/budgets", json={"category_id": cat.id, "amount_limit": "300.00"}
        )
        mock_summarize = mocker.patch(
            "budget.main.report_summarizer.summarize",
            return_value=self.FAKE_SUMMARY,
        )
        await client.get("/budgets/2026-03/summary")
        await client.get("/budgets/2026-03/summary", params={"force": "true"})
        assert mock_summarize.call_count == 2


class TestCategoriesSummary:
    FAKE_SUMMARY = {
        "narrative": "Category spending overview.",
        "insights": ["Food is the top category."],
        "recommendations": ["Cut restaurant spending."],
    }

    async def test_returns_narrative_insights_recommendations(
        self, client, make_account, make_category, make_transaction, mocker
    ):
        acct = await make_account()
        cat, sub = await make_category("Food & Drink", "Restaurants")
        await make_transaction(acct.id, amount=Decimal("-50.00"), subcategory_id=sub.id)
        mocker.patch(
            "budget.main.report_summarizer.summarize",
            return_value=self.FAKE_SUMMARY,
        )
        r = await client.get("/categories/summary")
        assert r.status_code == 200
        data = r.json()
        assert data["narrative"] == "Category spending overview."
        assert data["insights"] == ["Food is the top category."]
        assert data["recommendations"] == ["Cut restaurant spending."]

    async def test_cached_on_second_call(
        self, client, make_account, make_category, make_transaction, mocker
    ):
        acct = await make_account()
        cat, sub = await make_category("Food & Drink", "Restaurants")
        await make_transaction(acct.id, amount=Decimal("-50.00"), subcategory_id=sub.id)
        mock_summarize = mocker.patch(
            "budget.main.report_summarizer.summarize",
            return_value=self.FAKE_SUMMARY,
        )
        await client.get("/categories/summary")
        await client.get("/categories/summary")
        assert mock_summarize.call_count == 1

    async def test_force_bypasses_cache(
        self, client, make_account, make_category, make_transaction, mocker
    ):
        acct = await make_account()
        cat, sub = await make_category("Food & Drink", "Restaurants")
        await make_transaction(acct.id, amount=Decimal("-50.00"), subcategory_id=sub.id)
        mock_summarize = mocker.patch(
            "budget.main.report_summarizer.summarize",
            return_value=self.FAKE_SUMMARY,
        )
        await client.get("/categories/summary")
        await client.get("/categories/summary", params={"force": "true"})
        assert mock_summarize.call_count == 2


class TestRecurringSummary:
    FAKE_SUMMARY = {
        "narrative": "You have several recurring charges.",
        "insights": ["Netflix costs $15.99/month."],
        "recommendations": ["Review unused subscriptions."],
    }

    async def test_returns_narrative_insights_recommendations(
        self, client, make_account, make_transaction, make_merchant, mocker
    ):
        acct = await make_account()
        merchant = await make_merchant("Netflix")
        for i in range(3):
            await make_transaction(
                acct.id,
                amount=Decimal("-15.99"),
                merchant_id=merchant.id,
                txn_date=date(2026, i + 1, 15),
                is_recurring=True,
            )
        mocker.patch(
            "budget.main.report_summarizer.summarize",
            return_value=self.FAKE_SUMMARY,
        )
        r = await client.get("/recurring/summary")
        assert r.status_code == 200
        data = r.json()
        assert data["narrative"] == "You have several recurring charges."
        assert data["insights"] == ["Netflix costs $15.99/month."]
        assert data["recommendations"] == ["Review unused subscriptions."]

    async def test_cached_on_second_call(
        self, client, make_account, make_transaction, make_merchant, mocker
    ):
        acct = await make_account()
        merchant = await make_merchant("Spotify")
        for i in range(3):
            await make_transaction(
                acct.id,
                amount=Decimal("-9.99"),
                merchant_id=merchant.id,
                txn_date=date(2026, i + 1, 1),
                is_recurring=True,
            )
        mock_summarize = mocker.patch(
            "budget.main.report_summarizer.summarize",
            return_value=self.FAKE_SUMMARY,
        )
        await client.get("/recurring/summary")
        await client.get("/recurring/summary")
        assert mock_summarize.call_count == 1

    async def test_force_bypasses_cache(
        self, client, make_account, make_transaction, make_merchant, mocker
    ):
        acct = await make_account()
        merchant = await make_merchant("Adobe")
        for i in range(3):
            await make_transaction(
                acct.id,
                amount=Decimal("-54.99"),
                merchant_id=merchant.id,
                txn_date=date(2026, i + 1, 5),
                is_recurring=True,
            )
        mock_summarize = mocker.patch(
            "budget.main.report_summarizer.summarize",
            return_value=self.FAKE_SUMMARY,
        )
        await client.get("/recurring/summary")
        await client.get("/recurring/summary", params={"force": "true"})
        assert mock_summarize.call_count == 2


class TestTrendsSummary:
    FAKE_SUMMARY = {
        "narrative": "Your spending trends show steady growth.",
        "insights": ["Food & Drink is the top category."],
        "recommendations": ["Track grocery vs restaurant spending separately."],
    }

    async def test_returns_narrative_insights_recommendations(
        self, client, make_account, make_category, make_transaction, mocker
    ):
        acct = await make_account()
        cat, sub = await make_category("Food & Drink", "Restaurants")
        await make_transaction(
            acct.id,
            amount=Decimal("-100.00"),
            subcategory_id=sub.id,
            txn_date=date(2026, 1, 10),
        )
        mocker.patch(
            "budget.main.report_summarizer.summarize",
            return_value=self.FAKE_SUMMARY,
        )
        r = await client.get("/category-trends/summary")
        assert r.status_code == 200
        data = r.json()
        assert data["narrative"] == "Your spending trends show steady growth."
        assert data["insights"] == ["Food & Drink is the top category."]
        assert data["recommendations"] == [
            "Track grocery vs restaurant spending separately."
        ]

    async def test_cached_on_second_call(
        self, client, make_account, make_category, make_transaction, mocker
    ):
        acct = await make_account()
        cat, sub = await make_category("Transport", "Gas")
        await make_transaction(
            acct.id,
            amount=Decimal("-50.00"),
            subcategory_id=sub.id,
            txn_date=date(2026, 1, 5),
        )
        mock_summarize = mocker.patch(
            "budget.main.report_summarizer.summarize",
            return_value=self.FAKE_SUMMARY,
        )
        await client.get("/category-trends/summary")
        await client.get("/category-trends/summary")
        assert mock_summarize.call_count == 1

    async def test_force_bypasses_cache(
        self, client, make_account, make_category, make_transaction, mocker
    ):
        acct = await make_account()
        cat, sub = await make_category("Entertainment", "Streaming")
        await make_transaction(
            acct.id,
            amount=Decimal("-20.00"),
            subcategory_id=sub.id,
            txn_date=date(2026, 2, 1),
        )
        mock_summarize = mocker.patch(
            "budget.main.report_summarizer.summarize",
            return_value=self.FAKE_SUMMARY,
        )
        await client.get("/category-trends/summary")
        await client.get("/category-trends/summary", params={"force": "true"})
        assert mock_summarize.call_count == 2


# ---------------------------------------------------------------------------
# GET /transactions/duplicates
# ---------------------------------------------------------------------------


class TestDuplicatesEndpoint:
    async def test_empty_when_no_duplicates(
        self, client, make_account, make_transaction
    ):
        acct = await make_account()
        await make_transaction(
            acct.id, amount=Decimal("-10.00"), txn_date=date(2024, 1, 1)
        )
        r = await client.get("/transactions/duplicates")
        assert r.status_code == 200
        assert r.json()["groups"] == []

    async def test_returns_group_for_duplicates(
        self, client, make_account, make_transaction
    ):
        acct = await make_account()
        t1 = await make_transaction(
            acct.id,
            amount=Decimal("-4.50"),
            txn_date=date(2024, 3, 10),
            description="Coffee",
            raw_description="COFFEE",
        )
        t2 = await make_transaction(
            acct.id,
            amount=Decimal("-4.50"),
            txn_date=date(2024, 3, 10),
            description="Coffee 2",
            raw_description="COFFEE",
        )
        r = await client.get("/transactions/duplicates")
        assert r.status_code == 200
        groups = r.json()["groups"]
        assert len(groups) == 1
        ids_in_group = {tx["id"] for tx in groups[0]}
        assert ids_in_group == {t1.id, t2.id}

    async def test_different_raw_descriptions_not_grouped(
        self, client, make_account, make_transaction
    ):
        acct = await make_account()
        await make_transaction(
            acct.id,
            amount=Decimal("-4.50"),
            txn_date=date(2024, 3, 10),
            raw_description="COFFEE SHOP",
        )
        await make_transaction(
            acct.id,
            amount=Decimal("-4.50"),
            txn_date=date(2024, 3, 10),
            raw_description="AMAZON.COM",
        )
        r = await client.get("/transactions/duplicates")
        assert r.status_code == 200
        assert r.json()["groups"] == []

    async def test_excluded_not_in_groups(
        self, client, make_account, make_transaction, db_session
    ):
        acct = await make_account()
        t1 = await make_transaction(
            acct.id, amount=Decimal("-4.50"), txn_date=date(2024, 3, 10)
        )
        t2 = await make_transaction(
            acct.id, amount=Decimal("-4.50"), txn_date=date(2024, 3, 10)
        )
        # Exclude t2
        r = await client.patch(
            f"/transactions/{t2.id}",
            json={
                "description": "Coffee",
                "merchant_name": None,
                "category": None,
                "subcategory": None,
                "notes": None,
                "is_excluded": True,
            },
        )
        assert r.status_code == 200
        # Now duplicates endpoint should return no groups (only 1 non-excluded tx)
        _ = t1  # suppress unused warning
        r = await client.get("/transactions/duplicates")
        assert r.status_code == 200
        assert r.json()["groups"] == []

    async def test_different_amounts_not_grouped(
        self, client, make_account, make_transaction
    ):
        acct = await make_account()
        await make_transaction(
            acct.id, amount=Decimal("-4.50"), txn_date=date(2024, 3, 10)
        )
        await make_transaction(
            acct.id, amount=Decimal("-5.00"), txn_date=date(2024, 3, 10)
        )
        r = await client.get("/transactions/duplicates")
        assert r.status_code == 200
        assert r.json()["groups"] == []


# ---------------------------------------------------------------------------
# is_excluded field and analytics filtering
# ---------------------------------------------------------------------------


class TestIsExcluded:
    async def test_patch_sets_is_excluded(self, client, make_account, make_transaction):
        acct = await make_account()
        tx = await make_transaction(acct.id, amount=Decimal("-10.00"))
        r = await client.patch(
            f"/transactions/{tx.id}",
            json={
                "description": "Test",
                "merchant_name": None,
                "category": None,
                "subcategory": None,
                "notes": None,
                "is_excluded": True,
            },
        )
        assert r.status_code == 200
        assert r.json()["is_excluded"] is True

    async def test_patch_unsets_is_excluded(
        self, client, make_account, make_transaction
    ):
        acct = await make_account()
        tx = await make_transaction(acct.id, amount=Decimal("-10.00"))
        # Exclude then un-exclude
        await client.patch(
            f"/transactions/{tx.id}",
            json={
                "description": "Test",
                "merchant_name": None,
                "category": None,
                "subcategory": None,
                "notes": None,
                "is_excluded": True,
            },
        )
        r = await client.patch(
            f"/transactions/{tx.id}",
            json={
                "description": "Test",
                "merchant_name": None,
                "category": None,
                "subcategory": None,
                "notes": None,
                "is_excluded": False,
            },
        )
        assert r.status_code == 200
        assert r.json()["is_excluded"] is False

    async def test_excluded_absent_from_monthly_stats(
        self, client, make_account, make_category, make_transaction
    ):
        acct = await make_account()
        cat, sub = await make_category("Food", "Groceries")
        # Normal transaction: -50
        await make_transaction(
            acct.id,
            amount=Decimal("-50.00"),
            txn_date=date(2024, 1, 15),
            subcategory_id=sub.id,
        )
        # Excluded transaction: -20 (should not appear in stats)
        tx2 = await make_transaction(
            acct.id,
            amount=Decimal("-20.00"),
            txn_date=date(2024, 1, 15),
            subcategory_id=sub.id,
        )
        await client.patch(
            f"/transactions/{tx2.id}",
            json={
                "description": "Test",
                "merchant_name": None,
                "category": None,
                "subcategory": None,
                "notes": None,
                "is_excluded": True,
            },
        )
        r = await client.get("/monthly/2024-01")
        assert r.status_code == 200
        data = r.json()
        assert Decimal(data["summary"]["expenses"]) == Decimal("-50.00")

    async def test_excluded_absent_from_overview(
        self, client, make_account, make_transaction
    ):
        acct = await make_account()
        await make_transaction(
            acct.id, amount=Decimal("-30.00"), txn_date=date(2024, 1, 15)
        )
        tx2 = await make_transaction(
            acct.id, amount=Decimal("-10.00"), txn_date=date(2024, 1, 15)
        )
        await client.patch(
            f"/transactions/{tx2.id}",
            json={
                "description": "Test",
                "merchant_name": None,
                "category": None,
                "subcategory": None,
                "notes": None,
                "is_excluded": True,
            },
        )
        r = await client.get("/overview")
        assert r.status_code == 200
        data = r.json()
        assert Decimal(data["expenses"]) == Decimal("-30.00")


# ---------------------------------------------------------------------------
# Transfer linking via PATCH and POST /transfers/rematch
# ---------------------------------------------------------------------------


class TestTransferLinking:
    async def test_patch_sets_linked_transaction_id_bidirectionally(
        self, client, make_account, make_transaction
    ):
        acct1 = await make_account("Checking")
        acct2 = await make_account("Savings")
        tx1 = await make_transaction(acct1.id, amount=Decimal("-500.00"))
        tx2 = await make_transaction(acct2.id, amount=Decimal("500.00"))

        r = await client.patch(
            f"/transactions/{tx1.id}",
            json={
                "description": tx1.description,
                "merchant_name": None,
                "category": None,
                "subcategory": None,
                "notes": None,
                "linked_transaction_id": tx2.id,
            },
        )
        assert r.status_code == 200
        data = r.json()
        assert data["linked_transaction_id"] == tx2.id

        # Check the counterpart was also updated
        r2 = await client.get(f"/transactions?account={acct2.name}")
        items = r2.json()["items"]
        tx2_data = next(t for t in items if t["id"] == tx2.id)
        assert tx2_data["linked_transaction_id"] == tx1.id

    async def test_patch_clear_linked_transaction_clears_both_sides(
        self, client, make_account, make_transaction
    ):
        acct1 = await make_account("Checking")
        acct2 = await make_account("Savings")
        tx1 = await make_transaction(acct1.id, amount=Decimal("-300.00"))
        tx2 = await make_transaction(acct2.id, amount=Decimal("300.00"))

        # Link them first
        await client.patch(
            f"/transactions/{tx1.id}",
            json={
                "description": tx1.description,
                "merchant_name": None,
                "category": None,
                "subcategory": None,
                "notes": None,
                "linked_transaction_id": tx2.id,
            },
        )

        # Now unlink
        r = await client.patch(
            f"/transactions/{tx1.id}",
            json={
                "description": tx1.description,
                "merchant_name": None,
                "category": None,
                "subcategory": None,
                "notes": None,
                "clear_linked_transaction": True,
            },
        )
        assert r.status_code == 200
        assert r.json()["linked_transaction_id"] is None

        # Counterpart should also be cleared
        r2 = await client.get(f"/transactions?account={acct2.name}")
        items = r2.json()["items"]
        tx2_data = next(t for t in items if t["id"] == tx2.id)
        assert tx2_data["linked_transaction_id"] is None

    async def test_rematch_endpoint_returns_pair_count(
        self, client, make_account, make_transaction
    ):
        acct1 = await make_account("Checking")
        acct2 = await make_account("Savings")
        await make_transaction(
            acct1.id,
            amount=Decimal("-100.00"),
            txn_date=date(2024, 5, 1),
            payment_channel="transfer",
        )
        await make_transaction(
            acct2.id,
            amount=Decimal("100.00"),
            txn_date=date(2024, 5, 2),
            payment_channel="transfer",
        )
        r = await client.post("/transfers/rematch")
        assert r.status_code == 200
        data = r.json()
        assert data["pairs_linked"] == 1


# ---------------------------------------------------------------------------
# Mixed categories
# ---------------------------------------------------------------------------


class TestMixedCategoryMerchants:
    async def test_mixed_merchant_appears(
        self, client, make_account, make_merchant, make_category, make_transaction
    ):
        acct = await make_account()
        merchant = await make_merchant("Amazon")
        _, sub1 = await make_category("Shopping", "Electronics")
        _, sub2 = await make_category("Groceries", "Food")
        await make_transaction(
            acct.id,
            merchant_id=merchant.id,
            subcategory_id=sub1.id,
            amount=Decimal("-50.00"),
            txn_date=date(2024, 1, 1),
        )
        await make_transaction(
            acct.id,
            merchant_id=merchant.id,
            subcategory_id=sub2.id,
            amount=Decimal("-30.00"),
            txn_date=date(2024, 1, 2),
        )
        r = await client.get("/merchants/mixed-categories")
        assert r.status_code == 200
        groups = r.json()["groups"]
        assert len(groups) == 1
        assert groups[0]["merchant_name"] == "Amazon"
        assert sorted(groups[0]["categories"]) == ["Groceries", "Shopping"]
        assert len(groups[0]["transactions"]) == 2

    async def test_single_category_merchant_excluded(
        self, client, make_account, make_merchant, make_category, make_transaction
    ):
        acct = await make_account()
        merchant = await make_merchant("Starbucks")
        _, sub = await make_category("Food & Drink", "Coffee")
        await make_transaction(
            acct.id,
            merchant_id=merchant.id,
            subcategory_id=sub.id,
            amount=Decimal("-5.00"),
            txn_date=date(2024, 1, 1),
        )
        await make_transaction(
            acct.id,
            merchant_id=merchant.id,
            subcategory_id=sub.id,
            amount=Decimal("-5.50"),
            txn_date=date(2024, 1, 2),
        )
        r = await client.get("/merchants/mixed-categories")
        assert r.status_code == 200
        assert r.json()["groups"] == []

    async def test_excluded_transactions_ignored(
        self,
        client,
        make_account,
        make_merchant,
        make_category,
        make_transaction,
        db_session,
    ):
        from budget.models import Transaction as Txn

        acct = await make_account()
        merchant = await make_merchant("BigStore")
        _, sub1 = await make_category("Shopping", "General")
        _, sub2 = await make_category("Groceries", "Food")
        t1 = await make_transaction(
            acct.id,
            merchant_id=merchant.id,
            subcategory_id=sub1.id,
            amount=Decimal("-20.00"),
            txn_date=date(2024, 1, 1),
        )
        await make_transaction(
            acct.id,
            merchant_id=merchant.id,
            subcategory_id=sub2.id,
            amount=Decimal("-20.00"),
            txn_date=date(2024, 1, 2),
        )
        # Exclude the second transaction so merchant only has one active category
        await db_session.execute(
            __import__("sqlalchemy")
            .update(Txn)
            .where(Txn.merchant_id == merchant.id, Txn.subcategory_id == sub2.id)
            .values(is_excluded=True)
        )
        await db_session.commit()

        r = await client.get("/merchants/mixed-categories")
        assert r.status_code == 200
        # Only t1 (Shopping) remains active — not mixed
        groups = r.json()["groups"]
        assert not any(g["merchant_id"] == t1.merchant_id for g in groups)

    async def test_response_shape(
        self, client, make_account, make_merchant, make_category, make_transaction
    ):
        acct = await make_account()
        merchant = await make_merchant("TestShop")
        _, sub1 = await make_category("CatA", "SubA")
        _, sub2 = await make_category("CatB", "SubB")
        await make_transaction(
            acct.id,
            merchant_id=merchant.id,
            subcategory_id=sub1.id,
            txn_date=date(2024, 2, 1),
        )
        await make_transaction(
            acct.id,
            merchant_id=merchant.id,
            subcategory_id=sub2.id,
            txn_date=date(2024, 2, 2),
        )
        r = await client.get("/merchants/mixed-categories")
        assert r.status_code == 200
        group = r.json()["groups"][0]
        assert "merchant_id" in group
        assert "merchant_name" in group
        assert isinstance(group["categories"], list)
        assert group["categories"] == sorted(group["categories"])
        tx = group["transactions"][0]
        for field in (
            "id",
            "date",
            "description",
            "amount",
            "category",
            "subcategory",
            "account",
        ):
            assert field in tx
