"""Run the FastAPI backend server."""

import uvicorn
from pathlib import Path
import sys

# Add project root to path
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

if __name__ == "__main__":
    import os
    # Use port from environment variable or default to 8002 (8001 is used by Cursor)
    port = int(os.getenv("BACKEND_PORT", "8002"))
    uvicorn.run(
        "backend.main:app",
        host="0.0.0.0",
        port=port,
        reload=True,
        log_level="info"
    )

