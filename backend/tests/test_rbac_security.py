"""Authentication, RBAC and data-exposure tests."""
import jwt
import pytest
from sqlalchemy import text

from backend.app.config import get_settings


def test_login_role_comes_from_database(client, tokens):
    for key, role, home in [("officer", "Officer", "/officer"), ("head", "Head Officer", "/head"),
                            ("agency", "Implementing Agency", "/agency"), ("citizen", "Citizen", "/citizen"),
                            ("mp", "MP", "/mp")]:
        r = client.post("/api/auth/login", json={"identifier": f"{key}@mplads.demo", "password": "Demo@12345"})
        assert r.status_code == 200
        body = r.json()
        assert body["user"]["role"] == role and body["user"]["home_path"] == home
        # the JWT itself never carries a role
        payload = jwt.decode(body["access_token"], options={"verify_signature": False})
        assert "role" not in payload


def test_login_ignores_client_supplied_role(client):
    r = client.post("/api/auth/login", json={"identifier": "citizen@mplads.demo", "password": "Demo@12345", "role": "Head Officer"})
    assert r.status_code == 200 and r.json()["user"]["role"] == "Citizen"


def test_bad_credentials_and_unknown_user(client):
    assert client.post("/api/auth/login", json={"identifier": "citizen@mplads.demo", "password": "nope"}).status_code == 401
    assert client.post("/api/auth/login", json={"identifier": "ghost@mplads.demo", "password": "x"}).status_code == 401


def test_lockout_after_repeated_failures(client):
    for _ in range(get_settings().max_failed_logins):
        client.post("/api/auth/login", json={"identifier": "citizen2@mplads.demo", "password": "wrong"})
    r = client.post("/api/auth/login", json={"identifier": "citizen2@mplads.demo", "password": "Demo@12345"})
    assert r.status_code == 429
    # unlock again for the rest of the test session
    from backend.app.database import SessionLocal
    with SessionLocal() as db:
        db.execute(text("UPDATE users SET locked_until=NULL, failed_attempts=0 WHERE email='citizen2@mplads.demo'"))
        db.commit()


def test_protected_routes_need_a_token(client):
    for path in ["/api/auth/me", "/api/projects", "/api/notifications", "/api/audit-logs", "/api/dashboard", "/api/complaints"]:
        assert client.get(path).status_code == 401, path
    assert client.get("/api/projects", headers={"Authorization": "Bearer garbage"}).status_code == 401


def test_expired_token_rejected(client):
    from datetime import datetime, timedelta, timezone
    s = get_settings()
    tok = jwt.encode({"sub": "1", "jti": "x", "exp": datetime.now(timezone.utc) - timedelta(minutes=1)}, s.jwt_secret, algorithm="HS256")
    r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 401 and "expired" in r.json()["detail"].lower()


def test_forged_role_claim_does_not_escalate(client, tokens):
    s = get_settings()
    uid = jwt.decode(tokens["citizen"], options={"verify_signature": False})["sub"]
    forged = jwt.encode({"sub": uid, "jti": "forged", "role": "Head Officer", "exp": 4102444800}, s.jwt_secret, algorithm="HS256")
    r = client.get("/api/audit-logs", headers={"Authorization": f"Bearer {forged}"})
    assert r.status_code == 403  # still a Citizen according to the database


# ------------------------------------------------ permission matrix
MATRIX = [
    # method, path, {role: expected status class} - anything not listed must be 403
    ("GET", "/api/audit-logs", {"officer", "inspector", "head", "admin", "mp"}),
    ("GET", "/api/audit-logs/summary", {"head", "admin"}),
    ("GET", "/api/audit-logs/verify-chain", {"head", "admin"}),
    ("GET", "/api/extractions", {"officer", "inspector"}),
    ("GET", "/api/inspections", {"officer", "head", "inspector", "mp"}),
    ("GET", "/api/decisions", {"officer", "head", "inspector", "mp"}),
    ("GET", "/api/users", {"admin"}),
    ("GET", "/api/users/inspectors", {"head"}),
    ("GET", "/api/agencies", {"officer", "head", "inspector", "mp"}),
    ("GET", "/api/demo/sample-pdfs", {"officer", "inspector"}),
]


