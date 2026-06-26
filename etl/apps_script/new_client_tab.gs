/**
 * Auto-create a client tab from the TEMPLATE when a new client signs.
 * ───────────────────────────────────────────────────────────────────────────
 * Lives in the Monthly Article Count sheet (Extensions → Apps Script).
 * On a daily trigger it reads the canonical client list from BigQuery and, for
 * every client that has no tab yet, duplicates "🧩 TEMPLATE" and
 * renames the copy to the client name. It NEVER touches existing tabs.
 *
 * SETUP (once)
 *  1. In the sheet: Extensions → Apps Script, paste this file.
 *  2. Add a "⚙️ CONFIG" tab to the sheet with key/value rows in A:B —
 *       BQ_PROJECT     graphite-data
 *       CLIENT_QUERY   SELECT name FROM `graphite-data.graphite_bi_sandbox.editorial_clients` WHERE status IN ('ACTIVE','SOON_TO_BE_ACTIVE')
 *       TEMPLATE_TAB   🧩 TEMPLATE
 *       AUTH_MODE      advanced            (or: sa)
 *     CLIENT_QUERY must return ONE column = the canonical client name (first column is used).
 *  3a. AUTH_MODE=advanced (simplest): Apps Script editor → Services (+) → add
 *      "BigQuery API". Runs as YOU (the owner needs BigQuery access on graphite-data).
 *  3b. AUTH_MODE=sa (owner-independent, uses graphite-bi-sa): put the service-account
 *      creds in SCRIPT PROPERTIES (Project Settings → Script properties), NOT the
 *      config sheet — a sheet key is readable by every editor:
 *        SA_EMAIL   graphite-bi-sa@graphite-data.iam.gserviceaccount.com
 *        SA_KEY     -----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----\n
 *  4. Run previewNewClientTabs() once → authorize → check the log (DRY RUN, creates nothing).
 *  5. When happy, run createDailyTrigger() to schedule syncNewClientTabs() daily at 07:00.
 */

const CONFIG_TAB = '⚙️ CONFIG';
const LOG_TAB = '⚙️ AUTOCREATE LOG';

function getConfig_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(CONFIG_TAB);
  if (!sh) throw new Error('Add a "' + CONFIG_TAB + '" tab with BQ_PROJECT / CLIENT_QUERY / TEMPLATE_TAB / AUTH_MODE in columns A:B.');
  const cfg = {};
  sh.getRange(1, 1, sh.getLastRow(), 2).getValues().forEach(function (r) {
    if (r[0]) cfg[String(r[0]).trim()] = String(r[1]).trim();
  });
  if (!cfg.BQ_PROJECT || !cfg.CLIENT_QUERY) throw new Error('CONFIG needs BQ_PROJECT and CLIENT_QUERY.');
  cfg.TEMPLATE_TAB = cfg.TEMPLATE_TAB || '🧩 TEMPLATE';
  cfg.AUTH_MODE = (cfg.AUTH_MODE || 'advanced').toLowerCase();
  return cfg;
}

// alphanumeric-lowercase key so "Dr. Squatch" ↔ "Dr Squatch" don't double-create
function normKey_(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

function fetchClients_(cfg) {
  return cfg.AUTH_MODE === 'sa' ? queryViaServiceAccount_(cfg) : queryViaAdvancedService_(cfg);
}

// ── BigQuery via the built-in advanced service (runs as the script owner) ──
function queryViaAdvancedService_(cfg) {
  let job = BigQuery.Jobs.query({ query: cfg.CLIENT_QUERY, useLegacySql: false }, cfg.BQ_PROJECT);
  const jobId = job.jobReference.jobId;
  while (!job.jobComplete) {
    Utilities.sleep(1000);
    job = BigQuery.Jobs.getQueryResults(cfg.BQ_PROJECT, jobId);
  }
  return (job.rows || []).map(function (r) { return r.f[0].v; }).filter(String);
}

// ── BigQuery via service account (JWT → token → REST); creds in Script Properties ──
function queryViaServiceAccount_(cfg) {
  const props = PropertiesService.getScriptProperties();
  const email = props.getProperty('SA_EMAIL');
  const key = (props.getProperty('SA_KEY') || '').replace(/\\n/g, '\n');
  if (!email || !key) throw new Error('AUTH_MODE=sa needs SA_EMAIL and SA_KEY in Script properties.');
  const now = Math.floor(Date.now() / 1000);
  const b64 = function (o) { return Utilities.base64EncodeWebSafe(JSON.stringify(o)).replace(/=+$/, ''); };
  const head = b64({ alg: 'RS256', typ: 'JWT' });
  const claim = b64({ iss: email, scope: 'https://www.googleapis.com/auth/bigquery.readonly', aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now });
  const sig = Utilities.base64EncodeWebSafe(Utilities.computeRsaSha256Signature(head + '.' + claim, key)).replace(/=+$/, '');
  const tokRes = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post', muteHttpExceptions: true,
    payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: head + '.' + claim + '.' + sig }
  });
  const token = JSON.parse(tokRes.getContentText()).access_token;
  if (!token) throw new Error('SA token failed: ' + tokRes.getContentText());
  const qRes = UrlFetchApp.fetch('https://bigquery.googleapis.com/bigquery/v2/projects/' + cfg.BQ_PROJECT + '/queries', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ query: cfg.CLIENT_QUERY, useLegacySql: false })
  });
  const data = JSON.parse(qRes.getContentText());
  if (!data.rows && data.error) throw new Error('BQ error: ' + JSON.stringify(data.error));
  return (data.rows || []).map(function (r) { return r.f[0].v; }).filter(String);
}

