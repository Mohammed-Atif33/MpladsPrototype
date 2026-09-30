"""Test harness: uses a SEPARATE database (mplads_test) and a temp upload dir so the dev data is untouched."""
import os
import re
import shutil
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
_env = (ROOT / ".env").read_text(encoding="utf-8") if (ROOT / ".env").exists() else ""
_m = re.search(r"^DATABASE_URL=(.+)$", _env, re.M)
_base = os.environ.get("TEST_BASE_URL") or (_m.group(1).strip() if _m else "postgresql+psycopg2://postgres:postgres@localhost:5432/mplads")
TEST_URL = re.sub(r"/[^/]+$", "/mplads_test", _base)
os.environ["DATABASE_URL"] = TEST_URL
os.environ["UPLOAD_DIR"] = tempfile.mkdtemp(prefix="mplads_uploads_")
os.environ["SEED_ON_STARTUP"] = "false"
os.environ["ENABLE_SCHEDULER"] = "false"
os.environ["DEMO_PASSWORD"] = "Demo@12345"
os.environ["APP_ENV"] = "development"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture(scope="session")
def client():
    from database.seed import init_database
    init_database(reset=True, seed=True)
    from backend.app.main import app
    with TestClient(app) as c:
        yield c
    shutil.rmtree(os.environ["UPLOAD_DIR"], ignore_errors=True)


PASSWORD = "Demo@12345"


@pytest.fixture(scope="session")
def tokens(client):
    out = {}
    for key, email in {"officer": "officer@mplads.demo", "head": "head@mplads.demo", "agency": "agency@mplads.demo",
                       "agency2": "agency2@mplads.demo", "citizen": "citizen@mplads.demo", "citizen2": "citizen2@mplads.demo",
                       "inspector": "inspector@mplads.demo", "admin": "admin@mplads.demo", "mp": "mp@mplads.demo"}.items():
        r = client.post("/api/auth/login", json={"identifier": email, "password": PASSWORD})
        assert r.status_code == 200, r.text
        out[key] = r.json()["access_token"]
    return out


@pytest.fixture(scope="session")
def H(tokens):
    return {k: {"Authorization": f"Bearer {v}"} for k, v in tokens.items()}
