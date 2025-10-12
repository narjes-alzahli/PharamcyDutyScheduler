#!/bin/bash
# Quick fix for server setup issues

echo "🔧 Fixing server setup issues..."

# Remove existing virtual environment if it's broken
if [ -d "scheduler_env" ]; then
    echo "🗑️ Removing broken virtual environment..."
    rm -rf scheduler_env
fi

# Create fresh virtual environment
echo "🔧 Creating fresh virtual environment..."
python3 -m venv scheduler_env

# Activate and install essentials
echo "🔧 Installing essential build tools..."
source scheduler_env/bin/activate
pip install --upgrade pip
pip install --upgrade setuptools wheel

# Install requirements
echo "🔧 Installing all packages..."
pip install -r requirements.txt

echo "✅ Server setup fixed!"
echo "🚀 You can now run: ./launch_app.py"
