"""PDF text/table extraction -> project fields with confidence and source page.

Approach (rule-based, deterministic, explainable):
  1. pdfplumber gives per-page text lines and tables (OCR via Tesseract for scanned pages if available).
  2. Every field has a list of label aliases. A label found in a table row or as "Label: value"
     yields a candidate value.
  3. Confidence: exact/canonical label -> High; generic or fuzzy label, prose match, derived or
     OCR'd values -> Medium/Low; unparseable -> Low; not found -> Missing.
"""
from __future__ import annotations

import io
import re
from datetime import date

import pdfplumber

from . import parsing as P

# key, label, group, type, aliases (first = canonical) ; generic aliases get lower confidence
FIELD_DEFS: list[tuple[str, str, str, str, list[str]]] = [
    ("project_code", "Project ID", "Project", "code",
     ["project id", "project code", "project no", "project number", "scheme id"]),
    ("name", "Project Name", "Project", "text",
     ["project name", "name of work", "name of project", "work name", "title of work"]),
    ("category", "Category", "Project", "text",
     ["category", "project category", "type of work", "nature of work", "sector"]),
    ("location", "Location", "Project", "text",
     ["location", "work location", "site location", "site", "place"]),
    ("district", "District", "Project", "text", ["district"]),
    ("constituency", "Constituency", "Project", "text",
     ["constituency", "lok sabha constituency", "parliamentary constituency"]),
    ("agency", "Agency", "Project", "text",
     ["implementing agency", "executing agency", "executing department", "implementing department", "agency"]),
    ("description", "Description", "Project", "longtext",
     ["project description", "description", "scope of work", "brief description", "scope"]),
    ("sanctioned_amount", "Sanctioned Amount", "Financial", "money",
     ["sanctioned amount", "sanctioned cost", "sanctioned budget", "sanction amount", "total budget", "estimated cost", "budget"]),
    ("released_amount", "Released Amount", "Financial", "money",
     ["released amount", "amount released", "funds released", "released"]),
    ("expenditure", "Expenditure", "Financial", "money",
     ["expenditure", "total expenditure", "expenditure incurred", "expenditure to date", "amount spent", "amount utilised", "utilised amount"]),
    ("remaining_amount", "Remaining Amount", "Financial", "money",
     ["remaining amount", "remaining balance", "unspent balance", "balance amount", "balance"]),
    ("budget_revisions", "Budget Revisions", "Financial", "int",
     ["budget revisions", "number of budget revisions", "no. of budget revisions", "cost revisions", "revisions"]),
    ("sanction_date", "Sanction Date", "Timeline", "date",
     ["sanction date", "date of sanction", "date of administrative approval"]),
    ("start_date", "Start Date", "Timeline", "date",
     ["start date", "work start date", "commencement date", "date of commencement"]),
    ("deadline", "Original Deadline", "Timeline", "date",
     ["original deadline", "original completion date", "scheduled completion date", "stipulated completion date",
      "original due date", "deadline"]),
    ("revised_deadline", "Revised Deadline", "Timeline", "date",
     ["revised deadline", "revised completion date", "extended deadline", "extended completion date", "revised due date"]),
    ("completion_date", "Completion Date", "Timeline", "date",
     ["completion date", "actual completion date", "date of completion"]),
    ("delay_days", "Delay Days", "Timeline", "int",
     ["delay days", "delay (days)", "delay in days", "days of delay", "delay"]),
    ("extension_requests", "Extension Requests", "Timeline", "int",
     ["extension requests", "number of extension requests", "no. of extension requests", "time extensions", "extensions requested"]),
    ("planned_progress", "Planned Progress", "Progress", "percent",
     ["planned progress", "expected progress", "scheduled progress", "targeted progress"]),
    ("progress", "Actual Progress", "Progress", "percent",
     ["actual progress", "physical progress", "progress achieved", "completion percentage", "percentage completion",
      "completion %", "progress"]),
    ("reporting_period", "Reporting Period", "Progress", "text",
     ["reporting period", "period of report", "report period"]),
    ("report_date", "Report Date", "Progress", "date",
     ["report date", "as on date", "as on", "date of report", "reporting date"]),
    ("latitude", "Latitude", "Project", "float", ["latitude"]),
    ("longitude", "Longitude", "Project", "float", ["longitude"]),
]

FIELD_META = {k: {"label": lbl, "group": grp, "type": t} for k, lbl, grp, t, _ in FIELD_DEFS}

# aliases considered ambiguous (single generic words) -> capped at Medium confidence
GENERIC_ALIASES = {"budget", "progress", "balance", "delay", "revisions", "site", "place", "scope", "released",
                   "agency", "description"}

