"""Seed PostgreSQL with SYNTHETIC demo data (no real people, no Aadhaar, no real project records).

    python -m database.seed            # seed if the database is empty
    python -m database.seed --reset    # drop everything and reseed

Creates: roles/permissions, 8 agencies, demo users for every role, ~176 historical projects (with
progress snapshots), 14 live projects, complaints, inspections, decisions, notifications, reviews and
placeholder site photos. MPLADS-PN-001 (the headline demo project) is deliberately NOT seeded - it
enters through the PDF upload in demo_pdfs/ (its 4 verified complaints are waiting under that code).
"""
from __future__ import annotations

import io
import math
import random
import sys
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from PIL import Image, ImageDraw
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from backend.app import permissions as P
from backend.app.config import get_settings
from backend.app.database import Base, SessionLocal, engine
from backend.app.demo_accounts import DEMO_ACCOUNTS
from backend.app.models import (Agency, AgencyRequest, Clarification, Complaint, Decision, Document, Inspection,
                                OfficerWarning, Payment, Project, ProjectAssignmentHistory, ProgressReport, Review,
                                RolePermission, User, RiskAnalysis)
from backend.app.security import hash_password
from backend.app.services import file_storage as FS
from backend.app.services import notify, risk_service
from backend.app.services.audit import install_immutability, log_audit
from backend.app.services.reference import DISTRICT_CENTROIDS
from backend.app.services.stats import refresh_agency_stats

D = lambda x: Decimal(str(round(float(x), 2)))
LAKH = 100_000.0
UTC = timezone.utc


def dt(d: date, hour: int = 11) -> datetime:
    return datetime(d.year, d.month, d.day, hour, 0, tzinfo=UTC)


# ------------------------------------------------------------------ static reference for generation
AGENCIES = {
    # name: (district, mean_delay, sd_delay, n_hist, ext_rate, rev_rate, code)
    "Municipal Works Department": ("Pune", 78, 70, 24, 0.9, 0.7, "PN"),
    "PWD Pune Division": ("Pune", 34, 30, 26, 0.5, 0.5, "PN"),
    "Zilla Parishad Works Pune": ("Pune", 20, 22, 22, 0.3, 0.3, "PN"),
    "Pimpri Chinchwad Civic Works": ("Pimpri-Chinchwad", 45, 40, 24, 0.5, 0.5, "PC"),
    "Water Supply & Sanitation Board Pune": ("Pune", 30, 28, 22, 0.4, 0.4, "PN"),
    "Satara Rural Development Agency": ("Satara", 40, 35, 20, 0.5, 0.4, "ST"),
    "Kolhapur Municipal Works": ("Kolhapur", 25, 24, 20, 0.3, 0.3, "KP"),
    "Nashik District Works Cell": ("Nashik", 70, 60, 18, 0.8, 0.6, "NS"),
}
CAT_BASE = {"Road Development": 15 * LAKH, "Water Supply": 30 * LAKH, "School Building": 40 * LAKH,
            "Community Hall": 20 * LAKH, "Drainage & Sanitation": 25 * LAKH, "Street Lighting": 8 * LAKH,
            "Health Centre": 35 * LAKH, "Bridge / Culvert": 60 * LAKH}
CAT_DUR = {"Road Development": 330, "Water Supply": 420, "School Building": 480, "Community Hall": 360,
           "Drainage & Sanitation": 390, "Street Lighting": 210, "Health Centre": 500, "Bridge / Culvert": 560}
CAT_WEIGHTS = {"Road Development": 0.27, "Water Supply": 0.15, "School Building": 0.12, "Community Hall": 0.11,
               "Drainage & Sanitation": 0.12, "Street Lighting": 0.08, "Health Centre": 0.07, "Bridge / Culvert": 0.08}
LOCALITIES = {
    "Pune": [("Kothrud", 18.5074, 73.8077), ("Hadapsar", 18.5089, 73.9260), ("Sinhagad Road", 18.4813, 73.8113),
             ("Baner", 18.5590, 73.7868), ("Wagholi", 18.5808, 73.9787), ("Katraj", 18.4575, 73.8677),
             ("Yerawada", 18.5530, 73.8990), ("Warje", 18.4830, 73.8000), ("Hinjewadi", 18.5912, 73.7389),
             ("Shirur", 18.8286, 74.3766), ("Maval", 18.7300, 73.6500), ("Baramati", 18.1522, 74.5815)],
    "Pimpri-Chinchwad": [("Chinchwad Gaon", 18.6298, 73.7997), ("Pimple Saudagar", 18.6020, 73.7960),
                         ("Nigdi", 18.6494, 73.7684), ("Akurdi", 18.6483, 73.7715), ("Bhosari", 18.6190, 73.8480)],
    "Satara": [("Karad", 17.2850, 74.1810), ("Koregaon", 17.6890, 74.1580), ("Wai", 17.9520, 73.8900), ("Phaltan", 17.9800, 74.4300)],
    "Kolhapur": [("Shahupuri", 16.7040, 74.2400), ("Ichalkaranji", 16.6910, 74.4600), ("Gadhinglaj", 16.2310, 74.3500)],
    "Nashik": [("Panchavati", 20.0060, 73.7900), ("Sinnar", 19.8460, 73.9990), ("Igatpuri", 19.6960, 73.5610), ("Satpur", 19.9970, 73.7440)],
}
CONSTITUENCY = {"Pune": ["Pune", "Baramati", "Maval", "Shirur"], "Pimpri-Chinchwad": ["Maval", "Shirur"],
                "Satara": ["Satara"], "Kolhapur": ["Kolhapur"], "Nashik": ["Nashik"]}
