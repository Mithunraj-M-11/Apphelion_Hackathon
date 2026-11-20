# Aphelion: Independent Monitoring of Extraction and Material Movement

Hackathon PoC for **independent monitoring and control of extraction and material movement at large contracted
sites**. The Governing Body (GB) gets its own sensors at every gate, issues every trip pass itself, and compares what
physically happened against the permit, without relying on the Vendor's power, network, staff or records.

- Solution summary (one page): [docs/core_at_a_glance.md](docs/core_at_a_glance.md)
- Full core design: [docs/core_solution.md](docs/core_solution.md)
- Tampering cases and hardening layers: [docs/tampering_cases.md](docs/tampering_cases.md), [docs/solutions.md](docs/solutions.md)
- Research and evidence: [docs/research_existing_systems.md](docs/research_existing_systems.md)

## Stack

| Part | Tech | Folder |
|---|---|---|
| Database | PostgreSQL 16 | (container `db`) |
| Backend API (GB server) | Python 3.11, FastAPI, SQLAlchemy | `backend/` |
| Dashboard | React 18 + TypeScript, Vite | `frontend/` |
| Simulator (fake gate poles) | Python | `simulator/` *(coming)* |

Everything runs with **Docker Compose**, so teammates only need Docker.

## Quick start

Prerequisites: [Docker Desktop](https://www.docker.com/products/docker-desktop/) (includes Compose) and Git.

```bash
git clone <repo-url>
cd <repo-folder>
cp .env.example .env          # optional: defaults work without it
docker compose up --build
```

| Service | URL |
|---|---|
| Dashboard | http://localhost:5173 |
| API | http://localhost:8000 (docs: http://localhost:8000/docs) |
| Health check | http://localhost:8000/api/health |
| Postgres | localhost:5432 (user / password / db from `.env`) |

Stop with `Ctrl+C`, or `docker compose down`. To wipe the database too: `docker compose down -v`.

Code changes reload automatically: `backend/app` and `frontend/` are mounted into the containers.
If you change `requirements.txt` or `package.json`, rebuild with `docker compose up --build`.

## Project layout

```
backend/        FastAPI app (GB server: registry, passes, compare, alerts, records)
frontend/       React + TypeScript dashboard
simulator/      Simulated gate poles and demo scenarios (coming)
docs/           Problem statement, design docs, research
docker-compose.yml
.env.example
```

## Working together

- Branch from `main`: `feature/<short-name>`; open a pull request to merge.
- Never commit `.env` or secrets; add new settings to `.env.example` with a comment.
- Keep design decisions in `docs/` so the deck and code stay in sync.

## Build plan (PoC)

1. **Registry**: GB truck registry (plate, FASTag, length, empty weight, owner).
2. **First full flow**: plate reading at the gate → identify against the registry → result shown on the dashboard.
3. Trip pass, compare, act, record (see `docs/core_solution.md`).
