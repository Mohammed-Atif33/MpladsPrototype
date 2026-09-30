"""PDF upload -> extraction preview -> validation -> human verification -> project storage -> analysis."""
from __future__ import annotations

import hashlib
import random
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from .. import permissions as P
from ..database import get_db
from ..deps import client_ip, require
from ..models import Complaint, Document, Extraction, Payment, Project, User
from ..schemas import ExtractionEditIn, ExtractionVerifyIn
from ..services import file_storage as FS
from ..services import notify, parsing, risk_service, serializers as S, validation
from ..services.audit import log_audit
from ..services.pdf_extract import FIELD_DEFS, FIELD_META, ExtractionError, extract
from ..services.reference import DISTRICT_CENTROIDS, canonical_district
from ..services.stats import compute_delay_days, refresh_agency_stats
from .common import names

router = APIRouter(tags=["pdf-ingestion"])

FIELD_ORDER = [k for k, *_ in FIELD_DEFS]


def _values(ex: Extraction) -> dict:
    return {k: (f.get("value")) for k, f in ex.fields.items()}


def serialize_extraction(db: Session, ex: Extraction) -> dict:
    doc = db.get(Document, ex.document_id) if ex.document_id else None
    fields = []
    for k in FIELD_ORDER:
        f = ex.fields.get(k)
        if f:
            fields.append({"key": k, **f})
    return {
        "extraction_id": ex.extraction_id, "status": ex.status, "project_id": ex.project_id,
        "document": S.document(doc, names(db, {doc.uploaded_by})) if doc else None,
        "fields": fields, "payments": ex.payments or [], "milestones": ex.milestones or [],
        "validation": ex.validation, "notes": ex.notes, "created_at": S.iso(ex.created_at),
        "verified_at": S.iso(ex.verified_at),
        "confidence_summary": {b: sum(1 for f in ex.fields.values() if f["confidence"] == b)
                               for b in ("High", "Medium", "Low", "Missing")},
    }


def _revalidate(db: Session, ex: Extraction) -> dict:
    result = validation.validate(db, _values(ex), ex.payments or [], (ex.notes or {}).get("document_references"),
                                 extraction_id=ex.extraction_id)
    ex.validation = result
    return result


def _apply_edits(db: Session, user: User, ex: Extraction, fields: dict, payments: list | None,
                 reason: str | None, ip: str | None) -> list[str]:
    """Coerce + store officer edits; every correction is audited with previous/new value."""
    errors: list[str] = []
    changed: list[str] = []
    new_fields = {k: dict(v) for k, v in ex.fields.items()}
    for key, raw in fields.items():
        if key not in FIELD_META:
            raise HTTPException(422, f"Unknown field '{key}'.")
        ftype = FIELD_META[key]["type"]
        ftype_eff = "text" if ftype in ("code", "longtext") else ftype
        val, ok = parsing.coerce(ftype_eff, raw)
        if not ok:
            errors.append(f"'{FIELD_META[key]['label']}' has an invalid value: {raw!r}")
            continue
        prev = new_fields[key].get("value")
        if val == prev:
            continue
        if isinstance(val, str) and ftype in ("code", "text", "longtext"):
            val = val[:2000]
        new_fields[key].update({"value": val, "edited": True, "raw": str(val) if val is not None else None,
                                "confidence": new_fields[key]["confidence"] if new_fields[key]["confidence"] != "Missing" else "Low"})
        log_audit(db, user, "Data Correction", "Extraction", ex.extraction_id, previous={"field": key, "value": prev},
                  new={"field": key, "value": val}, reason=reason or "Officer correction of extracted value", ip=ip)
        changed.append(key)
    if errors:
        raise HTTPException(422, "; ".join(errors))
    ex.fields = new_fields
    if payments is not None:
        clean = []
        for p in payments[:200]:
            amt = parsing.parse_money(p.get("amount"))
            if not amt:
                continue
            d = parsing.parse_date(p.get("paid_on"))
            clean.append({"paid_on": d.isoformat() if d else None, "amount": amt,
                          "description": (str(p.get("description") or "")[:255]) or None,
                          "reference": (str(p.get("reference") or "")[:80]) or None,
                          "source_page": p.get("source_page")})
        if clean != (ex.payments or []):
            log_audit(db, user, "Data Correction", "Extraction", ex.extraction_id,
                      previous={"field": "payments", "count": len(ex.payments or [])},
                      new={"field": "payments", "count": len(clean)}, reason=reason or "Officer correction of payment schedule", ip=ip)
            ex.payments = clean
            changed.append("payments")
    return changed


