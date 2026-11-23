"""wim tables: wim_devices, wim_measurements, wim_anomalies

Revision ID: 31a7c5e89d12
Revises: 23b97d075501
Create Date: 2026-11-23 14:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '31a7c5e89d12'
down_revision: Union[str, None] = '6eaaf8f50407'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. wim_devices
    op.create_table(
        'wim_devices',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('device_code', sa.String(length=30), nullable=False),
        sa.Column('gate', sa.String(length=20), nullable=False),
        sa.Column('lane', sa.String(length=20), nullable=False),
        sa.Column('status', sa.String(length=20), server_default='ONLINE', nullable=False),
        sa.Column('model', sa.String(length=50), server_default='GB-WIM-Dynamic-40T', nullable=False),
        sa.Column('firmware_version', sa.String(length=30), server_default='v2.4.1', nullable=False),
        sa.Column('last_heartbeat', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('device_code')
    )
    op.create_index(op.f('ix_wim_devices_device_code'), 'wim_devices', ['device_code'], unique=True)
    op.create_index(op.f('ix_wim_devices_gate'), 'wim_devices', ['gate'], unique=False)
    op.create_index(op.f('ix_wim_devices_status'), 'wim_devices', ['status'], unique=False)

    # 2. wim_measurements
    op.create_table(
        'wim_measurements',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('measurement_id', sa.String(length=30), nullable=False),
        sa.Column('device_id', sa.Integer(), nullable=True),
        sa.Column('device_code', sa.String(length=30), nullable=False),
        sa.Column('gate', sa.String(length=20), nullable=False),
        sa.Column('lane', sa.String(length=20), nullable=False),
        sa.Column('direction', sa.String(length=10), nullable=False),
        sa.Column('observed_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('received_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('plate', sa.String(length=30), nullable=True),
        sa.Column('truck_id', sa.Integer(), nullable=True),
        sa.Column('speed_kmh', sa.Float(), nullable=False),
        sa.Column('axle_count', sa.Integer(), nullable=False),
        sa.Column('axle_weights', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('gross_weight_t', sa.Float(), nullable=False),
        sa.Column('quality', sa.String(length=20), server_default='GOOD', nullable=False),
        sa.Column('status', sa.String(length=30), server_default='VALID', nullable=False),
        sa.Column('source', sa.String(length=100), server_default='SIMULATED', nullable=False),
        sa.Column('movement_id', sa.Integer(), nullable=True),
        sa.Column('radar_length_m', sa.Float(), nullable=True),
        sa.Column('correlation_status', sa.String(length=30), server_default='CORRELATED', nullable=False),
        sa.Column('discrepancy_details', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['device_id'], ['wim_devices.id'], ),
        sa.ForeignKeyConstraint(['movement_id'], ['movements.id'], ),
        sa.ForeignKeyConstraint(['truck_id'], ['trucks.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('measurement_id')
    )
    op.create_index(op.f('ix_wim_measurements_correlation_status'), 'wim_measurements', ['correlation_status'], unique=False)
    op.create_index(op.f('ix_wim_measurements_device_code'), 'wim_measurements', ['device_code'], unique=False)
    op.create_index(op.f('ix_wim_measurements_device_id'), 'wim_measurements', ['device_id'], unique=False)
    op.create_index(op.f('ix_wim_measurements_gate'), 'wim_measurements', ['gate'], unique=False)
    op.create_index(op.f('ix_wim_measurements_measurement_id'), 'wim_measurements', ['measurement_id'], unique=True)
    op.create_index(op.f('ix_wim_measurements_movement_id'), 'wim_measurements', ['movement_id'], unique=False)
    op.create_index(op.f('ix_wim_measurements_plate'), 'wim_measurements', ['plate'], unique=False)
    op.create_index(op.f('ix_wim_measurements_status'), 'wim_measurements', ['status'], unique=False)
    op.create_index(op.f('ix_wim_measurements_truck_id'), 'wim_measurements', ['truck_id'], unique=False)

    # 3. wim_anomalies
    op.create_table(
        'wim_anomalies',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('anomaly_code', sa.String(length=30), nullable=False),
        sa.Column('measurement_id', sa.Integer(), nullable=True),
        sa.Column('movement_id', sa.Integer(), nullable=True),
        sa.Column('truck_id', sa.Integer(), nullable=True),
        sa.Column('plate', sa.String(length=30), nullable=True),
        sa.Column('anomaly_type', sa.String(length=50), nullable=False),
        sa.Column('severity', sa.String(length=20), server_default='MEDIUM', nullable=False),
        sa.Column('description', sa.Text(), nullable=False),
        sa.Column('details', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('status', sa.String(length=20), server_default='OPEN', nullable=False),
        sa.Column('reviewed_by', sa.Integer(), nullable=True),
        sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('resolution_reason', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['measurement_id'], ['wim_measurements.id'], ),
        sa.ForeignKeyConstraint(['movement_id'], ['movements.id'], ),
        sa.ForeignKeyConstraint(['reviewed_by'], ['officers.id'], ),
        sa.ForeignKeyConstraint(['truck_id'], ['trucks.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('anomaly_code')
    )
    op.create_index(op.f('ix_wim_anomalies_anomaly_code'), 'wim_anomalies', ['anomaly_code'], unique=True)
    op.create_index(op.f('ix_wim_anomalies_anomaly_type'), 'wim_anomalies', ['anomaly_type'], unique=False)
    op.create_index(op.f('ix_wim_anomalies_measurement_id'), 'wim_anomalies', ['measurement_id'], unique=False)
    op.create_index(op.f('ix_wim_anomalies_movement_id'), 'wim_anomalies', ['movement_id'], unique=False)
    op.create_index(op.f('ix_wim_anomalies_plate'), 'wim_anomalies', ['plate'], unique=False)
    op.create_index(op.f('ix_wim_anomalies_severity'), 'wim_anomalies', ['severity'], unique=False)
    op.create_index(op.f('ix_wim_anomalies_status'), 'wim_anomalies', ['status'], unique=False)
    op.create_index(op.f('ix_wim_anomalies_truck_id'), 'wim_anomalies', ['truck_id'], unique=False)


def downgrade() -> None:
    op.drop_table('wim_anomalies')
    op.drop_table('wim_measurements')
    op.drop_table('wim_devices')
