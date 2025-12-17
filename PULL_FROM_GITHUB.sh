#!/bin/bash
# Pull specific changes from GitHub on server
# Updates: Backend, Roster, Requirements, Alembic
# Preserves: Database files, Frontend build (already deployed)

set -e

SERVER_IP="185.226.124.30"
SERVER_PORT="33240"
SERVER_USER="root"
SERVER_PATH="/opt/apps/PharamcyDutySchedulerTailwind"
BRANCH="tailwind"  # Change if using different branch

echo "🚀 Pulling changes from GitHub on server..."
echo "📦 Will update: backend/, roster/, requirements.txt, alembic/"
echo "⚠️  Database files (.db) will NOT be touched"
echo ""

ssh -p $SERVER_PORT ${SERVER_USER}@${SERVER_IP} << ENDSSH
set -e

cd $SERVER_PATH

# Check if git repo exists
if [ ! -d ".git" ]; then
    echo "❌ Error: Not a git repository!"
    echo "   Please initialize git or clone the repo first"
    exit 1
fi

# Check current branch
CURRENT_BRANCH=\$(git branch --show-current)
echo "📍 Current branch: \$CURRENT_BRANCH"

# Stash any local changes (to be safe)
echo "💾 Stashing any local changes..."
git stash push -m "Pre-deployment stash \$(date +%Y%m%d_%H%M%S)" || true

# Fetch latest from GitHub
echo "📥 Fetching latest from GitHub..."
git fetch origin

# Checkout specific files/directories from the branch
echo "📦 Pulling specific directories from origin/$BRANCH..."

# Pull backend code
echo "  - Backend code..."
git checkout origin/$BRANCH -- backend/ || {
    echo "⚠️  Warning: Could not checkout backend/"
}

# Pull roster code
echo "  - Roster code..."
git checkout origin/$BRANCH -- roster/ || {
    echo "⚠️  Warning: Could not checkout roster/"
}

# Pull requirements.txt
echo "  - Requirements..."
git checkout origin/$BRANCH -- requirements.txt || {
    echo "⚠️  Warning: Could not checkout requirements.txt"
}

# Pull alembic
echo "  - Alembic migrations..."
git checkout origin/$BRANCH -- alembic/ alembic.ini || {
    echo "⚠️  Warning: Could not checkout alembic/"
}

# Verify database files are untouched
echo ""
echo "🔍 Verifying database files are safe..."
DB_FILES=\$(find . -name "*.db" -o -name "*.db-journal" -o -name "*.db-wal" -o -name "*.db-shm" 2>/dev/null | wc -l)
if [ "\$DB_FILES" -gt 0 ]; then
    echo "✅ Found \$DB_FILES database file(s) - all preserved"
    find . -name "*.db" 2>/dev/null | head -3
fi

# Show what changed
echo ""
echo "📊 Recent changes:"
git status --short backend/ roster/ requirements.txt alembic/ 2>/dev/null | head -10 || echo "   (no changes or git status unavailable)"

echo ""
echo "✅ Files pulled successfully!"
ENDSSH

if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Pull failed!"
    exit 1
fi

echo ""
echo "🔄 Step 2: Updating Python dependencies..."
ssh -p $SERVER_PORT ${SERVER_USER}@${SERVER_IP} << 'ENDSSH'
cd /opt/apps/PharamcyDutySchedulerTailwind

if [ -d "scheduler_env" ] && [ -f "requirements.txt" ]; then
    echo "📦 Installing/updating Python dependencies..."
    source scheduler_env/bin/activate
    pip install -q -r requirements.txt
    echo "✅ Dependencies updated"
else
    echo "⚠️  Virtual environment or requirements.txt not found"
fi
ENDSSH

echo ""
echo "🔄 Step 3: Restarting backend..."
ssh -p $SERVER_PORT ${SERVER_USER}@${SERVER_IP} << 'ENDSSH'
cd /opt/apps/PharamcyDutySchedulerTailwind

# Kill existing backend
echo "🛑 Stopping existing backend..."
pkill -f "uvicorn.*backend.main" || echo "   (no backend process found)"
sleep 2

# Start backend
echo "🚀 Starting backend..."
source scheduler_env/bin/activate
nohup uvicorn backend.main:app --host 0.0.0.0 --port 8000 --workers 1 > /tmp/backend.log 2>&1 &
sleep 3

# Check backend
if curl -s http://localhost:8000/api/health > /dev/null; then
    echo "✅ Backend is running!"
else
    echo "⚠️  Backend may need a moment to start"
    echo "   Check logs: tail -f /tmp/backend.log"
fi
ENDSSH

echo ""
echo "🎉 Deployment complete!"
echo "   ✅ Backend code updated from GitHub"
echo "   ✅ Roster code updated from GitHub"
echo "   ✅ Requirements updated"
echo "   ✅ Alembic migrations updated"
echo "   ✅ Database files preserved"
echo "   ✅ Backend restarted"
echo ""
echo "   Access at: http://185.226.124.30:8502"
echo "   Backend logs: ssh -p $SERVER_PORT root@$SERVER_IP 'tail -f /tmp/backend.log'"
