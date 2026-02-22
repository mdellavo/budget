from datetime import date
from decimal import Decimal

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from budget.database import Base, get_db
from budget.main import app
from budget.models import Account, Category, Merchant, Subcategory, Transaction


@pytest_asyncio.fixture
async def engine():
    eng = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield eng
    await eng.dispose()


@pytest_asyncio.fixture
async def db_session(engine):
    factory = async_sessionmaker(
        bind=engine, class_=AsyncSession, expire_on_commit=False
    )
    async with factory() as session:
        yield session


@pytest_asyncio.fixture
async def client(db_session):
    async def _override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Data helper fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def make_account(db_session):
    async def _make(name="Checking", institution=None, account_type=None):
        acct = Account(name=name, institution=institution, account_type=account_type)
        db_session.add(acct)
        await db_session.flush()
        await db_session.commit()
        return acct

    return _make


@pytest_asyncio.fixture
async def make_merchant(db_session):
    async def _make(name="Test Merchant", location=None):
        m = Merchant(name=name, location=location)
        db_session.add(m)
        await db_session.flush()
        await db_session.commit()
        return m

    return _make


@pytest_asyncio.fixture
async def make_category(db_session):
    async def _make(cat_name="Food & Drink", sub_name="Restaurants"):
        cat = Category(name=cat_name)
        db_session.add(cat)
        await db_session.flush()
        sub = Subcategory(category_id=cat.id, name=sub_name)
        db_session.add(sub)
        await db_session.flush()
        await db_session.commit()
        return cat, sub

    return _make


@pytest_asyncio.fixture
async def make_transaction(db_session):
    async def _make(
        account_id,
        amount=Decimal("-10.00"),
        description="Test transaction",
        txn_date=None,
        merchant_id=None,
        subcategory_id=None,
        is_recurring=False,
        csv_import_id=None,
        raw_description=None,
    ):
        if txn_date is None:
            txn_date = date(2024, 1, 15)
        tx = Transaction(
            account_id=account_id,
            date=txn_date,
            description=description,
            raw_description=raw_description,
            amount=amount,
            merchant_id=merchant_id,
            subcategory_id=subcategory_id,
            is_recurring=is_recurring,
            csv_import_id=csv_import_id,
        )
        db_session.add(tx)
        await db_session.flush()
        await db_session.commit()
        return tx

    return _make
