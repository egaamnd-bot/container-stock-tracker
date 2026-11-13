/**
 * SBS — MASTER_DAILY_STOCK → Supabase push (Container Stock Tracker)
 *
 * Add this as a NEW FILE in the same Apps Script project as the IT team's
 * Daily Stock fetcher. It does NOT modify their code and NEVER calls the lazyit API:
 * it only reads the MASTER_DAILY_STOCK tab that fetchDailyStock() already writes
 * (full stock — the 'offhire' filter there applies only to the Offhire/OB copies).
 *
 * Flow:  lazyit API --(IT script, every 6h)--> MASTER_DAILY_STOCK --(this, hourly)--> Supabase --> phones
 *
 * Setup (once):
 *   1. Project Settings → Script Properties → add
 *        SUPABASE_URL        = https://xrkbhopqyxoahusaozkc.supabase.co
 *        SUPABASE_SECRET_KEY = sb_secret_…   (Supabase → Settings → API Keys → Secret key)
 *      The secret key bypasses all access rules: never paste it in a sheet, a chat, or the app repo.
 *   2. Run stockPushDiagnose() → check the log shows the right column for each field.
 *   3. Run pushStockToSupabase() once manually (approve the permissions prompt).
 *   4. Run setupSupabasePushTrigger() once → hourly automatic push.
 *
 * Safety:
 *   - Pushes only when the IT script recorded a NEW successful API snapshot (no churn).
 *   - Replace import is one transaction on the server: any error = nothing changes.
 *   - Refuses to push if the snapshot is < 80% of what's in Supabase (protects against a
 *     partial/broken API response wiping containers from everyone's phones).
 *   - Rows with a missing field are skipped AND protected (never deleted because of bad data).
 */

var SP_MASTER_SHEET = 'MASTER_DAILY_STOCK';
var SP_LOG_SHEET = 'SUPABASE_PUSH_LOG';
var SP_MIN_RATIO = 0.8;         // block if new count < 80% of current Supabase count…
var SP_MIN_RATIO_FLOOR = 500;   // …but only once Supabase already holds more than this many

// Header candidates per app field (lowercased, first match wins). Override with SP_FIELD_OVERRIDE.
var SP_FIELD_CANDIDATES = {
  container_no:  ['container', 'cont', 'container_no', 'container_number'],
  shipping_line: ['owner', 'owner_code', 'shipping_line', 'line', 'operator', 'customer'],
  type:          ['type', 'cont_type', 'container_type', 'type_code'],
  grade:         ['grade', 'cont_grade', 'container_grade'],
  size:          ['size', 'cont_size', 'container_size'],
  condition:     ['condition', 'cond', 'cont_condition', 'container_condition']
};
// If auto-detection picks the wrong column, set the exact header here, e.g. { condition: 'status_cond' }
var SP_FIELD_OVERRIDE = {};

function pushStockToSupabase(force) {
  var started = new Date();
  var props = PropertiesService.getScriptProperties();
  var lock = LockService.getScriptLock(); // same lock as fetchDailyStock → never reads a half-written master
  if (!lock.tryLock(60000)) { spLog_([started, new Date(), 'SKIPPED_BUSY', '', '', '', 'Daily Stock sync is running; will retry next hour']); return; }
  try {
    var snapshotAt = props.getProperty('SBS_LAST_API_SUCCESS_AT') || '';
    if (!force && snapshotAt && snapshotAt === props.getProperty('SP_LAST_PUSHED_SNAPSHOT')) {
      return; // nothing new since last push — stay quiet, no log spam
    }

    var cfg = spConfig_();
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SP_MASTER_SHEET);
    if (!sheet || sheet.getLastRow() <= 1) throw new Error(SP_MASTER_SHEET + ' is missing or empty');
    var table = sheet.getDataRange().getDisplayValues(); // display values: keeps "20"/"40" as text, no 1.0E7 surprises
    var headers = table[0].map(function (h) { return String(h).trim().toLowerCase(); });
    var idx = spResolveColumns_(headers);

    var rows = [], invalid = 0, dup = 0, seen = {}, protectedNos = [];
    for (var i = 1; i < table.length; i++) {
      var r = table[i];
      var display = String(r[idx.container_no] || '').trim();
      var no = display.toUpperCase().replace(/[\s.\/_\-]/g, '');
      if (!no) continue; // blank line
      var rec = {
        container_no: no, display_no: display,
        shipping_line: String(r[idx.shipping_line] || '').trim(),
        type: String(r[idx.type] || '').trim(),
        grade: String(r[idx.grade] || '').trim(),
        size: String(r[idx.size] || '').trim(),
        condition: String(r[idx.condition] || '').trim()
      };
      var ok = /^[A-Z0-9]{4,15}$/.test(no) && rec.shipping_line && rec.type && rec.grade && rec.size && rec.condition;
      if (!ok) { invalid++; if (/^[A-Z0-9]{4,15}$/.test(no)) protectedNos.push(no); continue; }
      if (seen[no]) { dup++; continue; }
      seen[no] = true;
      rows.push(rec);
    }
    if (!rows.length) throw new Error('No valid rows in ' + SP_MASTER_SHEET + ' — refusing to push');

    var current = Number(spRpc_(cfg, 'inventory_count', {}));
    if (!force && current > SP_MIN_RATIO_FLOOR && rows.length < current * SP_MIN_RATIO) {
      spLog_([started, new Date(), 'BLOCKED_DROP', table.length - 1, rows.length, current,
        'New snapshot has ' + rows.length + ' valid rows vs ' + current + ' in Supabase (<' + (SP_MIN_RATIO * 100) +
        '%). Not pushed. If the drop is real, run pushStockToSupabase(true).']);
      return;
    }

    var batch = spRpc_(cfg, 'apply_import', {
      p_mode: 'replace',
      p_rows: rows,
      p_filename: 'MASTER_DAILY_STOCK (auto ' + (snapshotAt || 'manual') + ')',
      p_sheet_name: SP_MASTER_SHEET,
      p_total_rows: table.length - 1,
      p_invalid: invalid,
      p_duplicates: dup,
      p_protected: protectedNos
    });
    props.setProperty('SP_LAST_PUSHED_SNAPSHOT', snapshotAt);
    spLog_([started, new Date(), 'SUCCESS', table.length - 1, rows.length, current,
      '+' + batch.added + ' new, ' + batch.updated + ' updated, ' + batch.removed + ' removed, ' + invalid + ' invalid, ' + dup + ' dup']);
  } catch (e) {
    try { spLog_([started, new Date(), 'FAILED', '', '', '', String(e.message).slice(0, 500)]); } catch (ignored) {}
    throw e;
  } finally {
    lock.releaseLock();
  }
}

