#!/usr/bin/env python3
"""Startup script for the scheduler application."""

import sys
import os
from pathlib import Path

# Add the current directory to Python path
current_dir = Path(__file__).parent
sys.path.insert(0, str(current_dir))

# Set environment variables
os.environ['PYTHONPATH'] = str(current_dir)

if __name__ == "__main__":
    # Import and run the streamlit app
    from roster.app.ui.streamlit_app import main
    main()
