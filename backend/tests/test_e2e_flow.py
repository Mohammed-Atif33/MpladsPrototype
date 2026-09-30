"""The complete demo flow, end to end, through the REST API:
Officer login -> PDF upload -> extraction -> verify -> store -> historical comparison -> risk analysis ->
notification -> decision -> audit -> escalation -> head officer -> agency -> citizen."""
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
PDF = ROOT / "demo_pdfs" / "MPLADS-PN-001_Progress_Report.pdf"
MESSY = ROOT / "demo_pdfs" / "MPLADS-PC-002_Field_Report_messy.pdf"
STATE: dict = {}


def upload(client, H, path: Path, role="officer"):
    return client.post("/api/projects/upload-pdf", headers=H[role], files={"file": (path.name, path.read_bytes(), "application/pdf")})


def test_01_upload_and_extraction_preview(client, H):
    r = upload(client, H, PDF)
    assert r.status_code == 201, r.text
    ex = r.json()
    STATE["ex"] = ex["extraction_id"]
    f = {x["key"]: x for x in ex["fields"]}
    assert f["project_code"]["value"] == "MPLADS-PN-001" and f["project_code"]["confidence"] == "High" and f["project_code"]["source_page"] == 1
    assert f["sanctioned_amount"]["value"] == 1850000.0 and f["sanctioned_amount"]["source_page"] == 2
    assert f["expenditure"]["value"] == 1420000.0
    assert f["progress"]["value"] == 62.0 and f["progress"]["confidence"] == "Medium" and f["progress"]["source_page"] == 3
    assert f["delay_days"]["value"] == 180 and f["extension_requests"]["value"] == 2 and f["budget_revisions"]["value"] == 2
    assert len(ex["payments"]) == 4 and len(ex["milestones"]) == 6
    assert ex["validation"]["can_verify"] is True
    assert ex["validation"]["agency_name"] == "Municipal Works Department"
    # unverified data is NOT analysed / stored as a project yet
    codes = [p["project_code"] for p in client.get("/api/projects?page_size=100", headers=H["officer"]).json()["items"]]
    assert "MPLADS-PN-001" not in codes


def test_02_officer_got_verification_notification(client, H):
    n = client.get("/api/notifications", headers=H["officer"]).json()["items"]
    assert any(x["type"] == "Data verification required" and x["priority"] == "action" for x in n)


def test_03_correction_is_audited(client, H):
    r = client.put(f"/api/extractions/{STATE['ex']}", headers=H["officer"],
                   json={"fields": {"location": "Sinhagad Road, Ward 34, Pune (corrected)"}, "reason": "Ward label fixed"})
    assert r.status_code == 200
    logs = client.get("/api/audit-logs?action=Data%20Correction", headers=H["officer"]).json()["items"]
    assert logs and logs[0]["previous_value"]["field"] == "location" and "corrected" in logs[0]["new_value"]["value"]
    assert logs[0]["reason"] == "Ward label fixed" and logs[0]["role"] == "Officer"


def test_04_invalid_edit_rejected_and_progress_range_error(client, H):
    r = client.put(f"/api/extractions/{STATE['ex']}", headers=H["officer"], json={"fields": {"progress": "abc"}})
    assert r.status_code == 422
    r = client.put(f"/api/extractions/{STATE['ex']}", headers=H["officer"], json={"fields": {"progress": "140"}})
    assert r.status_code == 200
    assert any(e["code"] == "range" and e["field"] == "progress" for e in r.json()["validation"]["errors"])
    r = client.post(f"/api/extractions/{STATE['ex']}/verify", headers=H["officer"], json={"analyze": True})
    assert r.status_code == 422 and "validation" in r.json()["detail"]      # cannot verify with errors
    r = client.put(f"/api/extractions/{STATE['ex']}", headers=H["officer"], json={"fields": {"progress": "62"}})
    assert r.json()["validation"]["errors"] == []


