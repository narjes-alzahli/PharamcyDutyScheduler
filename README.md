# 🏥 Pharmacy Staff Scheduler

## Quick Start

```bash
# 1. Setup
bash activate_env.sh
alembic upgrade head
python backend/init_db.py
cd frontend && npm install

# 2. Run
python run_backend.py          # Terminal 1
cd frontend && npm start       # Terminal 2
```

**Access:** `http://localhost:3333` (frontend) → `http://localhost:8000` (backend)

## Default Credentials

- **Admin:** `admin` / `admin123`
- **Staff:** `<username>` / `password123` (e.g., `ameera` / `password123`)

## Database

**Development (SQLite):** Works automatically - no setup needed.

**Production (PostgreSQL):** Set `DATABASE_URL` in `.env`:
```
DATABASE_URL=postgresql+psycopg2://user:pass@localhost:5432/pharmacy_scheduler
```

See `.env.example` for configuration options.

## Server Setup

See [SERVER_MIGRATION.md](SERVER_MIGRATION.md) for production deployment guide.
