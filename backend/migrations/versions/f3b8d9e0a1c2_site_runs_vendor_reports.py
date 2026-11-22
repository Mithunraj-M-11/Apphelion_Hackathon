"""site runs and vendor reports

Revision ID: f3b8d9e0a1c2
Revises: e7a1c2d3f4b5
Create Date: 2026-11-21 16:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "f3b8d9e0a1c2"
down_revision: Union[str, None] = "e7a1c2d3f4b5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "site_runs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("scenario", sa.String(100), nullable=False),
        sa.Column("description", sa.String(500), nullable=True),
        sa.Column("seed", sa.Integer(), nullable=False),
        sa.Column("days", sa.Integer(), nullable=False),
        sa.Column("permit_id", sa.Integer(), sa.ForeignKey("permits.id"), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("report", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.create_table(
        "vendor_reports",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("permit_id", sa.Integer(), sa.ForeignKey("permits.id"), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("trips", sa.Integer(), nullable=False),
        sa.Column("tonnes", sa.Float(), nullable=False),
        sa.Column("source", sa.String(100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_vendor_reports_permit_id", "vendor_reports", ["permit_id"])


def downgrade() -> None:
    op.drop_index("ix_vendor_reports_permit_id", table_name="vendor_reports")
    op.drop_table("vendor_reports")
    op.drop_table("site_runs")
