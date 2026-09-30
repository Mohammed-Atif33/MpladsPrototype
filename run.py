#!/usr/bin/env python3
"""Start the app (API + built React UI) on http://localhost:8000.

    python run.py          (Windows: double-click run.bat)
"""
import os
import subprocess
import sys
import threading
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENV_PY = ROOT / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
PORT = os.environ.get("PORT", "8000")


def main() -> None:
    if not VENV_PY.exists() or not (ROOT / ".env").exists():
        sys.exit("Not set up yet. Run `python setup.py` first (Windows: double-click setup.bat).")
    if not (ROOT / "frontend" / "dist" / "index.html").exists():
        sys.exit("frontend/dist is missing. Run `python setup.py` again.")
    print(f"MPLADS Risk Intelligence Platform -> http://localhost:{PORT}   (Ctrl+C to stop)")
    threading.Timer(4.0, lambda: webbrowser.open(f"http://localhost:{PORT}")).start()
    try:
        subprocess.call([str(VENV_PY), "-m", "uvicorn", "backend.app.main:app", "--host", "127.0.0.1", "--port", PORT], cwd=ROOT)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
