#!/bin/bash
# Setup Python virtual environment and install dependencies

# Create venv if it doesn't exist
[ ! -d "scheduler_env" ] && python3 -m venv scheduler_env

# Activate venv
source scheduler_env/bin/activate

# Install dependencies
pip install --upgrade pip
pip install -r requirements.txt

echo "✅ Environment ready! Run: python run_backend.py"
