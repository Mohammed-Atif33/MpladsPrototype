"""Pre-analysis data validation (spec section 11). Returns errors (block verification),
warnings (must be acknowledged by the officer) and informational notes."""
from __future__ import annotations

import difflib
import re
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import Agency, Extraction, Project
from . import parsing as P
from .reference import DISTRICT_CENTROIDS, DISTRICT_CONSTITUENCIES, MAHARASHTRA_BBOX, canonical_district

REQUIRED = ["project_code", "name", "category", "agency", "district", "sanctioned_amount",
            "start_date", "deadline", "progress"]
RECOMMENDED = ["location", "constituency", "released_amount", "expenditure", "planned_progress",
               "sanction_date", "report_date"]
CODE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9\-_/]{2,39}$")


def _d(v) -> date | None:
    return P.parse_date(v) if v not in (None, "") else None


def match_agency(db: Session, name: str | None) -> tuple[Agency | None, str | None]:
    """Returns (agency, kind) where kind is 'exact' | 'close' | None."""
    if not name:
        return None, None
    norm = lambda s: re.sub(r"[^a-z0-9 ]", "", s.lower()).strip()
    agencies = db.execute(select(Agency)).scalars().all()
    n = norm(name)
    for a in agencies:
        if norm(a.name) == n:
            return a, "exact"
    best, ratio = None, 0.0
    for a in agencies:
        r = difflib.SequenceMatcher(None, norm(a.name), n).ratio()
        if r > ratio:
            best, ratio = a, r
    if best and ratio >= 0.8:
        return best, "close"
    return None, None


