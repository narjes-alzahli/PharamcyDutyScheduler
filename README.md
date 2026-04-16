# Pharmacy Staff Scheduler

Web app for pharmacy duty rosters: React UI, FastAPI API, SQL database, and an OR-Tools solver for generating schedules.

## Codebase overview

**What it is:** A tool for planning pharmacy shifts. Staff and managers maintain people, staffing needs, leave, and rules in the app; the system can **generate** rosters with a built-in solver and **save** committed schedules for later.

**Main parts:**

- **Frontend** (`frontend/`) — React UI.
- **Backend** (`backend/`) — FastAPI REST API (`/api/...`).
- **Database** — PostgreSQL in development and production; stores employees, demands, leave, saved rosters, and related data.
- **Roster logic** (`roster/app/model/`) — Turns inputs into assignments for a month or date range. How the solver works (sanity check, hard vs soft rules, main modules) is summarized at the top of [CONSTRAINTS.md](CONSTRAINTS.md).

## Environment files

Copy from the examples and edit:


| Location    | Template                | Purpose                                                 |
| ----------- | ----------------------- | ------------------------------------------------------- |
| Repo root   | `.env.example` → `.env` | Backend port, database (`DATABASE_URL`), etc.           |
| `frontend/` | `.env.example` → `.env` | API URL (`REACT_APP_API_URL`), dev server port (`PORT`) |


---

## Python: virtual environment and `requirements.txt`

Install backend dependencies from `requirements.txt` inside a `**.venv`** in the repo root (keeps packages off your system Python).

**Manual:**

```bash
python3 -m venv .venv
source .venv/bin/activate          # Linux / macOS
# .venv\Scripts\activate           # Windows
pip install --upgrade pip
pip install -r requirements.txt
```

**Or use the helper** (creates `.venv` if missing, then installs):

```bash
bash activate_env.sh
```

For every terminal where you run the backend, activate first: `source .venv/bin/activate`.

---

## Development (on your machine)

**Goal:** Run the app locally while you change code.

### One-time setup

1. **PostgreSQL** — Install and start PostgreSQL locally, then create an empty database (name should match the path in `DATABASE_URL`, default `pharmacy_scheduler`):

```bash
createdb pharmacy_scheduler
```

If your OS user owns the server, you can use a URL like `postgresql+psycopg2://$(whoami)@127.0.0.1:5432/pharmacy_scheduler` (no password). Adjust user and password in `.env` to match your server.

2. Copy env files (table above) and set **`DATABASE_URL`** in the repo root `.env` (see `.env.example`).

3. Create the Python venv and install dependencies (see **Python: virtual environment** above).

4. **Schema and seed data** — Apply migrations, then load default reference data:

```bash
alembic upgrade head
python backend/init_db.py
```

After any `git pull` that adds migrations, run `alembic upgrade head` again before starting the backend.

5. Install frontend packages:

```bash
cd frontend && npm install && cd ..
```

### Run the backend (terminal 1)

From the **repo root**, with the venv activated:

```bash
python run_backend.py
```

Default API: `http://localhost:8000` (or the port in root `.env` as `BACKEND_PORT`).

### Run the frontend (terminal 2)

```bash
cd frontend
npm start
```

Default UI: `http://localhost:3333` (see `frontend/.env` for `PORT` and `REACT_APP_API_URL`).

**Reloading:** The backend auto-reloads when you save Python files (or restart `run_backend.py`). The frontend dev server hot-reloads on save. After `git pull`, run `pip install -r requirements.txt` again if Python deps changed, and `cd frontend && npm install` if Node deps changed.

---

## Production (deployed server)

**Goal:** Users open a real website; the API runs as a stable process (not your laptop).

1. **Path:** `/opt/apps/PharamcyDutyScheduler_tailwind`
2. **`.env`:** Copy **`.env.example` → `.env`** in the **repo root** and again under **`frontend/`**. For production, use the **PRODUCTION** sections in those files (what to set for `DATABASE_URL`, `REACT_APP_API_URL`, etc.)—they are not the same as local dev.
3. **Backend:** If you changed **Python code**, the **HTTP API**, the **solver**, **database** settings, or anything else, usually the backend auto-reloads, but you can manually restart the service:

```bash
sudo systemctl restart dawamiplus-backend.service
```

Only run `sudo systemctl daemon-reload` if you edited a file under `/etc/systemd/system/`.

4. **Rebuild Frontend:** Rebuild static files after React / UI changes

```bash
cd /opt/apps/PharamcyDutyScheduler_tailwind/frontend
npm install
npm run build
```

---

## GitHub

**Development:** `git add -A && git commit -m "msg" && git push origin main` (use your branch if not `main`).

**Production:** `cd /opt/apps/PharamcyDutyScheduler_tailwind && git pull origin main` — same remote; works whether dev and prod are different machines or two folders on one box. Then run Production steps 3–4 if code changed.

---

## Default logins

- **Admin:** `anka` / `anka123`
- **Staff:** `<username>` / `<username>123`

