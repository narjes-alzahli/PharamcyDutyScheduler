#!/bin/bash
# Quick setup script for new development computer
# Usage: 
#   bash QUICK_START_NEW_COMPUTER.sh                    # Fresh setup
#   bash QUICK_START_NEW_COMPUTER.sh database_backup.sql # With database import

set -e

DATABASE_BACKUP="$1"

echo "🚀 Setting up Pharmacy Duty Scheduler on new computer..."
echo ""

# Check prerequisites
echo "📋 Checking prerequisites..."
command -v python3 >/dev/null 2>&1 || { echo "❌ Python 3 is required but not installed. Aborting." >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "❌ Node.js is required but not installed. Aborting." >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "❌ npm is required but not installed. Aborting." >&2; exit 1; }
echo "✅ Prerequisites check passed"
echo ""

# Backend setup
echo "🐍 Setting up Python backend..."
if [ ! -d "scheduler_env" ]; then
    python3 -m venv scheduler_env
    echo "✅ Created virtual environment"
fi

source scheduler_env/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
echo "✅ Python dependencies installed"
echo ""

# Database setup
echo "🗄️  Setting up database..."

if [ -n "$DATABASE_BACKUP" ] && [ -f "$DATABASE_BACKUP" ]; then
    echo "📥 Found database backup file: $DATABASE_BACKUP"
    
    # Check if sqlite3 is available
    if ! command -v sqlite3 &> /dev/null; then
        echo "⚠️  sqlite3 not found!"
        echo "   Please install sqlite3:"
        echo "     Linux: sudo apt-get install sqlite3"
        echo "     macOS: brew install sqlite3"
        echo ""
        echo "   Creating fresh database instead..."
        python3 -m backend.seed_database
    else
        echo "   Importing database from backup..."
        
        # Remove existing database if it exists
        if [ -f "roster.db" ]; then
            echo "   Removing existing database..."
            rm roster.db
        fi
        
        # Import the database
        sqlite3 roster.db < "$DATABASE_BACKUP"
        
        # Verify import
        if [ -f "roster.db" ]; then
            DB_SIZE=$(du -h roster.db | cut -f1)
            echo "✅ Database imported successfully (Size: $DB_SIZE)"
        else
            echo "❌ Database import failed, creating fresh database..."
            python3 -m backend.seed_database
        fi
    fi
elif [ -n "$DATABASE_BACKUP" ]; then
    echo "⚠️  Database backup file not found: $DATABASE_BACKUP"
    echo "   Creating fresh database instead..."
    python3 -m backend.seed_database
else
    echo "   Creating fresh database..."
    python3 -m backend.seed_database
fi

echo "✅ Database ready"
echo ""

# Frontend setup
echo "⚛️  Setting up React frontend..."
cd frontend
if [ ! -f ".env" ]; then
    echo "REACT_APP_API_URL=http://localhost:8000" > .env
    echo "✅ Created .env file"
fi

npm install
echo "✅ Node dependencies installed"
cd ..
echo ""

echo "✅ Setup complete!"
echo ""
echo "📝 Next steps:"
echo "   1. Start backend:  uvicorn backend.main:app --reload"
echo "   2. Start frontend: cd frontend && npm start"
echo ""
echo "🌐 Access:"
echo "   - Frontend: http://localhost:3000"
echo "   - Backend API: http://localhost:8000"
echo "   - API Docs: http://localhost:8000/docs"
echo ""
