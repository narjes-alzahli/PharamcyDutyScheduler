# Manual Deployment Steps (Everything Except Database)

## What Gets Deployed
- ✅ Frontend build (`frontend/build/`)
- ✅ Backend code (`backend/`)
- ✅ Roster code (`roster/`)
- ✅ Requirements (`requirements.txt`)
- ✅ Alembic migrations (`alembic/`)
- ✅ Configuration files

## What Does NOT Get Deployed
- ❌ Database files (`*.db`, `*.db-journal`, `*.db-wal`, `*.db-shm`)
- ❌ Node modules (`node_modules/`)
- ❌ Python cache (`__pycache__/`, `*.pyc`)
- ❌ Environment files (`.env`)

## Quick Deploy (Automated)

```bash
./DEPLOY_ALL_EXCEPT_DB.sh
```

## Manual Deploy Steps

### Step 1: Transfer Frontend Build
```bash
scp -P 33240 frontend/build.zip root@185.226.124.30:/opt/apps/PharamcyDutySchedulerTailwind/frontend/
```

### Step 2: Transfer Backend & Roster Code
```bash
# Option A: Using rsync (recommended - faster, excludes files automatically)
rsync -avz --progress \
    -e "ssh -p 33240" \
    --exclude='*.db' \
    --exclude='*.db-*' \
    --exclude='node_modules' \
    --exclude='__pycache__' \
    --exclude='*.pyc' \
    --exclude='.git' \
    --exclude='frontend/build' \
    --exclude='frontend/node_modules' \
    --exclude='.env' \
    ./ root@185.226.124.30:/opt/apps/PharamcyDutySchedulerTailwind/

# Option B: Using scp (if rsync not available)
scp -P 33240 -r backend/ root@185.226.124.30:/opt/apps/PharamcyDutySchedulerTailwind/
scp -P 33240 -r roster/ root@185.226.124.30:/opt/apps/PharamcyDutySchedulerTailwind/
scp -P 33240 requirements.txt root@185.226.124.30:/opt/apps/PharamcyDutySchedulerTailwind/
scp -P 33240 -r alembic/ root@185.226.124.30:/opt/apps/PharamcyDutySchedulerTailwind/
```

### Step 3: SSH and Deploy on Server
```bash
ssh -p 33240 root@185.226.124.30
cd /opt/apps/PharamcyDutySchedulerTailwind
```

#### On Server - Extract Frontend Build
```bash
cd frontend

# Backup existing build
if [ -d "build" ]; then
    mv build build_backup_$(date +%Y%m%d_%H%M%S)
fi

# Extract new build
unzip -o build.zip -d .
rm -f build.zip
```

#### On Server - Update Python Dependencies
```bash
cd /opt/apps/PharamcyDutySchedulerTailwind
source scheduler_env/bin/activate
pip install -r requirements.txt
```

#### On Server - Restart Backend
```bash
# Kill existing backend
pkill -f "uvicorn.*backend.main" || true
sleep 2

# Start backend
nohup uvicorn backend.main:app --host 0.0.0.0 --port 8000 --workers 1 > /tmp/backend.log 2>&1 &

# Verify it's running
sleep 3
curl -s http://localhost:8000/api/health || echo "Backend may need a moment to start"
```

#### On Server - Reload Nginx (if needed)
```bash
systemctl reload nginx
```

### Step 4: Verify Deployment
```bash
# Check backend is running
curl http://185.226.124.30:8000/api/health

# Check frontend is accessible
curl -I http://185.226.124.30:8502
```

## Database Safety Check

Before deploying, verify what database files exist on server:
```bash
ssh -p 33240 root@185.226.124.30 "find /opt/apps/PharamcyDutySchedulerTailwind -name '*.db*' -type f"
```

These files will NOT be touched by the deployment.

## Rollback (if needed)

### Rollback Frontend
```bash
ssh -p 33240 root@185.226.124.30
cd /opt/apps/PharamcyDutySchedulerTailwind/frontend
rm -rf build
mv build_backup_YYYYMMDD_HHMMSS build
```

### Rollback Backend/Roster
```bash
# Restore from git on server
ssh -p 33240 root@185.226.124.30
cd /opt/apps/PharamcyDutySchedulerTailwind
git checkout HEAD -- backend/ roster/
```

## Important Notes

1. **Database is NEVER touched** - All `.db` files are preserved
2. **Backend restart required** - After code changes, restart the backend
3. **Check logs** - If issues occur, check `/tmp/backend.log`
4. **Test first** - Consider testing on a staging environment first

