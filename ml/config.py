"""Risk-engine configuration. Weights are INTERNAL (never exposed to citizens/agencies)."""

MODEL_VERSION = "hybrid-rules-v1.0 + isolation-forest-v1.0"

# Prototype thresholds - NOT official government thresholds.
LEVELS = [(80, "Critical"), (60, "High"), (30, "Medium"), (0, "Low")]
THRESHOLD_NOTICE = "Prototype risk thresholds - not official government thresholds."
DISCLAIMER = (
    "A risk score is an investigation / prioritisation signal. It is NOT proof of fraud, "
    "corruption or wrongdoing. Human review of the evidence is required."
)

# Final score = W_RULE * rule_score + W_ANOMALY * anomaly_score   (both 0-100)
W_RULE = 0.75
W_ANOMALY = 0.25

# Rule weights (sum = 100 -> rule_score is 0-100)
RULE_WEIGHTS = {
    "delay": 22,
    "progress_mismatch": 15,
    "expenditure_mismatch": 15,
    "budget_revisions": 8,
    "extension_requests": 8,
    "payment_patterns": 6,
    "agency_history": 8,
    "verified_complaints": 8,
    "data_quality": 5,
    "previous_inspections": 5,
}
assert sum(RULE_WEIGHTS.values()) == 100

PAYMENT_APPROVAL_THRESHOLD = 500_000.0   # prototype: payments just below this are flagged
MIN_HISTORY_FOR_ANOMALY = 20


def level_for(score: float) -> str:
    for floor, name in LEVELS:
        if score >= floor:
            return name
    return "Low"