CATEGORY_SHORT = {"Road Development": "Road Development", "Water Supply": "Water Supply", "School Building": "School Building",
                  "Community Hall": "Community Hall", "Drainage & Sanitation": "Drainage Upgrade", "Street Lighting": "Street Lighting",
                  "Health Centre": "Health Centre", "Bridge / Culvert": "Bridge Works"}


# ------------------------------------------------------------------ helpers
def photo_bytes(caption: str, seed: int) -> bytes:
    rng = random.Random(seed)
    w, h = 800, 500
    img = Image.new("RGB", (w, h))
    px = img.load()
    top, bot = (110 + rng.randint(-20, 20), 160 + rng.randint(-20, 20), 210), (200, 205, 190)
    for y in range(h):
        t = y / h
        for x in range(w):
            px[x, y] = tuple(int(top[i] * (1 - t) + bot[i] * t) for i in range(3))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 330, w, h], fill=(96, 96, 100))                       # ground / road
    for x in range(0, w, 90):
        d.rectangle([x, 405, x + 45, 415], fill=(235, 235, 235))          # lane marks
    for i in range(3):                                                    # simple structures
        x0 = 80 + i * 240 + rng.randint(-20, 20)
        d.rectangle([x0, 230 - i * 15, x0 + 130, 330], fill=(170 - i * 20, 140, 120))
        d.rectangle([x0 + 20, 260 - i * 15, x0 + 50, 300], fill=(60, 80, 110))
    d.rectangle([0, 0, w, 44], fill=(20, 40, 70))
    d.text((14, 14), f"SYNTHETIC SITE PHOTO  |  {caption}", fill=(255, 255, 255))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=80)
    return buf.getvalue()


def add_photo(db: Session, project: Project, uploader: User | None, caption: str, seed: int, when: date):
    rel, sha = FS.save_bytes(photo_bytes(f"{project.project_code} {caption}", seed), f"projects/{project.project_id}", "image/jpeg")
    db.add(Document(project_id=project.project_id, document_type="Photo", file_name=f"{project.project_code}_{caption.replace(' ', '_')}.jpg",
                    file_path=rel, content_type="image/jpeg", size_bytes=1, sha256=sha, version=1, is_public=True,
                    description=caption, uploaded_by=uploader.user_id if uploader else None, uploaded_at=dt(when)))


# ------------------------------------------------------------------ permissions & users
def seed_permissions(db: Session):
    db.query(RolePermission).delete()
    for role, perms in P.ROLE_PERMISSIONS.items():
        for perm in perms:
            db.add(RolePermission(role_name=role, permission=perm, description=P.PERMISSION_DESCRIPTIONS.get(perm)))
    db.flush()


def seed_users(db: Session, password: str, agencies: dict[str, Agency]) -> dict[str, User]:
    pw = hash_password(password)
    users = {}
    for email, name, role, dept, dist, cons, agency, insp in DEMO_ACCOUNTS:
        u = User(name=name, email=email, password_hash=pw, role=role, department=dept, district=dist, constituency=cons,
                 agency_id=agencies[agency].agency_id if agency else None, is_inspector=insp, status="Active")
        db.add(u)
        users[email] = u
    for i, nm in enumerate(["Sunita More", "Amit Jadhav", "Neha Kale", "Imran Sheikh"], start=3):
        u = User(name=nm, email=f"citizen{i}@mplads.demo", password_hash=pw, role=P.CITIZEN, district="Pune", constituency="Pune")
        db.add(u)
        users[u.email] = u
    db.flush()
    return users