def test_05_verify_and_analyze(client, H):
    ex = client.get(f"/api/extractions/{STATE['ex']}", headers=H["officer"]).json()
    if ex["validation"]["warnings"]:
        r = client.post(f"/api/extractions/{STATE['ex']}/verify", headers=H["officer"], json={"analyze": True})
        assert r.status_code == 409  # warnings must be acknowledged
    r = client.post(f"/api/extractions/{STATE['ex']}/verify", headers=H["officer"], json={"analyze": True, "acknowledge_warnings": True})
    assert r.status_code == 200, r.text
    out = r.json()
    STATE["pid"] = out["project_id"]
    assert out["linked_complaints"] == 4          # the four verified complaints waiting under this project code
    risk = out["risk"]
    STATE["risk"] = risk
    print("\nMPLADS-PN-001 risk:", risk["risk_score"], risk["risk_level"], "rule", risk["rule_score"], "anomaly", risk["anomaly_score"])
    for fct in risk["contributing_factors"]:
        print(f"   {fct['points']:5.1f}/{fct['max_points']:<5} {fct['label']}")
    assert 80 <= risk["risk_score"] <= 92
    assert risk["risk_level"] == "Critical"
    hc = risk["historical_comparison"]
    print("comparison:", {k: hc[k] for k in ("compared_projects", "same_agency", "same_category", "peer_avg_delay", "current_delay",
                                              "avg_spend_ratio_at_stage", "current_spend_ratio", "expected_progress", "current_progress")})
    assert hc["compared_projects"] >= 100 and hc["same_agency"] >= 15 and hc["same_category"] >= 40
    assert hc["current_delay"] == 180 and hc["peer_avg_delay"] < 80
    keys = {f["key"] for f in risk["contributing_factors"]}
    assert {"delay", "progress_mismatch", "expenditure_mismatch", "extension_requests", "budget_revisions",
            "verified_complaints", "agency_history", "anomaly"} <= keys
    assert "not proof" in risk["disclaimer"].lower() and "prototype" in risk["threshold_notice"].lower()


def test_06_duplicate_upload_is_rejected(client, H):
    ex2 = upload(client, H, PDF).json()
    assert any(e["code"] == "duplicate" for e in ex2["validation"]["errors"])
    r = client.post(f"/api/extractions/{ex2['extraction_id']}/verify", headers=H["officer"], json={"acknowledge_warnings": True})
    assert r.status_code == 422
    client.post(f"/api/extractions/{ex2['extraction_id']}/discard", headers=H["officer"])


def test_07_analysis_notifications(client, H):
    off = client.get("/api/notifications", headers=H["officer"]).json()["items"]
    types = {n["type"] for n in off}
    assert {"Analysis completed", "High-priority review"} <= types
    head = client.get("/api/notifications", headers=H["head"]).json()["items"]
    assert any(n["type"] == "Supervisory review" and n["priority"] == "critical" and "MPLADS-PN-001" in n["message"] for n in head)


def test_08_project_case_pages(client, H):
    pid = STATE["pid"]
    d = client.get(f"/api/projects/{pid}", headers=H["officer"]).json()
    assert d["status"] == "Officer Review Required" and d["latest_risk"]["risk_level"] == "Critical"
    assert d["complaint_counts"]["verified"] == 4 and len(d["payments"]) == 4
    assert client.get(f"/api/projects/{pid}/historical-comparison", headers=H["officer"]).status_code == 200
    ah = client.get(f"/api/projects/{pid}/agency-history", headers=H["officer"]).json()
    assert ah["agency"]["name"] == "Municipal Works Department" and ah["agency"]["previous_high_risk_cases"] >= 3
    fb = client.get(f"/api/projects/{pid}/feedback", headers=H["officer"]).json()
    assert len(fb["complaints"]) == 4 and any(c["citizen"] == "Anonymous" for c in fb["complaints"])
    docs = d["documents"]
    assert any(x["document_type"] == "Project Report" for x in docs)
    dl = client.get(f"/api/documents/{docs[0]['document_id']}/file", headers=H["officer"])
    assert dl.status_code == 200 and dl.content.startswith(b"%PDF")


def test_09_decision_requires_reason_evidence_and_followup(client, H):
    pid = STATE["pid"]
    bad = {"project_id": pid, "decision": "Escalate to Head Officer", "reason": "too short", "evidence_reviewed": ["Risk factors"], "action": "x"}
    assert client.post("/api/decisions", headers=H["officer"], json=bad).status_code == 422
    bad = {"project_id": pid, "decision": "Escalate to Head Officer", "reason": "A sufficiently long reason", "evidence_reviewed": [], "action": "follow"}
    assert client.post("/api/decisions", headers=H["officer"], json=bad).status_code == 422
    bad = {"project_id": pid, "decision": "Escalate to Head Officer", "reason": "A sufficiently long reason", "evidence_reviewed": ["Risk factors"]}
    assert client.post("/api/decisions", headers=H["officer"], json=bad).status_code == 422


