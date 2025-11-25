#!/bin/bash
set -e

echo "🚀 Starting deployment..."

# Build frontend
echo "📦 Building frontend..."
cd /opt/apps/PharamcyDutyScheduler_tailwind/frontend
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Frontend build failed!"
    exit 1
fi

echo "✅ Frontend built successfully!"

# Restart backend
echo "🔄 Restarting backend..."
cd /opt/apps/PharamcyDutyScheduler_tailwind
source scheduler_env/bin/activate

# Kill existing backend
pkill -f "uvicorn.*backend.main" || true
sleep 2

# Start backend
echo "Starting backend server..."
nohup uvicorn backend.main:app --host 0.0.0.0 --port 8000 --workers 1 > /tmp/backend.log 2>&1 &
sleep 3

# Check backend
if curl -s http://localhost:8000/api/health > /dev/null; then
    echo "✅ Backend is running!"
else
    echo "❌ Backend failed to start. Check /tmp/backend.log"
    exit 1
fi

# Reload nginx
echo "🔄 Reloading nginx..."
sudo systemctl reload nginx

if [ $? -eq 0 ]; then
    echo "✅ Nginx reloaded!"
    echo ""
    echo "🎉 Deployment complete!"
    echo "   Access at: http://185.226.124.30:8502"
else
    echo "❌ Nginx reload failed!"
    exit 1
fi

