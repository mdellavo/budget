from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    ForeignKey,
    Numeric,
    String,
    Table,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base

transaction_tags = Table(
    "transaction_tags",
    Base.metadata,
    Column("transaction_id", ForeignKey("transactions.id"), primary_key=True),
    Column("tag_id", ForeignKey("tags.id"), primary_key=True),
)


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), unique=True)
    institution: Mapped[str | None] = mapped_column(String(200))
    account_type: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)

    csv_imports: Mapped[list["CsvImport"]] = relationship(back_populates="account")
    transactions: Mapped[list["Transaction"]] = relationship(back_populates="account")


class CsvImport(Base):
    __tablename__ = "csv_imports"

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"))
    filename: Mapped[str] = mapped_column(String(500))
    imported_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    row_count: Mapped[int]
    enriched_rows: Mapped[int] = mapped_column(default=0, server_default="0")
    status: Mapped[str] = mapped_column(
        String(20), default="in-progress", server_default="'in-progress'"
    )
    column_mapping: Mapped[str | None] = mapped_column(String(1000))

    account: Mapped[Account] = relationship(back_populates="csv_imports")
    transactions: Mapped[list["Transaction"]] = relationship(
        back_populates="csv_import"
    )


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), unique=True)

    subcategories: Mapped[list["Subcategory"]] = relationship(back_populates="category")


class Subcategory(Base):
    __tablename__ = "subcategories"

    id: Mapped[int] = mapped_column(primary_key=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id"))
    name: Mapped[str] = mapped_column(String(200))

    __table_args__ = (UniqueConstraint("category_id", "name"),)

    category: Mapped[Category] = relationship(back_populates="subcategories")
    transactions: Mapped[list["Transaction"]] = relationship(
        back_populates="subcategory"
    )


class Merchant(Base):
    __tablename__ = "merchants"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), unique=True)
    location: Mapped[str | None] = mapped_column(String(200))

    transactions: Mapped[list["Transaction"]] = relationship(back_populates="merchant")


class Tag(Base):
    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), unique=True)

    transactions: Mapped[list["Transaction"]] = relationship(
        secondary=transaction_tags, back_populates="tags"
    )


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"))
    csv_import_id: Mapped[int | None] = mapped_column(ForeignKey("csv_imports.id"))
    date: Mapped[date] = mapped_column(Date)
    description: Mapped[str] = mapped_column(String(500))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    merchant_id: Mapped[int | None] = mapped_column(ForeignKey("merchants.id"))
    subcategory_id: Mapped[int | None] = mapped_column(ForeignKey("subcategories.id"))
    notes: Mapped[str | None] = mapped_column(String(1000))
    is_recurring: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="0"
    )
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)

    account: Mapped[Account] = relationship(back_populates="transactions")
    csv_import: Mapped[CsvImport | None] = relationship(back_populates="transactions")
    merchant: Mapped["Merchant | None"] = relationship(back_populates="transactions")
    subcategory: Mapped[Subcategory | None] = relationship(
        back_populates="transactions"
    )
    tags: Mapped[list[Tag]] = relationship(
        secondary=transaction_tags, back_populates="transactions"
    )