@pytest.mark.parametrize("method,path,allowed", MATRIX)
def test_permission_matrix(client, H, method, path, allowed):
    for role, headers in H.items():
        r = client.request(method, path, headers=headers)
        if role in allowed:
            assert r.status_code == 200, f"{role} should reach {path}: {r.status_code} {r.text[:120]}"
        else:
            assert r.status_code == 403, f"{role} must NOT reach {path}: got {r.status_code}"


def test_write_endpoints_forbidden_outside_role(client, H):
    pid = client.get("/api/projects?page_size=1", headers=H["officer"]).json()["items"][0]["project_id"]
    # upload PDF: officer only
    for role in ("citizen", "agency", "head", "mp"):
        r = client.post("/api/projects/upload-pdf", headers=H[role], files={"file": ("x.pdf", b"%PDF-1.4", "application/pdf")})
        assert r.status_code == 403, role
    # run analysis: officer/head only
    for role in ("citizen", "agency", "mp"):
        assert client.post(f"/api/projects/{pid}/risk-analysis", headers=H[role]).status_code in (403, 404)
    # decisions: officer/head only
    body = {"project_id": pid, "decision": "Keep Under Review", "reason": "some valid reason text", "evidence_reviewed": ["Risk factors"], "action": "x"}
    for role in ("citizen", "agency", "admin", "mp"):
        assert client.post("/api/decisions", headers=H[role], json=body).status_code == 403, role
    # head-only action attempted by an officer
    body2 = {**body, "decision": "Close Review"}
    assert client.post("/api/decisions", headers=H["officer"], json=body2).status_code == 403
    # officer decision attempted by head
    assert client.post("/api/decisions", headers=H["head"], json=body).status_code == 403
    # scheduled checks: head only
    assert client.post("/api/system/run-checks", headers=H["officer"], json={}).status_code == 403
    # inspection assignment: head only
    assert client.post("/api/inspections", headers=H["citizen"], json={"project_id": pid, "reason": "some reason text here"}).status_code == 403


def test_citizen_sees_only_public_project_fields(client, H):
    r = client.get("/api/projects?page_size=100", headers=H["citizen"])
    assert r.status_code == 200
    items = r.json()["items"]
    assert items
    forbidden = {"latest_risk", "case_level", "budget_revisions",
                 "extension_requests", "verification_status", "agency_status", "contributing_factors"}
    for it in items:
        assert not (forbidden & set(it)), forbidden & set(it)
        assert "risk_score" in it
        assert "risk_level" in it
        assert "agency_name" in it
        assert "assigned_officer_name" in it
        assert "public_safe_risk_factors" in it
    d = client.get(f"/api/projects/{items[0]['project_id']}", headers=H["citizen"]).json()
    assert not (forbidden & set(d))
    assert "risk_score" in d
    assert "risk_level" in d
    assert "public_safe_risk_factors" in d
    assert client.get(f"/api/projects/{items[0]['project_id']}/risk", headers=H["citizen"]).status_code == 403


def test_agency_isolated_to_own_projects(client, H):
    mine = client.get("/api/projects", headers=H["agency"]).json()
    other = client.get("/api/projects", headers=H["agency2"]).json()
    mine_ids, other_ids = {p["project_id"] for p in mine["items"]}, {p["project_id"] for p in other["items"]}
    assert mine_ids and other_ids and not (mine_ids & other_ids)
    victim = next(iter(other_ids))
    assert client.get(f"/api/projects/{victim}", headers=H["agency"]).status_code == 404
    assert client.post(f"/api/projects/{victim}/progress-reports", headers=H["agency"],
                       json={"progress": 99, "expenditure": 1}).status_code == 404
    # agency view never contains risk data
    for p in mine["items"]:
        assert "latest_risk" not in p and "case_level" not in p and "status" not in p
    assert client.get(f"/api/projects/{next(iter(mine_ids))}/risk", headers=H["agency"]).status_code == 403