# ------------------------------------------------------------------ historical projects
def seed_historical(db: Session, agencies: dict[str, Agency], anchor: date, rng: random.Random) -> list[Project]:
    projects: list[Project] = []
    seq: dict[str, int] = {}
    cats = list(CAT_WEIGHTS)
    weights = [CAT_WEIGHTS[c] for c in cats]

    for aname, (district, mean_d, sd_d, n, ext_rate, rev_rate, code) in AGENCIES.items():
        ag = agencies[aname]
        for k in range(n):
            if aname == "Municipal Works Department" and k < 13:
                cat = "Road Development"
            elif aname == "Municipal Works Department":
                cat = rng.choices([c for c in cats if c != "Road Development"], k=1)[0]
            else:
                cat = rng.choices(cats, weights=weights, k=1)[0]
            amt = min(90 * LAKH, max(3 * LAKH, round(CAT_BASE[cat] * rng.lognormvariate(0, 0.42) / 10000) * 10000))
            dur = int(min(720, max(150, CAT_DUR[cat] * (0.75 + 0.25 * amt / CAT_BASE[cat]) * rng.uniform(0.85, 1.15))))
            ontime_p = 0.3 if mean_d < 50 else 0.15
            delay = 0 if rng.random() < ontime_p else int(min(420, max(1, rng.gauss(mean_d, sd_d))))
            ongoing = rng.random() < 0.20
            revs = min(4, int(sum(rng.random() < rev_rate * (0.25 + delay / 220) / 2 for _ in range(4))))
            exts = min(4, int(sum(rng.random() < ext_rate * (0.2 + delay / 160) / 2 for _ in range(4))))
            sanctioned = amt * (1 + 0.05 * revs)

            if not ongoing:
                completion = anchor - timedelta(days=rng.randint(25, 1900))
                deadline = completion - timedelta(days=delay)
                start = deadline - timedelta(days=dur)
                progress, planned, status = 100.0, 100.0, "Closed"
                expenditure = sanctioned * rng.uniform(0.93, 1.0)
                delay_days, comp_date = delay, completion
                revised = deadline + timedelta(days=min(delay, 120)) if exts else None
            else:
                late = rng.random() < 0.3
                frac = rng.uniform(1.05, 1.4) if late else rng.uniform(0.3, 0.9)
                start = anchor - timedelta(days=int(frac * dur))
                deadline = start + timedelta(days=dur)
                planned = min(100.0, round(frac * 100 * rng.uniform(0.97, 1.0), 1))
                lag = rng.uniform(0.70, 0.93) if mean_d > 50 else rng.uniform(0.88, 1.03)
                progress = round(min(97.0, max(8.0, planned * lag if not late else rng.uniform(62, 92))), 1)
                expenditure = min(sanctioned, sanctioned * progress / 100 * rng.uniform(0.92, 1.12))
                delay_days = max(0, (anchor - deadline).days)
                comp_date, status = None, "Under Review" if delay_days > 90 else "Cleared - Routine Monitoring"
                revised = deadline + timedelta(days=90) if exts else None
                if late:
                    delay = delay_days
            loc = rng.choice(LOCALITIES[district])
            seq[code] = seq.get(code, 100) + 1
            p = Project(
                project_code=f"MPLADS-{code}-{seq[code]}", name=f"{CATEGORY_SHORT[cat]} — {loc[0]} (Ward {rng.randint(1, 40)})",
                category=cat, location=f"{loc[0]}, {district}", latitude=round(loc[1] + rng.uniform(-0.012, 0.012), 5),
                longitude=round(loc[2] + rng.uniform(-0.012, 0.012), 5), district=district,
                constituency=rng.choice(CONSTITUENCY[district]), agency_id=ag.agency_id,
                description=f"{cat} works at {loc[0]}: scope as per sanctioned estimate (synthetic historical record).",
                sanction_date=start - timedelta(days=rng.randint(25, 70)), sanctioned_amount=D(sanctioned),
                released_amount=D(min(sanctioned, expenditure * 1.05 + 20000)), expenditure=D(expenditure),
                remaining_amount=D(max(0, sanctioned - expenditure)), progress=progress, planned_progress=planned,
                start_date=start, deadline=deadline, revised_deadline=revised, completion_date=comp_date, as_of_date=anchor,
                reporting_period=f"Snapshot {anchor:%b %Y}", delay_days=delay_days if ongoing else delay,
                budget_revisions=revs, extension_requests=exts, milestones=[],
                status=status, verification_status="Verified", is_public=(len(projects) % 6 == 0),
                is_historical=True, verified_at=dt(start), created_at=dt(start),
            )
            projects.append(p)
    db.add_all(projects)
    db.flush()

    # ---- anomalous historical cases (unusual patterns) -> earlier high-risk analyses for some agencies
    anomalies = {"Municipal Works Department": 3, "Nashik District Works Cell": 2, "PWD Pune Division": 2,
                 "Satara Rural Development Agency": 1, "Pimpri Chinchwad Civic Works": 1}
    by_agency: dict[int, list[Project]] = {}
    for p in projects:
        by_agency.setdefault(p.agency_id, []).append(p)
    risky: list[Project] = []
    for aname, cnt in anomalies.items():
        pool = [p for p in by_agency[agencies[aname].agency_id] if not p.completion_date is None][: 40]
        for p in rng.sample(pool, min(cnt, len(pool))):
            p.delay_days = rng.randint(230, 390)
            p.deadline = p.completion_date - timedelta(days=p.delay_days)
            p.start_date = p.deadline - timedelta(days=CAT_DUR[p.category])
            p.extension_requests, p.budget_revisions = 3, rng.randint(2, 3)
            p.sanctioned_amount = D(float(p.sanctioned_amount) * 1.15)
            p.expenditure = D(float(p.sanctioned_amount) * 0.99)
            risky.append(p)

    # ---- progress snapshots (for "average expenditure at a similar stage")
    for p in projects:
        sanctioned = float(p.sanctioned_amount)
        end = p.completion_date or anchor
        total_days = max(60, (end - p.start_date).days)
        anom = p in risky
        for t in (0.3, 0.55, 0.8, 1.0):
            if p.completion_date is None and t == 1.0:
                prog = p.progress
            else:
                prog = min(100.0, (p.progress if p.completion_date is None else 100.0) * t ** 0.95 * rng.uniform(0.94, 1.04))
            ratio = min(1.0, prog / 100 * rng.uniform(0.92, 1.10) * (1.28 if anom else 1.0))
            db.add(ProgressReport(project_id=p.project_id, agency_id=p.agency_id, period_label=f"Stage {int(t * 100)}%",
                                  report_date=p.start_date + timedelta(days=int(total_days * t)), progress=round(prog, 1),
                                  planned_progress=round(t * 100 * (1.0 if p.completion_date else (p.planned_progress or 100) / 100), 1),
                                  expenditure=D(sanctioned * ratio)))
    # ---- earlier (synthetic) risk analyses for historical cases -> agency "previous high-risk cases"
    for p in risky:
        score = rng.choice([64, 68, 72, 78, 83, 86])
        db.add(RiskAnalysis(project_id=p.project_id, risk_score=score, risk_level="Critical" if score >= 80 else "High",
                            contributing_factors=[{"key": "delay", "label": f"{p.delay_days}-day delay", "detail": "Historical record (seed).",
                                                   "signal": "Unusual pattern detected", "points": 20.0, "max_points": 16.5, "severity": 1.0,
                                                   "contributing": True}],
                            historical_comparison={"note": "Historical synthetic record"}, anomaly_score=None, rule_score=score,
                            model_version="seed-historical-v0", timestamp=dt(p.completion_date or anchor)))
    return projects


