import pytest
from datetime import date
from backend.app.main import app

def test_citizen_public_transparency_and_inspections(client, H):
    citizen_h = H["citizen"]

    # 1. Test list_projects for citizen
    res_list = client.get("/api/projects", headers=citizen_h)
    assert res_list.status_code == 200, res_list.text
    items = res_list.json()["items"]
    assert len(items) > 0

    # Verify public transparency fields exist on every item
    for item in items:
        assert "risk_score" in item
        assert "risk_level" in item
        assert "monitoring_officer_name" in item
        assert "agency_name" in item

    # Find a project in list that has risk analysis (e.g. MPLADS-PN-204)
    p204 = next((p for p in items if p["project_code"] == "MPLADS-PN-204"), None)
    if p204:
        assert p204["risk_score"] is not None
        assert p204["risk_level"] in ("High", "Critical")
        assert p204["monitoring_officer_name"] is not None
        assert p204["agency_name"] is not None

        # 2. Test project_detail for citizen
        res_detail = client.get(f"/api/projects/{p204['project_id']}", headers=citizen_h)
        assert res_detail.status_code == 200, res_detail.text
        d = res_detail.json()
        assert d["risk_score"] is not None
        assert d["risk_level"] in ("High", "Critical")
        assert d["risk_updated_at"] is not None
        assert d["monitoring_officer_name"] is not None
        assert d["agency_name"] is not None
        assert "inspections" in d

        # Check inspections structure
        for insp in d["inspections"]:
            assert "inspection_id" in insp
            assert "inspection_status" in insp
            assert "inspector_name" in insp
            assert "public_visibility" in insp
            assert "inspection_images" in insp

    # 3. Security: Citizens must NOT be able to modify inspections or create inspections
    res_post_insp = client.post("/api/inspections", headers=citizen_h, json={"project_id": 1, "reason": "Test", "priority": "Low"})
    assert res_post_insp.status_code == 403

    # Citizens must NOT be able to view internal audit logs or run risk recalculation
    assert client.get("/api/audit-logs", headers=citizen_h).status_code == 403
    assert client.post("/api/system/run-checks", headers=citizen_h).status_code == 403


def test_part22_test_a_inspection_lifecycle(client, H):
    """TEST A: Complete inspection workflow from Officer submission to Citizen visibility."""
    officer_h = H["officer"]
    head_h = H["head"]
    inspector_h = H["inspector"]
    citizen_h = H["citizen"]

    # Get inspector user_id
    inspectors = client.get("/api/users/inspectors", headers=head_h).json()
    insp_user = next((i for i in inspectors if i.get("name") == "Rahul Kulkarni"), inspectors[0])

    # 1. Request an inspection as Officer
    res_req = client.post("/api/inspections", headers=officer_h, json={
        "project_id": 1,
        "reason": "Routine physical quality and progress inspection",
        "priority": "Medium",
    })
    assert res_req.status_code == 201, res_req.text
    insp_id = res_req.json()["inspection_id"]

    # 1b. Head Officer assigns the inspector
    res_assign = client.put(f"/api/inspections/{insp_id}", headers=head_h, json={
        "action": "assign",
        "inspector_id": insp_user["user_id"],
    })
    assert res_assign.status_code == 200, res_assign.text
    assert res_assign.json()["status"] == "Assigned"

    # 2. Inspector schedules and marks completed
    res_sched = client.put(f"/api/inspections/{insp_id}", headers=inspector_h, json={
        "action": "schedule",
        "scheduled_date": str(date.today()),
    })
    assert res_sched.status_code == 200, res_sched.text
    res_comp = client.put(f"/api/inspections/{insp_id}", headers=inspector_h, json={
        "action": "complete",
        "note": "Field audit conducted on site.",
    })
    assert res_comp.status_code == 200, res_comp.text
    assert res_comp.json()["status"] == "Completed"

    # 3. Submit inspection report requiring action -> Status should become Action Pending
    res_sub = client.put(f"/api/inspections/{insp_id}", headers=inspector_h, json={
        "action": "submit_report",
        "findings": "Physical verification completed. Foundations conform to technical drawings, but drainage ditch requires widening.",
        "recommendation": "Contractor must widen drainage ditch by 0.5m before monsoon.",
        "outcome": "Minor Deficiencies",
        "progress_observed": 45,
        "issues": "Drainage width insufficient per flood guidelines.",
        "action_required": "Widen drainage culverts to sanctioned 1.5m width.",
        "responsible_party": "Civil Works Agency",
    })
    assert res_sub.status_code == 200, res_sub.text
    sub_data = res_sub.json()
    assert sub_data["status"] == "Action Pending"
    assert sub_data["action_required"] == "Widen drainage culverts to sanctioned 1.5m width."

    # 4. Record action taken
    res_act = client.put(f"/api/inspections/{insp_id}", headers=officer_h, json={
        "action": "record_action",
        "action_taken": "Contractor widened culverts to 1.5m; verified by assistant engineer.",
    })
    assert res_act.status_code == 200, res_act.text
    act_data = res_act.json()
    assert "widened culverts" in act_data["action_taken"]

    # 5. Close inspection
    res_close = client.put(f"/api/inspections/{insp_id}", headers=officer_h, json={
        "action": "close",
        "closure_reason": "Corrective action verified and compliant with safety specifications.",
    })
    assert res_close.status_code == 200, res_close.text
    close_data = res_close.json()
    assert close_data["status"] == "Closed"
    assert close_data["closure_reason"] == "Corrective action verified and compliant with safety specifications."

    # 6. Verify Citizen public view shows the inspection and all public-safe details
    res_pub = client.get("/api/projects/1", headers=citizen_h)
    assert res_pub.status_code == 200, res_pub.text
    pub_p = res_pub.json()
    matching_insp = next((i for i in pub_p["inspections"] if i["inspection_id"] == insp_id), None)
    assert matching_insp is not None
    assert matching_insp["inspection_status"] == "Closed"
    assert matching_insp["progress_observed"] == 45
    assert matching_insp["public_findings"] is not None
    assert "Foundations conform" in matching_insp["public_findings"]
    assert matching_insp["action_required"] == "Widen drainage culverts to sanctioned 1.5m width."
    assert "widened culverts" in matching_insp["action_taken"]
    assert matching_insp["closure_reason"] == "Corrective action verified and compliant with safety specifications."


