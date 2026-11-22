"""unify trip pipeline: merge the RFID/trip-session branch with the permit/pass branch

Trip sessions become the single pass record (with weights, SMS code, permit); our separate `passes` table is
dropped. Per-vehicle quotas are scoped to a permit. Joins the two migration heads.

Revision ID: a9c4e7f2b1d3
Revises: 595bb5447866, f3b8d9e0a1c2
Create Date: 2026-11-22 12:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "a9c4e7f2b1d3"
down_revision: Union[str, Sequence[str], None] = ("595bb5447866", "f3b8d9e0a1c2")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Links that pointed at the old `passes` table now point at trip sessions (old links are cleared).
    op.drop_constraint("fk_movements_pass_id", "movements", type_="foreignkey")
    op.drop_constraint("alerts_pass_id_fkey", "alerts", type_="foreignkey")
    op.execute("UPDATE movements SET pass_id = NULL")
    op.execute("UPDATE alerts SET pass_id = NULL")
    op.drop_table("passes")

    # Trip session = the pass: measurement, permit and close details
    op.add_column("trip_sessions", sa.Column("permit_id", sa.Integer(), sa.ForeignKey("permits.id"), nullable=True))
    op.create_index("ix_trip_sessions_permit_id", "trip_sessions", ["permit_id"])
    op.add_column("trip_sessions", sa.Column("entry_weight_t", sa.Float(), nullable=True))
    op.add_column("trip_sessions", sa.Column("entry_weight_measured", sa.Boolean(), server_default=sa.true(),
                                             nullable=False))
    op.add_column("trip_sessions", sa.Column("exit_weight_t", sa.Float(), nullable=True))
    op.add_column("trip_sessions", sa.Column("net_t", sa.Float(), nullable=True))
    op.add_column("trip_sessions", sa.Column("sms_code", sa.String(8), nullable=True))
    op.create_index("ix_trip_sessions_sms_code", "trip_sessions", ["sms_code"])
    op.add_column("trip_sessions", sa.Column("close_mode", sa.String(10), nullable=True))
    op.add_column("trip_sessions", sa.Column("flags", postgresql.ARRAY(sa.String(40)), server_default="{}",
                                             nullable=False))
    op.add_column("trip_sessions", sa.Column("source", sa.String(100), nullable=True))
    op.create_index("ix_trip_sessions_source", "trip_sessions", ["source"])

    op.create_foreign_key("fk_movements_pass_id", "movements", "trip_sessions", ["pass_id"], ["id"])
    op.create_foreign_key("alerts_pass_id_fkey", "alerts", "trip_sessions", ["pass_id"], ["id"])
    op.alter_column("alerts", "permit_id", existing_type=sa.Integer(), nullable=True)

    op.add_column("movements", sa.Column("rfid_sticker_uid", sa.String(50), nullable=True))

    # Per-vehicle allocation belongs to a permit (only when the contract caps trips per truck)
    op.add_column("permits", sa.Column("per_vehicle_trips", sa.Integer(), nullable=True))
    op.add_column("vehicle_quotas", sa.Column("permit_id", sa.Integer(), sa.ForeignKey("permits.id"), nullable=True))
    op.create_index("ix_vehicle_quotas_permit_id", "vehicle_quotas", ["permit_id"])
    op.drop_index("ix_vehicle_quotas_truck_id", table_name="vehicle_quotas")
    op.create_index("ix_vehicle_quotas_truck_id", "vehicle_quotas", ["truck_id"], unique=False)
    op.create_unique_constraint("uq_vehicle_quotas_permit_truck", "vehicle_quotas", ["permit_id", "truck_id"])


def downgrade() -> None:
    raise NotImplementedError("Unifying the two trip pipelines is one-way; reset the database instead.")
