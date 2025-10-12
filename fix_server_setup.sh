#!/bin/bash
# Quick fix for server setup issues - Python 3.12 compatible

echo "🔧 Fixing server setup issues for Python 3.12..."

# Remove existing virtual environment if it's broken
if [ -d "scheduler_env" ]; then
    echo "🗑️ Removing broken virtual environment..."
    rm -rf scheduler_env
fi

# Create fresh virtual environment
echo "🔧 Creating fresh virtual environment..."
python3 -m venv scheduler_env

# Activate and install essentials
echo "🔧 Installing Python 3.12 compatible build tools..."
source scheduler_env/bin/activate

# Upgrade pip first
pip install --upgrade pip

# Install modern setuptools and wheel that work with Python 3.12
pip install --upgrade "setuptools>=68.0.0" "wheel>=0.40.0"

# Install requirements
echo "🔧 Installing all packages..."
pip install -r requirements.txt

echo "✅ Server setup fixed for Python 3.12!"
echo "🚀 You can now run: ./launch_app.py"