# ------------------------------------------------------------------ live projects
LIVE = [
    # code, name, agency, category, district, locality idx, sanction(L), start_off, deadline_off, revised_off, progress, planned, exp_ratio, revs, exts, target
    ("MPLADS-PN-201", "Community Hall — Kothrud", "Municipal Works Department", "Community Hall", "Pune", "Kothrud", 22.0, -350, -30, None, 71, 85, 0.68, 0, 0, "Under Review"),
    ("MPLADS-PN-202", "Street Lighting — Baner", "Municipal Works Department", "Street Lighting", "Pune", "Baner", 8.5, -270, 60, None, 40, 45, 0.38, 0, 0, "Cleared - Routine Monitoring"),
    ("MPLADS-PN-203", "Drainage Upgrade — Hadapsar", "Municipal Works Department", "Drainage & Sanitation", "Pune", "Hadapsar", 31.0, -480, -120, 5, 66, 92, 0.81, 1, 1, None),
    ("MPLADS-PN-204", "Bridge Works — Mula River Crossing", "PWD Pune Division", "Bridge / Culvert", "Pune", "Baramati", 64.0, -700, -300, -90, 78, 100, 0.96, 3, 3, "ESCALATE"),
    ("MPLADS-PN-205", "Road Development — Wagholi", "PWD Pune Division", "Road Development", "Pune", "Wagholi", 27.0, -240, 120, None, 55, 60, 0.52, 0, 0, None),
    ("MPLADS-PN-206", "School Building — Shirur", "Zilla Parishad Works Pune", "School Building", "Pune", "Shirur", 45.0, -420, 50, None, 90, 92, 0.88, 0, 0, None),
    ("MPLADS-PN-207", "Water Supply — Maval", "Zilla Parishad Works Pune", "Water Supply", "Pune", "Maval", 38.0, -390, -96, 40, 35, 70, 0.52, 0, 2, None),
    ("MPLADS-PC-208", "Road Development — Pimple Saudagar", "Pimpri Chinchwad Civic Works", "Road Development", "Pimpri-Chinchwad", "Pimple Saudagar", 19.0, -420, -60, None, 100, 100, 0.97, 0, 0, "COMPLETED"),
    ("MPLADS-PC-209", "Health Centre — Nigdi", "Pimpri Chinchwad Civic Works", "Health Centre", "Pimpri-Chinchwad", "Nigdi", 52.0, -300, 180, None, 48, 55, 0.50, 0, 0, None),
    ("MPLADS-PN-210", "Water Supply — Kothrud", "Water Supply & Sanitation Board Pune", "Water Supply", "Pune", "Kothrud", 29.0, -300, 90, None, 62, 70, 0.60, 0, 0, None),
    ("MPLADS-PN-211", "Drainage Upgrade — Katraj", "Water Supply & Sanitation Board Pune", "Drainage & Sanitation", "Pune", "Katraj", 24.0, -420, -140, None, 25, 65, 0.45, 1, 2, None),
    ("MPLADS-ST-212", "School Building — Karad", "Satara Rural Development Agency", "School Building", "Satara", "Karad", 40.0, -280, 110, None, 60, 62, 0.58, 0, 0, None),
    ("MPLADS-KP-213", "Community Hall — Shahupuri", "Kolhapur Municipal Works", "Community Hall", "Kolhapur", "Shahupuri", 18.0, -320, 40, None, 85, 88, 0.83, 0, 0, None),
    ("MPLADS-NS-214", "Road Development — Sinnar", "Nashik District Works Cell", "Road Development", "Nashik", "Sinnar", 33.0, -560, -210, None, 30, 80, 0.70, 2, 3, None),
]


