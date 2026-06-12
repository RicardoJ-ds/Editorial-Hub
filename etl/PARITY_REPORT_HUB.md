# Hub cutover parity — published history vs warehouse view

_Generated 2026-06-12 19:24 UTC. Hub table: `team_pod_assignments_editorial_history`._

## A. History slice (2025-01 → 2026-05): ✅ PASS

- tuples in our view: 2237 · in Hub import slice: 2235
- Hub rows LOST in roundtrip: 0 (gate) · our enriched/renamed rows: 71 (informational)
- Hub-authored rows (intentional divergence, not compared): 2026-06×144

## B. Current month (2026-06) RBAC coverage: ✅ PASS

- sheet-derived member identities: 13 · in Hub: 13
- sheet identities MISSING from Hub: 0

### extra in Hub
```
('2025-04', 'Pod 1', 498, 'writer', 'Justine Smith')
('2025-06', 'Pod 3', 491, 'writer', 'Daniel Pelberg')
('2025-12', 'Pod 2', 482, 'writer', 'writer.hlebowitsh@ext.writing.graphitehq.com')
('2025-12', 'Pod 2', 493, 'writer', 'writer.pitkin@ext.writing.graphitehq.com')
('2025-12', 'Pod 2', 494, 'writer', 'andrew-blackman@ext.writing.graphitehq.com')
('2025-12', 'Pod 2', 494, 'writer', 'writer.pitkin@ext.writing.graphitehq.com')
('2026-01', 'Pod 2', 482, 'writer', 'writer.hlebowitsh@ext.writing.graphitehq.com')
('2026-01', 'Pod 2', 493, 'writer', 'writer.pitkin@ext.writing.graphitehq.com')
('2026-01', 'Pod 3', 483, 'writer', 'andrew-blackman@ext.writing.graphitehq.com')
('2026-01', 'Pod 5', 477, 'writer', 'writer.pitkin@ext.writing.graphitehq.com')
('2026-01', 'Pod 5', 478, 'writer', 'writer.pitkin@ext.writing.graphitehq.com')
('2026-02', 'Pod 2', 473, 'writer', 'writer.pitkin2@ext.writing.graphitehq.com')
('2026-02', 'Pod 2', 482, 'writer', 'writer.armstrong@ext.writing.graphitehq.com')
('2026-02', 'Pod 2', 482, 'writer', 'writer.hlebowitsh@ext.writing.graphitehq.com')
('2026-02', 'Pod 2', 493, 'writer', 'writer.pitkin@ext.writing.graphitehq.com')
('2026-02', 'Pod 3', 472, 'writer', 'writer.pitkin2@ext.writing.graphitehq.com')
('2026-02', 'Pod 3', 483, 'writer', 'andrew-blackman@ext.writing.graphitehq.com')
('2026-02', 'Pod 3', 483, 'writer', 'writer.murray@ext.writing.graphitehq.com')
('2026-02', 'Pod 5', 474, 'writer', 'writer.hlebowitsh@ext.writing.graphitehq.com')
('2026-02', 'Pod 5', 477, 'writer', 'writer.pitkin@ext.writing.graphitehq.com')
('2026-02', 'Pod 5', 478, 'writer', 'writer.pitkin@ext.writing.graphitehq.com')
('2026-02', 'Pod 5', 479, 'writer', 'andrew-blackman@ext.writing.graphitehq.com')
('2026-03', 'Pod 2', 473, 'writer', 'writer.pitkin2@ext.writing.graphitehq.com')
('2026-03', 'Pod 2', 475, 'writer', 'writer.hlebowitsh@ext.writing.graphitehq.com')
('2026-03', 'Pod 2', 482, 'writer', 'writer.armstrong@ext.writing.graphitehq.com')
('2026-03', 'Pod 2', 482, 'writer', 'writer.hlebowitsh@ext.writing.graphitehq.com')
('2026-03', 'Pod 2', 486, 'writer', 'writer.armstrong@ext.writing.graphitehq.com')
('2026-03', 'Pod 2', 486, 'writer', 'writer.murray@ext.writing.graphitehq.com')
('2026-03', 'Pod 2', 486, 'writer', 'writer.pitkin@ext.writing.graphitehq.com')
('2026-03', 'Pod 3', 472, 'writer', 'writer.pitkin2@ext.writing.graphitehq.com')
('2026-03', 'Pod 3', 483, 'writer', 'andrew-blackman@ext.writing.graphitehq.com')
('2026-03', 'Pod 3', 483, 'writer', 'writer.murray@ext.writing.graphitehq.com')
('2026-03', 'Pod 3', 492, 'writer', 'writer.armstrong@ext.writing.graphitehq.com')
('2026-03', 'Pod 5', 474, 'writer', 'writer.hlebowitsh@ext.writing.graphitehq.com')
('2026-03', 'Pod 5', 477, 'writer', 'writer.pitkin@ext.writing.graphitehq.com')
('2026-03', 'Pod 5', 478, 'writer', 'writer.pitkin@ext.writing.graphitehq.com')
('2026-03', 'Pod 5', 479, 'writer', 'andrew-blackman@ext.writing.graphitehq.com')
('2026-03', 'Pod 5', 481, 'writer', 'writer.murray@ext.writing.graphitehq.com')
('2026-04', 'Pod 1', 483, 'writer', 'andrew-blackman@ext.writing.graphitehq.com')
('2026-04', 'Pod 1', 483, 'writer', 'writer.murray@ext.writing.graphitehq.com')
```

## Verdict: ✅ CUTOVER UNBLOCKED