def test_citizen_cannot_read_other_citizens_complaints(client, H):
    mine = client.get("/api/complaints", headers=H["citizen"]).json()["items"]
    theirs = client.get("/api/complaints", headers=H["citizen2"]).json()["items"]
    assert mine and theirs
    mine_ids = {c["complaint_id"] for c in mine}
    other = next(c for c in theirs if c["complaint_id"] not in mine_ids)
    assert client.get(f"/api/complaints/{other['complaint_id']}", headers=H["citizen"]).status_code == 404
    # citizens never receive officer-only fields
    for c in mine:
        assert "screening_note" not in c and "serious" not in c


def test_officer_view_masks_identities(client, H):
    items = client.get("/api/complaints?page_size=100", headers=H["officer"]).json()["items"]
    anon = [c for c in items if c["anonymous"]]
    assert anon and all(c["citizen"] == "Anonymous" for c in anon)
    for c in items:
        assert "@" not in str(c.get("citizen"))
        assert "Ravi Kumar" not in str(c.get("citizen"))


def test_agency_complaint_view_has_no_identity_or_internal_notes(client, H):
    items = client.get("/api/complaints", headers=H["agency"]).json()["items"]
    assert items
    for c in items:
        assert "citizen" not in c and "screening_note" not in c and "anonymous" not in c


def test_notifications_are_private(client, H):
    n = client.get("/api/notifications", headers=H["head"]).json()["items"]
    assert n
    assert client.put(f"/api/notifications/{n[0]['notification_id']}/read", headers=H["citizen"]).status_code == 404


def test_audit_is_immutable_at_database_level(client):
    from backend.app.database import SessionLocal
    from sqlalchemy.exc import DBAPIError
    with SessionLocal() as db:
        with pytest.raises(DBAPIError):
            db.execute(text("UPDATE audit_logs SET reason='tampered' WHERE audit_id=(SELECT min(audit_id) FROM audit_logs)"))
        db.rollback()
        with pytest.raises(DBAPIError):
            db.execute(text("DELETE FROM audit_logs"))
        db.rollback()
        with pytest.raises(DBAPIError):
            db.execute(text("TRUNCATE audit_logs"))
        db.rollback()


def test_logout_revokes_token(client):
    tok = client.post("/api/auth/login", json={"identifier": "officer@mplads.demo", "password": "Demo@12345"}).json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}
    assert client.get("/api/auth/me", headers=h).status_code == 200
    assert client.post("/api/auth/logout", headers=h).status_code == 200
    assert client.get("/api/auth/me", headers=h).status_code == 401


def test_error_responses_do_not_leak_internals(client, H):
    r = client.get("/api/projects/999999", headers=H["officer"])
    assert r.status_code == 404 and "Traceback" not in r.text
    r = client.post("/api/complaints", headers=H["citizen"], data={"category": "bad"})
    assert r.status_code == 422 and "Traceback" not in r.text


