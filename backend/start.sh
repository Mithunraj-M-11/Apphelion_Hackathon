#!/bin/sh
# Container entrypoint: apply DB migrations, load test data (idempotent), start the API.
set -e
alembic upgrade head
python -m app.seed
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