@router.post("/api/projects/upload-pdf", status_code=201)
async def upload_pdf(request: Request, file: UploadFile = File(...), user: User = Depends(require("project:upload_pdf")),
                     db: Session = Depends(get_db)):
    data, _mime = await FS.read_upload(file, {"application/pdf"})
    ip = client_ip(request)
    try:
        pages = FS.validate_pdf_bytes(data)
    except HTTPException as e:
        log_audit(db, user, "PDF Upload Rejected", "Document", None, new={"file_name": FS.safe_display_name(file.filename)},
                  reason=str(e.detail), ip=ip)
        db.commit()
        raise
    try:
        result = extract(data)
    except ExtractionError as e:
        log_audit(db, user, "PDF Upload Rejected", "Document", None, new={"file_name": FS.safe_display_name(file.filename)},
                  reason=str(e), ip=ip)
        db.commit()
        raise HTTPException(422, str(e))
    except Exception:
        raise HTTPException(422, "The PDF could not be processed. It may be corrupted or use an unsupported layout.")

    rel, sha = FS.save_bytes(data, "source", "application/pdf")
    doc = Document(project_id=None, document_type="Project Report", file_name=FS.safe_display_name(file.filename),
                   file_path=rel, content_type="application/pdf", size_bytes=len(data), sha256=sha, version=1,
                   is_public=False, uploaded_by=user.user_id, description="Uploaded project PDF (pending verification)")
    db.add(doc)
    db.flush()
    ex = Extraction(document_id=doc.document_id, uploaded_by=user.user_id, fields=result["fields"],
                    payments=result["payments"], milestones=result["milestones"], notes=result["notes"])
    db.add(ex)
    db.flush()
    validation_result = _revalidate(db, ex)
    log_audit(db, user, "PDF Upload", "Document", doc.document_id, new={"file_name": doc.file_name, "pages": pages,
              "size_bytes": len(data), "sha256": sha[:16]}, reason="Project PDF uploaded", ip=ip)
    log_audit(db, user, "PDF Extraction", "Extraction", ex.extraction_id,
              new={"fields_extracted": sum(1 for f in ex.fields.values() if f["value"] is not None),
                   "fields_missing": sum(1 for f in ex.fields.values() if f["value"] is None),
                   "warnings": len(validation_result["warnings"]), "errors": len(validation_result["errors"])},
              reason="Automatic text/table extraction", ip=ip)
    notify.notify(db, [user.user_id], "Data verification required",
                  f"Extracted data from '{doc.file_name}' needs verification before analysis "
                  f"({len(validation_result['errors'])} error(s), {len(validation_result['warnings'])} warning(s)).",
                  "action", entity_type="Extraction", entity_id=ex.extraction_id)
    db.commit()
    return serialize_extraction(db, ex)


