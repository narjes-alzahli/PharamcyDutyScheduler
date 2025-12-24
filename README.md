# 🏥 Pharmacy Staff Scheduler

## 🚀 Setup on New Computer

```bash
# 1. Clone repo
git clone <your-repo-url>
cd PharamcyDutyScheduler

# 2. Set up Python virtual environment
bash activate_env.sh

# 3. Initialize database
python backend/init_db.py

# 4. (Optional) Seed database with default data
python backend/seed_database.py

# 5. Set up frontend
cd frontend
npm install
```

## 🏃 Run

```bash
# Terminal 1: Backend
# Option 1: Using the convenience script
python run_backend.py

# Option 2: Direct uvicorn command
uvicorn backend.main:app --reload --port 8002

# Terminal 2: Frontend
cd frontend && npm start
```

Access: `http://localhost:3000` (or port configured in frontend)

---

**Default admin:** username: `admin`, password: `admin123`
