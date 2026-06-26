/* Refresh the 'Roster' tab from BigQuery v_editorial_roster (the single source of
   truth: Rippling editors + Slack writers + legacy canonicals, minus the
   DaniQ-editable Exclusions tab). The MAC client tabs IMPORTRANGE this tab for their
   editor/writer/2nd-review dropdowns, so this is what keeps every dropdown current.

   SELF-CONTAINED and BOUND to the Editorial Name Mappings spreadsheet (writes its own
   'Roster' tab via getActive). One-time setup: Extensions -> Apps Script, add the
   BigQuery advanced service (Services -> BigQuery -> Add), paste this file. Then run
   previewRoster() (writes nothing, logs counts) -> refreshRosterNow() (writes) ->
   createDailyRosterTrigger() (daily 10:00). The trigger runs as whoever creates it,
   so install it as a user with BigQuery access to graphite-data. */

var BQ_PROJECT = 'graphite-data';
var ROSTER_VIEW = '`graphite-data.graphite_bi_sandbox.v_editorial_roster`';
var ROSTER_HEADER = ['ACTIVE EDITORS', 'ALL EDITORS (validation)', 'STATUS', 'HIRE',
  'TERM', 'SR EDITORS (2nd review)', 'WRITERS (validation)', 'WRITER STATUS', 'ACTIVE WRITERS'];

function bqRoster_(sql) {
  var job = BigQuery.Jobs.query({ query: sql, useLegacySql: false }, BQ_PROJECT);
  var id = job.jobReference.jobId;
  while (!job.jobComplete) {
    Utilities.sleep(800);
    job = BigQuery.Jobs.getQueryResults(BQ_PROJECT, id);
  }
  return (job.rows || []).map(function (r) { return r.f.map(function (c) { return c.v; }); });
}

function refreshRoster_(dry) {
  // active-first, then alphabetical - so the dropdowns list current people at top
  var rows = bqRoster_("SELECT canonical_name, role, status, " +
    "FORMAT_DATE('%Y-%m-%d', hire_date) hire, FORMAT_DATE('%Y-%m-%d', term_date) term " +
    "FROM " + ROSTER_VIEW + " ORDER BY (status = 'active') DESC, canonical_name");

  var editors = [], srs = [], writers = [];
  rows.forEach(function (r) {
    var name = r[0], role = r[1], status = r[2], active = (status === 'active');
    var rec = { name: name, status: status, active: active, hire: r[3] || '', term: r[4] || '' };
    if (role === 'editor' || role === 'sr_editor') editors.push(rec);
    if (role === 'sr_editor') srs.push(rec);
    if (role === 'writer') writers.push(rec);
  });
  function dedup(arr) {
    var seen = {}, out = [];
    arr.forEach(function (x) { var k = x.name.toLowerCase(); if (!seen[k]) { seen[k] = 1; out.push(x); } });
    return out;
  }
  editors = dedup(editors); srs = dedup(srs); writers = dedup(writers);

  var colA = editors.filter(function (e) { return e.active; }).map(function (e) { return e.name; });
  var colB = editors.map(function (e) { return e.name; });
  var colC = editors.map(function (e) { return e.active ? 'ACTIVE' : 'TERMINATED'; });
  var colD = editors.map(function (e) { return e.hire; });
  var colE = editors.map(function (e) { return e.term; });
  var colF = srs.map(function (e) { return e.name; });
  var colG = writers.map(function (w) { return w.name; });
  var colH = writers.map(function (w) { return w.active ? 'ACTIVE' : 'INACTIVE'; });
  var colI = writers.filter(function (w) { return w.active; }).map(function (w) { return w.name; });

  var n = Math.max(colA.length, colB.length, colF.length, colG.length, colI.length);
  var grid = [ROSTER_HEADER];
  for (var i = 0; i < n; i++) {
    grid.push([colA[i] || '', colB[i] || '', colC[i] || '', colD[i] || '', colE[i] || '',
      colF[i] || '', colG[i] || '', colH[i] || '', colI[i] || '']);
  }
  if (dry) {
    Logger.log('[DRY] editors=%s (active %s) | sr-editors=%s | writers=%s (active %s) | rows=%s',
      colB.length, colA.length, colF.length, colG.length, colI.length, grid.length - 1);
    return grid.length - 1;
  }
  // Safety guard: never overwrite the Roster tab with a near-empty result (e.g. a
  // transient BigQuery error that returns 0 rows). A healthy roster is ~130 people;
  // anything under 20 means something is wrong - abort and leave the tab untouched.
  if (grid.length - 1 < 20) {
    Logger.log('ABORT: view returned only %s people - refusing to overwrite the Roster tab. No changes made.', grid.length - 1);
    return -1;
  }
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName('Roster') || ss.insertSheet('Roster');
  // Clear only cols A-I (preserve any helper columns at J+), then write.
  sh.getRange(1, 1, Math.max(sh.getMaxRows(), grid.length), 9).clearContent();
  sh.getRange(1, 1, grid.length, 9).setValues(grid);
  return grid.length - 1;
}

function previewRoster() { refreshRoster_(true); }

function refreshRosterNow() {
  var n = refreshRoster_(false);
  Logger.log('Roster refreshed from v_editorial_roster: %s people', n);
}

function createDailyRosterTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'refreshRosterNow') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('refreshRosterNow').timeBased().everyDays(1).atHour(10).create();
}