DOC_PATTERNS = {
    "sanction_order": re.compile(r"sanction\s+(order|letter)|administrative\s+approval", re.I),
    "utilization_certificate": re.compile(r"utili[sz]ation\s+certificate", re.I),
    "work_order": re.compile(r"work\s+order", re.I),
    "photographs": re.compile(r"photograph|geo-?tagged", re.I),
    "completion_certificate": re.compile(r"completion\s+certificate", re.I),
}

CODE_RE = re.compile(r"\b[A-Z]{3,8}-[A-Z]{1,5}-\d{2,5}\b")
LABEL_LINE_RE = re.compile(r"^[A-Z][A-Za-z0-9 ./()%&'\-]{2,45}\s*[:=]\s*\S")


NULL_TOKENS = {"-", "--", "—", "n/a", "na", "not applicable", "not completed", "not yet completed", "pending",
               "ongoing", "tbd", "not available", "nil", "none"}


class ExtractionError(Exception):
    pass


def _band(score: float) -> str:
    return "High" if score >= 0.85 else ("Medium" if score >= 0.6 else "Low")


def _norm_label(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[:\-–—=*]+$", "", s.strip().lower())).strip()


def _page_texts(pdf_bytes: bytes) -> tuple[list[dict], dict]:
    pages: list[dict] = []
    notes = {"ocr_pages": [], "ocr_unavailable": False}
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for i, page in enumerate(pdf.pages, start=1):
            try:
                text = page.extract_text() or ""
            except Exception:
                text = ""
            try:
                tables = page.extract_tables() or []
            except Exception:
                tables = []
            ocr = False
            if len(text.strip()) < 30:
                ocr_text = _ocr_page(pdf_bytes, i - 1)
                if ocr_text is None:
                    notes["ocr_unavailable"] = True
                elif ocr_text.strip():
                    text, ocr = ocr_text, True
                    notes["ocr_pages"].append(i)
            pages.append({"page": i, "text": text, "tables": tables, "ocr": ocr})
    return pages, notes


def _ocr_page(pdf_bytes: bytes, index: int) -> str | None:
    """OCR fallback for scanned pages. Returns None if OCR engine is unavailable."""
    try:
        import pymupdf as fitz
        import pytesseract
        from PIL import Image

        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        pix = doc[index].get_pixmap(dpi=200)
        img = Image.open(io.BytesIO(pix.tobytes("png")))
        return pytesseract.image_to_string(img)
    except Exception:
        return None


def _clean_cell(c) -> str:
    return re.sub(r"\s+", " ", (c or "").replace("\n", " ")).strip()


def _is_data_table(table) -> bool:
    """Payment / milestone grids have a header row; they are not key-value tables."""
    if not table or len(table) < 2:
        return False
    header = [_clean_cell(c).lower() for c in table[0]]
    is_payment = any("amount" in h for h in header) and any(("date" in h) or ("payment" in h) for h in header) and len(header) >= 3
    is_milestone = any("milestone" in h for h in header)
    return is_payment or is_milestone


def _candidates(pages: list[dict]) -> dict[str, list[dict]]:
    """Collect candidate values per field from tables and text lines."""
    alias_index: dict[str, list[tuple[str, str, str, bool]]] = {}
    for key, _lbl, _grp, ftype, aliases in FIELD_DEFS:
        for idx, a in enumerate(aliases):
            alias_index.setdefault(a, []).append((key, ftype, a, idx == 0 or a not in GENERIC_ALIASES))

    cands: dict[str, list[dict]] = {k: [] for k in FIELD_META}

    def add(key: str, ftype: str, raw: str, page: int, base: float, ocr: bool, how: str):
        raw = raw.strip()
        if not raw or (raw.lower() in NULL_TOKENS and ftype != "int"):
            return
        val, ok = P.coerce(ftype, raw)
        score = base
        if ftype == "code":
            val, ok = raw.strip(), bool(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9\-_/]{2,39}", raw.strip()))
        if not ok:
            score = min(score, 0.4)
            val = raw
        if ocr:
            score -= 0.2
        cands[key].append({"value": val, "raw": raw, "score": round(score, 2), "page": page, "how": how, "ok": ok})

    for pg in pages:
        n, ocr = pg["page"], pg["ocr"]
        # ---- table rows: alias cell followed by value cell
        for table in pg["tables"]:
            if _is_data_table(table):
                continue
            for row in table:
                cells = [_clean_cell(c) for c in row]
                for ci, cell in enumerate(cells):
                    lab = _norm_label(cell)
                    if lab in alias_index and ci + 1 < len(cells) and cells[ci + 1]:
                        for key, ftype, alias, primary in alias_index[lab]:
                            add(key, ftype, cells[ci + 1], n, 0.95 if primary else 0.75, ocr, "table")
        # ---- text lines: "Label: value" (and "Label value" for typed values)
        lines = [ln.strip() for ln in pg["text"].splitlines()]
        for li, ln in enumerate(lines):
            if not ln:
                continue
            m = re.match(r"^(.{2,45}?)\s*[:=]\s*(.+)$", ln)
            if m:
                lab = _norm_label(m.group(1))
                lab_np = re.sub(r"\s*\([^)]*\)\s*$", "", lab).strip()   # "delay (days)" -> "delay"
                for candidate_lab in dict.fromkeys([lab, lab_np]):
                    if candidate_lab in alias_index:
                        for key, ftype, alias, primary in alias_index[candidate_lab]:
                            raw = m.group(2)
                            if ftype == "longtext":
                                extra = []
                                for nxt in lines[li + 1: li + 5]:
                                    if not nxt or LABEL_LINE_RE.match(nxt) or nxt.isupper():
                                        break
                                    extra.append(nxt)
                                raw = " ".join([raw] + extra)
                            add(key, ftype, raw, n, 0.93 if primary else 0.75, ocr, "text")
                        break
                continue
            # "Sanctioned Amount  Rs 18.5 lakh" (no separator) for typed fields only; longest alias wins
            low = ln.lower()
            for alias in sorted(alias_index, key=len, reverse=True):
                if low.startswith(alias + " ") or low.startswith(alias + "	"):
                    rest = ln[len(alias):].strip()
                    if not re.match(r"^(?:₹|Rs\.?|INR)?\s*\d", rest):
                        continue
                    for key, ftype, a, primary in alias_index[alias]:
                        if ftype in ("money", "percent", "date", "int", "code"):
                            add(key, ftype, rest, n, 0.7, ocr, "text-nosep")
                    break
        # ---- prose fallbacks
        if not cands["project_code"]:
            mm = CODE_RE.search(pg["text"])
            if mm:
                add("project_code", "code", mm.group(0), n, 0.6, ocr, "prose")
        if not cands["sanctioned_amount"]:
            mm = re.search(r"sanction(?:ed)?[^.\n]{0,40}?(?:Rs\.?|₹|INR)\s*([\d,.]+\s*(?:lakh|lakhs|crore|crores|cr|l)?)", pg["text"], re.I)
            if mm:
                add("sanctioned_amount", "money", mm.group(1), n, 0.55, ocr, "prose")
        mm = re.search(r"coordinates?\s*[:=]\s*(-?\d{1,2}\.\d+)\s*[,;]\s*(-?\d{2,3}\.\d+)", pg["text"], re.I)
        if mm:
            add("latitude", "float", mm.group(1), n, 0.9, ocr, "text")
            add("longitude", "float", mm.group(2), n, 0.9, ocr, "text")
    return cands


def _pick(cs: list[dict]) -> dict | None:
    if not cs:
        return None
    ordered = sorted(cs, key=lambda c: (-c["score"], c["page"]))
    best = dict(ordered[0])
    conflicting = {str(c["value"]).lower() for c in cs if c["ok"]} - {str(best["value"]).lower()}
    if conflicting:
        best["score"] = round(best["score"] - 0.15, 2)
        best["conflict"] = sorted(conflicting)[:3]
    return best


def _extract_payments(pages: list[dict]) -> list[dict]:
    out: list[dict] = []
    for pg in pages:
        for table in pg["tables"]:
            if not table or len(table) < 2:
                continue
            header = [_clean_cell(c).lower() for c in table[0]]
            if not any("amount" in h for h in header):
                continue
            if not any(("date" in h) or ("payment" in h) for h in header):
                continue
            col = {}
            for i, h in enumerate(header):
                if "amount" in h and "amount" not in col:
                    col["amount"] = i
                elif "date" in h and "date" not in col:
                    col["date"] = i
                elif any(w in h for w in ("description", "purpose", "milestone", "particular", "stage", "remark")) and "description" not in col:
                    col["description"] = i
                elif any(w in h for w in ("ref", "voucher", "cheque", "utr", "bill")) and "reference" not in col:
                    col["reference"] = i
            if "amount" not in col:
                continue
            for row in table[1:]:
                cells = [_clean_cell(c) for c in row]
                label = " ".join(cells).lower()
                if "total" in label:
                    continue
                amt = P.parse_money(cells[col["amount"]]) if col["amount"] < len(cells) else None
                if not amt:
                    continue
                d = P.parse_date(cells[col["date"]]) if "date" in col and col["date"] < len(cells) else None
                out.append({
                    "paid_on": d.isoformat() if d else None,
                    "amount": amt,
                    "description": cells[col["description"]] if "description" in col and col["description"] < len(cells) else None,
                    "reference": cells[col["reference"]] if "reference" in col and col["reference"] < len(cells) else None,
                    "source_page": pg["page"],
                })
    return out


def _extract_milestones(pages: list[dict]) -> list[dict]:
    out: list[dict] = []
    for pg in pages:
        for table in pg["tables"]:
            if not table or len(table) < 2:
                continue
            header = [_clean_cell(c).lower() for c in table[0]]
            if not any("milestone" in h for h in header):
                continue
            for row in table[1:]:
                cells = [_clean_cell(c) for c in row]
                rec = {"milestone": None, "planned": None, "actual": None, "status": None, "source_page": pg["page"]}
                for i, h in enumerate(header):
                    if i >= len(cells):
                        continue
                    if "milestone" in h:
                        rec["milestone"] = cells[i]
                    elif "plan" in h or "target" in h or "due" in h:
                        rec["planned"] = cells[i]
                    elif "actual" in h or "achiev" in h:
                        rec["actual"] = cells[i]
                    elif "status" in h:
                        rec["status"] = cells[i]
                if rec["milestone"]:
                    out.append(rec)
    return out


def extract(pdf_bytes: bytes) -> dict:
    """Returns {fields, payments, milestones, notes}."""
    pages, notes = _page_texts(pdf_bytes)
    total_chars = sum(len(p["text"].strip()) for p in pages)
    if total_chars < 30:
        raise ExtractionError(
            "No extractable text found in this PDF. It looks like a scanned document"
            + (" and the OCR engine is not available on this server." if notes["ocr_unavailable"] else ".")
        )
    cands = _candidates(pages)
    fields: dict[str, dict] = {}
    for key, label, group, ftype, _a in FIELD_DEFS:
        best = _pick(cands[key])
        if best:
            fields[key] = {"label": label, "group": group, "type": ftype, "value": best["value"], "raw": best["raw"],
                           "original": best["value"], "confidence": _band(best["score"]),
                           "confidence_score": best["score"], "source_page": best["page"], "edited": False,
                           "derived": False, "note": ("Conflicting values found: " + ", ".join(best["conflict"])) if best.get("conflict") else None}
        else:
            fields[key] = {"label": label, "group": group, "type": ftype, "value": None, "raw": None, "original": None,
                           "confidence": "Missing", "confidence_score": 0.0, "source_page": None, "edited": False,
                           "derived": False, "note": None}

    def derive(key: str, value, source_note: str, score: float = 0.7):
        f = fields[key]
        f.update({"value": value, "raw": str(value), "original": value, "confidence": _band(score),
                  "confidence_score": score, "derived": True, "note": source_note})

    # reporting period -> report date
    rp = fields["reporting_period"]["value"]
    if fields["report_date"]["value"] is None and rp:
        ds = P.find_dates(str(rp))
        if ds:
            derive("report_date", ds[-1].isoformat(), "Derived from the end of the reporting period.")
            fields["report_date"]["source_page"] = fields["reporting_period"]["source_page"]

    def val(k):
        return fields[k]["value"]

    if val("remaining_amount") is None and val("sanctioned_amount") is not None and val("expenditure") is not None:
        derive("remaining_amount", round(float(val("sanctioned_amount")) - float(val("expenditure")), 2),
               "Derived: sanctioned amount minus expenditure.")
    if val("delay_days") is None and val("deadline") and val("report_date"):
        d1, d2 = P.parse_date(val("deadline")), P.parse_date(val("report_date"))
        if d1 and d2 and not val("completion_date"):
            derive("delay_days", max(0, (d2 - d1).days), "Derived: report date minus original deadline.")
    # unspecified counts default to none stated (kept Missing so the officer sees it)

    text_all = "\n".join(p["text"] for p in pages)
    doc_refs = {k: next((p["page"] for p in pages if rx.search(p["text"])), None) for k, rx in DOC_PATTERNS.items()}
    return {
        "fields": fields,
        "payments": _extract_payments(pages),
        "milestones": _extract_milestones(pages),
        "notes": {"page_count": len(pages), "text_chars": total_chars, "ocr_pages": notes["ocr_pages"],
                  "ocr_unavailable": notes["ocr_unavailable"], "document_references": doc_refs,
                  "mentions_extra": bool(re.search(r"\bextension\b", text_all, re.I))},
    }
