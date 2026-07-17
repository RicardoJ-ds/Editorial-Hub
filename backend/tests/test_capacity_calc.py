"""Unit tests for capacity_calc.compute_member_utilization — pure Python.

Focus: capacity sharing. An editor staffed in >1 pod in a month (home slice +
support slice) must have their delivered-article count SPLIT across the pods by
capacity share, not credited in full to each pod (which double-counts their work
and inflates every pod's article total). Single-pod editors stay unchanged.
"""

from app.services.capacity_calc import compute_member_utilization


def _articles(*pairs):
    """Expand (editor_name, count) pairs into the [{editor_name}] input rows."""
    rows = []
    for name, n in pairs:
        rows.extend({"editor_name": name} for _ in range(n))
    return rows


def test_shared_editor_articles_split_by_capacity():
    # Jimmy is staffed in Pod 1 (cap 20) AND Pod 2 (cap 10) — a home + support
    # split — and delivered 30 articles this month. Alice is Pod 1 only.
    cph = [
        {"client_id": 1, "editorial_pod": "Pod 1", "category": "standard"},
        {"client_id": 2, "editorial_pod": "Pod 2", "category": "standard"},
    ]
    ph = [
        {"client_id": 1, "projected_original": 26, "articles_actual": 26},
        {"client_id": 2, "projected_original": 10, "articles_actual": 10},
    ]
    articles = _articles(("Jimmy", 30), ("Alice", 6))
    emc = [
        {
            "pod": "Pod 1",
            "role": "editor",
            "member_raw": "Jimmy Bunes",
            "member_breakdown": None,
            "capacity": 20,
        },
        {
            "pod": "Pod 2",
            "role": "editor",
            "member_raw": "Jimmy Bunes",
            "member_breakdown": None,
            "capacity": 10,
        },
        {
            "pod": "Pod 1",
            "role": "editor",
            "member_raw": "Alice Smith",
            "member_breakdown": None,
            "capacity": 10,
        },
    ]

    rows = compute_member_utilization(cph, ph, articles, emc)
    by = {(r["member"], r["pod"]): r for r in rows}

    jimmy_p1 = by[("Jimmy Bunes", "Pod 1")]
    jimmy_p2 = by[("Jimmy Bunes", "Pod 2")]
    alice = by[("Alice Smith", "Pod 1")]

    # Split by capacity share: 30 × 20/30 = 20 in Pod 1, 30 × 10/30 = 10 in Pod 2.
    assert jimmy_p1["articles"] == 20
    assert jimmy_p2["articles"] == 10
    # Conserved — NOT 30 credited to both pods (the double-count we fixed).
    assert jimmy_p1["articles"] + jimmy_p2["articles"] == 30

    # Pod article totals reflect the split, not the inflated full count.
    assert jimmy_p1["pod_total_articles"] == 26  # Jimmy 20 + Alice 6
    assert jimmy_p2["pod_total_articles"] == 10  # Jimmy 10

    # Single-pod editor is untouched.
    assert alice["articles"] == 6


def test_single_pod_editor_keeps_full_count():
    # No sharing: the editor's full article count lands in their one pod.
    cph = [{"client_id": 1, "editorial_pod": "Pod 1", "category": "standard"}]
    ph = [{"client_id": 1, "projected_original": 12, "articles_actual": 12}]
    articles = _articles(("Nina", 12))
    emc = [
        {
            "pod": "Pod 1",
            "role": "senior_editor",
            "member_raw": "Nina Denison",
            "member_breakdown": None,
            "capacity": 15,
        }
    ]

    rows = compute_member_utilization(cph, ph, articles, emc)
    assert len(rows) == 1
    assert rows[0]["articles"] == 12
    assert rows[0]["pod_total_articles"] == 12
