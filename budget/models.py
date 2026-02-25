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


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(200), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    password_hash: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)

    accounts: Mapped[list["Account"]] = relationship(back_populates="user")
    csv_imports: Mapped[list["CsvImport"]] = relationship(back_populates="user")
    categories: Mapped[list["Category"]] = relationship(back_populates="user")
    merchants: Mapped[list["Merchant"]] = relationship(back_populates="user")
    cardholders: Mapped[list["CardHolder"]] = relationship(back_populates="user")
    tags: Mapped[list["Tag"]] = relationship(back_populates="user")
    transactions: Mapped[list["Transaction"]] = relationship(back_populates="user")


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String(200))
    institution: Mapped[str | None] = mapped_column(String(200))
    account_type: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("user_id", "name"),)

    user: Mapped["User"] = relationship(back_populates="accounts")
    csv_imports: Mapped[list["CsvImport"]] = relationship(back_populates="account")
    transactions: Mapped[list["Transaction"]] = relationship(back_populates="account")


class CsvImport(Base):
    __tablename__ = "csv_imports"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"))
    filename: Mapped[str] = mapped_column(String(500))
    imported_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    row_count: Mapped[int]
    enriched_rows: Mapped[int] = mapped_column(default=0, server_default="0")
    status: Mapped[str] = mapped_column(
        String(20), default="in-progress", server_default="'in-progress'"
    )
    column_mapping: Mapped[str | None] = mapped_column(String(1000))

    user: Mapped["User"] = relationship(back_populates="csv_imports")
    account: Mapped[Account] = relationship(back_populates="csv_imports")
    transactions: Mapped[list["Transaction"]] = relationship(
        back_populates="csv_import"
    )


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String(200))

    __table_args__ = (UniqueConstraint("user_id", "name"),)

    user: Mapped["User"] = relationship(back_populates="categories")
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
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String(200))
    location: Mapped[str | None] = mapped_column(String(200))

    __table_args__ = (UniqueConstraint("user_id", "name"),)

    user: Mapped["User"] = relationship(back_populates="merchants")
    transactions: Mapped[list["Transaction"]] = relationship(back_populates="merchant")


class CardHolder(Base):
    __tablename__ = "cardholders"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    name: Mapped[str | None] = mapped_column(String(200))
    card_number: Mapped[str | None] = mapped_column(String(20))

    __table_args__ = (UniqueConstraint("user_id", "card_number"),)

    user: Mapped["User"] = relationship(back_populates="cardholders")
    transactions: Mapped[list["Transaction"]] = relationship(
        back_populates="cardholder"
    )


class Tag(Base):
    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String(200))

    __table_args__ = (UniqueConstraint("user_id", "name"),)

    user: Mapped["User"] = relationship(back_populates="tags")
    transactions: Mapped[list["Transaction"]] = relationship(
        secondary=transaction_tags, back_populates="tags"
    )


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"))
    csv_import_id: Mapped[int | None] = mapped_column(ForeignKey("csv_imports.id"))
    date: Mapped[date] = mapped_column(Date)
    description: Mapped[str] = mapped_column(String(500))
    raw_description: Mapped[str | None] = mapped_column(String(500))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    merchant_id: Mapped[int | None] = mapped_column(ForeignKey("merchants.id"))
    subcategory_id: Mapped[int | None] = mapped_column(ForeignKey("subcategories.id"))
    cardholder_id: Mapped[int | None] = mapped_column(ForeignKey("cardholders.id"))
    notes: Mapped[str | None] = mapped_column(String(1000))
    is_recurring: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="0"
    )
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)

    user: Mapped["User"] = relationship(back_populates="transactions")
    account: Mapped[Account] = relationship(back_populates="transactions")
    csv_import: Mapped[CsvImport | None] = relationship(back_populates="transactions")
    merchant: Mapped["Merchant | None"] = relationship(back_populates="transactions")
    subcategory: Mapped[Subcategory | None] = relationship(
        back_populates="transactions"
    )
    cardholder: Mapped["CardHolder | None"] = relationship(
        back_populates="transactions"
    )
    tags: Mapped[list[Tag]] = relationship(
        secondary=transaction_tags, back_populates="transactions"
    )
