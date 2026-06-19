"""Unit tests for the BQ read cache + the RBAC resolve cache.

Pure-Python: no BigQuery, no database. The token reader and the underlying
resolver are monkeypatched so we exercise the cache logic in isolation.
"""

from types import SimpleNamespace

import pytest

from app.config import settings
from app.services import access, bq_cache


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    bq_cache.clear()
    access.clear_rbac_cache()
    monkeypatch.setattr(settings, "bq_cache_enabled", True)
    monkeypatch.setattr(settings, "bq_cache_ttl_seconds", 600)
    monkeypatch.setattr(settings, "rbac_cache_ttl_seconds", 30)
    yield
    bq_cache.clear()
    access.clear_rbac_cache()


def _runner_factory():
    calls = {"n": 0}

    def runner():
        calls["n"] += 1
        return [{"call": calls["n"]}]

    return calls, runner


# ── BQ query cache ──────────────────────────────────────────────────────────


def test_cache_hit_same_token(monkeypatch):
    monkeypatch.setattr(bq_cache, "current_token", lambda: 1)
    calls, runner = _runner_factory()
    a = bq_cache.cached_query("SELECT 1", None, runner)
    b = bq_cache.cached_query("SELECT 1", None, runner)
    assert a == b == [{"call": 1}]
    assert calls["n"] == 1  # second served from cache


def test_token_bump_invalidates(monkeypatch):
    tok = {"v": 1}
    monkeypatch.setattr(bq_cache, "current_token", lambda: tok["v"])
    calls, runner = _runner_factory()
    bq_cache.cached_query("SELECT 1", None, runner)
    tok["v"] = 2  # simulate a warehouse-publish bump
    bq_cache.cached_query("SELECT 1", None, runner)
    assert calls["n"] == 2  # re-fetched after the token changed


def test_param_keying_separates_scopes(monkeypatch):
    monkeypatch.setattr(bq_cache, "current_token", lambda: 1)
    calls, runner = _runner_factory()
    scalar_a = [SimpleNamespace(name="y", type_="INT64", value=2025)]
    scalar_b = [SimpleNamespace(name="y", type_="INT64", value=2026)]
    arr = [SimpleNamespace(name="allowed", values=["n8n", "pebl"])]
    bq_cache.cached_query("SELECT 1", scalar_a, runner)
    bq_cache.cached_query("SELECT 1", scalar_a, runner)  # hit
    bq_cache.cached_query("SELECT 1", scalar_b, runner)  # different param -> miss
    bq_cache.cached_query("SELECT 1", arr, runner)  # array param -> miss
    bq_cache.cached_query("SELECT 1", arr, runner)  # hit
    assert calls["n"] == 3  # scalar_a, scalar_b, arr — each fetched once


def test_serve_stale_on_bq_error(monkeypatch):
    tok = {"v": 1}
    monkeypatch.setattr(bq_cache, "current_token", lambda: tok["v"])
    bq_cache.cached_query("SELECT 1", None, lambda: [{"ok": 1}])
    tok["v"] = 2  # bump -> next call misses

    def boom():
        raise RuntimeError("BQ down")

    res = bq_cache.cached_query("SELECT 1", None, boom)
    assert res == [{"ok": 1}]  # last-good served instead of raising


def test_error_with_no_prior_entry_raises(monkeypatch):
    monkeypatch.setattr(bq_cache, "current_token", lambda: 1)

    def boom():
        raise RuntimeError("BQ down")

    with pytest.raises(RuntimeError):
        bq_cache.cached_query("SELECT cold", None, boom)


def test_disabled_bypasses_cache(monkeypatch):
    monkeypatch.setattr(settings, "bq_cache_enabled", False)
    monkeypatch.setattr(bq_cache, "current_token", lambda: 1)
    calls, runner = _runner_factory()
    bq_cache.cached_query("SELECT 1", None, runner)
    bq_cache.cached_query("SELECT 1", None, runner)
    assert calls["n"] == 2  # no caching when disabled (parity-harness mode)


# ── RBAC resolve cache ────────────────────────────────────────────────────────


def test_rbac_cache_hits_and_isolates(monkeypatch):
    from app.services.access import AccessProfile

    made = {"n": 0}

    def fake_resolve(session, email):
        made["n"] += 1
        return AccessProfile(email=email, is_authenticated=True, view_slugs={"overview"})

    monkeypatch.setattr(access, "resolve_access", fake_resolve)
    p1 = access.resolve_access_cached(None, "a@x.com")
    p2 = access.resolve_access_cached(None, "a@x.com")
    assert made["n"] == 1  # second served from cache
    assert p1.view_slugs == p2.view_slugs == {"overview"}

    # Mutating a returned copy (as the preview-as path does) must NOT corrupt
    # the cached profile — every call returns an isolated deep copy.
    p1.is_preview = True
    p1.view_slugs.add("admin.access")
    p3 = access.resolve_access_cached(None, "a@x.com")
    assert p3.is_preview is False
    assert "admin.access" not in p3.view_slugs
    assert made["n"] == 1  # still one underlying resolve


def test_rbac_ttl_zero_bypasses(monkeypatch):
    from app.services.access import AccessProfile

    made = {"n": 0}

    def fake_resolve(session, email):
        made["n"] += 1
        return AccessProfile(email=email, is_authenticated=True)

    monkeypatch.setattr(access, "resolve_access", fake_resolve)
    monkeypatch.setattr(settings, "rbac_cache_ttl_seconds", 0)
    access.resolve_access_cached(None, "a@x.com")
    access.resolve_access_cached(None, "a@x.com")
    assert made["n"] == 2  # disabled -> always resolves live