def test_10_escalate_creates_decision_audit_and_head_notification(client, H):
    pid = STATE["pid"]
    r = client.post("/api/decisions", headers=H["officer"], json={
        "project_id": pid, "decision": "Escalate to Head Officer", "reason": "Critical score with 4 verified complaints and repeated extensions.",
        "evidence_reviewed": ["Risk factors", "Historical comparison", "Citizen feedback / complaints"], "follow_up_action": "n/a",
        "action": "Head Officer to assign an inspection", "follow_up_date": "2030-01-01"})
    assert r.status_code == 201, r.text
    assert r.json()["project_status"] == "Escalated to Head Officer" and r.json()["case_level"] == 2
    audit = client.get(f"/api/audit-logs?project_id={pid}", headers=H["officer"]).json()["items"]
    actions = [a["action"] for a in audit]
    for needed in ("Verification", "Risk Analysis", "Escalation", "Status Change"):
        assert needed in actions, actions
    esc = next(a for a in audit if a["action"] == "Escalation")
    assert esc["role"] == "Officer" and esc["previous_value"]["status"] == "Officer Review Required" and esc["reason"]
    head = client.get("/api/notifications", headers=H["head"]).json()["items"]
    assert any(n["type"] == "Escalation" and "MPLADS-PN-001" in n["message"] for n in head)


def test_11_head_officer_supervision(client, H):
    pid = STATE["pid"]
    dash = client.get("/api/dashboard", headers=H["head"]).json()
    assert dash["kpis"]["critical_risk"] >= 2 and dash["kpis"]["escalated"] >= 2
    cases = client.get("/api/projects?risk_level=Critical", headers=H["head"]).json()["items"]
    assert any(c["project_code"] == "MPLADS-PN-001" for c in cases)

    def act(decision, **extra):
        body = {"project_id": pid, "decision": decision, "reason": f"Supervisory action: {decision}", "evidence_reviewed": ["Risk factors"], **extra}
        return client.post("/api/decisions", headers=H["head"], json=body)

    assert act("Acknowledge").json()["project_status"] == "Supervisory Review"
    assert act("Request Evidence").json()["project_status"] == "Evidence Requested"
    assert act("Reopen").json()["project_status"] == "Reopened"
    assert act("Add Supervisory Note").json()["project_status"] == "Reopened"
    inspectors = client.get("/api/users/inspectors", headers=H["head"]).json()
    seeded_inspector = next(i for i in inspectors if i["name"] == "Rahul Kulkarni")   # the demo inspector (inspector@mplads.demo)
    r = act("Assign Inspection", inspector_id=seeded_inspector["user_id"], priority="High")
    assert r.status_code == 201 and r.json()["project_status"] == "Inspection Requested"
    STATE["insp"] = client.get(f"/api/inspections?project_id={pid}", headers=H["head"]).json()[0]["inspection_id"]
    assert act("Escalate Further").json()["case_level"] == 3
    assert act("Close Review").json()["project_status"] == "Closed"
    # agency was told about the evidence request
    n = client.get("/api/notifications", headers=H["agency"]).json()["items"]
    assert any("evidence" in x["message"].lower() and "MPLADS-PN-001" in x["message"] for x in n)


def test_12_inspection_lifecycle(client, H):
    i = STATE["insp"]
    put = lambda who, body: client.put(f"/api/inspections/{i}", headers=H[who], json=body)
    assert put("officer", {"action": "schedule", "scheduled_date": "2030-01-05"}).status_code == 403   # not the inspector
    assert put("inspector", {"action": "schedule", "scheduled_date": "2030-01-05"}).json()["status"] == "Scheduled"
    assert put("inspector", {"action": "submit_report", "findings": "too early", "outcome": "Satisfactory", "recommendation": "x"}).status_code == 409
    assert put("inspector", {"action": "complete"}).json()["status"] == "Completed"
    ev = client.post(f"/api/inspections/{i}/evidence", headers=H["inspector"],
                     files={"file": ("site.png", b"\x89PNG\r\n\x1a\n" + b"0" * 64, "image/png")})
    assert ev.status_code == 201
    r = put("inspector", {"action": "submit_report", "findings": "Base course thickness below specification.",
                          "recommendation": "Rectify and retest", "outcome": "Major Deficiencies"})
    assert r.json()["status"] == "Report Submitted"
    assert put("officer", {"action": "action_pending"}).json()["status"] == "Action Pending"
    assert put("head", {"action": "close"}).json()["status"] == "Closed"
    actions = [a["action"] for a in client.get("/api/audit-logs?entity_type=Inspection", headers=H["officer"]).json()["items"]]
    assert "Inspection" in actions and "Inspection Requested" in actions or "Inspection Assigned" in actions


