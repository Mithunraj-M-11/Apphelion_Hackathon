"""trucks.axle_spacings_m (backfilled per model) and wim_measurements.axle_spacings_m: axle layout for the WIM
body check

Revision ID: 7c2e9a4b1f60
Revises: 31a7c5e89d12
Create Date: 2026-11-23 18:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "7c2e9a4b1f60"
down_revision: Union[str, None] = "31a7c5e89d12"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# same values as app.seed.AXLE_SPACINGS, keyed by the model name stored on the truck
BY_MODEL = {
    "Signa 2823.K": [3.90, 1.37],
    "2820 Tipper": [3.80, 1.35],
    "2823C": [4.00, 1.40],
    "Pro 6028T": [3.85, 1.32],
    "Signa 3523.K": [1.95, 3.30, 1.37],
    "3520 Tipper": [1.90, 3.40, 1.35],
}


def upgrade() -> None:
    op.add_column("trucks", sa.Column("axle_spacings_m", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column("wim_measurements",
                  sa.Column("axle_spacings_m", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    trucks = sa.table("trucks", sa.column("model", sa.String), sa.column("axle_spacings_m", postgresql.JSONB))
    for model, spacings in BY_MODEL.items():
        op.execute(trucks.update().where(trucks.c.model == model).values(axle_spacings_m=spacings))


def downgrade() -> None:
    op.drop_column("wim_measurements", "axle_spacings_m")
    op.drop_column("trucks", "axle_spacings_m")
