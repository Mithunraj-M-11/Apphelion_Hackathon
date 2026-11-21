"""trip flow: permits, passes, holds, alerts, server keys; trip columns on movements

Revision ID: e7a1c2d3f4b5
Revises: db35411cd868
Create Date: 2026-11-21 10:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "e7a1c2d3f4b5"
down_revision: Union[str, None] = "db35411cd868"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "permits",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("contract_id", sa.Integer(), sa.ForeignKey("contracts.id"), nullable=False),
        sa.Column("label", sa.String(200), nullable=False),
        sa.Column("valid_from", sa.Date(), nullable=False),
        sa.Column("valid_to", sa.Date(), nullable=False),
        sa.Column("trip_limit", sa.Integer(), nullable=False),
        sa.Column("tonne_limit", sa.Float(), nullable=False),
        sa.Column("vehicle_limit", sa.Integer(), nullable=False),
        sa.Column("hours_start", sa.Time(), nullable=False),
        sa.Column("hours_end", sa.Time(), nullable=False),
        sa.Column("exit_grace_min", sa.Integer(), nullable=False),
        sa.Column("pass_expiry_min", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_permits_source", "permits", ["source"])

    op.add_column("movements", sa.Column("permit_id", sa.Integer(), sa.ForeignKey("permits.id"), nullable=True))
    op.create_index("ix_movements_permit_id", "movements", ["permit_id"])
    op.add_column("movements", sa.Column("weight_t", sa.Float(), nullable=True))
    op.add_column("movements", sa.Column("pass_id", sa.Integer(), nullable=True))
    op.add_column("movements", sa.Column("decision", sa.String(10), nullable=True))
    op.add_column("movements", sa.Column("barrier", sa.String(5), nullable=True))
    op.add_column("movements", sa.Column("barrier_forced", sa.Boolean(), server_default=sa.false(), nullable=False))
    op.add_column("movements", sa.Column("counted_trip", sa.Boolean(), server_default=sa.false(), nullable=False))
    op.add_column("movements", sa.Column("trip", sa.String(10), nullable=True))
    op.add_column("movements", sa.Column("steps", postgresql.JSONB(astext_type=sa.Text()), nullable=True))

    op.create_table(
        "passes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(20), nullable=False, unique=True),
        sa.Column("permit_id", sa.Integer(), sa.ForeignKey("permits.id"), nullable=False),
        sa.Column("truck_id", sa.Integer(), sa.ForeignKey("trucks.id"), nullable=False),
        sa.Column("entry_movement_id", sa.Integer(), sa.ForeignKey("movements.id"), nullable=False),
        sa.Column("exit_movement_id", sa.Integer(), sa.ForeignKey("movements.id"), nullable=True),
        sa.Column("entry_gate", sa.String(20), nullable=False),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("entry_weight_t", sa.Float(), nullable=False),
        sa.Column("entry_weight_measured", sa.Boolean(), nullable=False),
        sa.Column("exit_weight_t", sa.Float(), nullable=True),
        sa.Column("net_t", sa.Float(), nullable=True),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column("close_mode", sa.String(10), nullable=True),
        sa.Column("token", sa.Text(), nullable=False),
        sa.Column("sms_code", sa.String(8), nullable=False),
        sa.Column("flags", postgresql.ARRAY(sa.String(40)), nullable=False),
        sa.Column("source", sa.String(100), nullable=True),
    )
    op.create_index("ix_passes_permit_id", "passes", ["permit_id"])
    op.create_index("ix_passes_truck_id", "passes", ["truck_id"])
    op.create_index("ix_passes_sms_code", "passes", ["sms_code"])
    op.create_foreign_key("fk_movements_pass_id", "movements", "passes", ["pass_id"], ["id"])

    op.create_table(
        "truck_holds",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("permit_id", sa.Integer(), sa.ForeignKey("permits.id"), nullable=False),
        sa.Column("truck_id", sa.Integer(), sa.ForeignKey("trucks.id"), nullable=False),
        sa.Column("reason_code", sa.String(40), nullable=False),
        sa.Column("movement_id", sa.Integer(), sa.ForeignKey("movements.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("released_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("released_by", sa.Integer(), sa.ForeignKey("officers.id"), nullable=True),
        sa.Column("release_reason", sa.Text(), nullable=True),
    )
    op.create_index("ix_truck_holds_permit_id", "truck_holds", ["permit_id"])
    op.create_index("ix_truck_holds_truck_id", "truck_holds", ["truck_id"])

    op.create_table(
        "alerts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("permit_id", sa.Integer(), sa.ForeignKey("permits.id"), nullable=False),
        sa.Column("movement_id", sa.Integer(), sa.ForeignKey("movements.id"), nullable=True),
        sa.Column("pass_id", sa.Integer(), sa.ForeignKey("passes.id"), nullable=True),
        sa.Column("truck_id", sa.Integer(), sa.ForeignKey("trucks.id"), nullable=True),
        sa.Column("code", sa.String(40), nullable=False),
        sa.Column("severity", sa.String(10), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("status", sa.String(15), nullable=False),
        sa.Column("source", sa.String(100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_alerts_permit_id", "alerts", ["permit_id"])
    op.create_index("ix_alerts_movement_id", "alerts", ["movement_id"])
    op.create_index("ix_alerts_code", "alerts", ["code"])
    op.create_index("ix_alerts_source", "alerts", ["source"])

    op.create_table(
        "server_keys",
        sa.Column("name", sa.String(50), primary_key=True),
        sa.Column("value", sa.Text(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("server_keys")
    op.drop_table("alerts")
    op.drop_table("truck_holds")
    op.drop_constraint("fk_movements_pass_id", "movements", type_="foreignkey")
    op.drop_table("passes")
    for col in ("steps", "trip", "counted_trip", "barrier_forced", "barrier", "decision", "pass_id", "weight_t"):
        op.drop_column("movements", col)
    op.drop_index("ix_movements_permit_id", table_name="movements")
    op.drop_column("movements", "permit_id")
    op.drop_table("permits")