def seed_live(db: Session, agencies, users, anchor: date, rng: random.Random) -> dict[str, Project]:
    out: dict[str, Project] = {}
    for (code, name, aname, cat, district, loc, sanction, s_off, d_off, r_off, prog, plan, exp_ratio, revs, exts, _t) in LIVE:
        lat, lon = next((la, lo) for (n_, la, lo) in LOCALITIES[district] if n_ == loc)
        start, deadline = anchor + timedelta(days=s_off), anchor + timedelta(days=d_off)
        revised = anchor + timedelta(days=r_off) if r_off is not None else None
        completed = prog >= 100
        completion = anchor - timedelta(days=50) if completed else None
        delay = max(0, ((completion or anchor) - deadline).days)
        amount = sanction * LAKH
        p = Project(
            project_code=code, name=name, category=cat, location=f"{loc}, {district}",
            latitude=round(lat + rng.uniform(-0.004, 0.004), 5), longitude=round(lon + rng.uniform(-0.004, 0.004), 5), district=district,
            constituency=rng.choice(CONSTITUENCY[district]), agency_id=agencies[aname].agency_id,
            mp_id=users["mp@mplads.demo"].user_id, officer_id=users["officer@mplads.demo"].user_id,
            type="Civil Infrastructure",
            description=f"{cat} works at {loc} funded under MPLADS-type local area development (synthetic demo project).",
            sanction_date=start - timedelta(days=40), sanctioned_amount=D(amount),
            approved_budget=D(amount), released_amount=D(min(amount, amount * exp_ratio + 3 * LAKH)),
            expenditure=D(amount * exp_ratio), remaining_amount=D(amount * (1 - exp_ratio)), progress=float(prog),
            planned_progress=float(plan), start_date=start, deadline=deadline, revised_deadline=revised,
            completion_date=completion, expected_days=max(1, (deadline - start).days), as_of_date=anchor,
            reporting_period=f"Snapshot {anchor:%d %b %Y}", delay_days=delay,
            budget_revisions=revs, extension_requests=exts, milestones=[], status="Verified - Analysis Pending",
            verification_status="Verified", is_public=True, is_historical=False, verified_at=dt(start), created_at=dt(start),
            created_by=users["mp@mplads.demo"].user_id, verified_by=users["officer@mplads.demo"].user_id,
        )
        db.add(p)
        db.flush()
        db.add(ProjectAssignmentHistory(
            project_id=p.project_id, previous_agency_id=None, new_agency_id=p.agency_id,
            previous_officer_id=None, new_officer_id=p.officer_id,
            changed_by=users["mp@mplads.demo"].user_id, reason="Initial MP project assignment",
            created_at=dt(start),
        ))
        out[code] = p
    db.flush()

    # monthly progress reports + a couple of photos per project
    for i, (code, *_rest) in enumerate(LIVE):
        p = out[code]
        ag_users = [u for u in users.values() if u.role == P.AGENCY and u.agency_id == p.agency_id]
        elapsed = max(30, (anchor - p.start_date).days)
        n = 4
        for k in range(1, n + 1):
            f = k / n
            pr = round(p.progress * f * rng.uniform(0.96, 1.02) if k < n else p.progress, 1)
            ex = float(p.expenditure) * (f ** 1.05) if k < n else float(p.expenditure)
            db.add(ProgressReport(
                project_id=p.project_id, agency_id=p.agency_id, submitted_by=ag_users[0].user_id if ag_users else None,
                period_label=f"Month {k}", reporting_week=f"Week {k * 4}",
                report_date=p.start_date + timedelta(days=int(elapsed * f)) - (timedelta(days=0) if k < n else timedelta(days=26)),
                progress=min(pr, p.progress), planned_progress=round(float(p.planned_progress or 0) * f, 1),
                progress_change=round(pr / n, 1), expenditure=D(ex), delay_days=p.delay_days,
                reason_for_delay="Monsoon and utility-shifting delays." if (p.delay_days or 0) > 0 and k == n else None,
                milestones_completed=[f"Milestone {k}: Structural phase {k} completed"],
                issues="Utility relocation pending" if k == 2 and p.delay_days > 0 else None,
                corrective_action="Additional work shifts arranged" if k == 2 and p.delay_days > 0 else None,
                next_week_plan="Continue surface leveling and base compaction",
                evidence=[],
                delay_explanation="Monsoon and utility-shifting delays." if (p.delay_days or 0) > 0 and k == n else None,
            ))
        if i % 2 == 0 or (p.progress >= 50):
            add_photo(db, p, ag_users[0] if ag_users else None, "Site progress", 1000 + i, anchor - timedelta(days=20 + i))
            add_photo(db, p, ag_users[0] if ag_users else None, "Work in progress", 2000 + i, anchor - timedelta(days=60 + i))
    db.flush()

    # payment schedule for the escalated bridge project and one delayed drainage project (payment-pattern signals)
    b = out["MPLADS-PN-204"]
    for k, (days, amt) in enumerate([(-600, 12 * LAKH), (-320, 4.95 * LAKH), (-305, 4.9 * LAKH), (-292, 4.85 * LAKH), (-150, 15.5 * LAKH), (-30, 19.3 * LAKH)]):
        db.add(Payment(project_id=b.project_id, paid_on=anchor + timedelta(days=days), amount=D(amt), description=f"Stage payment {k + 1}", reference=f"V-{2100 + k}"))
    for k, (days, amt) in enumerate([(-300, 8 * LAKH), (-210, 9 * LAKH), (-90, 8 * LAKH)]):
        db.add(Payment(project_id=out["MPLADS-PN-203"].project_id, paid_on=anchor + timedelta(days=days), amount=D(amt), description=f"Running bill {k + 1}", reference=f"V-{3100 + k}"))
    db.flush()

    # Sample officer warnings on delayed projects
    db.add(OfficerWarning(
        project_id=out["MPLADS-PN-204"].project_id, agency_id=out["MPLADS-PN-204"].agency_id,
        issued_by=users["officer@mplads.demo"].user_id, warning_type="Progress Update Required",
        severity="Urgent", message="Bridge progress has fallen behind schedule by over 200 days. Immediate progress report and catch-up plan required.",
        status="Active", created_at=dt(anchor - timedelta(days=12)),
    ))
    db.add(OfficerWarning(
        project_id=out["MPLADS-PN-203"].project_id, agency_id=out["MPLADS-PN-203"].agency_id,
        issued_by=users["officer@mplads.demo"].user_id, warning_type="Weekly Report Missing",
        severity="Warning", message="Weekly report missing for last reporting cycle. Submit immediately.",
        status="Active", created_at=dt(anchor - timedelta(days=5)),
    ))
    db.flush()
    return out


