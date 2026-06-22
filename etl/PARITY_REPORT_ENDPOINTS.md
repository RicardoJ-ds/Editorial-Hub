# Endpoint parity — Postgres vs BigQuery warehouse

_Generated 2026-06-19 08:47 UTC. Same server, same request, two X-Data-Source values;
JSON diffed (lists as multisets; on-screen-ordered endpoints also
order-checked)._

## Verdict: ✅ ALL ENDPOINTS IDENTICAL

| Endpoint case | Result |
|---|---|
| clients (`/api/clients/?limit=500`) | ✅ |
| clients+status (`/api/clients/?limit=500&status=ACTIVE`) | ✅ |
| clients+pod (`/api/clients/?limit=500&editorial_pod=Pod%201`) | ✅ |
| clients+search (`/api/clients/?limit=500&search=meta`) | ✅ |
| deliverables p1 (`/api/deliverables/?limit=1000&skip=0`) | ✅ |
| goals all (`/api/goals-delivery/all`) | ✅ |
| goals all+pod (`/api/goals-delivery/all?pod=Pod%201`) | ✅ |
| cumulative (`/api/goals-delivery/cumulative`) | ✅ |
| kpis range (`/api/kpis/?limit=5000&year_from=2025&month_from=8&year_to=2027&month_to=5`) | ✅ |
| team-members (`/api/team-members/?limit=200`) | ✅ |
| editorial-weeks (`/api/migrate/editorial-weeks`) | ✅ |
| production-trend (`/api/dashboard/production-trend`) | ✅ |
| client-production (`/api/dashboard/client-production`) | ✅ |
| pacing (`/api/dashboard/pacing`) | ✅ |
| capacity pod-summary (`/api/capacity/pod-summary`) | ✅ |
| member-util 2026-05 (`/api/capacity/member-utilization?year=2026&month=5`) | ✅ |
| member-util 2026-03 (`/api/capacity/member-utilization?year=2026&month=3`) | ✅ |
| member-util 2025-12 (`/api/capacity/member-utilization?year=2025&month=12`) | ✅ |
| member-util-matrix (`/api/capacity/member-utilization-matrix`) | ✅ |
| client-contrib 2026-05 (`/api/capacity/client-contributions?year=2026&month=5`) | ✅ |
| client-contrib 2026-04 (`/api/capacity/client-contributions?year=2026&month=4`) | ✅ |
| articles editorial (`/api/articles/monthly?pod_axis=editorial`) | ✅ |
| articles growth (`/api/articles/monthly?pod_axis=growth`) | ✅ |
| articles pod1 (`/api/articles/monthly?pod_axis=editorial&pod=Pod%201`) | ✅ |
| articles unassigned (`/api/articles/monthly?pod_axis=editorial&pod=Unassigned`) | ✅ |
| articles window (`/api/articles/monthly?pod_axis=editorial&date_from=2026-01&date_to=2026-05`) | ✅ |
| articles client (`/api/articles/monthly?pod_axis=editorial&clients=Miter`) | ✅ |
| articles editors-filter (`/api/articles/monthly?pod_axis=editorial&editors=Jimmy%20Bunes,Robert%20Thorpe`) | ✅ |
| articles editors-list (`/api/articles/editors`) | ✅ |
| ai summary (`/api/ai-monitoring/summary`) | ✅ |
| ai by-pod (`/api/ai-monitoring/by-pod`) | ✅ |
| ai by-client (`/api/ai-monitoring/by-client?limit=20`) | ✅ |
| ai by-writer (`/api/ai-monitoring/by-writer?limit=20`) | ✅ |
| ai by-month (`/api/ai-monitoring/by-month`) | ✅ |
| ai flags (`/api/ai-monitoring/flags?limit=50`) | ✅ |
| ai rewrites (`/api/ai-monitoring/rewrites?limit=50`) | ✅ |
| ai surfer (`/api/ai-monitoring/surfer-usage`) | ✅ |
| deliverables p3 paged (`/api/deliverables/?limit=20&skip=40`) | ✅ |
| kpis paged (`/api/kpis/?limit=20&skip=100`) | ✅ |
| clients paged (`/api/clients/?limit=20&skip=20`) | ✅ |
| deliverables by client (`/api/deliverables/?limit=1000&client_id=471`) | ✅ |
| deliverables by ym (`/api/deliverables/?limit=1000&year=2026&month=3`) | ✅ |
| kpis single month (`/api/kpis/?limit=5000&year=2026&month=4`) | ✅ |
| kpis by type (`/api/kpis/?limit=5000&kpi_type=revision_rate`) | ✅ |
| team-members role (`/api/team-members/?limit=200&role=SENIOR_EDITOR`) | ✅ |
| team-members active (`/api/team-members/?limit=200&is_active=true`) | ✅ |
| weeks 2026 (`/api/migrate/editorial-weeks?year=2026`) | ✅ |
| clients growth pod (`/api/clients/?limit=500&growth_pod=Pod%201`) | ✅ |
| cumulative pod (`/api/goals-delivery/cumulative?pod=Pod%201`) | ✅ |
| ai summary pod+month (`/api/ai-monitoring/summary?pod=Pod%201`) | ✅ |
| ai by-client month (`/api/ai-monitoring/by-client?limit=20&month=March%202026`) | ✅ |
| ai flags client (`/api/ai-monitoring/flags?limit=50&pod=Pod%201`) | ✅ |