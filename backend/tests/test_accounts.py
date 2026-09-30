"""Citizen self-signup and administrator user management."""
import pytest

from backend.app.config import get_settings
from backend.app.security import password_problem

PW = "Sup3rSecret"


def signup(client, **over):
    body = {"name": "Test Citizen", "email": "new.citizen@example.org", "password": PW, **over}
    return client.post("/api/auth/register", json=body)


def login(client, email, password):
    return client.post("/api/auth/login", json={"identifier": email, "password": password})


def auth(tok):
    return {"Authorization": f"Bearer {tok}"}


def test_password_policy():
    assert password_problem("short1") and password_problem("longpasswordnodigits") and password_problem("123456789")
    assert password_problem("Demo@12345") is None and password_problem("abc12345") is None


def test_signup_creates_citizen_and_logs_in(client):
    r = signup(client)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["user"]["role"] == "Citizen" and body["user"]["home_path"] == "/citizen"
    assert "password" not in str(body).lower().replace("permissions", "")
    assert client.get("/api/auth/me", headers=auth(body["access_token"])).json()["email"] == "new.citizen@example.org"
    assert client.get("/api/projects", headers=auth(body["access_token"])).status_code == 200
    # a brand-new citizen has no access to staff functionality
    for path in ("/api/audit-logs", "/api/extractions", "/api/users", "/api/decisions"):
        assert client.get(path, headers=auth(body["access_token"])).status_code == 403, path
    assert login(client, "new.citizen@example.org", PW).status_code == 200


def test_signup_can_never_choose_a_role(client):
    r = signup(client, email="sneaky@example.org", role="Head Officer", agency_id=1, is_inspector=True)
    assert r.status_code == 201
    assert r.json()["user"]["role"] == "Citizen" and r.json()["user"]["agency_id"] is None
    assert client.get("/api/audit-logs", headers=auth(r.json()["access_token"])).status_code == 403


def test_signup_validation(client):
    assert signup(client, email="a@example.org", password="short1").status_code == 422
    assert signup(client, email="b@example.org", password="nodigitshere").status_code == 422
    assert signup(client, email="not-an-email").status_code == 422
    assert signup(client, email="c@example.org", name="x").status_code == 422
    r = signup(client, email="new.citizen@example.org")            # duplicate
    assert r.status_code == 409
    assert signup(client, email="NEW.Citizen@Example.org").status_code == 409     # case-insensitive


def test_signup_can_be_disabled_and_is_rate_limited(client, monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "allow_signup", False)
    assert signup(client, email="off@example.org").status_code == 403
    monkeypatch.setattr(s, "allow_signup", True)
    monkeypatch.setattr(s, "signup_limit_per_hour", 0)
    assert signup(client, email="limited@example.org").status_code == 429
    assert client.get("/api/auth/config").json()["signup_enabled"] is True


# ------------------------------------------------ admin user management
def test_only_admin_can_manage_users(client, H):
    body = {"name": "Nope User", "email": "nope@example.org", "role": "Officer"}
    for role in ("citizen", "agency", "officer", "head", "inspector"):
        assert client.post("/api/users", headers=H[role], json=body).status_code == 403, role
        assert client.get("/api/users", headers=H[role]).status_code == 403, role
        assert client.put("/api/users/1", headers=H[role], json={"status": "Disabled"}).status_code == 403, role
        assert client.post("/api/users/1/reset-password", headers=H[role], json={}).status_code == 403, role


def test_admin_creates_users_with_generated_or_chosen_password(client, H):
    r = client.post("/api/users", headers=H["admin"], json={"name": "New Officer", "email": "new.officer@example.org",
                                                              "role": "Officer", "department": "Field Wing", "is_inspector": True})
    assert r.status_code == 201, r.text
    u = r.json()
    temp = u["temporary_password"]
    assert password_problem(temp) is None and u["is_inspector"] is True and "password_hash" not in u
    ok = login(client, "new.officer@example.org", temp)
    assert ok.status_code == 200 and ok.json()["user"]["role"] == "Officer"
    assert client.get("/api/extractions", headers=auth(ok.json()["access_token"])).status_code == 200
    # inspector shows up for the head officer's assignment list
    assert any(i["name"] == "New Officer" for i in client.get("/api/users/inspectors", headers=H["head"]).json())

    r = client.post("/api/users", headers=H["admin"], json={"name": "Chosen Pw", "email": "chosen@example.org", "role": "Head Officer", "password": "Chosen123"})
    assert r.status_code == 201 and "temporary_password" not in r.json()
    assert login(client, "chosen@example.org", "Chosen123").status_code == 200
    assert client.post("/api/users", headers=H["admin"], json={"name": "Weak Pw", "email": "weak@example.org", "role": "Officer", "password": "weak"}).status_code == 422
    assert client.post("/api/users", headers=H["admin"], json={"name": "Dup", "email": "NEW.OFFICER@example.org", "role": "Officer"}).status_code == 409