# ------------------------------------------------------------------ complaints, inspections, decisions, etc.
def mk_complaint(db, users, citizen_email, project, code_ref, category, text_, days_ago, anchor, *, anonymous=False, screening="Verified",
                 status="Assigned", serious=False, response=None, resolution=None, screener="officer@mplads.demo", tracking="",
                 feedback=None, appeal=None, appeal_status="None", note="Screened: matches site observations."):
    created = anchor - timedelta(days=days_ago)
    c = Complaint(
        tracking_id=tracking,
        project_id=project.project_id if project else None, project_code_ref=code_ref, citizen_id=users[citizen_email].user_id,
        category=category, description=text_, incident_date=created - timedelta(days=3), location_text=project.location if project else None,
        evidence=[], anonymous=anonymous, status=status, serious=serious, screening_status=screening,
        screened_by=users[screener].user_id if screening != "Pending" else None, screened_at=dt(created + timedelta(days=2)) if screening != "Pending" else None,
        screening_note=note if screening != "Pending" else None, response=response, responded_at=dt(created + timedelta(days=5)) if response else None,
        resolution=resolution, resolved_at=dt(created + timedelta(days=12)) if resolution else None,
        feedback_satisfied=feedback, feedback_comment="Work still incomplete." if feedback is False else None,
        appeal=appeal, appeal_status=appeal_status, created_at=dt(created), updated_at=dt(created + timedelta(days=3)),
    )
    db.add(c)
    return c


def seed_complaints(db: Session, users, live, hist, anchor, rng):
    # --- 4 verified complaints waiting for the demo project (linked when MPLADS-PN-001 is verified)
    mk_complaint(db, users, "citizen@mplads.demo", None, "MPLADS-PN-001", "Poor quality of work",
                 "The newly laid base course near Sinhagad Road has already developed cracks and loose gravel after light rain.", 70, anchor,
                 status="Under Investigation", tracking="CMP-2025-PN001A", response="Quality tests are being repeated at the site.")
    mk_complaint(db, users, "citizen2@mplads.demo", None, "MPLADS-PN-001", "Work delay / stalled",
                 "Work has been stopped for many weeks. Machines were removed and the road is open with trenches.", 55, anchor,
                 status="Under Investigation", tracking="CMP-2025-PN001B")
    mk_complaint(db, users, "citizen3@mplads.demo", None, "MPLADS-PN-001", "Safety hazard",
                 "Open drain trench without barricades next to the school gate; children and two-wheelers are at risk.", 40, anchor,
                 anonymous=True, serious=True, status="Assigned", tracking="CMP-2025-PN001C")
    mk_complaint(db, users, "citizen4@mplads.demo", None, "MPLADS-PN-001", "Incomplete work marked complete",
                 "Asphalt surfacing is shown as done on the notice board but only a 300 m stretch has been surfaced.", 25, anchor,
                 status="Assigned", tracking="CMP-2025-PN001D")

    # --- escalated bridge project
    br = live["MPLADS-PN-204"]
    mk_complaint(db, users, "citizen@mplads.demo", br, br.project_code, "Financial irregularity",
                 "Payments seem to be released repeatedly while the bridge deck is not visibly progressing.", 120, anchor, serious=True,
                 status="Resolved", resolution="Inspection scheduled; billing records requested from the agency.", response="Work is progressing per the plan.",
                 tracking="CMP-2025-BR001", feedback=False, appeal="Resolution does not address the payment concern.", appeal_status="Pending")
    mk_complaint(db, users, "citizen2@mplads.demo", br, br.project_code, "Work delay / stalled",
                 "No worker activity at the bridge for over two months.", 90, anchor, status="Under Investigation", tracking="CMP-2025-BR002")
    mk_complaint(db, users, "citizen5@mplads.demo", br, br.project_code, "Poor quality of work",
                 "Concrete on the approach slab has visible honeycombing.", 80, anchor, status="Under Investigation", tracking="CMP-2025-BR003")

    # --- drainage project: one verified, one pending screening
    dr = live["MPLADS-PN-203"]
    mk_complaint(db, users, "citizen@mplads.demo", dr, dr.project_code, "Work delay / stalled",
                 "Drain work is stopped and the open trench floods during rain.", 45, anchor, status="Under Investigation", tracking="CMP-2025-DR001",
                 response="Materials delayed; work will restart next month.")
    mk_complaint(db, users, "citizen2@mplads.demo", dr, dr.project_code, "Poor quality of work",
                 "Pipes laid are thinner than shown on the sign board.", 3, anchor, screening="Pending", status="Submitted", tracking="CMP-2025-DR002")

    # --- citizen@ tracking examples
    ch = live["MPLADS-PN-201"]
    mk_complaint(db, users, "citizen@mplads.demo", ch, ch.project_code, "Other", "Hall roof leaks near the entrance during monsoon.", 30, anchor,
                 status="Resolved", resolution="Waterproofing repair completed and verified by the officer on site.", response="Repair scheduled and completed.",
                 tracking="CMP-2025-CH001")
    ls = live["MPLADS-PN-202"]
    mk_complaint(db, users, "citizen@mplads.demo", ls, ls.project_code, "Other", "Two street lights near the bus stop are not working.", 2, anchor,
                 screening="Pending", status="Submitted", tracking="CMP-2025-LS001")

    # --- closed complaints on historical projects (feeds the 'verified complaints' feature)
    hist_sample = rng.sample(hist, 34)
    cats = ["Poor quality of work", "Work delay / stalled", "Other"]
    emails = ["citizen3@mplads.demo", "citizen4@mplads.demo", "citizen5@mplads.demo", "citizen6@mplads.demo"]  # keep demo citizens' lists tidy
    for i, p in enumerate(hist_sample):
        c = mk_complaint(db, users, emails[i % 4], p, p.project_code, cats[i % 3], "Historical complaint (synthetic record) regarding work quality.",
                         rng.randint(300, 1500), anchor, status="Closed", resolution="Resolved after site inspection.", response="Addressed.",
                         tracking=f"CMP-H{i:04d}", feedback=True)


