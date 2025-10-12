#!/usr/bin/env python3
"""Script to run the Streamlit web interface."""

import subprocess
import sys
from pathlib import Path

def main():
    """Run the Streamlit app."""
    app_path = Path(__file__).parent / "roster" / "app" / "ui" / "streamlit_app.py"
    
    if not app_path.exists():
        print(f"Error: Streamlit app not found at {app_path}")
        sys.exit(1)
    
    try:
        subprocess.run([
            sys.executable, "-m", "streamlit", "run", str(app_path)
        ], check=True)
    except subprocess.CalledProcessError as e:
        print(f"Error running Streamlit: {e}")
        sys.exit(1)
    except KeyboardInterrupt:
        print("\nStreamlit app stopped.")
        sys.exit(0)

if __name__ == "__main__":
    main()
