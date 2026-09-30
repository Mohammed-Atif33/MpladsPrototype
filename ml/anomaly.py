"""Isolation Forest anomaly detection over the historical project database."""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import RobustScaler

from .config import MIN_HISTORY_FOR_ANOMALY

FEATURES = ["delay_days", "progress_gap", "spend_gap", "budget_revisions", "extension_requests",
            "verified_complaints", "log_amount"]
FEATURE_LABELS = {
    "delay_days": "delay", "progress_gap": "progress shortfall vs plan",
    "spend_gap": "expenditure ahead of progress", "budget_revisions": "budget revisions",
    "extension_requests": "extension requests", "verified_complaints": "verified complaints",
    "log_amount": "project size",
}


def _num(d: dict, k: str) -> float:
    v = d.get(k)
    try:
        return 0.0 if v is None or (isinstance(v, float) and np.isnan(v)) else float(v)
    except (TypeError, ValueError):
        return 0.0


def _row(d: dict) -> dict:
    sanctioned = _num(d, "sanctioned_amount")
    progress = _num(d, "progress")
    planned = d.get("planned_progress")
    planned = progress if planned is None or (isinstance(planned, float) and np.isnan(planned)) else float(planned)
    spend_pct = (_num(d, "expenditure") / sanctioned * 100) if sanctioned else 0.0
    return {
        "delay_days": _num(d, "delay_days"),
        "progress_gap": max(0.0, planned - progress),
        "spend_gap": spend_pct - progress,
        "budget_revisions": _num(d, "budget_revisions"),
        "extension_requests": _num(d, "extension_requests"),
        "verified_complaints": _num(d, "verified_complaints"),
        "log_amount": float(np.log10(sanctioned + 1)),
    }


def score_project(project: dict, hist_rows: list[dict]) -> dict:
    """Fit an Isolation Forest on history and score the project.
    Returns anomaly_score in 0-100 (percentile of how unusual vs history) plus drivers."""
    if len(hist_rows) < MIN_HISTORY_FOR_ANOMALY:
        return {"available": False, "anomaly_score": None,
                "reason": "Not enough historical projects for anomaly detection."}
    X = pd.DataFrame([_row(r) for r in hist_rows])[FEATURES]
    x = pd.DataFrame([_row(project)])[FEATURES]
    scaler = RobustScaler().fit(X)
    Xs, xs = scaler.transform(X), scaler.transform(x)
    model = IsolationForest(n_estimators=300, contamination="auto", random_state=42).fit(Xs)
    train = -model.score_samples(Xs)          # higher = more anomalous
    cur = float(-model.score_samples(xs)[0])
    pct = float((train <= cur).mean() * 100)  # share of history that is LESS anomalous
    is_outlier = bool(model.predict(xs)[0] == -1)

    # driver explanation: robust deviation of each feature vs the historical distribution
    med = X.median()
    iqr = (X.quantile(0.75) - X.quantile(0.25)).replace(0, np.nan)
    z = ((x.iloc[0] - med) / iqr).replace([np.inf, -np.inf], np.nan).fillna(0)
    drivers = [
        {"feature": k, "label": FEATURE_LABELS[k], "value": round(float(x.iloc[0][k]), 1),
         "historical_median": round(float(med[k]), 1), "deviation": round(float(v), 2)}
        for k, v in z.sort_values(ascending=False).items() if v > 1.0
    ][:4]
    return {"available": True, "anomaly_score": round(pct, 1), "raw_score": round(cur, 4),
            "is_outlier": is_outlier, "training_rows": int(len(X)), "drivers": drivers}