def seed_operations(db: Session, users, live, anchor, rng):
    officer, head = users["officer@mplads.demo"], users["head@mplads.demo"]
    inspector = users["inspector@mplads.demo"]
    ag1, ag2 = users["agency@mplads.demo"], users["agency2@mplads.demo"]

    # --- quiet risk analyses on all live projects (no notification noise)
    for code, p in live.items():
        risk_service.run_risk_analysis(db, p, None, notify_users=False)
    db.flush()

    # --- put the live projects in realistic case states via real decisions (audited)
    def decide(code, decision, reason, evidence, follow=None, action=None, new_status=None, level=None):
        p = live[code]
        risk = db.execute(select(RiskAnalysis).where(RiskAnalysis.project_id == p.project_id).order_by(RiskAnalysis.risk_id.desc())).scalars().first()
        who = head if decision in ("Acknowledge",) else officer
        prev = p.status
        p.status = new_status
        if level is not None:
            p.case_level = level
        db.add(Decision(project_id=p.project_id, user_id=who.user_id, role=who.role, decision=decision, reason=reason, evidence_reviewed=evidence,
                        follow_up_date=follow, action=action, risk_id=risk.risk_id, previous_status=prev, new_status=new_status,
                        created_at=dt(anchor - timedelta(days=rng.randint(2, 12)))))
        log_audit(db, who, "Escalation" if "Escalate" in decision else "Decision", "Project", code, project_id=p.project_id,
                  previous={"status": prev}, new={"decision": decision, "status": new_status}, reason=reason)

    decide("MPLADS-PN-202", "Clear for Routine Monitoring", "Progress and spend are in line with plan; no complaints outstanding.",
           ["Risk factors", "Historical comparison"], follow=anchor + timedelta(days=60), action="Routine quarterly review", new_status="Cleared - Routine Monitoring", level=0)
    decide("MPLADS-PN-201", "Keep Under Review", "Moderate delay explained by monsoon; awaiting next progress report.",
           ["Risk factors", "Agency explanation"], follow=anchor - timedelta(days=20), action="Check next monthly report", new_status="Under Review")
    decide("MPLADS-PN-204", "Escalate to Head Officer", "Repeated extensions, payments clustered below approval level and 3 verified complaints; supervisory review needed.",
           ["Risk factors", "Historical comparison", "Citizen feedback / complaints", "Source documents"], follow=anchor + timedelta(days=7),
           action="Head Officer to assign inspection", new_status="Escalated to Head Officer", level=2)
    decide("MPLADS-PC-208", "Clear for Routine Monitoring", "Completed with a marginal delay; closed.", ["Risk factors"], action="Close out", new_status="Closed", level=0)
    live["MPLADS-PC-208"].status = "Closed"

    # --- inspection on the bridge: assigned to the inspector and already past due (shows up as overdue)
    insp = Inspection(project_id=live["MPLADS-PN-204"].project_id, requested_by=officer.user_id, assigned_to=inspector.user_id, assigned_by=head.user_id,
                      reason="Verify physical progress of the deck slab against billed quantities and complaint claims.", priority="High",
                      status="Assigned", due_date=date.today() - timedelta(days=10), requested_at=dt(anchor - timedelta(days=25)))
    db.add(insp)
    # --- earlier inspections on historical projects (adverse findings feed the agency 'previous inspections' signal)
    mwd = db.execute(select(Project).where(Project.is_historical.is_(True), Project.category == "Road Development",
                                           Project.agency_id == live["MPLADS-PN-201"].agency_id).limit(2)).scalars().all()
    for i, hp in enumerate(mwd):
        db.add(Inspection(project_id=hp.project_id, requested_by=officer.user_id, assigned_to=inspector.user_id, assigned_by=head.user_id,
                          reason="Quality audit after complaints (synthetic historical inspection).", priority="Medium", status="Closed",
                          outcome="Major Deficiencies" if i == 0 else "Minor Deficiencies", findings="Bituminous thickness below specification at several chainages.",
                          recommendation="Rectify and retest.", scheduled_date=anchor - timedelta(days=500 + i * 60), due_date=anchor - timedelta(days=480),
                          requested_at=dt(anchor - timedelta(days=520 + i * 60)), completed_at=dt(anchor - timedelta(days=490 + i * 60)),
                          closed_at=dt(anchor - timedelta(days=470 + i * 60))))

    # --- open clarification + a pending extension request for the drainage project (agency dashboard content)
    dr = live["MPLADS-PN-203"]
    db.add(Clarification(project_id=dr.project_id, agency_id=dr.agency_id, requested_by=officer.user_id,
                         question="Explain the reason for the 118-day delay and the plan to recover the schedule.", due_date=date.today() + timedelta(days=5),
                         created_at=dt(anchor - timedelta(days=4))))
    dr.status = "Clarification Requested"
    db.add(AgencyRequest(project_id=live["MPLADS-PN-207"].project_id, agency_id=live["MPLADS-PN-207"].agency_id, request_type="Extension",
                         requested_deadline=anchor + timedelta(days=120), justification="Pipe supply delayed by the manufacturer; requesting 120 more days.",
                         submitted_by=users["agency@mplads.demo"].user_id, created_at=dt(anchor - timedelta(days=6))))

    # --- reviews from citizens
    comments = ["Good work so far, road is usable.", "Progress is slow but visible.", "Please speed up the work.", "Work quality looks fine.",
                "Site is often unattended.", "Very useful facility once finished."]
    citizens = [u for u in users.values() if u.role == P.CITIZEN]
    for i, (code, p) in enumerate(live.items()):
        for j, c in enumerate(citizens[: 1 + (i % 4)]):
            is_pending = (i == 0 and j == 0) or (i == 2 and j == 1)
            media = [{"file_name": "site_photo.jpg", "file_path": f"projects/{p.project_id}/photo.jpg", "content_type": "image/jpeg", "media_type": "IMAGE"}] if (i % 3 == 0) else []
            db.add(Review(
                project_id=p.project_id, citizen_id=c.user_id, rating=rng.choice([2, 3, 3, 4, 4, 5]),
                comment=rng.choice(comments), media=media,
                status="Pending" if is_pending else "Approved",
                moderated_by=users["officer@mplads.demo"].user_id if not is_pending else None,
                moderated_at=dt(anchor - timedelta(days=rng.randint(1, 20))) if not is_pending else None,
                created_at=dt(anchor - timedelta(days=rng.randint(1, 60))),
            ))
    db.flush()

    # --- a few starting notifications (unread) so every dashboard has content
    notify.notify(db, [head.user_id], "Escalation", "Case escalated by Anita Deshmukh: MPLADS-PN-204 (Bridge Works — Mula River Crossing) - Critical risk.",
                  "critical", project_id=live["MPLADS-PN-204"].project_id)
    notify.notify(db, [head.user_id], "Supervisory review", "Appeal requires review: complaint CMP-2025-BR001 on MPLADS-PN-204.", "action",
                  project_id=live["MPLADS-PN-204"].project_id)
    notify.notify(db, [officer.user_id], "Citizen complaint", "New citizen complaint CMP-2025-DR002 on MPLADS-PN-203 (Poor quality of work) awaiting screening.",
                  "review", project_id=live["MPLADS-PN-203"].project_id)
    notify.notify(db, [officer.user_id], "Citizen complaint", "New citizen complaint CMP-2025-LS001 on MPLADS-PN-202 awaiting screening.", "review",
                  project_id=live["MPLADS-PN-202"].project_id)
    notify.notify(db, [ag1.user_id], "Agency clarification", "Clarification requested for MPLADS-PN-203: Explain the reason for the 118-day delay...",
                  "action", project_id=dr.project_id)
    notify.notify(db, [ag1.user_id], "Citizen complaint", "A verified citizen complaint (CMP-2025-DR001) is open on MPLADS-PN-203. Please respond.", "action",
                  project_id=dr.project_id)
    notify.notify(db, [users["citizen@mplads.demo"].user_id], "Citizen complaint", "Your complaint CMP-2025-CH001 has been resolved. Please give your feedback.",
                  "action", project_id=live["MPLADS-PN-201"].project_id)
    notify.notify(db, [inspector.user_id], "Inspection requested", "You have been assigned an inspection for MPLADS-PN-204 (priority High).", "action",
                  project_id=live["MPLADS-PN-204"].project_id)
    notify.notify(db, [users["agency2@mplads.demo"].user_id], "Progress report", "Monthly progress reports are due for your assigned projects.", "review")