def test_part22_test_b_risk_transparency(client, H):
    """TEST B: Risk analysis transparency and genuinely unanalyzed fallback."""
    citizen_h = H["citizen"]
    mp_h = H["mp"]

    # 1. Project with existing risk analysis returns real score and level
    res_list = client.get("/api/projects", headers=citizen_h)
    items = res_list.json()["items"]
    analyzed = [p for p in items if p.get("risk_score") is not None]
    assert len(analyzed) > 0, "Expected at least one analyzed project"

    p = analyzed[0]
    assert p["risk_score"] >= 0
    assert p["risk_level"] in ("Low", "Medium", "High", "Critical")

    res_detail = client.get(f"/api/projects/{p['project_id']}", headers=citizen_h)
    assert res_detail.status_code == 200
    d = res_detail.json()
    assert d["risk_score"] == p["risk_score"]
    assert d["risk_level"] == p["risk_level"]
    assert d["risk_updated_at"] is not None

    # Check that public safe risk factors do not leak technical ML anomaly details
    safe_factors = d.get("public_safe_risk_factors", [])
    for factor in safe_factors:
        assert "isolation forest" not in factor.lower()

    # 2. Genuinely unanalyzed project returns None
    unanalyzed = next((p for p in items if p.get("risk_score") is None), None)
    if unanalyzed:
        res_un = client.get(f"/api/projects/{unanalyzed['project_id']}", headers=citizen_h)
        assert res_un.status_code == 200
        un_d = res_un.json()
        assert un_d["risk_score"] is None
        assert un_d["risk_level"] is None


def test_part22_test_c_public_transparency_summary(client, H):
    """TEST C: Verify all required public transparency elements are present for citizens."""
    citizen_h = H["citizen"]
    res = client.get("/api/projects/1", headers=citizen_h)
    assert res.status_code == 200, res.text
    d = res.json()

    # Project identity
    assert "project_id" in d
    assert "project_code" in d
    assert "name" in d
    assert "category" in d
    assert "district" in d
    assert "constituency" in d

    # Accountability & responsibility
    assert "agency_name" in d
    assert "monitoring_officer_name" in d
    assert "project_initiator" in d

    # Progress & Finances
    assert "progress" in d
    assert "sanctioned_amount" in d
    assert "approved_budget" in d
    assert "released_amount" in d
    assert "expenditure" in d

    # Inspection reports
    assert "inspections" in d
    assert isinstance(d["inspections"], list)

    # Agency requests & decisions
    assert "agency_requests" in d
    assert "decisions" in d

    # Complaints public-safe summary
    assert "complaints_summary" in d
    cs = d["complaints_summary"]
    assert "total" in cs
    assert "resolved" in cs
    assert "open" in cs

    # Weekly reports
    assert "weekly_reports" in d
    assert "weekly_report_status" in d

    # Public media & Recent changes & Last updated
    assert "public_media" in d
    assert "recent_public_changes" in d
    assert "last_updated" in d
    lu = d["last_updated"]
    assert "project" in lu
    assert "financial" in lu
    assert "inspection" in lu
    assert "risk_analysis" in lu

    # Public project timeline
    assert "timeline" in d
    assert isinstance(d["timeline"], list)

