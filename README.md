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
| Simulator (fake gate poles) | Python | `simulator/` |

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

### Database, test data and tests

On start the backend **applies migrations** (`alembic upgrade head`) and **loads test data** (`app/seed.py`: 4 GB
officers, 1 contract, 3 transporters, 20 trucks). The seed only runs on an empty database. All data is made up.

```bash
docker compose down -v && docker compose up --build    # reset to a fresh database + seed
docker compose exec backend pytest -q                    # run backend tests

# after changing models in backend/app/models/, create a migration (it appears in backend/migrations/versions/):
docker compose exec backend alembic revision --autogenerate -m "describe the change"
docker compose exec backend alembic upgrade head
```

Data persists across restarts in Docker volumes (`pgdata` for Postgres, `uploads` for optional photos).

### Tampering scenarios (simulator)

The simulator plays the gate poles. Each scenario in `simulator/scenarios/<suite>.yaml` describes what **physically**
happens (fake plate, stolen FASTag, removed identifiers, an old QR shown again, an overloaded body…); the simulator
reports faithful sensor readings to the backend like a real pole, and checks whether the system caught the trick.
Each scenario runs under its own small permit, so scenarios never affect each other or the real permit.

```bash
docker compose run --rm simulator trip_basic       # 22 full-trip stories: entry, pass, exit, weight, quota, hours
docker compose run --rm simulator identify_basic   # 5 Identify-only cases
```

### Site-level runs (a whole contract period)

`simulator/site_run.py` plays a whole contract period (7 days by default) through the gates: honest trucks working
their shifts plus cheats mixed in, with a simulated Vendor filing daily reports. It keeps the **ground truth** the GB
never sees, and saves a site report comparing Permitted / Vendor reported / GB legal / GB actual / GB illegal /
Ground truth, with every cheat scored as prevented, detected or missed. Same seed, same result.

```bash
docker compose run --rm simulator site clean_week   # control: honest traffic only
docker compose run --rm simulator site brief_case   # permit 100 trips, the Vendor pushes on to ~200 and reports 100
docker compose run --rm simulator site mixed_week   # every cheat type inside a normal week
```
Scenarios live in `simulator/scenarios/site/`. Each run takes about a minute and appears under **Site runs**.
Prints a scorecard (scenarios passed, tampering caught, false alarms on honest trips) and saves the run, which the
dashboard shows under **Scenario runs**. Every reading appears under **Gate events**. Scenario files are mounted, so
edit them and re-run without rebuilding.

### Dashboard

- **Truck registry** (`/registry`): search and filter trucks, see who is authorised today, open any truck for its
  full detail (identity, FASTag, measurements, documents, ownership, enrollment, photos, change history).
- **Transporters** (`/transporters`): companies and their drivers.
- **Gate console** (`/gate-console`): live walkthrough for demos. Describe what physically arrives at the gate
  (mocked sensors: registered or outside truck, plate shown, FASTag on the windscreen, or pick a preset), press
  "Truck arrives at gate", and watch the real GB software decide check by check while the server log streams
  live (Server-Sent Events from `/api/logs/stream`). Each browser tab sees only its own walkthrough.
- **Gate events** (`/gate-events`): every vehicle the poles observed: raw readings, Identify result, barrier,
  pass, alerts, and every step with its reason.
- **Alerts** (`/alerts`): every alert raised, by severity and source.
- **Scenario runs** (`/scenario-runs`): simulator scorecards; trip stories show each event expected vs actual.
- **Site runs** (`/site-runs`): site-level reports: the ledger table, trips per day (chart and table), cheats by
  type, alerts, false alarms.
- **Acting as** (top right): the GB officer making changes. There's no login in the PoC; every change is recorded
  against the selected officer.

## Project layout

```
backend/        FastAPI app (GB server: registry, passes, compare, alerts, records)
frontend/       React + TypeScript dashboard
simulator/      Simulated gate poles and tampering scenario suites
docs/           Problem statement, design docs, research
docker-compose.yml
.env.example
```

## Working together

**Branches**
```
main      stable: only updated from dev when a working version is ready (demo / submission)
  └── dev     integration: all features merge here first
        ├── feature/registry
        ├── feature/plate-reading
        └── feature/<short-name>
```
- **Never commit directly to `main` or `dev`.**
- Start every piece of work from the latest `dev`:
  ```bash
  git switch dev && git pull
  git switch -c feature/<short-name>
  ```
- Push your branch and open a **pull request into `dev`**. Get a teammate to review, then merge.
- When `dev` is stable and demo-ready, open a pull request **`dev` → `main`**.
- Keep branches small and short-lived; pull `dev` into your branch often to avoid big conflicts.

**General**
- Never commit `.env` or secrets; add new settings to `.env.example` with a comment.
- Keep design decisions in `docs/` so the deck and code stay in sync.

## Build plan (PoC)

1. **Registry**: GB truck registry (plate, FASTag, length, empty weight, owner).
2. **First full flow**: plate reading at the gate → identify against the registry → result shown on the dashboard.
3. Trip pass, compare, act, record (see `docs/core_solution.md`).
