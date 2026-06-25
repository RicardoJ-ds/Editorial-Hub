/* Daily refresh of the audit/normalization tabs in the Monthly Article Count sheet.
   Reads the BigQuery warehouse and updates: VALIDATION AUDIT (per-tab ARTICLES +
   UNDATED counts), Normalization Misses + Client Detail (appends NEW orphan names
   only - never edits existing rows or the manual Canonical/Full Name columns), and
   OM RECONCILIATION (regenerated). Tabs are matched by text so emoji cannot break it.
   Run previewAudits() first (writes nothing), then createDailyAuditTrigger(). */

var DS = '`graphite-data.graphite_bi_sandbox`';

function findSheet_(kw, notKw) {
  kw = kw.toUpperCase();
  var exc = notKw ? notKw.toUpperCase() : null;
  var all = SpreadsheetApp.getActive().getSheets();
  for (var i = 0; i < all.length; i++) {
    var n = all[i].getName().toUpperCase();
    if (n.indexOf(kw) >= 0 && (!exc || n.indexOf(exc) < 0)) return all[i];
  }
  throw new Error('Tab not found containing "' + kw + '"');
}

function aGetConfig_() {
  var sh = findSheet_('CONFIG');
  var cfg = {};
  sh.getRange(1, 1, sh.getLastRow(), 2).getValues().forEach(function (r) {
    if (r[0]) cfg[String(r[0]).trim()] = String(r[1]).trim();
  });
  cfg.BQ_PROJECT = cfg.BQ_PROJECT || 'graphite-data';
  cfg.AUTH_MODE = (cfg.AUTH_MODE || 'advanced').toLowerCase();
  return cfg;
}

function bq_(sql) {
  var cfg = aGetConfig_();
  var job = BigQuery.Jobs.query({ query: sql, useLegacySql: false }, cfg.BQ_PROJECT);
  var id = job.jobReference.jobId;
  while (!job.jobComplete) {
    Utilities.sleep(800);
    job = BigQuery.Jobs.getQueryResults(cfg.BQ_PROJECT, id);
  }
  return (job.rows || []).map(function (r) { return r.f.map(function (c) { return c.v; }); });
}

function rosterSets_() {
  var vals = findSheet_('ROSTER').getDataRange().getValues();
  var ed = {}, wr = {};
  for (var i = 1; i < vals.length; i++) {
    if (vals[i][1]) ed[String(vals[i][1]).trim()] = true;
    if (vals[i][6]) wr[String(vals[i][6]).trim()] = true;
  }
  return { ed: ed, wr: wr };
}

function refreshValidationCounts_(dry) {
  var rows = bq_('SELECT source_tab, COUNT(DISTINCT article_uid) articles, ' +
    'COUNTIF(submitted_date IS NULL) undated FROM ' + DS + '.editorial_raw_articles GROUP BY source_tab');
  var cnt = {};
  rows.forEach(function (r) { cnt[r[0]] = { a: Number(r[1]), u: Number(r[2]) }; });
  var sh = findSheet_('VALIDATION AUDIT');
  var data = sh.getDataRange().getValues();
  var hdr = -1, artCol = -1, undCol = -1;
  for (var i = 0; i < data.length; i++) {
    var row = data[i].map(function (c) { return String(c).trim().toUpperCase(); });
    if (row.indexOf('SHEET') >= 0 && row.indexOf('ARTICLES') >= 0) {
      hdr = i; artCol = row.indexOf('ARTICLES'); undCol = row.indexOf('UNDATED'); break;
    }
  }
  if (hdr < 0) return 0;
  var changed = 0;
  for (var j = hdr + 1; j < data.length; j++) {
    var tab = String(data[j][0]).trim();
    if (!tab || !cnt[tab]) continue;
    var c = cnt[tab];
    if (Number(data[j][artCol]) !== c.a || Number(data[j][undCol]) !== c.u) {
      changed++;
      if (!dry) {
        sh.getRange(j + 1, artCol + 1).setValue(c.a);
        sh.getRange(j + 1, undCol + 1).setValue(c.u);
      }
    }
  }
  return changed;
}

