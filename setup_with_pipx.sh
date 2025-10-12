#!/bin/bash
# Alternative setup using pipx (recommended for externally managed environments)

echo "🐍 Setting up with pipx for externally managed Python..."

# Install pipx if not available
if ! command -v pipx &> /dev/null; then
    echo "🔧 Installing pipx..."
    sudo apt update
    sudo apt install -y pipx
    pipx ensurepath
fi

# Install python3-full if needed
if ! dpkg -l | grep -q python3-full; then
    echo "🔧 Installing python3-full..."
    sudo apt install -y python3-full
fi

# Create virtual environment
echo "🔧 Creating virtual environment..."
python3 -m venv scheduler_env
source scheduler_env/bin/activate

# Install packages
echo "🔧 Installing packages in virtual environment..."
pip install --upgrade pip setuptools wheel
pip install streamlit pandas numpy plotly pydantic pyyaml python-dateutil
pip install ortools protobuf

echo "✅ Setup complete with pipx approach!"
echo "🚀 You can now run: ./launch_app.py"