def validate(db: Session, values: dict, payments: list[dict], doc_refs: dict | None,
             *, extraction_id: int | None = None) -> dict:
    """values: {field_key: normalized value}."""
    errors: list[dict] = []
    warnings: list[dict] = []
    infos: list[dict] = []

    def err(field, code, msg):
        errors.append({"field": field, "code": code, "message": msg})

    def warn(field, code, msg):
        warnings.append({"field": field, "code": code, "message": msg})

    def info(field, code, msg):
        infos.append({"field": field, "code": code, "message": msg})

    v = values
    # ---- required fields / missing values
    for k in REQUIRED:
        if v.get(k) in (None, ""):
            err(k, "required", f"Required field '{k.replace('_', ' ')}' is missing.")
    for k in RECOMMENDED:
        if v.get(k) in (None, ""):
            warn(k, "missing_value", f"'{k.replace('_', ' ')}' is missing; analysis will have less context.")

    code = v.get("project_code")
    if code:
        if not CODE_RE.match(str(code)):
            err("project_code", "invalid_value", "Project ID contains invalid characters (use letters, digits, - _ /).")
        dup = db.execute(select(Project.project_id).where(func.lower(Project.project_code) == str(code).lower())).first()
        if dup:
            err("project_code", "duplicate", f"A project with ID '{code}' already exists. Duplicate project IDs are not allowed.")
        pend = db.execute(select(Extraction.extraction_id).where(
            func.lower(Extraction.fields["project_code"]["value"].astext) == str(code).lower(),
            Extraction.status == "Pending Verification",
            Extraction.extraction_id != (extraction_id or -1))).first()
        if pend:
            warn("project_code", "duplicate_pending", "Another uploaded PDF with this project ID is awaiting verification.")

    # ---- dates
    dates = {}
    for k in ("sanction_date", "start_date", "deadline", "revised_deadline", "completion_date", "report_date"):
        raw = v.get(k)
        if raw in (None, ""):
            continue
        d = _d(raw)
        if d is None:
            err(k, "invalid_date", f"'{k.replace('_', ' ')}' is not a valid date.")
        elif not (date(1990, 1, 1) <= d <= date(2100, 12, 31)):
            err(k, "invalid_date", f"'{k.replace('_', ' ')}' is outside a plausible range.")
        else:
            dates[k] = d
    if "start_date" in dates and "deadline" in dates and dates["start_date"] > dates["deadline"]:
        err("deadline", "date_order", "Original deadline is before the start date.")
    if "revised_deadline" in dates and "deadline" in dates and dates["revised_deadline"] < dates["deadline"]:
        warn("revised_deadline", "date_order", "Revised deadline is earlier than the original deadline.")
    if "completion_date" in dates and "start_date" in dates and dates["completion_date"] < dates["start_date"]:
        err("completion_date", "date_order", "Completion date is before the start date.")
    if "sanction_date" in dates and "start_date" in dates and dates["sanction_date"] > dates["start_date"]:
        warn("sanction_date", "date_order", "Sanction date is after the start date.")

    # ---- progress
    for k in ("progress", "planned_progress"):
        p = v.get(k)
        if p not in (None, ""):
            try:
                pf = float(p)
                if not (0 <= pf <= 100):
                    err(k, "range", f"{k.replace('_', ' ').capitalize()} must be between 0 and 100 (got {pf:g}).")
            except (TypeError, ValueError):
                err(k, "invalid_value", f"{k.replace('_', ' ').capitalize()} is not a number.")

    # ---- money consistency
    def num(k):
        x = v.get(k)
        try:
            return float(x) if x not in (None, "") else None
        except (TypeError, ValueError):
            return None

    san, rel, exp, rem = num("sanctioned_amount"), num("released_amount"), num("expenditure"), num("remaining_amount")
    for k in ("sanctioned_amount", "released_amount", "expenditure", "remaining_amount"):
        x = num(k)
        if x is not None and x < 0:
            err(k, "range", f"{k.replace('_', ' ').capitalize()} cannot be negative.")
    if san is not None and san <= 0 and v.get("sanctioned_amount") not in (None, ""):
        err("sanctioned_amount", "range", "Sanctioned amount must be greater than zero.")
    if san and rel is not None and rel > san * 1.001:
        err("released_amount", "budget_consistency", "Released amount exceeds the sanctioned amount.")
    if san and exp is not None and exp > san * 1.001:
        err("expenditure", "budget_consistency", "Expenditure exceeds the sanctioned amount.")
    elif rel is not None and exp is not None and exp > rel * 1.001:
        warn("expenditure", "budget_consistency", "Expenditure exceeds the released amount (spending ahead of released funds).")
    if san is not None and exp is not None and rem is not None and abs((san - exp) - rem) > max(1000.0, san * 0.01):
        warn("remaining_amount", "budget_consistency",
             f"Remaining amount ({rem:,.0f}) does not equal sanctioned minus expenditure ({san - exp:,.0f}).")
    if payments and exp:
        total = sum(float(p.get("amount") or 0) for p in payments)
        if abs(total - exp) > max(1000.0, exp * 0.01):
            warn("payments", "payment_mismatch",
                 f"Listed payments total {total:,.0f} but expenditure is {exp:,.0f}.")

    # ---- progress vs completion / delay
    prog = num("progress")
    if "completion_date" in dates and prog is not None and prog < 100:
        warn("completion_date", "inconsistent", "A completion date is given but progress is below 100%.")
    delay = P.parse_int(v.get("delay_days")) if v.get("delay_days") not in (None, "") else None
    as_of = dates.get("report_date")
    if delay is not None and "deadline" in dates and as_of and "completion_date" not in dates:
        computed = max(0, (as_of - dates["deadline"]).days)
        if abs(computed - delay) > 2:
            warn("delay_days", "delay_mismatch",
                 f"Stated delay ({delay} days) differs from report date minus original deadline ({computed} days).")

    # ---- agency match
    agency, kind = match_agency(db, v.get("agency"))
    agency_id = agency.agency_id if agency else None
    if v.get("agency"):
        if kind == "close":
            warn("agency", "agency_match", f"Agency '{v['agency']}' is not an exact match; closest registered agency is '{agency.name}'. It will be used if you verify.")
        elif kind is None:
            err("agency", "agency_match", f"Agency '{v['agency']}' is not in the agency registry. Correct it to a registered agency name.")

    # ---- location consistency
    district = canonical_district(v.get("district"))
    if v.get("district"):
        if not district:
            warn("district", "location_match", f"District '{v['district']}' is not one of the known demo districts.")
        else:
            if v.get("constituency") and str(v["constituency"]).strip().lower() not in [c.lower() for c in DISTRICT_CONSTITUENCIES.get(district, [])]:
                warn("constituency", "location_match", f"Constituency '{v['constituency']}' is not usually associated with {district} district.")
            loc = str(v.get("location") or "").lower()
            others = [d for d in DISTRICT_CENTROIDS if d != district and d.lower() in loc]
            if others and district.lower() not in loc:
                warn("location", "location_match", f"Location text mentions {others[0]} while the district is {district}.")
    lat, lon = num("latitude"), num("longitude")
    if lat is not None and lon is not None:
        a, b, c, d = MAHARASHTRA_BBOX
        if not (a <= lat <= b and c <= lon <= d):
            warn("latitude", "location_match", "Coordinates fall outside Maharashtra.")
    elif v.get("district"):
        info("latitude", "map_location", "No coordinates supplied - map position will be approximated from the district centre.")

    # ---- required documents
    refs = doc_refs or {}
    if not refs.get("sanction_order"):
        warn("documents", "required_document", "Required document reference not found in the PDF: Sanction Order.")
    if (exp or 0) > 0 and not refs.get("utilization_certificate"):
        warn("documents", "required_document", "Required document reference not found in the PDF: Utilization Certificate (expenditure is reported).")
    info("documents", "source_document", "The uploaded PDF is stored as the project source document (version 1).")

    return {
        "errors": errors, "warnings": warnings, "infos": infos,
        "can_verify": not errors,
        "agency_id": agency_id, "agency_name": agency.name if agency else None,
        "data_quality_issues": len(warnings) + len(errors),
    }