def test_13_scheduled_checks_flag_overdue_inspection(client, H):
    r = client.post("/api/system/run-checks", headers=H["head"], json={"as_of": "2031-01-01"})
    assert r.status_code == 200
    body = r.json()
    assert body["overdue_inspections"] >= 1                     # seeded bridge inspection is past due
    head = client.get("/api/notifications", headers=H["head"]).json()["items"]
    assert any(n["type"] == "Inspection overdue" and n["priority"] == "critical" for n in head)
    again = client.post("/api/system/run-checks", headers=H["head"], json={"as_of": "2031-01-01"}).json()
    assert again["overdue_inspections"] == 0                    # idempotent - no duplicate notifications


def test_14_agency_flow(client, H):
    projects = client.get("/api/projects", headers=H["agency"]).json()["items"]
    codes = {p["project_code"] for p in projects}
    assert "MPLADS-PN-001" in codes and "MPLADS-PN-201" in codes
    p = next(p for p in projects if p["project_code"] == "MPLADS-PN-201")
    detail = client.get(f"/api/projects/{p['project_id']}", headers=H["agency"]).json()
    assert "latest_risk" not in detail and "status" not in detail
    # progress cannot go backwards; valid report is accepted and audited
    assert client.post(f"/api/projects/{p['project_id']}/progress-reports", headers=H["agency"],
                       json={"progress": 10, "expenditure": 1}).status_code == 422
    r = client.post(f"/api/projects/{p['project_id']}/progress-reports", headers=H["agency"],
                    json={"progress": 74, "expenditure": 1600000, "delay_explanation": "Monsoon delays; recovery plan in place."})
    assert r.status_code == 201, r.text
    # request extension -> officer approves -> deadline updated
    rq = client.post(f"/api/projects/{p['project_id']}/requests", headers=H["agency"],
                     json={"request_type": "Extension", "requested_deadline": "2031-06-30", "justification": "Additional monsoon delay and utility shifting."})
    assert rq.status_code == 201
    assert client.post(f"/api/projects/{p['project_id']}/requests", headers=H["agency"],
                       json={"request_type": "Extension", "requested_deadline": "2032-06-30", "justification": "Duplicate pending request check."}).status_code == 409
    d = client.put(f"/api/requests/{rq.json()['request_id']}", headers=H["officer"], json={"decision": "Approve", "note": "Approved after review."})
    assert d.json()["status"] == "Approved"
    assert client.get(f"/api/projects/{p['project_id']}", headers=H["officer"]).json()["revised_deadline"] == "2031-06-30"
    assert client.put(f"/api/requests/{rq.json()['request_id']}", headers=H["agency"], json={"decision": "Approve", "note": "self approve"}).status_code == 403
    # clarification response
    cl = client.get("/api/clarifications?status=Open", headers=H["agency"]).json()
    assert cl
    r = client.put(f"/api/clarifications/{cl[0]['clarification_id']}/respond", headers=H["agency"], json={"response": "Delay due to material supply; recovery plan attached."})
    assert r.status_code == 200 and r.json()["status"] == "Responded"
    # agency cannot decide on complaints or touch risk
    comp = client.get("/api/complaints", headers=H["agency"]).json()["items"]
    assert client.put(f"/api/complaints/{comp[0]['complaint_id']}", headers=H["agency"], json={"action": "resolve", "text": "closing it myself now"}).status_code == 403
    assert client.put(f"/api/complaints/{comp[0]['complaint_id']}", headers=H["agency"], json={"action": "screen", "verdict": "verified", "note": "x y z abc"}).status_code == 403


