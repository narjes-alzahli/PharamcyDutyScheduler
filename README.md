# 🏥 Pharmacy Staff Scheduler

A full-stack rostering platform that generates fair pharmacy schedules, manages leave/shift requests, and visualises results.

**Architecture:**
- **Backend:** FastAPI + OR-Tools (solver, data APIs)
- **Frontend:** React 19 + Tailwind CSS
- **Build Tools:** Node ≥ 18, Python ≥ 3.10

---

## 🚀 Quick Start

### 1. Clone Repository
```bash
git clone git@github.com:narjes-alzahli/PharamcyDutyScheduler.git
cd PharamcyDutyScheduler
```

### 2. Backend Setup
```bash
# Create virtual environment
python -m venv scheduler_env
source scheduler_env/bin/activate  # Windows: scheduler_env\Scripts\activate

# Install dependencies
pip install --upgrade pip
pip install -r requirements.txt

# Start backend
uvicorn backend.main:app --reload
```
Backend API available at `http://localhost:8000` (docs at `/docs`)

### 3. Frontend Setup
```bash
cd frontend
npm install

# Create .env file
echo "REACT_APP_API_URL=http://localhost:8000" > .env

# Start dev server
npm start
```
Frontend available at `http://localhost:3000`

---

## 📦 Key Dependencies

**Backend:**
- `ortools` 9.8.x — optimisation solver
- `fastapi` / `uvicorn` — REST API & ASGI server
- `pandas` / `numpy` — data processing
- `pydantic` — data validation

**Frontend:**
- React 19 + TypeScript
- Tailwind CSS
- Axios for API calls

---

## 🗄️ Database Setup

### Initial Setup
```bash
# Initialize database (creates tables and default admin user)
python3 -m backend.init_db
```

This creates:
- Database tables
- Default admin user (username: `admin`, password: `admin123`)
- Default leave types (DO, AL, ML, W, UL, APP, STL, L, O)

### Database Options

**SQLite (default, development):**
- No setup needed, uses `roster.db` in project root

**PostgreSQL (production):**
```bash
# Install PostgreSQL, then:
createdb roster_db
export DATABASE_URL=postgresql://user:password@localhost/roster_db
```

### Migrations
```bash
# Run Alembic migrations
alembic upgrade head
```

### Migrate Existing Data
```bash
# Migrate JSON data to database
python3 -m backend.migrate_from_json
```

---

## 🗂️ Data Files

Source data in `roster/app/data/`:

| File | Purpose |
| --- | --- |
| `employees.csv` | Employee skills & constraints |
| `demands/*.csv` | Daily shift requirements |
| `time_off.csv` | Approved leave (auto-updated) |
| `locks.csv` | Forced/forbidden shifts (auto-updated) |
| `shift_types.json` | Configurable shift codes |

---

## ✨ Features

- Employee management with username sync
- Staffing needs editor with weekday/weekend presets
- Leave & shift request approvals
- Guided roster generator with step-by-step flow
- Schedule visualization with color coding
- Download roster as image (with title + legend)
- Reports & analytics (fairness metrics, coverage summaries)
- Persistent committed schedules

---

## 🚀 Production Deployment

### Build Frontend
```bash
cd frontend
npm run build
```

### Run Backend
```bash
source scheduler_env/bin/activate
uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

### Nginx Setup
- Serve `frontend/build/` as static files
- Proxy `/api/` to `http://127.0.0.1:8000`

See `DEPLOYMENT_SUMMARY.md` for server-specific deployment details.

---

## 🔧 Environment Variables

**Frontend `.env`:**
```
REACT_APP_API_URL=http://localhost:8000
PORT=3000  # Optional, defaults to 3000
```

**Backend:**
- `DATABASE_URL` - Database connection (default: SQLite)
- `API_BASE_URL` - API base URL (optional)
- `FRONTEND_ORIGIN` - CORS origin (optional)

---

## 🧪 Testing

```bash
# Backend tests
pytest

# Frontend tests
cd frontend
npm test
```

---

## 🐛 Troubleshooting

| Issue | Fix |
| --- | --- |
| `ModuleNotFoundError` | Activate virtual environment: `source scheduler_env/bin/activate` |
| CORS errors | Check `REACT_APP_API_URL` matches backend URL |
| Port already in use | Change port in `.env` or stop conflicting service |
| Database errors | Run `python3 -m backend.init_db` to initialize |
| Solver fails quickly | Check demands vs employee skills match |

---

## 📁 Project Structure

```
PharamcyDutyScheduler/
├── backend/              # FastAPI routers, models, solver
│   ├── routers/          # API endpoints
│   └── models.py         # Database models
├── frontend/             # React app
│   ├── src/              # Source code
│   └── public/           # Static assets
├── roster/               # Data utilities & solver logic
│   ├── app/
│   │   ├── data/         # CSV/JSON data files
│   │   └── model/        # Solver constraints & logic
│   └── data/             # Shift type definitions
├── alembic/              # Database migrations
├── requirements.txt      # Python dependencies
└── README.md            # This file
```

---

**Built to keep pharmacy teams fairly scheduled—24/7.**