def test_mp_role_workflows_and_permissions(client, H):
    # 1. MP Dashboard
    d = client.get("/api/dashboard", headers=H["mp"])
    assert d.status_code == 200
    db_json = d.json()
    assert db_json["role"] == "MP"
    assert "requiring_attention" in db_json["kpis"]
    assert "active_projects" in db_json["kpis"]

    # 2. Non-MP roles cannot manually create projects
    meta = client.get("/api/meta", headers=H["mp"]).json()
    agency_id = meta["agencies"][0]["agency_id"]
    officer_id = meta["officers"][0]["user_id"]
    body = {
        "name": "Community Library Facility",
        "category": "Community Hall",
        "location": "Kothrud, Pune",
        "district": "Pune",
        "constituency": "Pune",
        "agency_id": agency_id,
        "officer_id": officer_id,
        "start_date": "2026-10-01",
        "deadline": "2027-09-30",
        "sanctioned_amount": 3500000,
        "approved_budget": 3500000,
        "released_amount": 1500000,
    }
    for role in ("citizen", "agency", "officer", "head"):
        assert client.post("/api/projects", headers=H[role], json=body).status_code == 403, role

    # 3. MP can create a new project
    created = client.post("/api/projects", headers=H["mp"], json=body)
    assert created.status_code == 201, created.text
    proj = created.json()
    new_pid = proj["project_id"]
    assert proj["name"] == "Community Library Facility"
    assert proj["agency_id"] == agency_id
    assert proj["officer_id"] == officer_id

    # 4. MP can fetch assignments overview
    overview = client.get("/api/projects/assignments-overview", headers=H["mp"])
    assert overview.status_code == 200
    ov_data = overview.json()
    assert any(p["project_id"] == new_pid for p in ov_data["projects"])

    # 5. Non-authorized roles cannot reassign
    second_agency_id = meta["agencies"][1]["agency_id"]
    reassign_body = {
        "agency_id": second_agency_id,
        "reason": "Reassigned for expedited execution under revised constituency plan",
    }
    for role in ("citizen", "agency", "officer"):
        assert client.post(f"/api/projects/{new_pid}/reassign", headers=H[role], json=reassign_body).status_code == 403

    # 6. MP reassigns agency
    r_resp = client.post(f"/api/projects/{new_pid}/reassign", headers=H["mp"], json=reassign_body)
    assert r_resp.status_code == 200, r_resp.text
    assert "assignment updated successfully" in r_resp.json()["message"]

    # Verify updated agency in project detail
    updated_p = client.get(f"/api/projects/{new_pid}", headers=H["mp"]).json()
    assert updated_p["agency_id"] == second_agency_id


def test_citizen_transparency_acceptance_tests(client, H):
    # TEST 1 & TEST 2: Citizen opens projects and verifies visibility of risk and responsibility
    r = client.get("/api/projects?page_size=50", headers=H["citizen"])
    assert r.status_code == 200
    items = r.json()["items"]
    assert items

    # Check that public fields are populated on list
    for p in items:
        assert "project_id" in p
        assert "project_code" in p
        assert "name" in p or "project_name" in p
        assert "progress" in p
        assert "risk_score" in p
        assert "risk_level" in p
        assert "agency_name" in p or "agency" in p
        assert "assigned_officer_name" in p or "officer_name" in p
        assert "public_safe_risk_factors" in p

    # Find a project with risk analysis
    analyzed_p = next((p for p in items if p["risk_score"] is not None), items[0])
    d = client.get(f"/api/projects/{analyzed_p['project_id']}", headers=H["citizen"]).json()
    assert d["project_id"] == analyzed_p["project_id"]
    assert d["name"]
    assert "agency_name" in d or "agency" in d
    assert "assigned_officer_name" in d or "officer_name" in d
    assert "public_safe_risk_factors" in d

    # If analyzed, verify public-safe factors format (no Isolation Forest or model weights)
    if d["risk_score"] is not None:
        assert isinstance(d["public_safe_risk_factors"], list)
        for factor in d["public_safe_risk_factors"]:
            assert "isolation forest" not in factor.lower()
            assert "weight" not in factor.lower()

    # TEST 4: Citizen cannot modify risk score
    pid = items[0]["project_id"]
    r_risk = client.post(f"/api/projects/{pid}/risk-analysis", headers=H["citizen"])
    assert r_risk.status_code in (403, 404)

    # TEST 5: Citizen cannot change agency
    r_reassign_agency = client.post(f"/api/projects/{pid}/reassign", headers=H["citizen"], json={"agency_id": 1, "reason": "hack"})
    assert r_reassign_agency.status_code == 403

    # TEST 6: Citizen cannot change officer
    r_reassign_officer = client.post(f"/api/projects/{pid}/reassign", headers=H["citizen"], json={"officer_id": 1, "reason": "hack"})
    assert r_reassign_officer.status_code == 403

