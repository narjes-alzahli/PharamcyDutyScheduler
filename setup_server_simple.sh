#!/bin/bash
# Simple server setup for externally managed Python environments

echo "🐍 Setting up Pharmacy Scheduler on externally managed Python..."

# Check if python3-full is installed
if ! dpkg -l | grep -q python3-full; then
    echo "🔧 Installing python3-full..."
    sudo apt update
    sudo apt install -y python3-full python3-venv
fi

# Remove any existing broken environment
if [ -d "scheduler_env" ]; then
    echo "🗑️ Removing existing virtual environment..."
    rm -rf scheduler_env
fi

# Create virtual environment with full Python
echo "🔧 Creating virtual environment with python3-full..."
python3 -m venv scheduler_env

# Activate environment
echo "🔧 Activating virtual environment..."
source scheduler_env/bin/activate

# Upgrade pip and install build tools
echo "🔧 Installing build tools..."
pip install --upgrade pip
pip install --upgrade setuptools wheel

# Install packages one by one to avoid conflicts
echo "🔧 Installing core packages..."
pip install streamlit==1.28.1
pip install pandas==2.1.4
pip install numpy==1.24.3
pip install plotly==5.17.0
pip install pydantic==2.5.0
pip install pyyaml==6.0.1
pip install python-dateutil==2.8.2

# Try OR-Tools
echo "🔧 Installing OR-Tools..."
pip install ortools==9.8.3296 || {
    echo "⚠️ OR-Tools failed, trying without version pin..."
    pip install ortools
}

# Install protobuf
echo "🔧 Installing protobuf..."
pip install protobuf==4.25.1

echo "✅ Setup complete!"
echo "🚀 You can now run: ./launch_app.py"