function plan_() {
  const ss = SpreadsheetApp.getActive();
  const cfg = getConfig_();
  if (!ss.getSheetByName(cfg.TEMPLATE_TAB)) throw new Error('Template tab not found: ' + cfg.TEMPLATE_TAB);
  const tabNames = ss.getSheets().map(function (s) { return s.getName().trim(); });
  const exact = {};
  tabNames.forEach(function (n) { exact[normKey_(n)] = true; });
  // A client is "covered" if a tab matches it exactly (punctuation-insensitive),
  // OR a tab is the leading words of the client name at a WORD boundary — so
  // "Tempo XYZ" is covered by the "Tempo" tab, but "BetterUp" is NOT by "Better".
  function covered(name) {
    if (exact[normKey_(name)]) return true;
    const lower = name.toLowerCase();
    return tabNames.some(function (t) {
      const tl = t.toLowerCase();
      return tl && lower.startsWith(tl + ' ');
    });
  }
  const missing = [];
  fetchClients_(cfg).forEach(function (name) {
    name = String(name).trim();
    if (name && !covered(name)) { missing.push(name); exact[normKey_(name)] = true; }
  });
  return { ss: ss, cfg: cfg, missing: missing };
}

// DRY RUN — logs what WOULD be created, changes nothing. Run this first.
function previewNewClientTabs() {
  const p = plan_();
  Logger.log(p.missing.length ? 'Would create ' + p.missing.length + ' tab(s): ' + p.missing.join(', ') : 'No new clients — nothing to create.');
  log_(p.ss, '[PREVIEW] ' + (p.missing.length ? p.missing.join(', ') : '(none)'));
  return p.missing;
}

// LIVE — duplicates the template for each missing client.
function syncNewClientTabs() {
  const p = plan_();
  const template = p.ss.getSheetByName(p.cfg.TEMPLATE_TAB);
  const created = [];
  p.missing.forEach(function (name) {
    const tab = template.copyTo(p.ss).setName(name);
    tab.getRange('A1').setValue('MONTHLY ARTICLES COUNT  🔍  [' + name.toUpperCase() + ']');
    moveAlpha_(p.ss, tab);
    created.push(name);
  });
  log_(p.ss, created.length ? created.join(', ') : '(none)');
  return created;
}

// A "client" tab = letter-named and not a summary/audit/utility tab. Used as the
// alphabetical boundary so a new tab isn't slotted next to MONTHLY_ARTICLES_COUNT,
// Word Counts, the audits, Roster, etc.
function isClientTab_(n) {
  if (!/^[A-Za-z]/.test(n)) return false;
  const u = n.toUpperCase();
  return ['MONTHLY', 'WORD COUNT', 'COMPARE', 'AUDIT', 'MISSES', 'RECONCIL', 'ROSTER', 'CONFIG', 'TEMPLATE', 'AUTOCREATE'].every(function (k) { return u.indexOf(k) < 0; });
}

// Slot the new tab into alphabetical order among the CLIENT tabs only.
function moveAlpha_(ss, tab) {
  const lower = tab.getName().toLowerCase();
  const sheets = ss.getSheets();
  let pos = sheets.length;
  for (let i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === tab.getSheetId()) continue;
    const n = sheets[i].getName();
    if (isClientTab_(n) && n.toLowerCase() > lower) { pos = i + 1; break; }
  }
  ss.setActiveSheet(tab);
  ss.moveActiveSheet(pos);
}

// ONE-TIME cleanup: alphabetically sort ALL existing client tabs (utility/summary
// tabs keep their exact positions). New tabs are slotted by moveAlpha_ as they're
// created; run this once to fix tabs created before that existed. Reorders only —
// never edits content. Run manually from the editor.
function sortAllClientTabs() {
  const ss = SpreadsheetApp.getActive();
  const sheets = ss.getSheets();
  const clientIdx = [], clientSheets = [];
  sheets.forEach(function (s, i) {
    if (isClientTab_(s.getName())) { clientIdx.push(i); clientSheets.push(s); }
  });
  const sorted = clientSheets.slice().sort(function (a, b) {
    var an = a.getName().toLowerCase(), bn = b.getName().toLowerCase();
    return an < bn ? -1 : an > bn ? 1 : 0;
  });
  // Desired full order: non-client tabs stay in place; client slots get the sorted clients.
  const desired = sheets.slice();
  clientIdx.forEach(function (idx, k) { desired[idx] = sorted[k]; });
  for (var i = 0; i < desired.length; i++) {
    ss.setActiveSheet(desired[i]);
    ss.moveActiveSheet(i + 1);
  }
  log_(ss, '[SORT] reordered ' + clientSheets.length + ' client tabs alphabetically');
  Logger.log('Sorted ' + clientSheets.length + ' client tabs alphabetically.');
}

function log_(ss, msg) {
  const sh = ss.getSheetByName(LOG_TAB) || ss.insertSheet(LOG_TAB);
  sh.appendRow([new Date(), msg]);
}

function createDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncNewClientTabs') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncNewClientTabs').timeBased().everyDays(1).atHour(7).create();
}