/** Logs which sheet column feeds each app field + 3 sample rows. Run this first. */
function stockPushDiagnose() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SP_MASTER_SHEET);
  if (!sheet || sheet.getLastRow() <= 1) throw new Error(SP_MASTER_SHEET + ' is missing or empty');
  var vals = sheet.getRange(1, 1, Math.min(4, sheet.getLastRow()), sheet.getLastColumn()).getDisplayValues();
  var headers = vals[0].map(function (h) { return String(h).trim().toLowerCase(); });
  Logger.log('All headers: ' + headers.join(' | '));
  var idx = spResolveColumns_(headers);
  Object.keys(idx).forEach(function (f) {
    Logger.log(f + ' ← "' + headers[idx[f]] + '"  samples: ' + vals.slice(1).map(function (r) { return r[idx[f]]; }).join(', '));
  });
  Logger.log('Rows in master: ' + (sheet.getLastRow() - 1));
}

/** Installs the hourly push. Safe to run again (replaces only its own trigger). */
function setupSupabasePushTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'pushStockToSupabase') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('pushStockToSupabase').timeBased().everyHours(1).create();
  Logger.log('Installed: pushStockToSupabase every hour (pushes only when a new API snapshot exists).');
}

// ---------- helpers ----------
function spConfig_() {
  var p = PropertiesService.getScriptProperties();
  var url = (p.getProperty('SUPABASE_URL') || '').replace(/\/+$/, '');
  var key = p.getProperty('SUPABASE_SECRET_KEY') || '';
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SECRET_KEY in Script Properties');
  if (key.indexOf('sb_publishable_') === 0) throw new Error('SUPABASE_SECRET_KEY is the publishable key — use the sb_secret_… key');
  return { url: url, key: key };
}

function spResolveColumns_(headers) {
  var idx = {}, missing = [];
  Object.keys(SP_FIELD_CANDIDATES).forEach(function (field) {
    var names = SP_FIELD_OVERRIDE[field] ? [String(SP_FIELD_OVERRIDE[field]).toLowerCase()] : SP_FIELD_CANDIDATES[field];
    for (var i = 0; i < names.length; i++) {
      var at = headers.indexOf(names[i]);
      if (at !== -1) { idx[field] = at; return; }
    }
    missing.push(field);
  });
  if (missing.length) {
    throw new Error('Cannot find column for: ' + missing.join(', ') + '. Headers are: ' + headers.join(' | ') +
      '. Set SP_FIELD_OVERRIDE at the top of SupabaseStockPush.gs.');
  }
  return idx;
}

function spRpc_(cfg, fn, body) {
  var headers = { apikey: cfg.key, Prefer: 'return=representation' };
  if (cfg.key.indexOf('eyJ') === 0) headers.Authorization = 'Bearer ' + cfg.key; // legacy service_role JWT
  var res = null, lastErr = null;
  for (var attempt = 0; attempt < 3; attempt++) {
    try {
      res = UrlFetchApp.fetch(cfg.url + '/rest/v1/rpc/' + fn, {
        method: 'post', contentType: 'application/json', headers: headers,
        payload: JSON.stringify(body), muteHttpExceptions: true
      });
      var code = res.getResponseCode();
      if (code >= 200 && code < 300) return JSON.parse(res.getContentText() || 'null');
      if (code < 500) throw new Error('Supabase ' + fn + ' HTTP ' + code + ': ' + res.getContentText().slice(0, 300));
      lastErr = new Error('Supabase ' + fn + ' HTTP ' + code);
    } catch (e) {
      if (String(e.message).indexOf('HTTP 4') !== -1) throw e; // client errors are not retried
      lastErr = e;
    }
    Utilities.sleep(Math.pow(2, attempt) * 2000);
  }
  throw lastErr;
}

function spLog_(values) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SP_LOG_SHEET) || ss.insertSheet(SP_LOG_SHEET);
  if (sh.getLastRow() === 0) sh.appendRow(['Started', 'Finished', 'Status', 'Master rows', 'Pushed', 'Supabase before', 'Message']);
  sh.appendRow(values);
}
