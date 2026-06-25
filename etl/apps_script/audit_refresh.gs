/**
 * Daily refresh of the audit / normalization tabs in the Monthly Article Count sheet.
 * ───────────────────────────────────────────────────────────────────────────
 * Reads the always-fresh warehouse in BigQuery (republished on every SYNC) and
 * updates the audit tabs so they stay current without anyone running a script.
 *
 * What it touches (and what it deliberately does NOT):
 *   • ✅ VALIDATION AUDIT — recomputes the per-tab ARTICLES + UNDATED counts.
 *   • 🔬 Normalization Misses + … Client Detail — APPENDS newly-appeared orphan
 *       names (in the article data, not in the roster, not already listed) so
 *       DaniQ can map them. It NEVER edits existing rows or the manual
 *       "Canonical name" / "Full Name" columns — her assignments are safe.
 *   • 🔍 OM RECONCILIATION — fully regenerated (pure computed, no manual data).
 *
 * SETUP (once) — reuses the same ⚙️ CONFIG tab as the new-client script
 * (BQ_PROJECT + AUTH_MODE). Paste this file, run previewAudits() to authorize +
 * see what WOULD change (writes nothing), then createDailyAuditTrigger().
 */

const A_CONFIG_TAB = '⚙️ CONFIG';
const DS = '`graphite-data.graphite_bi_sandbox`';
const TAB_VALIDATION = '✅ VALIDATION AUDIT';
const TAB_MISSES = '🔬 Normalization Misses';
const TAB_MISSES_DETAIL = '🔬 Normalization Misses - Client Detail';
const TAB_OM = '🔍 OM RECONCILIATION';
const ROSTER_LOCAL = '📋 Roster';

// ── config + BigQuery (mirrors new_client_tab.gs) ──────────────────────────
function aGetConfig_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(A_CONFIG_TAB);
  if (!sh) throw new Error('Add a "' + A_CONFIG_TAB + '" tab (BQ_PROJECT / AUTH_MODE).');
  const cfg = {};
  sh.getRange(1, 1, sh.getLastRow(), 2).getValues().forEach(function (r) {
    if (r[0]) cfg[String(r[0]).trim()] = String(r[1]).trim();
  });
  cfg.BQ_PROJECT = cfg.BQ_PROJECT || 'graphite-data';
  cfg.AUTH_MODE = (cfg.AUTH_MODE || 'advanced').toLowerCase();
  return cfg;
}

function bq_(sql) {
  const cfg = aGetConfig_();
  let job = BigQuery.Jobs.query({ query: sql, useLegacySql: false }, cfg.BQ_PROJECT);
  const id = job.jobReference.jobId;
  while (!job.jobComplete) {
    Utilities.sleep(800);
    job = BigQuery.Jobs.getQueryResults(cfg.BQ_PROJECT, id);
  }
  return (job.rows || []).map(function (r) { return r.f.map(function (c) { return c.v; }); });
}

function rosterSets_() {
  const r = SpreadsheetApp.getActive().getSheetByName(ROSTER_LOCAL);
  const vals = r.getDataRange().getValues();
  const ed = {}, wr = {};
  for (let i = 1; i < vals.length; i++) {
    if (vals[i][1]) ed[String(vals[i][1]).trim()] = true;          // col B = ALL EDITORS
    if (vals[i][6]) wr[String(vals[i][6]).trim()] = true;          // col G = WRITERS
  }
  return { ed: ed, wr: wr };
}

// ── 1. VALIDATION AUDIT — per-tab ARTICLES + UNDATED ───────────────────────
function refreshValidationCounts_(dry) {
  const rows = bq_(
    'SELECT source_tab, COUNT(DISTINCT article_uid) articles, ' +
    'COUNTIF(submitted_date IS NULL) undated FROM ' + DS + '.editorial_raw_articles ' +
    'GROUP BY source_tab');
  const cnt = {};
  rows.forEach(function (r) { cnt[r[0]] = { a: Number(r[1]), u: Number(r[2]) }; });
  const sh = SpreadsheetApp.getActive().getSheetByName(TAB_VALIDATION);
  const data = sh.getDataRange().getValues();
  let hdr = -1, artCol = -1, undCol = -1;
  for (let i = 0; i < data.length; i++) {
    const row = data[i].map(function (c) { return String(c).trim().toUpperCase(); });
    if (row.indexOf('SHEET') >= 0 && row.indexOf('ARTICLES') >= 0) {
      hdr = i; artCol = row.indexOf('ARTICLES'); undCol = row.indexOf('UNDATED'); break;
    }
  }
  if (hdr < 0) return 0;
  let changed = 0;
  for (let i = hdr + 1; i < data.length; i++) {
    const tab = String(data[i][0]).trim();
    if (!tab || !cnt[tab]) continue;
    const c = cnt[tab];
    if (Number(data[i][artCol]) !== c.a || Number(data[i][undCol]) !== c.u) {
      changed++;
      if (!dry) {
        sh.getRange(i + 1, artCol + 1).setValue(c.a);
        sh.getRange(i + 1, undCol + 1).setValue(c.u);
      }
    }
  }
  return changed;
}

