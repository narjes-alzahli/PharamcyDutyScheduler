# 🏥 Pharmacy Staff Rostering System — Environment Setup

The project now runs as a FastAPI backend + React/Tailwind frontend.  
Follow the steps below to recreate a working environment.

---

## 1. Backend (Python / FastAPI)

```bash
python -m venv scheduler_env
source scheduler_env/bin/activate          # Windows: scheduler_env\Scripts\activate
pip install --upgrade pip
pip install -r requirements.txt
uvicorn backend.main:app --reload
```

### Key Python Dependencies

- **ortools 9.8.x** — optimisation solver
- **fastapi / uvicorn** — REST API & ASGI server
- **pandas / numpy** — data wrangling
- **pydantic** — data validation

Deactivate with `deactivate` when finished.

---

## 2. Frontend (React / Tailwind)

```bash
cd frontend
npm install
cp .env.example .env        # set VITE_API_URL if backend differs
npm start
```

This launches the dev server at `http://localhost:3000`.

### Production Build

```bash
npm run build
# Serve contents of frontend/build/ with nginx or another static server
```

---

## 3. Directory Overview

```
backend/        FastAPI app & solver routers
frontend/       React UI (src/, public/)
roster/app/     Data utilities + legacy Streamlit (optional)
requirements.txt    Backend Python dependencies
```

Sample CSV data lives under `roster/app/data/`.

---

## 4. Troubleshooting

| Issue | Fix |
| --- | --- |
| `ModuleNotFoundError` | Verify the virtual environment is activated before running uvicorn. |
| CORS errors | Ensure `VITE_API_URL` matches the backend hostname/port. |
| npm permission errors | Re-run `npm install` with proper user permissions (avoid sudo). |
| Solver fails quickly | Check demands vs employee skills; regenerate defaults if needed. |

---

## 5. Deployment Tips

- Run the backend with `uvicorn backend.main:app --host 0.0.0.0 --port 8000` under systemd/pm2/supervisor.
- Serve the compiled React build behind Nginx; proxy `/api/` to the FastAPI service.
- Keep `roster/app/data/` mounted on persistent storage if you need durable edits.

---

All set! Backend on `http://localhost:8000`, frontend on `http://localhost:3000`.  
Happy scheduling! 🎉
