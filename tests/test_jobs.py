"""Tests for RQ job entry points in budget/jobs.py."""

from unittest.mock import AsyncMock

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from budget.database import Base
from budget.jobs import run_enrichment_job, run_reenrichment_job
from budget.models import Account, CsvImport, Transaction


class TestRunEnrichmentJob:
    async def _setup_db(self):
        eng = create_async_engine(
            "sqlite+aiosqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        async with eng.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        return eng

    def test_run_enrichment_job_calls_async(self, mocker):
        mock = mocker.patch("budget.jobs._run_enrichment", new=AsyncMock())
        run_enrichment_job(
            enrich_input=[
                {
                    "index": 0,
                    "description": "Coffee",
                    "amount": "-5.00",
                    "date": "2024-01-15",
                }
            ],
            rows=[{"Date": "2024-01-15", "Amount": "-5.00", "Description": "Coffee"}],
            date_col="Date",
            amount_col="Amount",
            desc_col="Description",
            account_id=1,
            csv_import_id=1,
            account_type=None,
            user_id=1,
        )
        mock.assert_awaited_once()
        call_kwargs = mock.call_args
        assert call_kwargs.kwargs["csv_import_id"] == 1
        assert call_kwargs.kwargs["user_id"] == 1

    def test_run_enrichment_job_end_to_end(self, mocker):
        import asyncio

        eng = asyncio.run(self._setup_db())
        factory = async_sessionmaker(
            bind=eng, class_=AsyncSession, expire_on_commit=False
        )

        async def _seed():
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
                return acct.id, ci.id

        account_id, ci_id = asyncio.run(_seed())

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

        run_enrichment_job(
            enrich_input=[
                {
                    "index": 0,
                    "description": "STARBUCKS",
                    "amount": "-5.00",
                    "date": "2024-01-15",
                }
            ],
            rows=[
                {"Date": "2024-01-15", "Amount": "-5.00", "Description": "STARBUCKS"}
            ],
            date_col="Date",
            amount_col="Amount",
            desc_col="Description",
            account_id=account_id,
            csv_import_id=ci_id,
            account_type=None,
            user_id=1,
        )

        async def _verify():
            async with factory() as session:
                result = await session.execute(
                    select(Transaction).where(Transaction.account_id == account_id)
                )
                return result.scalars().all()

        txs = asyncio.run(_verify())
        assert len(txs) == 1
        assert txs[0].description == "Starbucks Coffee"

        asyncio.run(eng.dispose())


class TestRunReenrichmentJob:
    def test_run_reenrichment_job_calls_async(self, mocker):
        mock = mocker.patch("budget.jobs._run_reenrichment_for_import", new=AsyncMock())
        run_reenrichment_job(csv_import_id=5, user_id=2)
        mock.assert_awaited_once_with(5, 2)
