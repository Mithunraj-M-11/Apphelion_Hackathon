"""officers: generic names (Admin 1, 2, 3) instead of people's names

Revision ID: 8d3f1b2c4e71
Revises: 7c2e9a4b1f60
Create Date: 2026-11-23 21:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

revision: str = "8d3f1b2c4e71"
down_revision: Union[str, None] = "7c2e9a4b1f60"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

RENAMES = [("Mithunraj", "Admin 1"), ("Adishesh", "Admin 2"), ("Bhuvanesh", "Admin 3")]
# earlier records that name the officer in their text (demo data): (table, column, is JSON)
TEXT_COLUMNS = [("alerts", "message", False), ("event_logs", "message", False), ("trip_sessions", "notes", False),
                ("event_logs", "context", True), ("movements", "steps", True), ("sim_runs", "results", True)]


def upgrade() -> None:
    for old, new in RENAMES:
        op.execute(f"UPDATE officers SET name = '{new}' WHERE name = '{old}'")
        for table, col, is_json in TEXT_COLUMNS:
            value = f"replace({col}::text, '{old}', '{new}')" + ("::jsonb" if is_json else "")
            op.execute(f"UPDATE {table} SET {col} = {value} WHERE {col}::text LIKE '%{old}%'")


def downgrade() -> None:
    for old, new in RENAMES:
        op.execute(f"UPDATE officers SET name = '{old}' WHERE name = '{new}'")
