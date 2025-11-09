#!/bin/bash
# Pharmacy Staff Rostering System - Environment Setup Script

echo "🏥 Setting up Pharmacy Staff Rostering Environment..."
echo "=================================================="

# Check if virtual environment exists, create if not
if [ ! -d "scheduler_env" ]; then
    echo "🔧 Creating virtual environment..."
    python3 -m venv scheduler_env
    echo "✅ Virtual environment created!"
else
    echo "✅ Virtual environment already exists!"
fi

# Activate the virtual environment
echo "🔧 Activating virtual environment..."
source scheduler_env/bin/activate

# Install/upgrade pip and essential build tools (Python 3.12 compatible)
echo "🔧 Upgrading pip and installing Python 3.12 compatible build tools..."
pip install --upgrade pip
pip install --upgrade "setuptools>=68.0.0" "wheel>=0.40.0"

# Install requirements if they don't exist or if requirements.txt is newer
if [ ! -f "scheduler_env/.requirements_installed" ] || [ "requirements.txt" -nt "scheduler_env/.requirements_installed" ]; then
    echo "🔧 Installing required packages..."
    pip install -r requirements.txt
    touch scheduler_env/.requirements_installed
    echo "✅ All packages installed!"
else
    echo "✅ All packages already installed!"
fi

echo "✅ Virtual environment activated!"
echo "🐍 Python path: $(which python)"
echo ""
echo "🚀 Backend ready!"
echo "   uvicorn backend.main:app --reload"
echo ""
echo "🧷 Remember to install frontend deps separately:"
echo "   cd frontend && npm install && npm start"
echo ""
echo "To deactivate the virtualenv:"
echo "   deactivate"
echo "=================================================="
