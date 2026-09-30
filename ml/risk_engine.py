"""Hybrid, explainable risk engine.

  final_score = W_RULE * rule_score  +  W_ANOMALY * anomaly_score

* rule_score   : weighted rule checks (delay, progress, expenditure, revisions, ...) using
                 the historical comparison as the baseline (0-100)
* anomaly_score: Isolation Forest percentile against the historical database (0-100)

Each factor's `points` is its exact contribution to the final score, so the factor list
always adds up to the displayed score. Wording is deliberately neutral ("unusual pattern
detected", "priority review recommended") - the score is a prioritisation signal only.
"""
from __future__ import annotations

from datetime import date, datetime

from . import config as C


def _clip(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def _f(x, default=0.0) -> float:
    try:
        return default if x is None else float(x)
    except (TypeError, ValueError):
        return default


def _lakh(x: float) -> str:
    return f"Rs {x / 100000:.1f} lakh"


def payment_flags(payments: list[dict], expenditure: float, sanctioned: float, progress: float) -> list[str]:
    """Simple, transparent payment-pattern checks (prototype rules)."""
    flags: list[str] = []
    amounts = [_f(p.get("amount")) for p in payments if _f(p.get("amount")) > 0]
    if not amounts:
        return flags
    T = C.PAYMENT_APPROVAL_THRESHOLD
    just_below = [a for a in amounts if 0.9 * T <= a < T]
    if len(just_below) >= 2:
        flags.append(f"{len(just_below)} payments fall just below the Rs {T / 100000:.0f} lakh approval level")
    round_amts = [a for a in amounts if a % 50000 == 0]
    if len(amounts) >= 3 and len(round_amts) / len(amounts) >= 0.6:
        flags.append("most payments are round figures")
    dates = sorted(d for d in (_to_date(p.get("paid_on")) for p in payments) if d)
    if len(dates) >= 3:
        for i in range(len(dates) - 2):
            if (dates[i + 2] - dates[i]).days <= 30:
                flags.append("3 or more payments released within 30 days")
                break
    if sanctioned:
        paid_pct = sum(amounts) / sanctioned * 100
        if paid_pct - progress > 15:
            flags.append(f"cumulative payments ({paid_pct:.0f}% of sanction) run ahead of progress ({progress:.0f}%)")
    return flags


def _to_date(v) -> date | None:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    if isinstance(v, str):
        try:
            return date.fromisoformat(v[:10])
        except ValueError:
            return None
    return None


def analyze(project: dict, comparison: dict, anomaly: dict, ctx: dict) -> dict:
    W = C.RULE_WEIGHTS
    factors: list[dict] = []

    def add(key: str, title: str, sev: float, detail: str, signal: str, weight_key: str | None = None,
            max_points: float | None = None, points: float | None = None):
        mp = max_points if max_points is not None else W[weight_key] * C.W_RULE
        pts = points if points is not None else sev * mp
        factors.append({
            "key": key, "label": title, "detail": detail, "signal": signal,
            "severity": round(sev, 3), "points": round(pts, 1), "max_points": round(mp, 1),
            "contributing": pts >= 0.5,
        })
        return sev * (W[weight_key] if weight_key else 0)

    cmp_ = comparison or {}
    delay = _f(project.get("delay_days"))
    peer_avg = _f(cmp_.get("peer_avg_delay"))
    progress = _f(project.get("progress"))
    expected = project.get("planned_progress")
    sanctioned = _f(project.get("sanctioned_amount"))
    spend_pct = (_f(project.get("expenditure")) / sanctioned * 100) if sanctioned else 0.0

    rule_total = 0.0

    # 1. Delay
    if delay > 0:
        sev = 0.6 * _clip(delay / 180) + (0.4 * _clip((delay - peer_avg) / 150) if cmp_.get("peer_count") else 0.4 * _clip(delay / 180))
    else:
        sev = 0.0
    detail = (f"{int(delay)}-day delay beyond the original deadline"
              + (f"; similar projects average {peer_avg:.0f} days" if cmp_.get("peer_count") else "") + ".")
    rule_total += add("delay", f"{int(delay)}-day delay" if delay > 0 else "No delay recorded", sev,
                      detail if delay > 0 else "Project is within its original schedule.",
                      "Unusual pattern detected" if sev >= 0.5 else "Within expected range", "delay")

    # 2. Progress mismatch
    if expected is not None:
        gap = _f(expected) - progress
        sev = _clip(gap / 30)
        rule_total += add("progress_mismatch", "Progress below expected level" if gap > 0 else "Progress on or above plan", sev,
                          f"Actual progress {progress:.0f}% vs expected {_f(expected):.0f}% ({max(gap, 0):.0f} points below plan).",
                          "Progress variance detected" if sev >= 0.3 else "Within expected range", "progress_mismatch")
    else:
        rule_total += add("progress_mismatch", "Expected progress not available", 0.3,
                          "No planned-progress figure was supplied, so progress cannot be compared with the plan.",
                          "Further verification recommended", "progress_mismatch")

    # 3. Expenditure vs progress
    at_stage = cmp_.get("avg_spend_ratio_at_stage")
    excess_vs_peers = (spend_pct - _f(at_stage)) if at_stage is not None else 0.0
    ahead_of_progress = spend_pct - progress
    sev = 0.6 * _clip(excess_vs_peers / 25) + 0.4 * _clip(ahead_of_progress / 25)
    detail = f"{spend_pct:.1f}% of the sanctioned amount spent at {progress:.0f}% progress"
    if at_stage is not None:
        detail += f"; similar projects had spent {_f(at_stage):.1f}% at a comparable stage"
    rule_total += add("expenditure_mismatch", "Unusual expenditure pattern" if sev >= 0.3 else "Expenditure consistent with progress", sev,
                      detail + ".", "Financial variance detected" if sev >= 0.3 else "Within expected range", "expenditure_mismatch")

    # 4. Budget revisions / 5. Extension requests
    rev = _f(project.get("budget_revisions"))
    sev = _clip(rev / 2)
    rule_total += add("budget_revisions", "Budget revisions" if rev else "No budget revisions", sev,
                      f"{int(rev)} budget revision(s) recorded; similar projects average {_f(cmp_.get('peer_avg_budget_revisions')):.1f}.",
                      "Unusual pattern detected" if sev >= 0.6 else "Within expected range", "budget_revisions")
    ext = _f(project.get("extension_requests"))
    sev = _clip(ext / 2)
    rule_total += add("extension_requests", "Multiple extension requests" if ext >= 2 else "Extension requests", sev,
                      f"{int(ext)} extension request(s) recorded; similar projects average {_f(cmp_.get('peer_avg_extension_requests')):.1f}.",
                      "Unusual pattern detected" if sev >= 0.6 else "Within expected range", "extension_requests")

    # 6. Payment patterns
    pf = payment_flags(ctx.get("payments", []), _f(project.get("expenditure")), sanctioned, progress)
    sev = _clip(len(pf) / 2)
    rule_total += add("payment_patterns", "Payment pattern observations" if pf else "No payment pattern concerns", sev,
                      ("; ".join(pf).capitalize() + ".") if pf else "No unusual payment pattern found in the payment schedule.",
                      "Further verification recommended" if pf else "Within expected range", "payment_patterns")

    # 7. Agency history
    ag = ctx.get("agency") or {}
    total = _f(ag.get("total_projects"))
    delayed_ratio = (_f(ag.get("delayed_projects")) / total) if total else 0.0
    g_avg = _f(cmp_.get("global_avg_delay"))
    sev = (0.35 * _clip(delayed_ratio / 0.6) + 0.35 * _clip((_f(ag.get("average_delay")) - g_avg) / 60)
           + 0.30 * _clip(_f(ag.get("previous_high_risk_cases")) / 3)) if ag else 0.0
    rule_total += add("agency_history", "Agency historical delays" if sev >= 0.3 else "Agency history", sev,
                      (f"{ag.get('name')}: {int(_f(ag.get('delayed_projects')))} of {int(total)} past projects delayed, "
                       f"average delay {_f(ag.get('average_delay')):.0f} days (all projects {g_avg:.0f}); "
                       f"{int(_f(ag.get('previous_high_risk_cases')))} previous high-risk case(s).") if ag else "No agency history available.",
                      "Unusual pattern detected" if sev >= 0.5 else "Within expected range", "agency_history")

    # 8. Verified complaints (only screened/verified complaints carry real weight)
    vc, uc = _f(ctx.get("verified_complaints")), _f(ctx.get("unverified_complaints"))
    sev = _clip(vc / 4 + min(uc * 0.05, 0.1))
    rule_total += add("verified_complaints", "Verified complaints" if vc else "Citizen complaints", sev,
                      f"{int(vc)} screened/verified complaint(s); {int(uc)} not yet verified (unverified complaints carry minimal weight).",
                      "Priority review recommended" if vc >= 3 else ("Further verification recommended" if vc else "Within expected range"),
                      "verified_complaints")

    # 9. Missing / inconsistent data
    dq = _f(ctx.get("data_quality_issues"))
    sev = _clip(dq / 5)
    rule_total += add("data_quality", "Missing or inconsistent data" if dq else "Data complete and consistent", sev,
                      f"{int(dq)} data-quality observation(s) during validation." if dq else "No missing or inconsistent values were found.",
                      "Further verification recommended" if dq else "Within expected range", "data_quality")

    # 10. Previous inspections (adverse outcomes for this project / agency)
    adv = _f(ctx.get("adverse_inspections"))
    sev = _clip(adv / 2)
    rule_total += add("previous_inspections", "Previous adverse inspections" if adv else "No adverse inspection history", sev,
                      f"{int(adv)} earlier inspection(s) with adverse findings for this project or agency." if adv else "No earlier adverse inspection findings.",
                      "Further verification recommended" if adv else "Within expected range", "previous_inspections")

    rule_score = round(rule_total, 1)  # 0-100

    # Anomaly (Isolation Forest)
    if anomaly and anomaly.get("available"):
        a = _f(anomaly.get("anomaly_score"))
        drivers = ", ".join(d["label"] for d in anomaly.get("drivers", [])[:3]) or "no single dominant feature"
        add("anomaly", "Unusual overall pattern vs history (Isolation Forest)", a / 100,
            f"The combined profile is more unusual than {a:.0f}% of {anomaly.get('training_rows')} historical projects "
            f"(main drivers: {drivers}).",
            "Unusual pattern detected" if a >= 70 else "Within historical range", max_points=100 * C.W_ANOMALY)
        final = C.W_RULE * rule_score + C.W_ANOMALY * a
    else:
        a = None
        final = rule_score  # rules only; weights not redistributed silently - flagged in the response
        add("anomaly", "Anomaly detection unavailable", 0.0,
            (anomaly or {}).get("reason", "Not enough historical data."), "Further verification recommended",
            max_points=0.0, points=0.0)

    final = round(_clip(final, 0.0, 100.0), 1)
    level = C.level_for(final)
    factors.sort(key=lambda f: f["points"], reverse=True)

    recommendations = {
        "Low": "Routine monitoring appears sufficient; no unusual pattern requiring priority review.",
        "Medium": "Further verification recommended; keep under monitoring.",
        "High": "Priority review recommended; officer review of evidence required.",
        "Critical": "Priority review recommended; officer review required and supervisory (Head Officer) attention advised.",
    }
    return {
        "risk_score": final,
        "risk_level": level,
        "rule_score": rule_score,
        "anomaly_score": a,
        "factors": factors,
        "recommendation": recommendations[level],
        "status": "Officer Review Required" if level in ("Medium", "High", "Critical") else "Routine Monitoring Suggested",
        "model_version": C.MODEL_VERSION,
        "threshold_notice": C.THRESHOLD_NOTICE,
        "disclaimer": C.DISCLAIMER,
        "anomaly_available": a is not None,
        "payment_flags": pf,
    }
