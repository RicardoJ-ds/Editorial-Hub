"""Shared name-normalization helpers for the ETL mappings + transforms.

These are intentionally tiny pure functions — the same rules are used to BUILD
the mapping dictionaries (`build_mappings.py`) and to APPLY them (`transform.py`),
so a name that resolves at build time always resolves the same way at load time.
"""

from __future__ import annotations

import re

# Annotations the capacity sheet appends to member names. Stripped before any
# canonical lookup: "Jimmy Bunes (temp)" → "Jimmy Bunes".
_ANNOTATION_RE = re.compile(
    r"\s*\((?:temp|net-new|freelancer|backfill|[A-Za-z'’]+’?s? backfill|"
    r"[A-Za-z'’]+'s backfill|aud writer)\)\s*",
    re.IGNORECASE,
)
# Trailing "(28)" capacity numbers inside combined cells.
_NUMBER_PAREN_RE = re.compile(r"\s*\(\d+\)\s*")

# Placeholder slot values in the capacity sheet — not people.
PLACEHOLDER_MEMBERS = {
    "-",
    "—",
    "new hire",
    "support from pod 1",
    "support from pod 2",
    "support from pod 3",
    "support from pod 5",
    "pod 3",
    "pod 2",
}


def norm_key(name: str | None) -> str:
    """Canonical lookup key: lowercase, collapse whitespace, strip '*'."""
    return re.sub(r"\s+", " ", str(name or "").replace("*", "").strip().lower())


def strip_member_annotations(name: str | None) -> str:
    """Remove sheet annotations from a capacity member name so the bare person
    name can be looked up: '(temp)', '(net-new)', '(freelancer)',
    '(Anabelle's backfill)', trailing '(28)' numbers."""
    s = str(name or "")
    s = _NUMBER_PAREN_RE.sub(" ", s)
    s = _ANNOTATION_RE.sub(" ", s)
    return re.sub(r"\s+", " ", s).strip()


def is_placeholder_member(name: str | None) -> bool:
    """True for capacity slot values that aren't people ('new hire',
    'support from Pod 1', '-', bare pod refs)."""
    k = norm_key(strip_member_annotations(name))
    if not k:
        return True
    if k in PLACEHOLDER_MEMBERS:
        return True
    return bool(re.fullmatch(r"(new hire|support from pod \d+|pod \d+)([ +].*)?", k))


def first_token(name: str | None) -> str:
    return norm_key(name).split(" ")[0] if norm_key(name) else ""
