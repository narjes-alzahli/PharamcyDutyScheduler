# 🏥 Pharmacy Staff Scheduler

## 🚀 Setup on New Computer

```bash
# 1. Clone repo
git clone <your-repo-url>
cd PharamcyDutyScheduler_tailwind
git checkout tailwind

# 2. Run setup
bash QUICK_START_NEW_COMPUTER.sh

# 3. If you have database backup, import it:
bash QUICK_START_NEW_COMPUTER.sh database_backup.sql
```

## 📦 Export Database (Before Moving)

On your **OLD computer**:
```bash
bash EXPORT_DATABASE.sh
# Transfer the .sql file to new computer
```

## 🏃 Run

```bash
# Terminal 1: Backend
uvicorn backend.main:app --reload

# Terminal 2: Frontend
cd frontend && npm start
```

Access: `http://localhost:3000`

---

**Default admin:** username: `admin`, password: `admin123`