// ── 2. Normalization Misses — APPEND new orphans (never edit existing) ─────
function appendNewOrphans_(tabName, perClient, dry) {
  const r = rosterSets_();
  // orphan = a name in the data that is NOT in the roster for its role
  const grp = perClient ? 'editor_name, client_name' : 'editor_name';
  const sql =
    "SELECT k, n, " + (perClient ? "client, " : "") + "occ, y0, y1 FROM (" +
    "  SELECT 'Editor' k, editor_name n, " + (perClient ? "client_name client, " : "") +
    "    COUNT(*) occ, MIN(EXTRACT(YEAR FROM submitted_date)) y0, MAX(EXTRACT(YEAR FROM submitted_date)) y1" +
    "  FROM " + DS + ".editorial_raw_articles WHERE editor_name IS NOT NULL" +
    "  GROUP BY editor_name" + (perClient ? ", client_name" : "") +
    "  UNION ALL" +
    "  SELECT 'Writer', writer_name, " + (perClient ? "client_name, " : "") +
    "    COUNT(*), MIN(EXTRACT(YEAR FROM submitted_date)), MAX(EXTRACT(YEAR FROM submitted_date))" +
    "  FROM " + DS + ".editorial_raw_articles WHERE writer_name IS NOT NULL" +
    "  GROUP BY writer_name" + (perClient ? ", client_name" : "") + ")";
  const rows = bq_(sql);
  const sh = SpreadsheetApp.getActive().getSheetByName(tabName);
  const existing = {};
  sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 1).getValues()
    .forEach(function (x) { if (x[0]) existing[String(x[0]).trim().toLowerCase()] = true; });
  const out = [];
  rows.forEach(function (r2) {
    const kind = r2[0], name = String(r2[1] || '').trim();
    if (!name) return;
    const inRoster = kind === 'Editor' ? r.ed[name] : r.wr[name];
    if (inRoster || existing[name.toLowerCase()]) return;          // canonical or already listed
    const occ = perClient ? r2[3] : r2[2];
    const y0 = perClient ? r2[4] : r2[3];
    const y1 = perClient ? r2[5] : r2[4];
    const years = (y0 && y1) ? (y0 + '–' + y1) : '';
    const note = 'auto-detected — needs identification';
    if (perClient) out.push([name, kind, r2[2], occ, years, 'Needs attention', note, '']);
    else out.push([name, kind, occ, years, 'Needs attention', note, '', '', '']);
    existing[name.toLowerCase()] = true;
  });
  if (out.length && !dry) sh.getRange(sh.getLastRow() + 1, 1, out.length, out[0].length).setValues(out);
  return out.length;
}

// ── 3. OM RECONCILIATION — regenerate (no manual data) ─────────────────────
function refreshOMReconciliation_(dry) {
  // last 6 months present in the article log
  const months = bq_(
    'SELECT DISTINCT month_year FROM ' + DS + '.editorial_raw_articles ' +
    'WHERE month_year IS NOT NULL ORDER BY month_year DESC LIMIT 6')
    .map(function (r) { return r[0]; }).sort();
  if (!months.length) return 0;
  const log = {};
  bq_('SELECT client_name, month_year, COUNT(DISTINCT article_uid) c FROM ' + DS +
    ".editorial_raw_articles WHERE month_year IS NOT NULL GROUP BY 1,2")
    .forEach(function (r) { (log[r[0]] = log[r[0]] || {})[r[1]] = Number(r[2]); });
  const om = {};
  bq_("SELECT client_name, FORMAT('%04d-%02d', year, month) my, SUM(articles_actual) a FROM " +
    DS + ".editorial_raw_production WHERE year IS NOT NULL GROUP BY 1,2")
    .forEach(function (r) { (om[r[0]] = om[r[0]] || {})[r[1]] = Number(r[2] || 0); });
  const clients = {};
  Object.keys(log).forEach(function (c) { clients[c] = true; });
  Object.keys(om).forEach(function (c) { clients[c] = true; });
  const names = Object.keys(clients).sort();
  const header = ['CLIENT'].concat(months.map(function (m) { return 'OM ' + m; }))
    .concat(months.map(function (m) { return 'LOG ' + m; }));
  const grid = [header];
  names.forEach(function (c) {
    const row = [c];
    months.forEach(function (m) { row.push((om[c] && om[c][m]) || 0); });
    months.forEach(function (m) { row.push((log[c] && log[c][m]) || 0); });
    grid.push(row);
  });
  if (!dry) {
    const sh = SpreadsheetApp.getActive().getSheetByName(TAB_OM);
    sh.clearContents();
    sh.getRange(1, 1, grid.length, grid[0].length).setValues(grid);
  }
  return grid.length - 1;
}

// ── entry points ───────────────────────────────────────────────────────────
function previewAudits() {
  const v = refreshValidationCounts_(true);
  const m = appendNewOrphans_(TAB_MISSES, false, true);
  const d = appendNewOrphans_(TAB_MISSES_DETAIL, true, true);
  const o = refreshOMReconciliation_(true);
  Logger.log('[PREVIEW] VALIDATION counts to update: %s · new orphans (summary): %s · ' +
    'new orphans (client detail): %s · OM-recon client rows: %s', v, m, d, o);
}

function refreshAllAudits() {
  const v = refreshValidationCounts_(false);
  const m = appendNewOrphans_(TAB_MISSES, false, false);
  const d = appendNewOrphans_(TAB_MISSES_DETAIL, true, false);
  const o = refreshOMReconciliation_(false);
  Logger.log('VALIDATION counts updated: %s · new orphans appended (summary): %s · ' +
    '(client detail): %s · OM-recon rows: %s', v, m, d, o);
}

function createDailyAuditTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'refreshAllAudits') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('refreshAllAudits').timeBased().everyDays(1).atHour(11).create();
}
