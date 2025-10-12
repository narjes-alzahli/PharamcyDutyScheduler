#!/bin/bash
# Python 3.12 specific setup script

echo "🐍 Setting up for Python 3.12..."

# Remove broken environment
if [ -d "scheduler_env" ]; then
    echo "🗑️ Removing broken virtual environment..."
    rm -rf scheduler_env
fi

# Create fresh environment
echo "🔧 Creating fresh virtual environment..."
python3 -m venv scheduler_env

# Activate
source scheduler_env/bin/activate

# Install modern build tools
echo "🔧 Installing modern build tools..."
pip install --upgrade pip
pip install --upgrade "setuptools>=68.0.0" "wheel>=0.40.0"

# Try minimal requirements first
echo "🔧 Installing core packages..."
pip install -r requirements-minimal.txt

# Try to install OR-Tools separately
echo "🔧 Installing OR-Tools..."
pip install ortools==9.8.3296 || echo "⚠️ OR-Tools installation failed, trying alternative..."

# If OR-Tools fails, try without version pin
if ! python -c "import ortools" 2>/dev/null; then
    echo "🔧 Trying OR-Tools without version pin..."
    pip install ortools
fi

# Install protobuf
echo "🔧 Installing protobuf..."
pip install protobuf==4.25.1

echo "✅ Python 3.12 setup complete!"
echo "🚀 You can now run: ./launch_app.py"
