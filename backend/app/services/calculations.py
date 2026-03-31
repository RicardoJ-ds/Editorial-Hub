from datetime import date


def capacity_utilization_pct(used: int, total: int) -> float:
    if total <= 0:
        return 0.0
    return round((used / total) * 100, 1)


def capacity_status(pct: float) -> str:
    """Returns capacity status per model assumptions:
    80-85% = OPTIMAL (green)
    85-100% = WARNING (yellow)
    <80% = UNDER (red)
    >100% = OVER (red)
    """
    if pct < 80:
        return "UNDER"
    elif pct <= 85:
        return "OPTIMAL"
    elif pct <= 100:
        return "WARNING"
    else:
        return "OVER"


def time_to_metric(date_from: date | None, date_to: date | None) -> int | None:
    if date_from is None or date_to is None:
        return None
    return (date_to - date_from).days


def delivery_variance(delivered: int, invoiced: int) -> int:
    return delivered - invoiced


def pacing_status(actual: int, expected: int) -> str:
    """Return pacing status based on actual vs expected delivery.

    AHEAD:    >5% above expected
    ON_TRACK: within +/-5%
    BEHIND:   -5% to -20%
    AT_RISK:  worse than -20%
    """
    if expected <= 0:
        return "ON_TRACK"
    delta = (actual - expected) / expected * 100
    if delta > 5:
        return "AHEAD"
    elif delta >= -5:
        return "ON_TRACK"
    elif delta >= -20:
        return "BEHIND"
    else:
        return "AT_RISK"
