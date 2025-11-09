# 🏥 Pharmacy Staff Scheduler

A full-stack rostering platform that generates fair pharmacy schedules, manages leave/shift requests, and visualises results.  
The new architecture is:

- **Backend:** FastAPI + OR-Tools (solver, data APIs)
- **Frontend:** React 19 + Vite + Tailwind CSS
- **Build Tools:** Node ≥ 18, Python ≥ 3.10

---

## 🚀 Quick Start

### 1. Clone
```bash
git clone git@github.com:narjes-alzahli/PharamcyDutyScheduler.git
cd PharamcyDutyScheduler
```

### 2. Backend (FastAPI)
```bash
python -m venv scheduler_env
source scheduler_env/bin/activate  # Windows: scheduler_env\Scripts\activate
pip install --upgrade pip
pip install -r requirements.txt
uvicorn backend.main:app --reload
```
The API will be available at `http://localhost:8000` (docs at `/docs`).

### 3. Frontend (React)
```bash
cd frontend
npm install
cp .env.example .env        # set API_URL if backend is not on localhost:8000
npm start
```
Visit `http://localhost:3000`.

---

## 🧭 Primary Apps

| Area | Tech | Command | Notes |
| --- | --- | --- | --- |
| Backend | FastAPI (Python) | `uvicorn backend.main:app --reload` | Provides REST API for employees, demands, solver, reports |
| Frontend | React + Tailwind | `npm start` | SPA with Roster Generator, Requests, Reports, Schedule image download |
| Solver | OR-Tools | triggered via API | Optimises schedules via asynchronous job queue |

The legacy Streamlit UI remains in `roster/app/ui/` for reference but is no longer required.

---

## 📄 Environment Variables

Frontend `.env` (see `.env.example`):

```
VITE_API_URL=http://localhost:8000
```

Backend uses environment defaults. For production you can set:
- `API_BASE_URL`, `FRONTEND_ORIGIN`
- `UVICORN_PORT`, `UVICORN_HOST`

---

## 🗂️ Data Inputs

Source data lives in `roster/app/data/`. Key files:

| File | Purpose |
| --- | --- |
| `employees.csv` | Employee skills & constraints |
| `demands/*.csv` | Daily shift requirements |
| `time_off.csv` | Approved leave (auto-updated by manager approvals) |
| `locks.csv` | Forced/forbidden shifts (auto-updated) |
| `shift_types.json` | Configurable shift codes (incl. `MS`, `C`) |

The frontend now validates demand vs available skills and hides stale schedules any time these datasets change.

---

## ✨ Features

- Employee management with username sync and duplicate validation
- Staffing needs editor with weekday/weekend presets
- Leave & shift request approvals (move to solver inputs automatically)
- Guided roster generator with step list (tabs hidden until month/year selected)
- Combined “Generate & Review” flow, colour legend editing, P/O display
- Download roster **as an image** with title + legend (no more CSV)
- Reports & analytics (fairness metrics, coverage summaries)
- Persistent committed schedules surfaced in Monthly Roster & Reports pages

---

## 🧪 Testing & Tooling

- Backend linting/test hooks are not yet bundled; use `pytest` or equivalent if you add suites.
- Frontend uses CRA scripts (`npm test`, `npm run build`).
- ESLint is configured via CRA defaults; run `npm run lint` if you add a script.

---

## 🚀 Deployment Notes

For a production/Nginx setup:

1. **Backend**
   - Run with a process manager: `uvicorn backend.main:app --host 0.0.0.0 --port 8000`
   - Reverse-proxy `/api/` through Nginx (include CORS/origin headers)
2. **Frontend**
   - `npm run build`
   - Serve `frontend/build/` as static assets through Nginx
3. **Background Solver**
   - The solver runs in-process via FastAPI job polling; ensure the API service stays alive (systemd/pm2/supervisor).

---

## 📁 Repository Layout

```
PharamcyDutyScheduler/
├── backend/                # FastAPI routers, models, solver endpoints
├── frontend/               # React app (Tailwind, axios services)
│   ├── public/
│   └── src/
├── roster/                 # Data manager utilities & legacy Streamlit app
├── requirements.txt        # Backend Python deps
├── README.md               # This guide
└── ENVIRONMENT_SETUP.md    # Expanded setup walkthrough
```

---

**Built to keep pharmacy teams fairly scheduled—24/7.**
