"""Value parsers used by PDF extraction and by server-side coercion of officer edits."""
from __future__ import annotations

import re
from datetime import date, datetime

from dateutil import parser as dateparser

_NUM_WORDS = {"nil": 0, "none": 0, "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
              "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10}


def parse_money(raw) -> float | None:
    """'₹18.5 lakh', 'Rs. 18,50,000/-', 'INR 1.85 crore', 1850000 -> rupees (float)."""
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        return float(raw)
    s = str(raw).strip()
    if not s:
        return None
    low = s.lower().replace(",", "")
    m = re.search(r"(\d+(?:\.\d+)?)\s*(lakhs?|lacs?|lakh|crores?|cr\b|l\b)?", low)
    if not m:
        return None
    val = float(m.group(1))
    unit = (m.group(2) or "").strip()
    if unit.startswith(("lakh", "lac")) or unit == "l":
        val *= 100_000
    elif unit.startswith("cr"):
        val *= 10_000_000
    return round(val, 2)


def parse_percent(raw) -> float | None:
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        return float(raw)
    m = re.search(r"-?\d+(?:\.\d+)?", str(raw).replace(",", ""))
    return float(m.group(0)) if m else None


def parse_int(raw) -> int | None:
    if raw is None:
        return None
    if isinstance(raw, bool):
        return int(raw)
    if isinstance(raw, (int, float)):
        return int(raw)
    s = str(raw).strip().lower()
    if s in _NUM_WORDS:
        return _NUM_WORDS[s]
    if s in ("-", "--", "n/a", "na"):
        return 0
    m = re.search(r"-?\d+", s.replace(",", ""))
    if m:
        return int(m.group(0))
    first = re.match(r"[a-z]+", s)
    if first and first.group(0) in _NUM_WORDS:
        return _NUM_WORDS[first.group(0)]
    return None


def parse_float(raw) -> float | None:
    if raw is None or raw == "":
        return None
    try:
        return float(str(raw).strip().replace(",", ""))
    except ValueError:
        return None


_DATE_RE = re.compile(
    r"(\d{4}-\d{2}-\d{2}|\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9},?\s+\d{4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})"
)


def parse_date(raw) -> date | None:
    if raw is None or raw == "":
        return None
    if isinstance(raw, datetime):
        return raw.date()
    if isinstance(raw, date):
        return raw
    s = str(raw).strip()
    m = _DATE_RE.search(s)
    if not m:
        return None
    token = m.group(1)
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", token):
        try:
            return date.fromisoformat(token)
        except ValueError:
            return None
    try:
        return dateparser.parse(token, dayfirst=True).date()
    except (ValueError, OverflowError):
        return None


def find_dates(raw: str) -> list[date]:
    out = []
    for m in _DATE_RE.finditer(raw or ""):
        d = parse_date(m.group(1))
        if d:
            out.append(d)
    return out


def coerce(ftype: str, value):
    """Return (normalized_value, ok). Empty input -> (None, True)."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return None, True
    if ftype == "money":
        v = parse_money(value)
    elif ftype == "percent":
        v = parse_percent(value)
    elif ftype == "int":
        v = parse_int(value)
    elif ftype == "float":
        v = parse_float(value)
    elif ftype == "date":
        d = parse_date(value)
        v = d.isoformat() if d else None
    else:
        v = str(value).strip()
    return v, v is not None