@router.get("/api/extractions")
def list_extractions(status: str | None = "Pending Verification", user: User = Depends(require("project:upload_pdf")),
                     db: Session = Depends(get_db)):
    q = select(Extraction).order_by(Extraction.extraction_id.desc()).limit(100)
    if status:
        q = q.where(Extraction.status == status)
    rows = db.execute(q).scalars().all()
    nm = names(db, {r.uploaded_by for r in rows})
    out = []
    for r in rows:
        doc = db.get(Document, r.document_id) if r.document_id else None
        out.append({"extraction_id": r.extraction_id, "status": r.status, "file_name": doc.file_name if doc else None,
                    "project_code": r.fields.get("project_code", {}).get("value"),
                    "project_name": r.fields.get("name", {}).get("value"),
                    "uploaded_by": nm.get(r.uploaded_by), "created_at": S.iso(r.created_at),
                    "errors": len((r.validation or {}).get("errors", [])),
                    "warnings": len((r.validation or {}).get("warnings", [])), "project_id": r.project_id})
    return out


def _get_ex(db: Session, extraction_id: int) -> Extraction:
    ex = db.get(Extraction, extraction_id)
    if not ex:
        raise HTTPException(404, "Extraction not found.")
    return ex


@router.get("/api/extractions/{extraction_id}")
def get_extraction(extraction_id: int, user: User = Depends(require("project:upload_pdf")), db: Session = Depends(get_db)):
    return serialize_extraction(db, _get_ex(db, extraction_id))


@router.put("/api/extractions/{extraction_id}")
def edit_extraction(extraction_id: int, body: ExtractionEditIn, request: Request,
                    user: User = Depends(require("project:verify")), db: Session = Depends(get_db)):
    ex = _get_ex(db, extraction_id)
    if ex.status != "Pending Verification":
        raise HTTPException(409, f"This extraction is already {ex.status.lower()} and can no longer be edited.")
    _apply_edits(db, user, ex, body.fields, body.payments, body.reason, client_ip(request))
    _revalidate(db, ex)
    db.commit()
    return serialize_extraction(db, ex)


@router.post("/api/extractions/{extraction_id}/discard")
def discard_extraction(extraction_id: int, request: Request, user: User = Depends(require("project:verify")),
                       db: Session = Depends(get_db)):
    ex = _get_ex(db, extraction_id)
    if ex.status != "Pending Verification":
        raise HTTPException(409, "Only extractions pending verification can be discarded.")
    ex.status = "Discarded"
    log_audit(db, user, "Status Change", "Extraction", ex.extraction_id, previous={"status": "Pending Verification"},
              new={"status": "Discarded"}, reason="Officer discarded the extraction", ip=client_ip(request))
    db.commit()
    return serialize_extraction(db, ex)


def _approx_coords(code: str, district: str | None) -> tuple[float, float]:
    d = canonical_district(district) or "Pune"
    lat, lon = DISTRICT_CENTROIDS[d]
    rng = random.Random(int(hashlib.sha256(code.encode()).hexdigest()[:8], 16))
    return round(lat + rng.uniform(-0.08, 0.08), 5), round(lon + rng.uniform(-0.08, 0.08), 5)