# ------------------------------------------------------------------ orchestration
def seed_all(db: Session) -> None:
    s = get_settings()
    anchor = date.today() - timedelta(days=3)
    rng = random.Random(20260921)
    seed_permissions(db)
    agencies: dict[str, Agency] = {}
    for name, (district, *_r) in AGENCIES.items():
        a = Agency(name=name, district=district, constituency=CONSTITUENCY[district][0])
        db.add(a)
        agencies[name] = a
    db.flush()
    users = seed_users(db, s.demo_password, agencies)
    hist = seed_historical(db, agencies, anchor, rng)
    live = seed_live(db, agencies, users, anchor, rng)
    db.flush()
    seed_complaints(db, users, live, hist, anchor, rng)
    db.flush()
    seed_operations(db, users, live, anchor, rng)
    db.flush()
    for a in agencies.values():
        refresh_agency_stats(db, a.agency_id)
    log_audit(db, None, "Seed", "System", "demo-data", new={"agencies": len(agencies), "users": len(users), "historical_projects": len(hist),
                                                               "live_projects": len(live)}, reason="Synthetic demo data loaded", role="System")
    db.commit()


def init_database(reset: bool = False, seed: bool = True) -> None:
    if reset:
        Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        install_immutability(conn)
    with SessionLocal() as db:
        # roles/permissions are always refreshed so code changes to RBAC take effect
        if db.scalar(select(User.user_id).limit(1)) is None:
            if seed:
                seed_all(db)
            else:
                seed_permissions(db)
                db.commit()
        else:
            seed_permissions(db)
            db.commit()


if __name__ == "__main__":
    init_database(reset="--reset" in sys.argv)
    print("Database ready.")
