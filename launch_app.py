#!/usr/bin/env python3
"""Robust launcher for the Staff Rostering System."""

import sys
import subprocess
from pathlib import Path

def main():
    """Launch the Staff Rostering System."""
    
    print("🏥 Pharmacy Staff Rostering System")
    print("==================================")
    
    # Check if we're in the right directory
    project_root = Path(__file__).parent
    app_path = project_root / "roster" / "app" / "ui" / "streamlit_app.py"
    
    if not app_path.exists():
        print(f"❌ Error: Streamlit app not found at {app_path}")
        print("Please make sure you're running this from the project root directory.")
        sys.exit(1)
    
    # Check if virtual environment exists
    venv_path = project_root / "scheduler_env"
    if not venv_path.exists():
        print("❌ Virtual environment not found!")
        print("Please run: ./activate_env.sh first")
        sys.exit(1)
    
    # Activate virtual environment and run
    venv_python = venv_path / "bin" / "python"
    if not venv_python.exists():
        print("❌ Virtual environment Python not found!")
        sys.exit(1)
    
    print("🔧 Using virtual environment Python...")
    print(f"🐍 Python: {venv_python}")
    
    try:
        # Run streamlit with the virtual environment Python
        subprocess.run([
            str(venv_python), "-m", "streamlit", "run", str(app_path)
        ], check=True)
    except subprocess.CalledProcessError as e:
        print(f"❌ Error running Streamlit: {e}")
        sys.exit(1)
    except KeyboardInterrupt:
        print("\n👋 Streamlit app stopped.")
        sys.exit(0)

if __name__ == "__main__":
    main()
