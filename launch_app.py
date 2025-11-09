#!/usr/bin/env python3
"""Simple launcher for the FastAPI backend."""

import sys
import subprocess
from pathlib import Path

def main():
    """Launch the Staff Rostering System."""
    
    print("🏥 Pharmacy Staff Rostering System")
    print("==================================")
    
    project_root = Path(__file__).parent
    venv_path = project_root / "scheduler_env"
    if not venv_path.exists():
        print("❌ Virtual environment not found!")
        print("Run ./activate_env.sh first.")
        sys.exit(1)
    
    venv_python = venv_path / "bin" / "python"
    if not venv_python.exists():
        print("❌ Virtual environment Python not found!")
        sys.exit(1)
    
    print("🔧 Using virtual environment Python...")
    print(f"🐍 Python: {venv_python}")
    
    try:
        subprocess.run(
            [str(venv_python), "-m", "uvicorn", "backend.main:app", "--reload"],
            check=True,
        )
    except subprocess.CalledProcessError as e:
        print(f"❌ Error running backend: {e}")
        sys.exit(1)
    except KeyboardInterrupt:
        print("\n👋 Backend stopped.")
        sys.exit(0)

if __name__ == "__main__":
    main()