@router.post("/api/extractions/{extraction_id}/verify")
def verify_extraction(extraction_id: int, body: ExtractionVerifyIn, request: Request,
                      user: User = Depends(require("project:verify")), db: Session = Depends(get_db)):
    """'Verify & Analyze': apply final edits, re-validate, store the verified project, then (optionally) analyse."""
    ex = _get_ex(db, extraction_id)
    if ex.status != "Pending Verification":
        raise HTTPException(409, f"This extraction is already {ex.status.lower()}.")
    ip = client_ip(request)
    _apply_edits(db, user, ex, body.fields, body.payments, body.reason, ip)
    result = _revalidate(db, ex)
    if result["errors"]:
        db.commit()  # keep edits + audit
        raise HTTPException(422, detail={"message": "Validation errors must be corrected before verification.",
                                         "validation": result})
    if result["warnings"] and not body.acknowledge_warnings:
        db.commit()
        raise HTTPException(409, detail={"message": "Please review and acknowledge the validation warnings to continue.",
                                         "validation": result})

    v = _values(ex)
    num = lambda k, d=0.0: float(v[k]) if v.get(k) not in (None, "") else d
    dt = lambda k: parsing.parse_date(v.get(k)) if v.get(k) else None
    sanctioned, expenditure = num("sanctioned_amount"), num("expenditure")
    released = num("released_amount", expenditure)
    remaining = num("remaining_amount", max(0.0, sanctioned - expenditure))
    deadline, completion, as_of = dt("deadline"), dt("completion_date"), dt("report_date")
    delay = int(v["delay_days"]) if v.get("delay_days") not in (None, "") else compute_delay_days(deadline, as_of, completion)
    code = str(v["project_code"]).strip()
    district = canonical_district(v.get("district")) or v.get("district")
    lat, lon = num("latitude", 0.0), num("longitude", 0.0)
    coords_note = None
    if not (lat and lon):
        lat, lon = _approx_coords(code, district)
        coords_note = "approximate (district centre)"
    agency_id = result["agency_id"]

    project = Project(
        project_code=code, name=str(v["name"]).strip()[:200], category=str(v["category"]).strip(),
        location=(v.get("location") or None), latitude=lat, longitude=lon, district=district,
        constituency=v.get("constituency"), agency_id=agency_id, description=v.get("description"),
        sanction_date=dt("sanction_date"), sanctioned_amount=Decimal(str(sanctioned)),
        released_amount=Decimal(str(released)), expenditure=Decimal(str(expenditure)),
        remaining_amount=Decimal(str(remaining)), progress=num("progress"),
        planned_progress=num("planned_progress") if v.get("planned_progress") not in (None, "") else None,
        start_date=dt("start_date"), deadline=deadline, revised_deadline=dt("revised_deadline"),
        completion_date=completion, as_of_date=as_of, reporting_period=v.get("reporting_period"),
        delay_days=delay, budget_revisions=int(v["budget_revisions"]) if v.get("budget_revisions") not in (None, "") else 0,
        extension_requests=int(v["extension_requests"]) if v.get("extension_requests") not in (None, "") else 0,
        milestones=ex.milestones or [], status="Verified - Analysis Pending", verification_status="Verified",
        is_public=body.publish_to_citizens, is_historical=False, created_by=ex.uploaded_by,
        verified_by=user.user_id, verified_at=datetime.now(timezone.utc),
    )
    db.add(project)
    db.flush()

    for p in ex.payments or []:
        db.add(Payment(project_id=project.project_id, paid_on=parsing.parse_date(p.get("paid_on")), amount=Decimal(str(p["amount"])),
                       description=p.get("description"), reference=p.get("reference")))
    if ex.document_id:
        doc = db.get(Document, ex.document_id)
        doc.project_id, doc.description = project.project_id, "Source project PDF (verified)"
    ex.status, ex.project_id, ex.verified_by, ex.verified_at = "Verified", project.project_id, user.user_id, project.verified_at

    # complaints citizens filed against this project code before it was ingested get linked now
    linked = db.execute(update(Complaint).where(Complaint.project_id.is_(None), Complaint.project_code_ref == code)
                        .values(project_id=project.project_id)).rowcount
    refresh_agency_stats(db, agency_id)

    log_audit(db, user, "Verification", "Project", code, project_id=project.project_id,
              previous={"verification_status": "Pending Verification"},
              new={"verification_status": "Verified", "warnings_acknowledged": len(result["warnings"]),
                   "map_position": coords_note or "from document", "linked_complaints": linked,
                   "edited_fields": [k for k, f in ex.fields.items() if f.get("edited")]},
              reason=body.reason or "Officer verified extracted data", ip=ip)
    log_audit(db, user, "Status Change", "Project", code, project_id=project.project_id, previous={"status": None},
              new={"status": project.status}, reason="Project stored after verification", ip=ip)

    out: dict = {"project_id": project.project_id, "project_code": code, "linked_complaints": linked}
    if body.analyze:
        analysis = risk_service.run_risk_analysis(db, project, user)
        out["risk"] = S.risk_full(analysis)
        out["project_status"] = project.status
    db.commit()
    return out
