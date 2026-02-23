"""Tests for FastAPI endpoints in budget/main.py.

All tests use the `client` fixture (httpx AsyncClient with ASGITransport).
AI endpoints use `mocker` to patch module-level singletons.
"""

import io
from datetime import date
from decimal import Decimal
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from budget.database import Base
from budget.main import _classify_gap, _run_enrichment, parse_amount, parse_date
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
            account_id=acct.id,
            filename="january.csv",
            row_count=10,
            enriched_rows=10,
            status="complete",
        )
        ci2 = CsvImport(
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
            return_value=[
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
        mocker.patch("budget.main._run_enrichment", new=AsyncMock())

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
        mocker.patch("budget.main.AsyncSessionLocal", factory)
        mocker.patch(
            "budget.main.enricher._enrich_batch",
            return_value=[
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
        )

        async with factory() as session:
            acct = Account(name="Test Account")
            session.add(acct)
            await session.flush()
            ci = CsvImport(
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
        mocker.patch("budget.main.AsyncSessionLocal", factory)
        mocker.patch(
            "budget.main.enricher._enrich_batch",
            return_value=[
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
        )

        async with factory() as session:
            acct = Account(name="No Desc Account")
            session.add(acct)
            await session.flush()
            ci = CsvImport(
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
            account_id=acct.id,
            filename="z.csv",
            row_count=1,
            enriched_rows=1,
            status="complete",
        )
        db_session.add(ci)
        await db_session.commit()
        mocker.patch("budget.main._run_reenrichment_for_import", new=AsyncMock())
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
            account_id=acct.id,
            filename="retry.csv",
            row_count=5,
            enriched_rows=2,
            status="aborted",
        )
        db_session.add(ci)
        await db_session.commit()
        mocker.patch("budget.main._run_reenrichment_for_import", new=AsyncMock())
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