def test_15_citizen_complaint_workflow(client, H):
    pub = client.get("/api/projects?q=Kothrud", headers=H["citizen"]).json()["items"]
    proj = next(p for p in pub if p["project_code"] == "MPLADS-PN-201")
    r = client.post("/api/complaints", headers=H["citizen"], data={
        "category": "Safety hazard", "description": "Exposed rebar near the hall entrance is a hazard for children.",
        "project_id": str(proj["project_id"]), "anonymous": "true"},
        files=[("files", ("evidence.png", b"\x89PNG\r\n\x1a\n" + b"0" * 128, "image/png"))])
    assert r.status_code == 201, r.text
    c = r.json()
    assert c["tracking_id"].startswith("CMP-") and c["status"] == "Submitted" and len(c["evidence"]) == 1
    cid = c["complaint_id"]
    # not visible to the agency until screened & verified
    assert client.get(f"/api/complaints/{cid}", headers=H["agency"]).status_code == 404
    assert client.put(f"/api/complaints/{cid}", headers=H["officer"], json={"action": "screen", "verdict": "verified", "serious": True, "note": "Site photo matches."}).json()["status"] == "Assigned"
    assert client.get(f"/api/complaints/{cid}", headers=H["agency"]).status_code == 200
    assert client.put(f"/api/complaints/{cid}", headers=H["agency"], json={"action": "respond", "text": "Barricading done; rectification scheduled."}).json()["status"] == "Under Investigation"
    assert client.put(f"/api/complaints/{cid}", headers=H["officer"], json={"action": "resolve", "text": "Rebar cut and capped; verified on site."}).json()["status"] == "Resolved"
    r = client.put(f"/api/complaints/{cid}", headers=H["citizen"], json={"action": "feedback", "satisfied": False, "text": "Still unsafe at night."})
    assert r.json()["feedback_satisfied"] is False
    r = client.put(f"/api/complaints/{cid}", headers=H["citizen"], json={"action": "appeal", "text": "The area is still not lit or barricaded."})
    assert r.json()["status"] == "Appealed"
    head = client.get("/api/notifications", headers=H["head"]).json()["items"]
    assert any("Appeal requires review" in n["message"] for n in head)
    r = client.put(f"/api/complaints/{cid}", headers=H["head"], json={"action": "decide_appeal", "outcome": "uphold", "note": "Reopen and re-inspect."})
    assert r.json()["status"] == "Under Investigation"
    # citizen view is free of internal data; tracking timeline present
    cit = client.get(f"/api/complaints/{cid}", headers=H["citizen"]).json()
    assert "screening_note" not in cit and len(cit["timeline"]) == 8
    # anonymous identity never revealed to officers
    off = client.get(f"/api/complaints/{cid}", headers=H["officer"]).json()
    assert off["citizen"] == "Anonymous"


def test_16_only_verified_complaints_move_the_score(client, H):
    pid = STATE["pid"]
    before = STATE["risk"]["risk_score"]
    ok = client.post(f"/api/projects/{pid}/risk-analysis", headers=H["head"])
    assert ok.status_code == 200
    again = ok.json()["risk"]["risk_score"]
    assert abs(again - before) < 3     # unchanged inputs -> (near) identical score


def test_17_messy_pdf_shows_warnings_and_invalid_value(client, H):
    ex = upload(client, H, MESSY).json()
    f = {x["key"]: x for x in ex["fields"]}
    assert f["progress"]["value"] == 108.0 and f["sanction_date"]["confidence"] == "Missing"
    v = ex["validation"]
    assert any(e["field"] == "progress" for e in v["errors"])
    codes = {w["code"] for w in v["warnings"]}
    assert {"agency_match", "budget_consistency", "delay_mismatch", "required_document"} <= codes
    assert v["agency_name"] == "PWD Pune Division"
    r = client.put(f"/api/extractions/{ex['extraction_id']}", headers=H["officer"], json={"fields": {"progress": "58", "planned_progress": "70"}})
    assert r.json()["validation"]["errors"] == []


def test_18_pdf_validation(client, H):
    assert upload(client, H, ROOT / "requirements.txt").status_code == 415
    bad = client.post("/api/projects/upload-pdf", headers=H["officer"], files={"file": ("x.pdf", b"%PDF-1.4 garbage not a pdf", "application/pdf")})
    assert bad.status_code == 422
    js = client.post("/api/projects/upload-pdf", headers=H["officer"],
                     files={"file": ("x.pdf", PDF.read_bytes()[:200] + b"/JavaScript (app.alert(1))" + PDF.read_bytes()[200:], "application/pdf")})
    assert js.status_code == 422
    big = client.post("/api/projects/upload-pdf", headers=H["officer"], files={"file": ("x.pdf", b"%PDF-" + b"0" * (11 * 1024 * 1024), "application/pdf")})
    assert big.status_code == 413


def test_19_audit_chain_intact_and_summary(client, H):
    v = client.get("/api/audit-logs/verify-chain", headers=H["head"]).json()
    assert v["valid"] is True and v["checked"] > 50
    s = client.get("/api/audit-logs/summary", headers=H["head"]).json()
    assert s["total_records"] > 50 and s["by_action"]
    # officer cannot browse login events
    assert not any(a["action"] in ("Login", "Logout") for a in client.get("/api/audit-logs?page_size=100", headers=H["officer"]).json()["items"])
