#!/usr/bin/env python3
"""One-time setup.

    python setup.py                 (Windows: double-click setup.bat)

What it does
  1. creates a private virtual environment (.venv) and installs the Python dependencies
  2. asks for your PostgreSQL connection, creates the `mplads` database if needed and writes .env
  3. makes sure the built React app exists (frontend/dist ships pre-built; Node is only needed if it is missing)
  4. creates the tables and loads the synthetic demo data

Requirements: Python 3.10+ and a running PostgreSQL server (12+). Nothing else.
Non-interactive:  python setup.py --host localhost --port 5432 --user postgres --password secret --dbname mplads --yes
"""
from __future__ import annotations

import argparse
import getpass
import os
import re
import secrets
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import quote_plus

ROOT = Path(__file__).resolve().parent
VENV = ROOT / ".venv"
VENV_PY = VENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def say(msg: str = "") -> None:
    print(msg, flush=True)


def step(n: int, title: str) -> None:
    say(f"\n[{n}/4] {title}")


def run(cmd: list[str], **kw) -> None:
    subprocess.check_call(cmd, cwd=ROOT, **kw)


# ----------------------------------------------------------------------------- phase 1: venv + packages
def phase1(args) -> None:
    if sys.version_info < (3, 10):
        sys.exit(f"Python 3.10 or newer is required (found {sys.version.split()[0]}). Install it from https://www.python.org/downloads/")
    step(1, "Python environment")
    if not VENV_PY.exists():
        say("  creating virtual environment (.venv) ...")
        run([sys.executable, "-m", "venv", str(VENV)])
    say("  installing dependencies (a few minutes the first time) ...")
    run([str(VENV_PY), "-m", "pip", "install", "--disable-pip-version-check", "-q", "--upgrade", "pip"])
    run([str(VENV_PY), "-m", "pip", "install", "--disable-pip-version-check", "-q", "-r", "requirements.txt"])
    say("  done.")
    code = subprocess.call([str(VENV_PY), str(Path(__file__)), "--phase2", *sys.argv[1:]], cwd=ROOT)
    sys.exit(code)


# ----------------------------------------------------------------------------- phase 2: database, .env, frontend, seed
def ask(prompt: str, default: str = "", secret: bool = False, yes: bool = False) -> str:
    if yes:
        return default
    shown = f"{prompt} [{default}]: " if default and not secret else f"{prompt}: "
    v = getpass.getpass(shown) if secret else input(shown)
    return v.strip() or default


def connect(host, port, user, password, dbname):
    import psycopg2
    return psycopg2.connect(host=host, port=port, user=user, password=password, dbname=dbname, connect_timeout=6)


def phase2(args) -> None:
    import psycopg2  # noqa: F401  (installed in phase 1)
    from psycopg2 import sql

    env_path = ROOT / ".env"
    step(2, "PostgreSQL database")
    if env_path.exists() and not args.force:
        say("  .env already exists - keeping it (run `python setup.py --force` to reconfigure).")
        db_url = re.search(r"^DATABASE_URL=(.+)$", env_path.read_text(encoding="utf-8"), re.M)
        if not db_url:
            sys.exit("  .env has no DATABASE_URL. Delete .env and run setup again.")
    else:
        say("  Enter your PostgreSQL connection (the server must be running).")
        host = ask("  Host", args.host or os.environ.get("PGHOST", "localhost"), yes=args.yes)
        port = ask("  Port", args.port or os.environ.get("PGPORT", "5432"), yes=args.yes)
        user = ask("  User", args.user or os.environ.get("PGUSER", "postgres"), yes=args.yes)
        password = args.password if args.password is not None else os.environ.get("PGPASSWORD") or ask("  Password", "", secret=True)
        dbname = ask("  Database name to create/use", args.dbname or "mplads", yes=args.yes)
        try:
            conn = connect(host, port, user, password, "postgres")
        except Exception as e:  # noqa: BLE001
            say(f"\n  Could not connect to PostgreSQL at {host}:{port} as '{user}':\n  {str(e).strip()}")
            say("  Check that PostgreSQL is running and the credentials are right, then run setup again.")
            sys.exit(1)
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (dbname,))
            if cur.fetchone():
                say(f"  database '{dbname}' already exists - using it.")
            else:
                cur.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(dbname)))
                say(f"  created database '{dbname}'.")
        conn.close()
        url = f"postgresql+psycopg2://{quote_plus(user)}:{quote_plus(password)}@{host}:{port}/{dbname}"
        template = (ROOT / ".env.example").read_text(encoding="utf-8")
        text = re.sub(r"^DATABASE_URL=.*$", lambda _: f"DATABASE_URL={url}", template, flags=re.M)
        text = re.sub(r"^JWT_SECRET=.*$", lambda _: f"JWT_SECRET={secrets.token_urlsafe(48)}", text, flags=re.M)
        env_path.write_text(text, encoding="utf-8")
        say("  wrote .env (contains your DB password and a random JWT secret - do not share it).")

    step(3, "Frontend")
    dist = ROOT / "frontend" / "dist" / "index.html"
    if dist.exists():
        say("  pre-built React app found - nothing to do.")
    else:
        npm = shutil.which("npm")
        if not npm:
            say("  frontend/dist is missing and Node.js/npm was not found.")
            say("  Install Node 18+ (https://nodejs.org) and run setup again, or ask the sender for a copy that includes frontend/dist.")
            sys.exit(1)
        say("  building the React app (needs internet for npm packages) ...")
        run([npm, "install", "--no-audit", "--no-fund"], cwd=ROOT / "frontend")
        run([npm, "run", "build"], cwd=ROOT / "frontend")

    step(4, "Tables and synthetic demo data")
    say("  this takes about 30-60 seconds the first time ...")
    code = subprocess.call([str(VENV_PY), "-m", "database.seed"], cwd=ROOT)
    if code != 0:
        sys.exit("  Seeding failed - see the error above.")

    say("\nSetup complete.")
    say("  Start the app:   " + ("run.bat" if os.name == "nt" else "./run.sh") + "   (or: python run.py)")
    say("  Then open:       http://localhost:8000")
    say("  Demo logins:     officer@mplads.demo / head@mplads.demo / agency@mplads.demo / citizen@mplads.demo")
    say("  Password:        Demo@12345")


def main() -> None:
    ap = argparse.ArgumentParser(description="Set up the MPLADS Risk Intelligence Platform")
    ap.add_argument("--phase2", action="store_true", help=argparse.SUPPRESS)
    ap.add_argument("--host"), ap.add_argument("--port"), ap.add_argument("--user"), ap.add_argument("--password")
    ap.add_argument("--dbname")
    ap.add_argument("--yes", action="store_true", help="accept defaults / never prompt (except for a missing password)")
    ap.add_argument("--force", action="store_true", help="recreate .env even if it exists")
    args = ap.parse_args()
    phase2(args) if args.phase2 else phase1(args)


if __name__ == "__main__":
    main()
