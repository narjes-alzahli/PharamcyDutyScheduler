#!/bin/bash
# Pharmacy Staff Rostering System - Application Launcher

echo "🏥 Starting Pharmacy Staff Rostering System..."
echo "=============================================="

# Check if virtual environment exists
if [ ! -d "scheduler_env" ]; then
    echo "❌ Virtual environment not found!"
    echo "Please run: ./activate_env.sh first"
    exit 1
fi

# Activate virtual environment and start app
echo "🔧 Activating virtual environment..."
source scheduler_env/bin/activate

echo "✅ Environment activated!"
echo "🐍 Using Python: $(which python)"
echo "📦 OR-Tools version: $(python -c 'import ortools; print(ortools.__version__)')"
echo "📦 Protobuf version: $(python -c 'import google.protobuf; print(google.protobuf.__version__)')"
echo ""
echo "🚀 Starting FastAPI backend..."
echo "🌐 API available at: http://localhost:8000"
echo "=============================================="

# Start the backend API
uvicorn backend.main:app --reload