def test_agency_users_need_an_agency_and_stay_scoped(client, H):
    meta = client.get("/api/meta", headers=H["admin"]).json()
    agency = next(a for a in meta["agencies"] if a["name"] == "Kolhapur Municipal Works")
    assert client.post("/api/users", headers=H["admin"], json={"name": "No Agency", "email": "na@example.org", "role": "Implementing Agency"}).status_code == 422
    assert client.post("/api/users", headers=H["admin"], json={"name": "Bad Agency", "email": "ba@example.org", "role": "Implementing Agency", "agency_id": 9999}).status_code == 422
    r = client.post("/api/users", headers=H["admin"], json={"name": "Kolhapur Clerk", "email": "kolhapur.clerk@example.org",
                                                              "role": "Implementing Agency", "agency_id": agency["agency_id"]})
    assert r.status_code == 201
    tok = login(client, "kolhapur.clerk@example.org", r.json()["temporary_password"]).json()["access_token"]
    projects = client.get("/api/projects", headers=auth(tok)).json()["items"]
    assert projects and all(p["agency"] == "Kolhapur Municipal Works" for p in projects)
    # non-agency roles never keep an agency; only officers can be inspectors
    r = client.post("/api/users", headers=H["admin"], json={"name": "Cit With Agency", "email": "cwa@example.org", "role": "Citizen",
                                                              "agency_id": agency["agency_id"], "is_inspector": True})
    assert r.json()["agency_id"] is None and r.json()["is_inspector"] is False


def test_role_change_and_disable_take_effect_immediately(client, H):
    uid = signup(client, email="promote.me@example.org").json()["user"]["user_id"]
    tok = login(client, "promote.me@example.org", PW).json()["access_token"]
    assert client.get("/api/audit-logs", headers=auth(tok)).status_code == 403
    r = client.put(f"/api/users/{uid}", headers=H["admin"], json={"role": "Officer", "department": "Cell", "reason": "Joined the cell"})
    assert r.status_code == 200 and r.json()["role"] == "Officer"
    assert client.get("/api/audit-logs", headers=auth(tok)).status_code == 200            # same token, new role from the DB
    r = client.put(f"/api/users/{uid}", headers=H["admin"], json={"status": "Disabled"})
    assert r.json()["status"] == "Disabled"
    assert client.get("/api/auth/me", headers=auth(tok)).status_code == 401              # existing session dies at once
    assert login(client, "promote.me@example.org", PW).status_code == 401
    assert client.put(f"/api/users/{uid}", headers=H["admin"], json={"status": "Active"}).status_code == 200
    assert login(client, "promote.me@example.org", PW).status_code == 200


def test_admin_cannot_lock_themselves_out(client, H):
    me = next(u for u in client.get("/api/users", headers=H["admin"]).json() if u["email"] == "admin@mplads.demo")
    assert client.put(f"/api/users/{me['user_id']}", headers=H["admin"], json={"status": "Disabled"}).status_code == 409
    assert client.put(f"/api/users/{me['user_id']}", headers=H["admin"], json={"role": "Officer"}).status_code == 409
    assert client.put("/api/users/999999", headers=H["admin"], json={"status": "Disabled"}).status_code == 404
    # the last active admin can never be removed by someone else either
    a2 = client.post("/api/users", headers=H["admin"], json={"name": "Second Admin", "email": "admin2@example.org", "role": "Admin", "password": "Admin2pass1"}).json()
    tok2 = login(client, "admin2@example.org", "Admin2pass1").json()["access_token"]
    assert client.put(f"/api/users/{me['user_id']}", headers=auth(tok2), json={"status": "Disabled"}).status_code == 200
    assert client.put(f"/api/users/{me['user_id']}", headers=auth(tok2), json={"status": "Active"}).status_code == 200


def test_password_reset(client, H):
    uid = signup(client, email="forgot@example.org").json()["user"]["user_id"]
    r = client.post(f"/api/users/{uid}/reset-password", headers=H["admin"], json={})
    assert r.status_code == 200
    temp = r.json()["temporary_password"]
    assert password_problem(temp) is None
    assert login(client, "forgot@example.org", PW).status_code == 401
    assert login(client, "forgot@example.org", temp).status_code == 200
    r = client.post(f"/api/users/{uid}/reset-password", headers=H["admin"], json={"new_password": "Another1Pass"})
    assert r.json()["temporary_password"] is None and login(client, "forgot@example.org", "Another1Pass").status_code == 200
    assert client.post(f"/api/users/{uid}/reset-password", headers=H["admin"], json={"new_password": "bad"}).status_code == 422
    # change-password also enforces the policy
    tok = login(client, "forgot@example.org", "Another1Pass").json()["access_token"]
    assert client.post("/api/auth/change-password", headers=auth(tok), json={"current_password": "Another1Pass", "new_password": "onlyletters"}).status_code == 422


def test_account_events_are_audited_without_passwords(client, H):
    logs = client.get("/api/audit-logs?page_size=100", headers=H["admin"]).json()["items"]
    actions = {a["action"] for a in logs}
    for needed in ("Account Registered", "User Created", "User Disabled", "User Enabled", "User Role Changed", "Password Reset"):
        assert needed in actions, (needed, sorted(actions))
    blob = str([a["new_value"] for a in logs if a["action"] in ("User Created", "Password Reset", "Account Registered")])
    assert PW not in blob and "Chosen123" not in blob and "Another1Pass" not in blob
    assert client.get("/api/audit-logs/verify-chain", headers=H["head"]).json()["valid"] is True


def test_user_list_filters(client, H):
    officers = client.get("/api/users?role=Officer", headers=H["admin"]).json()
    assert officers and all(u["role"] == "Officer" for u in officers)
    assert all("password_hash" not in u for u in officers)
    hits = client.get("/api/users?q=anita", headers=H["admin"]).json()
    assert len(hits) == 1 and hits[0]["email"] == "officer@mplads.demo"
