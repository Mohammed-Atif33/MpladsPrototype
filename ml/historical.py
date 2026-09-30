"""Historical project comparison (pure pandas/numpy; no database access)."""
from __future__ import annotations

import numpy as np
import pandas as pd

SIZE_BANDS = [(0, 1_000_000, "Small"), (1_000_000, 5_000_000, "Medium"),
              (5_000_000, 20_000_000, "Large"), (20_000_000, float("inf"), "Very large")]


def size_band(amount: float) -> str:
    for lo, hi, name in SIZE_BANDS:
        if lo <= amount < hi:
            return name
    return "Small"


def _f(x, default=0.0) -> float:
    try:
        if x is None or (isinstance(x, float) and np.isnan(x)):
            return default
        return float(x)
    except (TypeError, ValueError):
        return default


HIST_COLS = ["project_id", "project_code", "name", "category", "district", "agency_id", "sanctioned_amount",
             "expenditure", "progress", "planned_progress", "delay_days", "duration_days",
             "budget_revisions", "extension_requests", "verified_complaints"]


def prepare_history(rows: list[dict]) -> pd.DataFrame:
    """rows: dicts with the HIST_COLS keys."""
    df = pd.DataFrame(rows, columns=HIST_COLS)
    for c in ["sanctioned_amount", "expenditure", "progress", "planned_progress", "delay_days",
              "duration_days", "budget_revisions", "extension_requests", "verified_complaints"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df["spend_ratio"] = np.where(df["sanctioned_amount"] > 0, df["expenditure"] / df["sanctioned_amount"], np.nan)
    df["size_band"] = df["sanctioned_amount"].fillna(0).map(size_band)
    return df


def prepare_snapshots(rows: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(rows, columns=["project_id", "progress", "spend_ratio"])
    for c in ["progress", "spend_ratio"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    return df


def _current(project: dict, spend_ratio: float) -> dict:
    return {
        "project_code": project.get("project_code"), "name": project.get("name"),
        "delay_days": int(_f(project.get("delay_days"))), "progress": round(_f(project.get("progress")), 1),
        "planned_progress": project.get("planned_progress"), "spend_ratio": round(spend_ratio * 100, 1),
        "budget_revisions": int(_f(project.get("budget_revisions"))),
        "extension_requests": int(_f(project.get("extension_requests"))),
    }


def compare(project: dict, hist: pd.DataFrame, snapshots: pd.DataFrame, agency: dict | None,
            agency_projects: list[dict] | None = None) -> dict:
    """Compare one project against the historical database.

    snapshots: DataFrame(project_id, progress, spend_ratio) - progress/expenditure snapshots
    taken from historical progress reports, used for 'average expenditure at a similar stage'.
    """
    sanctioned = _f(project.get("sanctioned_amount"))
    progress = _f(project.get("progress"))
    duration = _f(project.get("duration_days"))
    spend_ratio = (_f(project.get("expenditure")) / sanctioned) if sanctioned else 0.0
    h = hist[hist["project_id"] != project.get("project_id")].copy()

    if h.empty:
        return {"compared_projects": 0, "insufficient_history": True, "current": _current(project, spend_ratio)}

    same_cat = h["category"] == project.get("category")
    same_dist = h["district"] == project.get("district")
    same_agency = h["agency_id"] == project.get("agency_id")
    if sanctioned:
        sim_budget = (h["sanctioned_amount"] >= sanctioned * 0.65) & (h["sanctioned_amount"] <= sanctioned * 1.5)
    else:
        sim_budget = pd.Series(False, index=h.index)
    if duration:
        sim_dur = (h["duration_days"] >= duration * 0.7) & (h["duration_days"] <= duration * 1.3)
    else:
        sim_dur = pd.Series(False, index=h.index)
    sim_size = h["size_band"] == size_band(sanctioned)
    sim_stage = (h["progress"] - progress).abs() <= 10

    h["match_count"] = (same_cat.astype(int) + same_dist.astype(int) + same_agency.astype(int)
                        + sim_budget.astype(int) + sim_dur.astype(int) + sim_size.astype(int))
    pool = h[h["match_count"] >= 2]
    peers = h[h["match_count"] >= 3]
    if len(peers) < 5:
        peers = pool if len(pool) >= 5 else h

    # ---- delay comparison
    peer_delay = peers["delay_days"].dropna()
    peer_avg_delay = float(peer_delay.mean()) if len(peer_delay) else 0.0
    peer_median_delay = float(peer_delay.median()) if len(peer_delay) else 0.0
    delayed_share = float((peer_delay > 90).mean()) if len(peer_delay) else 0.0

    # ---- expenditure at similar stage (from historical snapshots)
    peer_ids = set(peers["project_id"])
    if not snapshots.empty:
        snap = snapshots[snapshots["project_id"].isin(peer_ids)]
        stage = snap[(snap["progress"] - progress).abs() <= 8]
    else:
        stage = snapshots
    if len(stage) >= 3:
        avg_spend_stage = float(stage["spend_ratio"].mean())
        stage_n = int(len(stage))
    else:
        cur = peers[(peers["progress"] - progress).abs() <= 15]
        avg_spend_stage = float(cur["spend_ratio"].mean()) if len(cur) >= 3 else float(peers["spend_ratio"].mean())
        stage_n = int(len(cur)) if len(cur) >= 3 else int(len(peers))

    peer_rev = float(peers["budget_revisions"].mean())
    peer_ext = float(peers["extension_requests"].mean())

    similar = pool.sort_values(["match_count", "delay_days"], ascending=[False, False]).head(8)
    similar_list = [
        {"project_code": r.project_code, "name": r.name, "category": r.category, "district": r.district,
         "delay_days": int(_f(r.delay_days)), "progress": round(_f(r.progress), 1),
         "spend_ratio": round(_f(r.spend_ratio) * 100, 1), "sanctioned_amount": _f(r.sanctioned_amount),
         "similarity": round(float(r.match_count) / 6.0, 2)}
        for r in similar.itertuples()
    ]

    agency_perf = None
    if agency:
        total = agency.get("total_projects", 0) or 0
        agency_perf = {
            "name": agency.get("name"), "total_projects": total,
            "completed_projects": agency.get("completed_projects", 0),
            "delayed_projects": agency.get("delayed_projects", 0),
            "average_delay": round(_f(agency.get("average_delay")), 1),
            "complaints": agency.get("complaints", 0), "inspections": agency.get("inspections", 0),
            "previous_high_risk_cases": agency.get("previous_high_risk_cases", 0),
            "historical_performance": round(_f(agency.get("historical_performance")), 1),
            "delayed_ratio": round(agency.get("delayed_projects", 0) / total, 3) if total else 0.0,
        }
    agency_delay_history = [
        {"project_code": ap.get("project_code"), "delay_days": int(_f(ap.get("delay_days")))}
        for ap in (agency_projects or [])[:20]
    ]

    global_avg_delay = float(h["delay_days"].dropna().mean()) if h["delay_days"].notna().any() else 0.0
    expected_progress = project.get("planned_progress")

    return {
        "insufficient_history": False,
        "compared_projects": int(len(pool)),
        "history_size": int(len(h)),
        "same_agency": int(same_agency.sum()),
        "same_category": int(same_cat.sum()),
        "same_district": int(same_dist.sum()),
        "similar_budget": int(sim_budget.sum()),
        "similar_duration": int(sim_dur.sum()),
        "similar_size": int(sim_size.sum()),
        "similar_progress_stage": int(sim_stage.sum()),
        "peer_count": int(len(peers)),
        "similar_previous_delays": int((peer_delay > 90).sum()),
        "peer_avg_delay": round(peer_avg_delay, 1),
        "peer_median_delay": round(peer_median_delay, 1),
        "peer_delayed_share": round(delayed_share, 3),
        "global_avg_delay": round(global_avg_delay, 1),
        "current_delay": int(_f(project.get("delay_days"))),
        "avg_spend_ratio_at_stage": round(avg_spend_stage * 100, 1),
        "stage_sample_size": stage_n,
        "current_spend_ratio": round(spend_ratio * 100, 1),
        "current_progress": round(progress, 1),
        "expected_progress": None if expected_progress is None else round(_f(expected_progress), 1),
        "peer_avg_budget_revisions": round(peer_rev, 2),
        "peer_avg_extension_requests": round(peer_ext, 2),
        "agency_performance": agency_perf,
        "agency_delay_history": agency_delay_history,
        "similar_projects": similar_list,
        "current": _current(project, spend_ratio),
        "charts": {
            "progress": [
                {"label": "Planned / expected", "value": round(_f(expected_progress), 1)},
                {"label": "Actual", "value": round(progress, 1)},
            ],
            "expenditure": [
                {"label": "Similar projects at this stage", "value": round(avg_spend_stage * 100, 1)},
                {"label": "This project", "value": round(spend_ratio * 100, 1)},
            ],
            "hist_vs_current": [
                {"metric": "Delay (days)", "historical": round(peer_avg_delay, 1), "current": int(_f(project.get("delay_days")))},
                {"metric": "Budget revisions", "historical": round(peer_rev, 2), "current": int(_f(project.get("budget_revisions")))},
                {"metric": "Extension requests", "historical": round(peer_ext, 2), "current": int(_f(project.get("extension_requests")))},
            ],
        },
    }
