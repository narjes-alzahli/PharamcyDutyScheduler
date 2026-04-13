#!/bin/bash
# Create .venv if missing and install dependencies from requirements.txt

[ ! -d ".venv" ] && python3 -m venv .venv

source .venv/bin/activate

pip install --upgrade pip
pip install -r requirements.txt

echo "✅ Environment ready! Activate later with: source .venv/bin/activate"
echo "   Then run: python run_backend.py"