function appendNewOrphans_(kw, notKw, perClient, dry) {
  var r = rosterSets_();
  var sql = "SELECT k, n, " + (perClient ? "client, " : "") + "occ, y0, y1 FROM (" +
    "  SELECT 'Editor' k, editor_name n, " + (perClient ? "client_name client, " : "") +
    "    COUNT(*) occ, MIN(EXTRACT(YEAR FROM submitted_date)) y0, MAX(EXTRACT(YEAR FROM submitted_date)) y1" +
    "  FROM " + DS + ".editorial_raw_articles WHERE editor_name IS NOT NULL" +
    "  GROUP BY editor_name" + (perClient ? ", client_name" : "") +
    "  UNION ALL" +
    "  SELECT 'Writer', writer_name, " + (perClient ? "client_name, " : "") +
    "    COUNT(*), MIN(EXTRACT(YEAR FROM submitted_date)), MAX(EXTRACT(YEAR FROM submitted_date))" +
    "  FROM " + DS + ".editorial_raw_articles WHERE writer_name IS NOT NULL" +
    "  GROUP BY writer_name" + (perClient ? ", client_name" : "") + ")";
  var rows = bq_(sql);
  var sh = findSheet_(kw, notKw);
  var existing = {};
  sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 1).getValues()
    .forEach(function (x) { if (x[0]) existing[String(x[0]).trim().toLowerCase()] = true; });
  var out = [];
  rows.forEach(function (r2) {
    var kind = r2[0], name = String(r2[1] || '').trim();
    if (!name) return;
    var inRoster = kind === 'Editor' ? r.ed[name] : r.wr[name];
    if (inRoster || existing[name.toLowerCase()]) return;
    var occ = perClient ? r2[3] : r2[2];
    var y0 = perClient ? r2[4] : r2[3];
    var y1 = perClient ? r2[5] : r2[4];
    var years = (y0 && y1) ? (y0 + '-' + y1) : '';
    var note = 'auto-detected - needs identification';
    if (perClient) out.push([name, kind, r2[2], occ, years, 'Needs attention', note, '']);
    else out.push([name, kind, occ, years, 'Needs attention', note, '', '', '']);
    existing[name.toLowerCase()] = true;
  });
  if (out.length && !dry) sh.getRange(sh.getLastRow() + 1, 1, out.length, out[0].length).setValues(out);
  return out.length;
}

function refreshOMReconciliation_(dry) {
  var months = bq_('SELECT DISTINCT month_year FROM ' + DS + '.editorial_raw_articles ' +
    'WHERE month_year IS NOT NULL ORDER BY month_year DESC LIMIT 6').map(function (r) { return r[0]; }).sort();
  if (!months.length) return 0;
  var log = {};
  bq_('SELECT client_name, month_year, COUNT(DISTINCT article_uid) c FROM ' + DS +
    ".editorial_raw_articles WHERE month_year IS NOT NULL GROUP BY 1,2")
    .forEach(function (r) { (log[r[0]] = log[r[0]] || {})[r[1]] = Number(r[2]); });
  var om = {};
  bq_("SELECT cl.name, FORMAT('%04d-%02d', p.year, p.month) my, SUM(p.articles_actual) a FROM " +
    DS + ".editorial_raw_production p JOIN " + DS + ".editorial_raw_clients cl ON cl.id = p.client_id " +
    "WHERE p.year IS NOT NULL GROUP BY 1,2")
    .forEach(function (r) { (om[r[0]] = om[r[0]] || {})[r[1]] = Number(r[2] || 0); });
  var clients = {};
  Object.keys(log).forEach(function (c) { clients[c] = true; });
  Object.keys(om).forEach(function (c) { clients[c] = true; });
  var names = Object.keys(clients).sort();
  var header = ['CLIENT'].concat(months.map(function (m) { return 'OM ' + m; }))
    .concat(months.map(function (m) { return 'LOG ' + m; }));
  var grid = [header];
  names.forEach(function (c) {
    var row = [c];
    months.forEach(function (m) { row.push((om[c] && om[c][m]) || 0); });
    months.forEach(function (m) { row.push((log[c] && log[c][m]) || 0); });
    grid.push(row);
  });
  if (!dry) {
    var sh = findSheet_('OM RECONCILIATION');
    sh.clearContents();
    sh.getRange(1, 1, grid.length, grid[0].length).setValues(grid);
  }
  return grid.length - 1;
}

function previewAudits() {
  var v = refreshValidationCounts_(true);
  var m = appendNewOrphans_('NORMALIZATION MISSES', 'CLIENT', false, true);
  var d = appendNewOrphans_('CLIENT DETAIL', null, true, true);
  var o = refreshOMReconciliation_(true);
  Logger.log('[PREVIEW] validation rows to update=%s  new orphans summary=%s  client detail=%s  OM rows=%s', v, m, d, o);
}

function refreshAllAudits() {
  var v = refreshValidationCounts_(false);
  var m = appendNewOrphans_('NORMALIZATION MISSES', 'CLIENT', false, false);
  var d = appendNewOrphans_('CLIENT DETAIL', null, true, false);
  var o = refreshOMReconciliation_(false);
  Logger.log('validation updated=%s  orphans summary=%s  client detail=%s  OM rows=%s', v, m, d, o);
}

function createDailyAuditTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'refreshAllAudits') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('refreshAllAudits').timeBased().everyDays(1).atHour(11).create();
}
