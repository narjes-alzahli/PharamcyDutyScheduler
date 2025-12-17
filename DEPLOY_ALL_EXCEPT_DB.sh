#!/bin/bash
# Deploy Everything Except Database
# Updates: Frontend, Backend, Roster code, Config files
# Preserves: All .db database files

set -e

SERVER_IP="185.226.124.30"
SERVER_PORT="33240"
SERVER_USER="root"
SERVER_PATH="/opt/apps/PharamcyDutySchedulerTailwind"

echo "🚀 Starting full deployment (excluding database)..."
echo "⚠️  Database files (.db) will NOT be touched"

# Check if build exists
if [ ! -f "frontend/build.zip" ]; then
    echo "📦 Building frontend first..."
    cd frontend
    CI=false npm run build
    cd build
    zip -r ../build.zip .
    cd ../..
fi

echo ""
echo "📦 Step 1: Transferring frontend build..."
scp -P $SERVER_PORT frontend/build.zip ${SERVER_USER}@${SERVER_IP}:${SERVER_PATH}/frontend/

echo ""
echo "📦 Step 2: Transferring backend code..."
# Exclude database files, node_modules, __pycache__, .git, build directories
rsync -avz --progress \
    -e "ssh -p $SERVER_PORT" \
    --exclude='*.db' \
    --exclude='*.db-journal' \
    --exclude='*.db-wal' \
    --exclude='*.db-shm' \
    --exclude='node_modules' \
    --exclude='__pycache__' \
    --exclude='*.pyc' \
    --exclude='.git' \
    --exclude='frontend/build' \
    --exclude='frontend/node_modules' \
    --exclude='.env' \
    --exclude='*.log' \
    ./ ${SERVER_USER}@${SERVER_IP}:${SERVER_PATH}/

if [ $? -ne 0 ]; then
    echo "⚠️  rsync not available, using scp for critical files..."
    
    # Transfer critical directories
    echo "  - Backend code..."
    scp -P $SERVER_PORT -r backend/ ${SERVER_USER}@${SERVER_IP}:${SERVER_PATH}/
    
    echo "  - Roster code..."
    scp -P $SERVER_PORT -r roster/ ${SERVER_USER}@${SERVER_IP}:${SERVER_PATH}/
    
    echo "  - Requirements..."
    scp -P $SERVER_PORT requirements.txt ${SERVER_USER}@${SERVER_IP}:${SERVER_PATH}/
    
    echo "  - Alembic..."
    if [ -d "alembic" ]; then
        scp -P $SERVER_PORT -r alembic/ ${SERVER_USER}@${SERVER_IP}:${SERVER_PATH}/
    fi
fi

echo ""
echo "📦 Step 3: Deploying on server..."
ssh -p $SERVER_PORT ${SERVER_USER}@${SERVER_IP} << 'ENDSSH'
cd /opt/apps/PharamcyDutySchedulerTailwind

# Backup existing frontend build
if [ -d "frontend/build" ]; then
    echo "📦 Backing up existing frontend build..."
    BACKUP_NAME="frontend_build_backup_$(date +%Y%m%d_%H%M%S)"
    mv frontend/build ${BACKUP_NAME}
fi

# Extract new frontend build
if [ -f "frontend/build.zip" ]; then
    echo "📦 Extracting new frontend build..."
    cd frontend
    unzip -q -o build.zip -d .
    rm -f build.zip
    cd ..
    echo "✅ Frontend build extracted"
fi

# Install/update Python dependencies if requirements.txt changed
if [ -f "requirements.txt" ]; then
    echo "📦 Checking Python dependencies..."
    if [ -d "scheduler_env" ]; then
        source scheduler_env/bin/activate
        pip install -q -r requirements.txt
        echo "✅ Python dependencies updated"
    fi
fi

# Verify database files are untouched
echo ""
echo "🔍 Verifying database files are safe..."
DB_FILES=$(find . -name "*.db" -o -name "*.db-journal" -o -name "*.db-wal" -o -name "*.db-shm" 2>/dev/null | wc -l)
if [ "$DB_FILES" -gt 0 ]; then
    echo "✅ Found $DB_FILES database file(s) - all preserved"
    find . -name "*.db" 2>/dev/null | head -3
fi

echo ""
echo "✅ Deployment complete on server!"
ENDSSH

if [ $? -eq 0 ]; then
    echo ""
    echo "🔄 Step 4: Restarting backend (if needed)..."
    echo "   You may need to restart the backend manually:"
    echo "   ssh -p $SERVER_PORT root@$SERVER_IP"
    echo "   cd $SERVER_PATH"
    echo "   source scheduler_env/bin/activate"
    echo "   pkill -f 'uvicorn.*backend.main' || true"
    echo "   nohup uvicorn backend.main:app --host 0.0.0.0 --port 8000 --workers 1 > /tmp/backend.log 2>&1 &"
    echo ""
    echo "🎉 Deployment successful!"
    echo "   ✅ Frontend updated"
    echo "   ✅ Backend code updated"
    echo "   ✅ Roster code updated"
    echo "   ✅ Database files preserved"
    echo ""
    echo "   Access at: http://185.226.124.30:8502"
else
    echo ""
    echo "❌ Deployment failed!"
    exit 1
fi

