"""
InsuriMax database reset.

DESTRUCTIVE: wipes every application table (claims, documents, policies, adjudications,
queries, users, organizations, ...) and re-creates only the demo organizations and users.
The schema and the alembic_version table are left untouched.

Usage (from Backend/):
    python reset_db.py --yes

Demo logins (password: Password@123):
    adjuster@insurimax.com          Adjuster          MediAssist TPA Services
    senior.adjuster@insurimax.com   Senior Adjuster   MediAssist TPA Services
    admin@insurimax.com             Admin             MediAssist TPA Services
    hospital@insurimax.com          Hospital Desk     Apollo Hospital, Bannerghatta

Uploaded files in GCS / storage_local are NOT deleted.
"""
import argparse
import asyncio
import uuid

from sqlalchemy import text

import app.db.base_all  # noqa: F401  registers every model on Base.metadata
from app.core.security import hash_password
from app.db.base import Base
from app.db.session import AsyncSessionLocal, engine
from app.models.user import Organization, OrgType, User, UserRole

DEMO_PASSWORD = "Password@123"

# Same fixed IDs as seed_db.py so the two scripts stay compatible.
DEMO_ORGS = [
    (uuid.UUID("11111111-1111-1111-1111-111111111111"), "MediAssist TPA Services", OrgType.TPA),
    (uuid.UUID("22222222-2222-2222-2222-222222222222"), "Apollo Hospital, Bannerghatta", OrgType.HOSPITAL),
    (uuid.UUID("33333333-3333-3333-3333-333333333333"), "ICICI Lombard Insurance", OrgType.INSURER),
]

DEMO_USERS = [
    ("adjuster@insurimax.com", "Priya Sharma", UserRole.ADJUSTER, DEMO_ORGS[2][0]),
    ("senior.adjuster@insurimax.com", "Rajesh Patel (Lead Adjuster)", UserRole.SENIOR_ADJUSTER, DEMO_ORGS[2][0]),
    ("admin@insurimax.com", "Vikram Seth (Operations Admin)", UserRole.ADMIN, DEMO_ORGS[0][0]),
    ("hospital@insurimax.com", "Sunita Rao (Apollo Billing)", UserRole.HOSPITAL_DESK, DEMO_ORGS[1][0]),
]


async def wipe_all_tables() -> list[str]:
    tables = [t.name for t in Base.metadata.sorted_tables if t.name != "alembic_version"]
    quoted = ", ".join(f'"{name}"' for name in tables)
    async with engine.begin() as conn:
        await conn.execute(text(f"TRUNCATE TABLE {quoted} RESTART IDENTITY CASCADE"))
    return tables


async def seed_demo_users() -> None:
    async with AsyncSessionLocal() as db:
        for org_id, name, org_type in DEMO_ORGS:
            db.add(Organization(id=org_id, name=name, org_type=org_type))
        await db.flush()

        hashed = hash_password(DEMO_PASSWORD)
        for email, full_name, role, org_id in DEMO_USERS:
            db.add(
                User(
                    id=uuid.uuid4(),
                    email=email,
                    full_name=full_name,
                    role=role,
                    org_id=org_id,
                    hashed_password=hashed,
                    is_active=True,
                    is_verified=True,
                )
            )
        await db.commit()


async def main() -> None:
    tables = await wipe_all_tables()
    print(f"[INFO] Truncated {len(tables)} tables: {', '.join(tables)}")
    await seed_demo_users()
    print(f"[SUCCESS] Seeded {len(DEMO_ORGS)} organizations and {len(DEMO_USERS)} demo users "
          f"(password: {DEMO_PASSWORD}).")
    await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Wipe all InsuriMax data and seed demo users only.")
    parser.add_argument("--yes", action="store_true", help="confirm that ALL data should be deleted")
    args = parser.parse_args()
    if not args.yes:
        parser.error("this deletes ALL data in the configured database; re-run with --yes to confirm")
    asyncio.run(main())
