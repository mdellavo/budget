#!/usr/bin/env python
"""Create a user in the database.

Usage:
    python scripts/seed_user.py --email user@example.com --name "Jane" --password "secret"
"""
import argparse
import asyncio
import sys
from pathlib import Path

# Allow importing budget package from the project root
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select  # noqa: E402

from budget.auth import hash_password  # noqa: E402
from budget.database import AsyncSessionLocal  # noqa: E402
from budget.models import User  # noqa: E402


async def main() -> None:
    parser = argparse.ArgumentParser(description="Create a budget app user")
    parser.add_argument("--email", required=True, help="User email address")
    parser.add_argument("--name", required=True, help="Display name")
    parser.add_argument("--password", required=True, help="Plain-text password")
    args = parser.parse_args()

    async with AsyncSessionLocal() as db:
        existing = (
            await db.execute(select(User).where(User.email == args.email))
        ).scalar_one_or_none()
        if existing:
            print(f"User with email '{args.email}' already exists (id={existing.id})")
            return

        user = User(
            email=args.email,
            name=args.name,
            password_hash=hash_password(args.password),
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        print(f"Created user: id={user.id} email='{user.email}' name='{user.name}'")


if __name__ == "__main__":
    asyncio.run(main())
