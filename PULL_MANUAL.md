# Pull Changes from GitHub on Server

## Quick Deploy (Automated)

```bash
./PULL_FROM_GITHUB.sh
```

## Manual Steps

### Step 1: SSH to Server
```bash
ssh -p 33240 root@185.226.124.30
cd /opt/apps/PharamcyDutySchedulerTailwind
```

### Step 2: Stash Local Changes (if any)
```bash
git stash push -m "Pre-deployment stash $(date +%Y%m%d_%H%M%S)"
```

### Step 3: Fetch Latest from GitHub
```bash
git fetch origin
```

### Step 4: Pull Specific Directories
```bash
# Pull backend code
git checkout origin/tailwind -- backend/

# Pull roster code (includes the rules!)
git checkout origin/tailwind -- roster/

# Pull requirements
git checkout origin/tailwind -- requirements.txt

# Pull alembic migrations
git checkout origin/tailwind -- alembic/ alembic.ini
```

### Step 5: Verify Database is Safe
```bash
# Check database files still exist
find . -name "*.db" -type f

# Should show your database files - they're safe!
```

### Step 6: Update Python Dependencies
```bash
source scheduler_env/bin/activate
pip install -r requirements.txt
```

### Step 7: Restart Backend
```bash
# Stop existing backend
pkill -f "uvicorn.*backend.main" || true
sleep 2

# Start backend
nohup uvicorn backend.main:app --host 0.0.0.0 --port 8000 --workers 1 > /tmp/backend.log 2>&1 &

# Verify it's running
sleep 3
curl http://localhost:8000/api/health
```

### Step 8: Check Logs (if needed)
```bash
tail -f /tmp/backend.log
```

## What Gets Updated

✅ **Pulled from GitHub:**
- `backend/` - All API changes
- `roster/` - Includes rules (two O after N, one O after M4/A)
- `requirements.txt` - Python dependencies
- `alembic/` - Database migrations
- `alembic.ini` - Alembic configuration

❌ **NOT Touched:**
- `*.db` files - Database preserved
- `frontend/build/` - Already deployed via SCP
- `.env` files - Environment variables preserved

## Using Different Branch

If you want to pull from a different branch (e.g., `main`):

```bash
git checkout origin/main -- backend/ roster/ requirements.txt alembic/ alembic.ini
```

## Troubleshooting

**If git checkout fails:**
- Make sure you're in the correct directory
- Check if the branch exists: `git branch -r`
- Verify remote: `git remote -v`

**If backend won't start:**
- Check logs: `tail -f /tmp/backend.log`
- Verify Python dependencies: `pip list`
- Check port 8000 is available: `lsof -i:8000`

**If database seems affected:**
- Database files are NEVER touched by git checkout
- Verify with: `ls -lh *.db`
- Check git status: `git status` (should not show .db files)

## Verify Deployment

```bash
# Check backend health
curl http://185.226.124.30:8000/api/health

# Check frontend
curl -I http://185.226.124.30:8502

# Check recent commits pulled
cd /opt/apps/PharamcyDutySchedulerTailwind
git log origin/tailwind --oneline -5
```
