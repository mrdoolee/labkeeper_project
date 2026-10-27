// LabKeeper 학교용 코드 (API_VERSION 4)
// gas/src에서 자동으로 만든 파일입니다. 직접 고치지 말고 저장소에서 npm run bundle로 다시 만드세요.
// Apps Script 편집기에 이 파일 하나만 두고, 배포 → 배포 관리 → 수정 → 새 버전으로 배포하세요.

// ===== Auth.js =====

// Passwords, sessions and the first admin account.

var HASH_ROUNDS = 1000;
var SESSION_SECONDS = 21600; // 6 hours, extended on every request
var MAX_FAILURES = 5;
var LOCKOUT_SECONDS = 600;
var MIN_PASSWORD_LENGTH = 8;
var SYSTEM_USER = { id: 'system', name: '첫 설정' };
var SHEET_OWNER = { id: 'sheet-owner', name: '시트 소유자' };

function authActions() {
  return {
    'auth.login': { auth: 'none', write: true, handler: authLogin },
    'auth.me': { auth: 'user', write: false, handler: function (payload, user) { return user; } },
    'auth.logout': { auth: 'user', write: false, handler: authLogout },
    'auth.changePassword': { auth: 'user', write: true, handler: authChangePassword },
  };
}

function toHex(bytes) {
  return bytes
    .map(function (b) {
      var v = (b + 256) % 256;
      return (v < 16 ? '0' : '') + v.toString(16);
    })
    .join('');
}

function newSalt() {
  return Utilities.getUuid().replace(/-/g, '');
}

function hashPassword(password, saltHex) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, saltHex + ':' + password, Utilities.Charset.UTF_8);
  for (var i = 1; i < HASH_ROUNDS; i++) {
    bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes);
  }
  return toHex(bytes);
}

function publicUser(row) {
  return {
    id: row.id,
    loginId: row.loginId,
    name: row.name,
    role: row.role,
    mustChangePassword: row.mustChangePassword,
    active: row.active,
  };
}

function normalizeLoginId(loginId) {
  return String(loginId || '').trim().toLowerCase();
}

function checkPasswordRule(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw apiError('INVALID', '비밀번호는 ' + MIN_PASSWORD_LENGTH + '자 이상이어야 합니다.');
  }
}

function checkLoginId(loginId) {
  if (!/^[a-z0-9._-]{3,30}$/.test(loginId)) {
    throw apiError('INVALID', '아이디는 영문 소문자, 숫자, . _ - 로 3~30자여야 합니다.');
  }
}

function activeUsers() {
  return dbList('Users').filter(function (u) {
    return u.active;
  });
}

// The session remembers the user's salt. Every password change or reset
// makes a new salt, so all sessions from before it stop working.
function startSession(row) {
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('session:' + token, JSON.stringify({ userId: row.id, salt: row.salt }), SESSION_SECONDS);
  return token;
}

function requireUser(token) {
  var cache = CacheService.getScriptCache();
  var raw = token ? cache.get('session:' + token) : null;
  var session = raw ? JSON.parse(raw) : null;
  var row = session ? dbGet('Users', session.userId) : null;
  if (!row || row.deleted || !row.active || row.salt !== session.salt) {
    if (token) cache.remove('session:' + token);
    throw apiError('AUTH_REQUIRED', '로그인이 필요합니다.');
  }
  cache.put('session:' + token, raw, SESSION_SECONDS);
  return publicUser(row);
}

function requireAdmin(token) {
  var user = requireUser(token);
  if (user.role !== 'admin') throw apiError('FORBIDDEN', '운영 교사만 할 수 있습니다.');
  return user;
}

// Setup is open only while the Users sheet has no rows at all, so editing
// the sheet (e.g. renaming the 'active' header) can never reopen it.
function hasAnyUser() {
  return dbList('Users', { includeDeleted: true }).length > 0;
}

function authLogin(payload) {
  var loginId = normalizeLoginId(payload.loginId);
  var cache = CacheService.getScriptCache();
  var failKey = 'fail:' + loginId;
  var failures = Number(cache.get(failKey) || 0);
  if (failures >= MAX_FAILURES) {
    throw apiError('LOCKED_OUT', '로그인에 여러 번 실패해서 10분 동안 잠겼습니다. 잠시 후 다시 시도해 주세요.');
  }
  var row = dbList('Users').filter(function (u) {
    return u.loginId === loginId && u.active;
  })[0];
  if (!row || hashPassword(String(payload.password || ''), row.salt) !== row.hash) {
    cache.put(failKey, String(failures + 1), LOCKOUT_SECONDS);
    throw apiError('INVALID', '아이디 또는 비밀번호가 맞지 않습니다.');
  }
  cache.remove(failKey);
  dbAudit({ id: row.id, name: row.name }, 'Users', row.id, 'login', null, null, row.name);
  return { token: startSession(row), user: publicUser(row) };
}

function authLogout(payload, user, token) {
  CacheService.getScriptCache().remove('session:' + token);
  return true;
}

function authChangePassword(payload, user) {
  var row = dbGet('Users', user.id);
  if (hashPassword(String(payload.currentPassword || ''), row.salt) !== row.hash) {
    throw apiError('INVALID', '현재 비밀번호가 맞지 않습니다.');
  }
  checkPasswordRule(payload.newPassword);
  var salt = newSalt();
  var updated = dbUpdate('Users', user.id, { salt: salt, hash: hashPassword(payload.newPassword, salt), mustChangePassword: false }, user, { skipAudit: true });
  dbAudit(user, 'Users', user.id, 'passwordChange', null, null, user.name);
  return { token: startSession(updated) };
}

// ===== Code.js =====

// Web app entry points and request routing.
// Request:  POST text/plain {"action", "token"?, "payload"?}
// Response: {"ok": true, "data"} or {"ok": false, "error": {"code", "message"}}

// Filled lazily by registerActions(): Apps Script does not guarantee the
// order in which project files load, so nothing is registered at load time.
var ACTIONS = {};

function registerActions() {
  var groups = [systemActions(), authActions(), usersActions(), settingsActions(), recordsActions(), reagentsActions(), reagentTxActions()];
  groups.forEach(function (group) {
    Object.keys(group).forEach(function (name) {
      if (!ACTIONS[name]) ACTIONS[name] = group[name];
    });
  });
}

function doGet() {
  return jsonOut(ok({ name: 'LabKeeper' }));
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e && e.postData ? e.postData.contents : '');
  } catch (err) {
    return jsonOut(fail('INVALID', '요청 형식이 올바르지 않습니다.'));
  }
  if (!req || typeof req.action !== 'string') {
    return jsonOut(fail('INVALID', '요청 형식이 올바르지 않습니다.'));
  }

  registerActions();
  var def = ACTIONS[req.action];
  if (!def) return jsonOut(fail('UNKNOWN_ACTION', '알 수 없는 요청입니다.'));

  var lock = null;
  try {
    ensureLayout();
    if (req.action !== 'system.info' && sheetOwnerState() === 'copied') {
      throw apiError('SHEET_COPIED', '운영 중인 시트의 사본입니다. 시트 메뉴 LabKeeper → 사본을 새 학교 시트로 시작을 먼저 실행하세요.');
    }
    if (req.action !== 'system.info' && isTemplateSheet()) throw apiError('SHEET_TEMPLATE', TEMPLATE_MESSAGE);
    if (req.action !== 'system.info' && sheetClosedInfo()) {
      throw apiError('SHEET_CLOSED', '이 학교 시트는 운영이 종료되었습니다. 운영 교사에게 새 접속 링크를 받아 주세요.');
    }
    var user = null;
    if (def.auth === 'user') user = requireUser(req.token);
    else if (def.auth === 'admin') user = requireAdmin(req.token);
    if (def.write) {
      lock = LockService.getScriptLock();
      lock.waitLock(10000);
    }
    var data = def.handler(req.payload || {}, user, req.token);
    return jsonOut(ok(data === undefined ? null : data));
  } catch (err) {
    if (err && err.isApiError) return jsonOut(fail(err.code, err.message));
    console.error(err);
    return jsonOut(fail('SERVER_ERROR', '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.'));
  } finally {
    if (lock) lock.releaseLock();
  }
}

function ok(data) {
  return { ok: true, data: data };
}

function fail(code, message) {
  return { ok: false, error: { code: code, message: message } };
}

function apiError(code, message) {
  var err = new Error(message);
  err.code = code;
  err.isApiError = true;
  return err;
}

function jsonOut(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

// ===== Db.js =====

// Table storage on top of one spreadsheet: one tab per table, row 1 is the
// header. Tabs and headers are Korean (Schema.js); columns are always found by
// header, so people can reorder columns or add their own without breaking
// anything. Deletes are soft, and every change goes to an 이력 tab.

// ---- time ----

// Korean time as ISO text, e.g. 2026-10-24T14:20:00+09:00: readable in the sheet,
// and Date() in the browser reads it correctly.
function nowIso() {
  return kstIso(new Date());
}

function kstParts(date) {
  var d = new Date(date.getTime() + 9 * 3600 * 1000);
  var pad = function (n) {
    return (n < 10 ? '0' : '') + n;
  };
  return {
    date: d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()),
    time: pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()),
    seconds: pad(d.getUTCSeconds()),
  };
}

function kstIso(date) {
  var p = kstParts(date);
  return p.date + 'T' + p.time + ':' + p.seconds + '+09:00';
}

// "2026-10-24 14:20" for the 일시 column; old UTC values are converted too.
function kstText(iso) {
  var d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso || '');
  var p = kstParts(d);
  return p.date + ' ' + p.time;
}

// ---- tabs ----

var layoutChecked = false;

// Opens (or creates) a tab and makes sure every expected column has a header.
// Returns { sheet, header } where header[i] is the column key of column i+1
// (null for a column a person added).
function openTab(name, columns, labelOf, keyOf, kind) {
  ensureLayout();
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(name) || createTab(ss, name, kind);
  var labels = sheet.getLastRow() === 0 ? [] : sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  var header = labels.map(keyOf);
  var missing = columns.filter(function (c) {
    return header.indexOf(c) < 0;
  });
  if (missing.length) {
    var extraColumns = header.length + missing.length - sheet.getMaxColumns();
    if (extraColumns > 0) sheet.insertColumnsAfter(sheet.getMaxColumns(), extraColumns);
    sheet.getRange(1, header.length + 1, 1, missing.length).setValues([missing.map(function (c) {
      return toCell(labelOf(c));
    })]);
    sheet.getRange(1, header.length + 1, 1, missing.length).setFontWeight('bold');
    if (kind === 'history') {
      missing.forEach(function (c, i) {
        if (HISTORY_COLUMNS.indexOf(c) >= HISTORY_COLUMNS.indexOf(HISTORY_RAW_FROM)) {
          sheet.getRange(1, header.length + 1 + i).setBackground(RAW_HEADER_BACKGROUND);
        }
      });
    }
    header = header.concat(missing);
  }
  return { sheet: sheet, header: header };
}

// Data tabs go before the history tabs; colours tell the two apart.
function createTab(ss, name, kind) {
  var sheet;
  if (kind === 'data') {
    var dataNames = Object.keys(SHEET_NAMES).map(function (k) {
      return SHEET_NAMES[k];
    });
    var position = ss.getSheets().filter(function (s) {
      return dataNames.indexOf(s.getName()) >= 0;
    }).length;
    sheet = ss.insertSheet(name, position);
  } else {
    sheet = ss.insertSheet(name);
  }
  sheet.setTabColor(TAB_COLORS[kind]);
  sheet.setFrozenRows(1);
  return sheet;
}

function openTable(table) {
  return openTab(
    SHEET_NAMES[table] || table,
    columnsOf(table),
    function (c) {
      return columnLabel(table, c);
    },
    function (label) {
      return keyForLabel(table, label);
    },
    'data',
  );
}

function openHistory(group) {
  return openTab(
    HISTORY_TABS[group],
    HISTORY_COLUMNS,
    function (c) {
      return HISTORY_LABELS[c];
    },
    historyKeyForLabel,
    'history',
  );
}

// ---- cells ----

// Strings always get a leading apostrophe so Sheets keeps them as text
// (no formulas from "=...", no numbers from "0123").
function toCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value === '' ? '' : "'" + value;
  return value;
}

function fromCell(column, value) {
  if (BOOLEAN_COLUMNS.indexOf(column) >= 0) return value === true || String(value).toLowerCase() === 'true';
  if (NUMBER_COLUMNS.indexOf(column) >= 0) return value === '' || value === null ? null : Number(value);
  return value === null || value === undefined ? '' : String(value);
}

function readRows(t) {
  var last = t.sheet.getLastRow();
  if (last < 2) return [];
  var values = t.sheet.getRange(2, 1, last - 1, t.header.length).getValues();
  var rows = [];
  values.forEach(function (line, i) {
    var obj = {};
    t.header.forEach(function (column, c) {
      if (column) obj[column] = line[c];
    });
    if (obj.id === '' || obj.id === null || obj.id === undefined) return;
    rows.push({ rowNumber: i + 2, record: obj });
  });
  return rows;
}

function typed(table, raw) {
  var out = {};
  columnsOf(table).forEach(function (column) {
    out[column] = fromCell(column, raw[column] === undefined ? '' : raw[column]);
  });
  return out;
}

function checkColumns(table, values) {
  var allowed = TABLES[table];
  Object.keys(values).forEach(function (key) {
    if (allowed.indexOf(key) < 0) throw apiError('INVALID', '알 수 없는 항목입니다: ' + key);
  });
}

// ---- records ----

function dbList(table, options) {
  options = options || {};
  var where = options.where || {};
  return readRows(openTable(table))
    .map(function (r) {
      return typed(table, r.record);
    })
    .filter(function (row) {
      if (!options.includeDeleted && row.deleted) return false;
      return Object.keys(where).every(function (key) {
        return row[key] === where[key];
      });
    });
}

function findRow(t, id) {
  var rows = readRows(t);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].record.id) === String(id)) return rows[i];
  }
  return null;
}

function dbGet(table, id) {
  var found = findRow(openTable(table), id);
  return found ? typed(table, found.record) : null;
}

// Appends objects as rows in one sheet write (Apps Script is slow per call).
function appendObjects(t, objects) {
  if (!objects.length) return;
  var start = Math.max(t.sheet.getLastRow(), 1) + 1;
  // setValues does not grow the sheet (a new sheet has 1000 rows), so add rows first.
  var extraRows = start + objects.length - 1 - t.sheet.getMaxRows();
  if (extraRows > 0) t.sheet.insertRowsAfter(t.sheet.getMaxRows(), extraRows);
  t.sheet.getRange(start, 1, objects.length, t.header.length).setValues(
    objects.map(function (obj) {
      return t.header.map(function (column) {
        return column ? toCell(obj[column] === undefined ? '' : obj[column]) : '';
      });
    }),
  );
}

// options.skipAudit: the caller writes its own history entry (Settings does,
// so its history is keyed by setting name).
function dbCreate(table, values, user, options) {
  return dbCreateMany(table, [values], user, options)[0];
}

function dbCreateMany(table, valuesList, user, options) {
  valuesList.forEach(function (values) {
    checkColumns(table, values);
  });
  var t = openTable(table);
  var now = nowIso();
  var rows = valuesList.map(function (values) {
    var row = {};
    columnsOf(table).forEach(function (column) {
      row[column] = values[column] === undefined ? '' : values[column];
    });
    row.id = Utilities.getUuid();
    row.createdBy = user.id;
    row.createdByName = user.name;
    row.createdAt = now;
    row.updatedBy = user.id;
    row.updatedByName = user.name;
    row.updatedAt = now;
    row.deleted = false;
    row.deletedBy = '';
    row.deletedByName = '';
    row.deletedAt = '';
    return row;
  });
  appendObjects(t, rows);
  var created = rows.map(function (row) {
    return typed(table, row);
  });
  if (!(options && options.skipAudit)) {
    dbAuditMany(
      user,
      table,
      created.map(function (row) {
        return { recordId: row.id, action: 'create', before: null, after: row };
      }),
    );
  }
  return created;
}

// Writes the given columns of one row and returns the typed row before and after.
function writeFields(table, id, fields) {
  var t = openTable(table);
  var found = findRow(t, id);
  if (!found) throw apiError('NOT_FOUND', '해당 기록을 찾을 수 없습니다.');
  var before = typed(table, found.record);
  Object.keys(fields).forEach(function (column) {
    t.sheet.getRange(found.rowNumber, t.header.indexOf(column) + 1).setValue(toCell(fields[column]));
    found.record[column] = fields[column];
  });
  return { before: before, after: typed(table, found.record) };
}

function recordLabel(row) {
  return row ? row.name || row.loginId || row.reagentName || '' : '';
}

function dbUpdate(table, id, changes, user, options) {
  checkColumns(table, changes);
  var fields = Object.assign({}, changes, { updatedBy: user.id, updatedByName: user.name, updatedAt: nowIso() });
  var result = writeFields(table, id, fields);
  var before = {};
  var after = {};
  Object.keys(changes).forEach(function (key) {
    if (result.before[key] !== result.after[key]) {
      before[key] = result.before[key];
      after[key] = result.after[key];
    }
  });
  if (!(options && options.skipAudit)) dbAudit(user, table, id, 'update', before, after, recordLabel(result.after));
  return result.after;
}

function dbSoftDelete(table, id, user) {
  var now = nowIso();
  var result = writeFields(table, id, {
    deleted: true,
    deletedBy: user.id,
    deletedByName: user.name,
    deletedAt: now,
    updatedBy: user.id,
    updatedByName: user.name,
    updatedAt: now,
  });
  dbAudit(user, table, id, 'delete', result.before, null);
  return result.after;
}

function dbRestore(table, id, user) {
  var result = writeFields(table, id, {
    deleted: false,
    deletedBy: '',
    deletedByName: '',
    deletedAt: '',
    updatedBy: user.id,
    updatedByName: user.name,
    updatedAt: nowIso(),
  });
  dbAudit(user, table, id, 'restore', null, result.after);
  return result.after;
}

// ---- history ----

function withoutSecrets(values) {
  if (!values) return values;
  var copy = {};
  Object.keys(values).forEach(function (key) {
    if (SECRET_COLUMNS.indexOf(key) < 0) copy[key] = values[key];
  });
  return copy;
}

function showValue(value) {
  if (value === true) return '예';
  if (value === false) return '아니요';
  if (value === null || value === undefined || value === '') return '(없음)';
  return String(value);
}

function fieldLabel(table, key) {
  if (table === 'Settings') return SETTING_LABELS[key] || key;
  return columnLabel(table, key) || key;
}

// The 바뀐 내용 sentence: "이름: A → B" for updates, the filled-in fields for adds.
function historySummary(table, action, before, after) {
  if (action === 'update' && after) {
    return Object.keys(after)
      .map(function (key) {
        return fieldLabel(table, key) + ': ' + showValue(before ? before[key] : null) + ' → ' + showValue(after[key]);
      })
      .join(', ');
  }
  if (action === 'create' && after) {
    var own = TABLE_LAYOUT[table] ? TABLE_LAYOUT[table][0] : Object.keys(after);
    return own
      .filter(function (key) {
        return after[key] !== undefined && after[key] !== null && after[key] !== '';
      })
      .map(function (key) {
        return fieldLabel(table, key) + ': ' + showValue(after[key]);
      })
      .join(', ');
  }
  if (after && after.note) return String(after.note);
  return '';
}

// Name of what the entry is about, for the 대상 column.
function historyTarget(table, recordId, before, after, label) {
  if (label) return label;
  if (table === 'Settings') return SETTING_LABELS[recordId] || recordId;
  if (table === 'System') return '시트';
  var named = recordLabel(after) || recordLabel(before);
  if (named) return named;
  try {
    return recordLabel(TABLES[table] ? dbGet(table, recordId) : null);
  } catch (err) {
    return '';
  }
}

// One history line; before/after are objects (or null), at is ISO text.
function historyRow(entry) {
  var before = withoutSecrets(entry.before);
  var after = withoutSecrets(entry.after);
  return {
    when: kstText(entry.at),
    userName: entry.userName,
    tableLabel: TABLE_LABELS[entry.table] || entry.table,
    target: historyTarget(entry.table, entry.recordId, before, after, entry.label),
    actionLabel: ACTION_LABELS[entry.action] || entry.action,
    summary: historySummary(entry.table, entry.action, before, after),
    id: entry.id,
    at: entry.at,
    userId: entry.userId,
    table: entry.table,
    recordId: entry.recordId,
    action: entry.action,
    before: before ? JSON.stringify(before) : '',
    after: after ? JSON.stringify(after) : '',
  };
}

function appendHistory(entries) {
  var byGroup = {};
  entries.forEach(function (entry) {
    var group = historyGroupFor(entry.table, entry.action);
    (byGroup[group] = byGroup[group] || []).push(historyRow(entry));
  });
  Object.keys(byGroup).forEach(function (group) {
    appendObjects(openHistory(group), byGroup[group]);
  });
}

// label (optional) names the record when before/after do not carry its name.
function dbAudit(user, table, recordId, action, before, after, label) {
  dbAuditMany(user, table, [{ recordId: recordId, action: action, before: before, after: after, label: label }]);
}

function dbAuditMany(user, table, items) {
  var at = nowIso();
  appendHistory(
    items.map(function (item) {
      return {
        id: Utilities.getUuid(),
        at: at,
        userId: user ? user.id : '',
        userName: user ? user.name : '',
        table: table,
        recordId: item.recordId,
        action: item.action,
        before: item.before,
        after: item.after,
        label: item.label,
      };
    }),
  );
}

// History lines of the given groups as plain objects, oldest first.
function historyEntries(groups) {
  var ss = SpreadsheetApp.getActive();
  var out = [];
  groups.forEach(function (group) {
    if (!ss.getSheetByName(HISTORY_TABS[group])) return;
    readRows(openHistory(group)).forEach(function (r) {
      var e = {};
      HISTORY_COLUMNS.forEach(function (c) {
        e[c] = r.record[c] === undefined || r.record[c] === null ? '' : String(r.record[c]);
      });
      out.push(e);
    });
  });
  return out
    .map(function (e, i) {
      return { e: e, i: i };
    })
    .sort(function (a, b) {
      return Date.parse(a.e.at) - Date.parse(b.e.at) || a.i - b.i;
    })
    .map(function (x) {
      return x.e;
    });
}

// ---- moving an old (English) sheet to this layout ----

var LAYOUT_PROP = 'SHEET_LAYOUT';
var LAYOUT_VERSION = '2';

// Runs once per execution. A sheet made before the Korean layout gets its
// tabs renamed, headers translated, name columns filled and AuditLog moved
// into the 이력 tabs.
function ensureLayout() {
  if (layoutChecked) return;
  layoutChecked = true;
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(LAYOUT_PROP) === LAYOUT_VERSION) return;
  var ss = SpreadsheetApp.getActive();
  var legacy =
    !!ss.getSheetByName('AuditLog') ||
    Object.keys(SHEET_NAMES).some(function (k) {
      return !!ss.getSheetByName(k);
    });
  if (legacy) {
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      migrateLegacyLayout(ss);
    } finally {
      lock.releaseLock();
    }
  }
  props.setProperty(LAYOUT_PROP, LAYOUT_VERSION);
}

// Old history values are JSON; a line someone edited by hand must not stop the move.
function parseOldJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    return null;
  }
}

function migrateLegacyLayout(ss) {
  Object.keys(SHEET_NAMES).forEach(function (table) {
    var old = ss.getSheetByName(table);
    if (!old || ss.getSheetByName(SHEET_NAMES[table])) return;
    if (old.getLastColumn() > 0) {
      var labels = old
        .getRange(1, 1, 1, old.getLastColumn())
        .getValues()[0]
        .map(function (h) {
          var key = keyForLabel(table, String(h));
          return toCell(key ? COLUMN_LABELS[key] : String(h));
        });
      old.getRange(1, 1, 1, labels.length).setValues([labels]).setFontWeight('bold');
    }
    old.setName(SHEET_NAMES[table]);
    old.setTabColor(TAB_COLORS.data);
    old.setFrozenRows(1);
  });

  // Fill the new name columns from the account list.
  var names = {};
  names[SYSTEM_USER.id] = SYSTEM_USER.name;
  names[SHEET_OWNER.id] = SHEET_OWNER.name;
  if (ss.getSheetByName(SHEET_NAMES.Users)) {
    readRows(openTable('Users')).forEach(function (r) {
      names[String(r.record.id)] = String(r.record.name);
    });
  }
  Object.keys(SHEET_NAMES).forEach(function (table) {
    if (!ss.getSheetByName(SHEET_NAMES[table])) return;
    var t = openTable(table);
    var rows = readRows(t);
    ['createdBy', 'updatedBy', 'deletedBy'].forEach(function (idColumn) {
      var nameColumn = idColumn + 'Name';
      var col = t.header.indexOf(nameColumn) + 1;
      rows.forEach(function (r) {
        var id = String(r.record[idColumn] || '');
        if (id && !r.record[nameColumn]) t.sheet.getRange(r.rowNumber, col).setValue(toCell(names[id] || id));
      });
    });
  });

  // AuditLog → the 이력 tabs.
  var log = ss.getSheetByName('AuditLog');
  if (log) {
    if (log.getLastRow() > 1) {
      var head = log.getRange(1, 1, 1, log.getLastColumn()).getValues()[0].map(String);
      var lines = log.getRange(2, 1, log.getLastRow() - 1, head.length).getValues();
      appendHistory(
        lines
          .map(function (line) {
            var e = {};
            head.forEach(function (h, i) {
              e[h] = line[i] === null || line[i] === undefined ? '' : String(line[i]);
            });
            return e;
          })
          .filter(function (e) {
            return e.id;
          })
          .map(function (e) {
            return {
              id: e.id,
              at: e.at,
              userId: e.userId,
              userName: e.userName,
              table: e.table,
              recordId: e.recordId,
              action: e.action,
              before: parseOldJson(e.before),
              after: parseOldJson(e.after),
            };
          }),
      );
    }
    ss.deleteSheet(log);
  }
}

// ===== Menu.js =====

// The "LabKeeper" menu in the spreadsheet. Only people who can open the
// sheet can use it, so the first admin account is created here (never from
// the web). The sheet* functions hold the logic and are tested; the menu*
// functions only show dialogs.

function withScriptLock(fn) {
  ensureLayout(); // may take the lock itself, so before ours
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// Who ran a sheet-menu item: the menu has no LabKeeper login, so the history
// names the Google account when Apps Script reveals it.
function sheetActor() {
  var email = '';
  try {
    email = String(Session.getActiveUser().getEmail() || '');
  } catch (err) {
    email = '';
  }
  return { id: SHEET_OWNER.id, name: SHEET_OWNER.name + (email ? ' (' + email + ')' : '') };
}

// School name and operating teacher, shown at the bottom of the web menu.
function sheetSetSchoolInfo(form) {
  return withScriptLock(function () {
    if (isTemplateSheet()) throw apiError('INVALID', TEMPLATE_MESSAGE);
    writeSettings({ schoolName: String(form.schoolName || ''), managerName: String(form.managerName || '') }, sheetActor());
    var s = settingsGet();
    return { schoolName: s.schoolName, managerName: s.managerName };
  });
}

// 운영 종료: the web app stops working for this sheet (data stays), e.g.
// after the school moved to a copy. Reversible with sheetReopenSheet.
function sheetCloseSheet(note) {
  return withScriptLock(function () {
    if (sheetClosedInfo()) throw apiError('INVALID', '이미 운영이 종료된 시트입니다.');
    var text = String(note || '').trim();
    if (text.length > 200) throw apiError('INVALID', '안내 문구는 200자 이내로 적어 주세요.');
    PropertiesService.getScriptProperties().setProperty(CLOSED_PROP, JSON.stringify({ at: nowIso(), note: text }));
    dbAudit(sheetActor(), 'System', String(SpreadsheetApp.getActive().getId()), 'close', null, { note: text });
    return true;
  });
}

function sheetReopenSheet() {
  return withScriptLock(function () {
    if (!sheetClosedInfo()) throw apiError('INVALID', '운영 중인 시트입니다. 풀 것이 없습니다.');
    PropertiesService.getScriptProperties().deleteProperty(CLOSED_PROP);
    dbAudit(sheetActor(), 'System', String(SpreadsheetApp.getActive().getId()), 'reopen', null, null);
    return true;
  });
}

// What a copy holds, shown before "이 사본을 계속 쓰기" so the person can check it.
function sheetCopySummary() {
  return { schoolName: settingsGet().schoolName, users: dbList('Users').length };
}

// 이 사본을 계속 쓰기: a detected copy becomes the school's sheet with all its
// data (used when the original cannot change owner, e.g. a school account).
function sheetContinueCopy() {
  return withScriptLock(function () {
    if (sheetOwnerState() !== 'copied') {
      throw apiError('INVALID', '이 시트는 사본이 아닙니다. 운영 중인 시트의 사본에서만 쓸 수 있습니다.');
    }
    var props = PropertiesService.getScriptProperties();
    var previous = props.getProperty(OWNER_PROP);
    var id = String(SpreadsheetApp.getActive().getId());
    props.setProperty(OWNER_PROP, id);
    props.deleteProperty(CLOSED_PROP); // the original may have been closed before it was copied
    dbAudit(sheetActor(), 'System', id, 'continueCopy', { ownerSpreadsheetId: previous }, { ownerSpreadsheetId: id });
    return true;
  });
}

function sheetCreateAdmin(form) {
  return withScriptLock(function () {
    if (isTemplateSheet()) throw apiError('INVALID', TEMPLATE_MESSAGE);
    sheetOwnerState(); // the sheet that gets the first account is the owner
    if (hasAnyUser()) throw apiError('SETUP_DONE', '이미 운영 교사 계정이 있습니다.');
    var loginId = normalizeLoginId(form.loginId);
    var name = String(form.name || '').trim();
    checkLoginId(loginId);
    if (!name) throw apiError('INVALID', '이름을 입력해 주세요.');
    checkPasswordRule(form.password);
    var salt = newSalt();
    dbCreate(
      'Users',
      { loginId: loginId, name: name, role: 'admin', salt: salt, hash: hashPassword(form.password, salt), mustChangePassword: false, active: true },
      SYSTEM_USER,
    );
    return { loginId: loginId, name: name };
  });
}

// For an admin who forgot their password (nobody else can reset an admin
// when there is only one). Same effect as users.resetPassword.
function sheetResetAdminPassword(loginId) {
  return withScriptLock(function () {
    var id = normalizeLoginId(loginId);
    var row = activeUsers().filter(function (u) {
      return u.loginId === id && u.role === 'admin';
    })[0];
    if (!row) throw apiError('NOT_FOUND', '운영 교사 계정을 찾을 수 없습니다: ' + id);
    var password = tempPassword();
    var salt = newSalt();
    var actor = sheetActor();
    dbUpdate('Users', row.id, { salt: salt, hash: hashPassword(password, salt), mustChangePassword: true }, actor, { skipAudit: true });
    dbAudit(actor, 'Users', row.id, 'passwordReset', null, null, row.name);
    CacheService.getScriptCache().remove('fail:' + row.loginId);
    return { tempPassword: password };
  });
}

// Every tab LabKeeper manages: the data tabs, then the 이력 tabs.
function managedTabNames() {
  return Object.keys(SHEET_NAMES)
    .map(function (k) {
      return SHEET_NAMES[k];
    })
    .concat(
      Object.keys(HISTORY_TABS).map(function (k) {
        return HISTORY_TABS[k];
      }),
    );
}

// Deletes every data row of every table and the history; headers stay.
function clearAllRows() {
  var ss = SpreadsheetApp.getActive();
  managedTabNames().forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet || sheet.getLastRow() < 2) return;
    // Sheets refuses to delete every row below a frozen header, so keep one spare row.
    if (sheet.getMaxRows() <= sheet.getLastRow()) sheet.insertRowsAfter(sheet.getLastRow(), 1);
    sheet.deleteRows(2, sheet.getLastRow() - 1);
  });
}

var TEMPLATE_CONFIRM_WORD = '원본으로 초기화';

// Turns a sheet (e.g. one used for trying LabKeeper out) into the empty
// distribution template other schools copy. Everything is erased, including
// the history (it would otherwise be copied into every school), and the sheet
// refuses to be used as a school sheet from then on.
function sheetMakeTemplate(confirmWord) {
  if (String(confirmWord || '').trim() !== TEMPLATE_CONFIRM_WORD) {
    throw apiError('INVALID', "확인 문구가 맞지 않습니다. '" + TEMPLATE_CONFIRM_WORD + "'를 그대로 입력해 주세요.");
  }
  return withScriptLock(function () {
    clearAllRows();
    var props = PropertiesService.getScriptProperties();
    props.deleteProperty(OWNER_PROP);
    props.deleteProperty(CLOSED_PROP);
    props.setProperty(TEMPLATE_PROP, String(SpreadsheetApp.getActive().getId()));
    return true;
  });
}

// Empties every table (headers stay) and makes this spreadsheet the owner.
// Only for a detected copy of a sheet in use, so the live sheet cannot be wiped.
function sheetStartFresh() {
  return withScriptLock(function () {
    if (sheetOwnerState() !== 'copied') {
      throw apiError('INVALID', '운영 중인 시트의 사본에서만 쓸 수 있습니다. 이 시트는 사본이 아니라서 기록을 지우지 않았습니다.');
    }
    clearAllRows();
    var id = String(SpreadsheetApp.getActive().getId());
    var props = PropertiesService.getScriptProperties();
    props.setProperty(OWNER_PROP, id);
    props.deleteProperty(CLOSED_PROP);
    dbAudit(sheetActor(), 'System', id, 'startFresh', null, null);
    return true;
  });
}

// Lists problems without fixing anything (openTable would add headers).
// A missing 이력 tab is normal: it appears with the first change in that area.
function checkSheetStructure() {
  var ss = SpreadsheetApp.getActive();
  var problems = [];
  Object.keys(SHEET_NAMES).forEach(function (table) {
    var name = SHEET_NAMES[table];
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      problems.push(name + ' 시트가 없습니다');
      return;
    }
    var header = sheet.getLastColumn() ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String) : [];
    var keys = header.map(function (h) {
      return keyForLabel(table, h);
    });
    columnsOf(table).forEach(function (column) {
      if (keys.indexOf(column) < 0) problems.push(name + ' 시트에 ' + columnLabel(table, column) + ' 열이 없습니다');
    });
  });
  Object.keys(HISTORY_TABS).forEach(function (group) {
    var sheet = ss.getSheetByName(HISTORY_TABS[group]);
    if (!sheet) return;
    var keys = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (h) {
      return historyKeyForLabel(String(h));
    });
    HISTORY_COLUMNS.forEach(function (column) {
      if (keys.indexOf(column) < 0) problems.push(HISTORY_TABS[group] + ' 시트에 ' + HISTORY_LABELS[column] + ' 열이 없습니다');
    });
  });
  return problems;
}

// ---- Menu and dialogs (not unit tested: they only call the functions above) ----

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('LabKeeper')
    .addItem('학교 정보 입력', 'menuSchoolInfo')
    .addItem('운영 교사 계정 만들기', 'menuCreateAdmin')
    .addItem('운영 교사 비밀번호 초기화', 'menuResetAdminPassword')
    .addSeparator()
    .addItem('시트 구조 점검', 'menuCheckStructure')
    .addItem('사본을 새 학교 시트로 시작', 'menuStartFresh')
    .addItem('이 사본을 계속 쓰기', 'menuContinueCopy')
    .addSeparator()
    .addItem('운영 종료 (이 시트 잠그기)', 'menuCloseSheet')
    .addItem('운영 종료 풀기', 'menuReopenSheet')
    .addSeparator()
    .addItem('배포용 원본으로 초기화', 'menuMakeTemplate')
    .addSeparator()
    .addItem('사용 가이드', 'menuGuide')
    .addToUi();
}

var CREATE_ADMIN_HTML =
  '<style>body{font:14px sans-serif;margin:0}label{display:block;margin-top:10px;font-weight:600}' +
  'input{width:100%;box-sizing:border-box;padding:6px;margin-top:4px}button{margin-top:14px;padding:8px 14px}' +
  '#msg{margin-top:10px;color:#b91c1c}small{color:#64748b}</style>' +
  '<form id="f">' +
  '<label>아이디<input name="loginId" required autocomplete="off"></label><small>영문 소문자, 숫자, . _ - 로 3~30자</small>' +
  '<label>이름<input name="name" required></label>' +
  '<label>비밀번호<input name="password" type="password" required></label><small>8자 이상</small>' +
  '<label>비밀번호 확인<input name="confirm" type="password" required></label>' +
  '<button type="submit">계정 만들기</button><div id="msg"></div></form>' +
  '<script>' +
  'var f=document.getElementById("f"),m=document.getElementById("msg");' +
  'f.onsubmit=function(e){e.preventDefault();' +
  'if(f.password.value!==f.confirm.value){m.textContent="비밀번호가 서로 다릅니다.";return;}' +
  'm.textContent="만드는 중…";' +
  'google.script.run.withSuccessHandler(function(r){m.style.color="#15803d";' +
  'm.textContent=r.name+" 선생님 계정("+r.loginId+")을 만들었습니다. 이제 웹 화면에서 로그인하세요.";f.querySelector("button").disabled=true;})' +
  '.withFailureHandler(function(err){m.style.color="#b91c1c";m.textContent=err.message;})' +
  '.sheetCreateAdmin({loginId:f.loginId.value,name:f.name.value,password:f.password.value});};' +
  '</script>';

// Values go into the page as JSON; '<' is escaped so a value cannot end the script tag.
function schoolInfoHtml(current) {
  var init = JSON.stringify(current).replace(/</g, '\\u003c');
  return (
    '<style>body{font:14px sans-serif;margin:0}label{display:block;margin-top:10px;font-weight:600}' +
    'input{width:100%;box-sizing:border-box;padding:6px;margin-top:4px}button{margin-top:14px;padding:8px 14px}' +
    '#msg{margin-top:10px}small{color:#64748b}</style>' +
    '<form id="f">' +
    '<label>학교 이름<input name="schoolName" maxlength="100"></label>' +
    '<label>관리 교사<input name="managerName" maxlength="100"></label><small>웹 화면 왼쪽 메뉴 아래에 보입니다.</small>' +
    '<button type="submit">저장</button><div id="msg"></div></form>' +
    '<script>var init=' + init + ',f=document.getElementById("f"),m=document.getElementById("msg");' +
    'f.schoolName.value=init.schoolName;f.managerName.value=init.managerName;' +
    'f.onsubmit=function(e){e.preventDefault();m.style.color="#334155";m.textContent="저장하는 중…";' +
    'google.script.run.withSuccessHandler(function(){m.style.color="#15803d";m.textContent="저장했습니다. 변경 기록은 환경설정 이력 탭에 남습니다.";})' +
    '.withFailureHandler(function(err){m.style.color="#b91c1c";m.textContent=err.message;})' +
    '.sheetSetSchoolInfo({schoolName:f.schoolName.value,managerName:f.managerName.value});};</script>'
  );
}

function menuSchoolInfo() {
  var s = settingsGet();
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(schoolInfoHtml({ schoolName: s.schoolName, managerName: s.managerName })).setWidth(360).setHeight(300),
    '학교 정보 입력',
  );
}

function menuCloseSheet() {
  var ui = SpreadsheetApp.getUi();
  if (sheetClosedInfo()) {
    ui.alert('이미 운영이 종료된 시트입니다. 다시 쓰려면 "운영 종료 풀기"를 누르세요.');
    return;
  }
  var res = ui.prompt(
    '운영 종료 (이 시트 잠그기)',
    '이 시트로 연결된 웹 화면을 더 이상 쓸 수 없게 합니다. 기록은 지우지 않으며, "운영 종료 풀기"로 되돌릴 수 있습니다.\n' +
      '선생님들이 웹 화면에서 볼 안내 문구를 적어 주세요(예: 새 접속 링크는 운영 교사에게 받으세요).',
    ui.ButtonSet.OK_CANCEL,
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;
  try {
    sheetCloseSheet(res.getResponseText());
    ui.alert('운영을 종료했습니다. 이 시트에 연결된 웹 화면은 안내 문구만 보여 줍니다.');
  } catch (err) {
    ui.alert(err.message);
  }
}

function menuReopenSheet() {
  var ui = SpreadsheetApp.getUi();
  if (!sheetClosedInfo()) {
    ui.alert('운영 중인 시트입니다. 풀 것이 없습니다.');
    return;
  }
  if (ui.alert('운영 종료 풀기', '이 시트로 웹 화면을 다시 쓸 수 있게 합니다. 계속할까요?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  sheetReopenSheet();
  ui.alert('다시 운영 중입니다.');
}

function menuContinueCopy() {
  var ui = SpreadsheetApp.getUi();
  if (sheetOwnerState() !== 'copied') {
    ui.alert('이 시트는 운영 중인 시트의 사본이 아니라서 할 일이 없습니다.');
    return;
  }
  var summary = sheetCopySummary();
  var answer = ui.alert(
    '이 사본을 계속 쓰기',
    '이 사본에 든 기록을 그대로 이어서 쓰고, 이 사본을 학교의 시트로 삼습니다.\n\n' +
      '학교 이름: ' + (summary.schoolName || '(미입력)') + '\n계정 수: ' + summary.users + '\n\n' +
      '꼭 함께 할 일:\n' +
      '1. 원래 시트에서 LabKeeper → 운영 종료를 실행해 원래 시트를 잠급니다(기록이 둘로 갈라지지 않게).\n' +
      '2. 이 사본에서 웹 앱을 새로 배포하고, 새 접속 링크를 모든 선생님께 다시 보냅니다.\n' +
      '3. 선생님들은 다시 로그인해야 합니다(아이디·비밀번호는 그대로).\n\n계속할까요?',
    ui.ButtonSet.YES_NO,
  );
  if (answer !== ui.Button.YES) return;
  try {
    sheetContinueCopy();
    ui.alert('이 사본을 학교 시트로 삼았습니다. 웹 앱을 새로 배포하고 새 접속 링크를 보내 주세요.');
  } catch (err) {
    ui.alert(err.message);
  }
}

function menuMakeTemplate() {
  var ui = SpreadsheetApp.getUi();
  if (isTemplateSheet()) {
    ui.alert('이미 배포용 원본입니다. 공유 → 링크가 있는 모든 사용자(뷰어)로 두고 /copy 링크를 나눠 주세요.');
    return;
  }
  var res = ui.prompt(
    '배포용 원본으로 초기화',
    '이 시트를 다른 학교에 나눠 줄 빈 원본으로 만듭니다.\n' +
      '- 계정, 학교 정보, 교실·보관장, 변경 이력 등 모든 기록을 지웁니다. 되돌릴 수 없습니다.\n' +
      '- 이후 이 시트로는 웹 화면을 쓸 수 없습니다(사본에서만 씁니다).\n\n' +
      "계속하려면 '" + TEMPLATE_CONFIRM_WORD + "'를 입력하세요.",
    ui.ButtonSet.OK_CANCEL,
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;
  try {
    sheetMakeTemplate(res.getResponseText());
    ui.alert(
      '배포용 원본으로 만들었습니다.\n\n' +
        '1. Apps Script → 배포 → 배포 관리에서 이 시트의 웹 앱 배포를 보관(삭제)하세요.\n' +
        '2. 공유 → 일반 액세스를 "링크가 있는 모든 사용자(뷰어)"로 바꾸세요.\n' +
        '3. 주소의 /edit… 부분을 /copy로 바꾼 링크를 학교들에 나눠 주세요.\n' +
        '우리 학교도 이 원본을 사본 만들기로 복사해서 씁니다.',
    );
  } catch (err) {
    ui.alert(err.message);
  }
}

function menuCreateAdmin() {
  var ui = SpreadsheetApp.getUi();
  if (hasAnyUser()) {
    ui.alert('이미 운영 교사 계정이 있습니다. 비밀번호를 잊었다면 "운영 교사 비밀번호 초기화"를 쓰세요.');
    return;
  }
  ui.showModalDialog(HtmlService.createHtmlOutput(CREATE_ADMIN_HTML).setWidth(360).setHeight(420), '운영 교사 계정 만들기');
}

function menuResetAdminPassword() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('운영 교사 비밀번호 초기화', '운영 교사의 아이디를 입력하세요.', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  try {
    var out = sheetResetAdminPassword(res.getResponseText());
    ui.alert('임시 비밀번호: ' + out.tempPassword + '\n\n이 비밀번호로 로그인하면 새 비밀번호를 정하게 됩니다. 이전 로그인은 모두 끊겼습니다.');
  } catch (err) {
    ui.alert(err.message);
  }
}

function menuCheckStructure() {
  var problems = checkSheetStructure();
  SpreadsheetApp.getUi().alert(
    problems.length
      ? '확인할 것:\n- ' + problems.join('\n- ') + '\n\n(아직 쓰지 않은 표는 처음 쓸 때 만들어집니다. 1행 머리글 이름은 바꾸지 마세요.)'
      : '시트 구조에 문제가 없습니다.',
  );
}

function menuStartFresh() {
  var ui = SpreadsheetApp.getUi();
  var answer = ui.alert(
    '사본을 새 학교 시트로 시작',
    '이 시트의 계정·기록·설정·변경 이력을 모두 지웁니다. 되돌릴 수 없습니다.\n운영 중인 시트를 복사한 사본에서만 쓰세요. 계속할까요?',
    ui.ButtonSet.YES_NO,
  );
  if (answer !== ui.Button.YES) return;
  try {
    sheetStartFresh();
    ui.alert('모든 기록을 지웠습니다. "운영 교사 계정 만들기"로 첫 계정을 만드세요.');
  } catch (err) {
    ui.alert(err.message);
  }
}

function menuGuide() {
  SpreadsheetApp.getUi().alert(
    'LabKeeper 사용 가이드',
    '1. 확장 프로그램 → Apps Script → 배포 → 새 배포 → 웹 앱 (실행: 나, 액세스: 모든 사용자)으로 배포하고 URL을 복사합니다.\n' +
      '2. LabKeeper → 운영 교사 계정 만들기에서 첫 계정을 만듭니다.\n' +
      '3. LabKeeper 웹 화면에서 "스프레드시트 연결"에 URL을 붙여 넣고 로그인합니다.\n' +
      '4. 계정 관리에서 선생님 계정을 만들고, "우리 학교 접속 링크"와 임시 비밀번호를 전합니다.\n\n' +
      '코드를 업데이트할 때: 새 코드를 붙여 넣고 배포 → 배포 관리 → 수정 → 새 버전으로 배포합니다(주소가 바뀌지 않습니다).\n' +
      '1행 머리글 이름은 바꾸지 마세요.',
    SpreadsheetApp.getUi().ButtonSet.OK,
  );
}

// ===== Reagents.js =====

// Reagents and their in/out records (design M2 5·7). Only these actions write
// the two tables, so stock always equals the sum of the live records.

var HAZARD_STATUSES = ['해당', '해당 없음', '판정 불가'];
var REAGENT_GRADES = ['', '시약용', '공업용'];
var REAGENT_UNITS = ['mL', 'g'];
var TX_KIND_LABELS = { initial: '기초 재고', in: '입고', out: '출고' };

function reagentsActions() {
  return {
    'reagents.list': { auth: 'user', write: false, handler: reagentsList },
    'reagents.create': { auth: 'user', write: true, handler: reagentsCreate },
    'reagents.createMany': { auth: 'user', write: true, handler: reagentsCreateMany },
    'reagents.update': { auth: 'user', write: true, handler: reagentsUpdate },
    'reagents.delete': { auth: 'user', write: true, handler: reagentsDelete },
    'reagents.restore': { auth: 'user', write: true, handler: reagentsRestore },
  };
}

function round3(x) {
  return Math.round(x * 1000) / 1000;
}

function todayKst() {
  return kstParts(new Date()).date;
}

function isDateText(text) {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  var d = new Date(text + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text;
}

function checkDate(values, key, label, required) {
  var v = values[key];
  if (v === undefined || v === null || v === '') {
    if (required) throw invalid(label + '을(를) 입력해 주세요.');
    if (v === null) values[key] = '';
    return;
  }
  if (!isDateText(v)) throw invalid(label + '은(는) 2026-03-16 같은 날짜로 입력해 주세요.');
}

// Same rule as isValidCas in web/src/domain/hazard.ts.
function isValidCas(cas) {
  var m = /^(\d{2,7})-(\d{2})-(\d)$/.exec(cas);
  if (!m) return false;
  var digits = (m[1] + m[2]).split('').reverse();
  var sum = 0;
  for (var i = 0; i < digits.length; i++) sum += Number(digits[i]) * (i + 1);
  return sum % 10 === Number(m[3]);
}

function checkChoice(values, key, label, choices) {
  if (values[key] !== undefined && choices.indexOf(values[key]) < 0) throw invalid(label + ' 값이 올바르지 않습니다.');
}

function textOrEmpty(values, key) {
  if (values[key] === null) values[key] = '';
}

function validateReagent(values, isCreate, lookup) {
  Object.keys(values).forEach(function (key) {
    if (REAGENT_COLUMNS_INPUT.indexOf(key) < 0) throw invalid('알 수 없는 항목입니다: ' + key);
  });
  ['name', 'formula', 'casNo', 'mainUse', 'maker', 'supplier', 'zoneId', 'note'].forEach(function (key) {
    textOrEmpty(values, key);
  });
  checkText(values, 'name', '약품명', isCreate || values.name !== undefined, 100);
  if (values.concentration === '' || values.concentration === null) values.concentration = null;
  else if (values.concentration !== undefined) {
    var c = values.concentration;
    if (typeof c !== 'number' || !(c > 0 && c <= 100)) throw invalid('농도는 0보다 크고 100 이하인 %로 입력해 주세요.');
  }
  checkText(values, 'formula', '화학식', false, 50);
  checkText(values, 'casNo', 'CAS No.', false, 20);
  if (values.casNo && !isValidCas(values.casNo)) throw invalid('CAS No.가 올바르지 않습니다: ' + values.casNo);
  checkChoice(values, 'grade', '규격', REAGENT_GRADES);
  if (isCreate || values.unit !== undefined) checkChoice({ unit: values.unit === undefined ? null : values.unit }, 'unit', '단위', REAGENT_UNITS);
  checkText(values, 'mainUse', '주용도', false, 50);
  checkDate(values, 'expiryDate', '유효기간', false);
  checkDate(values, 'purchaseDate', '구입일', false);
  checkDate(values, 'openedDate', '개봉일', false);
  checkText(values, 'maker', '제조사', false, 100);
  checkText(values, 'supplier', '구입처', false, 100);
  checkText(values, 'note', '비고', false, 500);
  if (values.zoneId && !existsIn(lookup, 'Zones', values.zoneId)) throw apiError('NOT_FOUND', '보관 구역을 찾을 수 없습니다.');
  checkChoice(values, 'toxic', '유독물질 판정', HAZARD_STATUSES);
  checkChoice(values, 'accidentPrep', '사고대비물질 판정', HAZARD_STATUSES);
  ['hazardManual', 'poison', 'banned', 'permitted', 'restricted'].forEach(function (key) {
    checkBoolean(values, key, COLUMN_LABELS[key]);
  });
  if (isCreate) {
    if (values.mainUse === undefined) values.mainUse = '실험용';
    if (values.toxic === undefined) values.toxic = '판정 불가';
    if (values.accidentPrep === undefined) values.accidentPrep = '판정 불가';
  }
  return values;
}

// Same name (spaces and case ignored) and same concentration = the same reagent.
function reagentKey(name, concentration) {
  var c = concentration === null || concentration === undefined || concentration === '' ? '' : String(concentration);
  return String(name).trim().toLowerCase() + '|' + c;
}

function liveReagentKeys(exceptId) {
  var keys = {};
  dbList('Reagents').forEach(function (r) {
    if (r.id !== exceptId) keys[reagentKey(r.name, r.concentration)] = r;
  });
  return keys;
}

function duplicateError(name) {
  return invalid('이미 등록된 시약입니다: ' + name + ' (같은 약품명·농도는 한 건으로 관리합니다)');
}

function checkInitial(amount, date) {
  if (typeof amount !== 'number' || !(amount >= 0) || !isFinite(amount)) throw invalid('기초 재고량은 0 이상의 숫자로 입력해 주세요.');
  if (!isDateText(date)) throw invalid('기준일은 2026-03-16 같은 날짜로 입력해 주세요.');
  if (date > todayKst()) throw invalid('기준일은 오늘 이후일 수 없습니다.');
}

function initialTx(reagent, amount, date) {
  return { reagentId: reagent.id, reagentName: reagent.name, date: date, kind: TX_KIND_LABELS.initial, amount: round3(amount), purpose: '', price: '', note: '' };
}

function reagentsList(payload) {
  return dbList('Reagents', { includeDeleted: !!payload.includeDeleted });
}

function reagentsCreate(payload, user) {
  var values = validateReagent(copyOf(payload.values), true, {});
  checkInitial(payload.initialAmount, payload.initialDate);
  if (liveReagentKeys()[reagentKey(values.name, values.concentration)]) throw duplicateError(values.name);
  values.stock = round3(payload.initialAmount);
  var reagent = dbCreate('Reagents', values, user);
  dbCreate('ReagentTx', initialTx(reagent, payload.initialAmount, payload.initialDate), user);
  return reagent;
}

function reagentsCreateMany(payload, user) {
  if (!Array.isArray(payload.rows) || payload.rows.length > 500) throw invalid('한 번에 500줄까지 보낼 수 있습니다.');
  var existing = liveReagentKeys();
  var inFile = {};
  var lookup = {};
  var toCreate = [];
  var skippedLines = [];
  payload.rows.forEach(function (row) {
    var line = row && row.line;
    try {
      var values = validateReagent(copyOf(row.values), true, lookup);
      checkInitial(row.initialAmount, row.initialDate);
      var key = reagentKey(values.name, values.concentration);
      if (existing[key]) {
        skippedLines.push(line);
        return;
      }
      if (inFile[key]) throw invalid(inFile[key] + '번째 줄과 같은 시약입니다.');
      inFile[key] = line;
      values.stock = round3(row.initialAmount);
      toCreate.push({ values: values, amount: row.initialAmount, date: row.initialDate });
    } catch (err) {
      if (err && err.isApiError) throw apiError(err.code, line + '번째 줄: ' + err.message);
      throw err;
    }
  });
  var created = dbCreateMany(
    'Reagents',
    toCreate.map(function (r) {
      return r.values;
    }),
    user,
  );
  dbCreateMany(
    'ReagentTx',
    created.map(function (reagent, i) {
      return initialTx(reagent, toCreate[i].amount, toCreate[i].date);
    }),
    user,
  );
  return { created: created, skippedLines: skippedLines };
}

function liveReagent(id) {
  var r = dbGet('Reagents', id);
  if (!r || r.deleted) throw apiError('NOT_FOUND', '시약을 찾을 수 없습니다.');
  return r;
}

function reagentsUpdate(payload, user) {
  var current = liveReagent(payload.id);
  var changes = validateReagent(copyOf(payload.changes), false, {});
  if (changes.name !== undefined || changes.concentration !== undefined) {
    var name = changes.name !== undefined ? changes.name : current.name;
    var concentration = changes.concentration !== undefined ? changes.concentration : current.concentration;
    if (liveReagentKeys(current.id)[reagentKey(name, concentration)]) throw duplicateError(name);
  }
  return dbUpdate('Reagents', current.id, changes, user);
}

function reagentsDelete(payload, user) {
  return dbSoftDelete('Reagents', liveReagent(payload.id).id, user);
}

function reagentsRestore(payload, user) {
  var r = dbGet('Reagents', payload.id);
  if (!r) throw apiError('NOT_FOUND', '시약을 찾을 수 없습니다.');
  if (liveReagentKeys(r.id)[reagentKey(r.name, r.concentration)]) throw duplicateError(r.name);
  return dbRestore('Reagents', r.id, user);
}

// ---- in/out records ----

function reagentTxActions() {
  return {
    'reagentTx.list': { auth: 'user', write: false, handler: reagentTxList },
    'reagentTx.create': { auth: 'user', write: true, handler: reagentTxCreate },
    'reagentTx.update': { auth: 'user', write: true, handler: reagentTxUpdate },
    'reagentTx.delete': { auth: 'user', write: true, handler: reagentTxDelete },
    'reagentTx.restore': { auth: 'user', write: true, handler: reagentTxRestore },
    'reagentTx.recentPurposes': { auth: 'user', write: false, handler: reagentTxRecentPurposes },
  };
}

function txKindKey(label) {
  for (var key in TX_KIND_LABELS) {
    if (TX_KIND_LABELS[key] === label || key === label) return key;
  }
  return label;
}

// Sheet row → API row (kind as initial/in/out).
function txOut(row) {
  var out = Object.assign({}, row);
  out.kind = txKindKey(row.kind);
  return out;
}

// Same order and arithmetic as runningBalances in web/src/domain/ledger.ts.
function txBalances(rows) {
  var live = rows.filter(function (t) {
    return !t.deleted;
  });
  live.sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    var ai = a.kind === 'initial' ? 1 : 0;
    var bi = b.kind === 'initial' ? 1 : 0;
    if (ai !== bi) return bi - ai;
    var at = Date.parse(a.createdAt) - Date.parse(b.createdAt);
    if (at) return at;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  var balance = 0;
  return live.map(function (tx) {
    var before = balance;
    balance = round3(tx.kind === 'out' ? balance - tx.amount : balance + tx.amount);
    return { tx: tx, before: before, after: balance };
  });
}

// Checks a reagent's records after a change and returns the new stock.
// newId: the record being added, for the "more than is left" message.
function checkedStock(reagent, rows, newId) {
  var initial = rows.filter(function (t) {
    return t.kind === 'initial' && !t.deleted;
  })[0];
  rows.forEach(function (t) {
    if (!t.deleted && initial && t.kind !== 'initial' && t.date < initial.date) {
      throw invalid('기준일(' + initial.date + ')보다 앞선 날짜의 기록은 둘 수 없습니다.');
    }
  });
  var balances = txBalances(rows);
  for (var i = 0; i < balances.length; i++) {
    if (balances[i].after < 0) {
      if (balances[i].tx.id === newId) throw invalid('남은 양(' + balances[i].before + ' ' + reagent.unit + ')보다 많습니다.');
      throw invalid('이렇게 바꾸면 ' + balances[i].tx.date + '에 남은 양이 음수가 됩니다.');
    }
  }
  return balances.length ? balances[balances.length - 1].after : 0;
}

function reagentTxRows(reagentId) {
  return dbList('ReagentTx', { where: { reagentId: reagentId }, includeDeleted: true }).map(txOut);
}

function checkTxFields(values, kind, isCreate) {
  if (isCreate || values.date !== undefined) {
    checkDate(values, 'date', '일자', true);
    if (values.date > todayKst()) throw invalid('일자는 오늘 이후일 수 없습니다.');
  }
  if (isCreate || values.amount !== undefined) {
    var a = values.amount;
    var ok = typeof a === 'number' && isFinite(a) && (kind === 'initial' ? a >= 0 : a > 0);
    if (!ok) throw invalid(kind === 'initial' ? '기초 재고량은 0 이상이어야 합니다.' : '수량은 0보다 커야 합니다.');
    values.amount = round3(a);
  }
  textOrEmpty(values, 'purpose');
  textOrEmpty(values, 'note');
  checkText(values, 'purpose', '용도', kind === 'out' && (isCreate || values.purpose !== undefined), 200);
  checkText(values, 'note', '비고', false, 200);
  if (values.price === null) values.price = '';
  if (values.price !== undefined && values.price !== '') {
    if (kind !== 'in') throw invalid('금액은 입고 기록에만 적을 수 있습니다.');
    if (typeof values.price !== 'number' || !(values.price >= 0)) throw invalid('금액이 올바르지 않습니다.');
  }
}

function saveStock(reagent, stock, user) {
  if (reagent.stock !== stock) dbUpdate('Reagents', reagent.id, { stock: stock }, user, { skipAudit: true });
}

function reagentTxList(payload) {
  return dbList('ReagentTx', { includeDeleted: !!payload.includeDeleted })
    .map(txOut)
    .filter(function (t) {
      if (payload.reagentId && t.reagentId !== payload.reagentId) return false;
      if (payload.from && t.date < payload.from) return false;
      if (payload.to && t.date > payload.to) return false;
      return true;
    });
}

function reagentTxCreate(payload, user) {
  var reagent = liveReagent(payload.reagentId);
  var kind = payload.kind;
  if (kind !== 'in' && kind !== 'out') throw invalid('구분은 입고 또는 출고만 적을 수 있습니다.');
  var values = { date: payload.date, amount: payload.amount, purpose: payload.purpose, price: payload.price, note: payload.note };
  checkTxFields(values, kind, true);
  var draft = { id: '￿', kind: kind, date: values.date, amount: values.amount, createdAt: nowIso(), deleted: false };
  var stock = checkedStock(reagent, reagentTxRows(reagent.id).concat([draft]), draft.id);
  var tx = dbCreate(
    'ReagentTx',
    {
      reagentId: reagent.id,
      reagentName: reagent.name,
      date: values.date,
      kind: TX_KIND_LABELS[kind],
      amount: values.amount,
      purpose: values.purpose || '',
      price: values.price === undefined ? '' : values.price,
      note: values.note || '',
    },
    user,
  );
  saveStock(reagent, stock, user);
  return { tx: txOut(tx), stock: stock };
}

function findTx(id) {
  var row = dbGet('ReagentTx', id);
  if (!row) throw apiError('NOT_FOUND', '기록을 찾을 수 없습니다.');
  return txOut(row);
}

function reagentTxUpdate(payload, user) {
  var current = findTx(payload.id);
  if (current.deleted) throw apiError('NOT_FOUND', '삭제된 기록입니다.');
  var reagent = liveReagent(current.reagentId);
  var changes = copyOf(payload.changes);
  var allowed = current.kind === 'initial' ? ['date', 'amount'] : ['date', 'amount', 'purpose', 'price', 'note'];
  Object.keys(changes).forEach(function (key) {
    if (allowed.indexOf(key) < 0) throw invalid(current.kind === 'initial' ? '기초 재고는 수량과 날짜만 고칠 수 있습니다.' : '고칠 수 없는 항목입니다: ' + key);
  });
  checkTxFields(changes, current.kind, false);
  var rows = reagentTxRows(reagent.id).map(function (t) {
    return t.id === current.id ? Object.assign({}, t, changes) : t;
  });
  var stock = checkedStock(reagent, rows, null);
  var updated = dbUpdate('ReagentTx', current.id, changes, user);
  saveStock(reagent, stock, user);
  return { tx: txOut(updated), stock: stock };
}

function setTxDeleted(payload, user, deleted) {
  var current = findTx(payload.id);
  if (current.kind === 'initial') throw invalid('기초 재고 기록은 삭제할 수 없습니다. 수량을 고쳐 주세요.');
  if (current.deleted === deleted) throw invalid(deleted ? '이미 삭제된 기록입니다.' : '삭제되지 않은 기록입니다.');
  var reagent = liveReagent(current.reagentId);
  var rows = reagentTxRows(reagent.id).map(function (t) {
    return t.id === current.id ? Object.assign({}, t, { deleted: deleted }) : t;
  });
  var stock = checkedStock(reagent, rows, null);
  var row = deleted ? dbSoftDelete('ReagentTx', current.id, user) : dbRestore('ReagentTx', current.id, user);
  saveStock(reagent, stock, user);
  return { tx: txOut(row), stock: stock };
}

function reagentTxDelete(payload, user) {
  return setTxDeleted(payload, user, true);
}

function reagentTxRestore(payload, user) {
  return setTxDeleted(payload, user, false);
}

// Up to 8 different purposes of recent uses, newest first (rows are appended in time order).
function reagentTxRecentPurposes() {
  var rows = dbList('ReagentTx').map(txOut);
  var seen = {};
  var out = [];
  for (var i = rows.length - 1; i >= 0 && out.length < 8; i--) {
    var p = rows[i].kind === 'out' ? String(rows[i].purpose).trim() : '';
    if (p && !seen[p]) {
      seen[p] = true;
      out.push(p);
    }
  }
  return out;
}

// ===== Records.js =====

// Generic create/read/update/delete for the tables in RECORD_TABLES, with
// per-table validation, plus reading the change history.

function recordsActions() {
  return {
    'records.list': { auth: 'user', write: false, handler: recordsList },
    'records.create': { auth: 'user', write: true, handler: recordsCreate },
    'records.createMany': { auth: 'user', write: true, handler: recordsCreateMany },
    'records.update': { auth: 'user', write: true, handler: recordsUpdate },
    'records.delete': { auth: 'user', write: true, handler: recordsDelete },
    'records.deleteMany': { auth: 'user', write: true, handler: recordsDeleteMany },
    'records.restore': { auth: 'user', write: true, handler: recordsRestore },
    'audit.list': { auth: 'user', write: false, handler: auditList },
  };
}

function recordTable(table) {
  if (typeof table !== 'string' || !Object.prototype.hasOwnProperty.call(RECORD_TABLES, table)) {
    throw apiError('FORBIDDEN', '이 표는 이 방법으로 다룰 수 없습니다.');
  }
  return table;
}

function invalid(message) {
  return apiError('INVALID', message);
}

function checkText(values, key, label, required, max) {
  if (values[key] === undefined) {
    if (required) throw invalid(label + '을(를) 입력해 주세요.');
    return;
  }
  if (typeof values[key] !== 'string') throw invalid(label + ' 값이 올바르지 않습니다.');
  values[key] = values[key].trim();
  if (required && !values[key]) throw invalid(label + '을(를) 입력해 주세요.');
  if (values[key].length > max) throw invalid(label + '은(는) ' + max + '자 이하로 입력해 주세요.');
}

function checkBoolean(values, key, label) {
  if (values[key] !== undefined && typeof values[key] !== 'boolean') throw invalid(label + ' 값이 올바르지 않습니다.');
}

function checkInteger(values, key, label, required, min, max) {
  var v = values[key];
  if (v === undefined) {
    if (required) throw invalid(label + '을(를) 입력해 주세요.');
    return;
  }
  if (typeof v !== 'number' || Math.floor(v) !== v || v < min || v > max) {
    throw invalid(label + '은(는) ' + min + '~' + max + ' 사이의 정수여야 합니다.');
  }
}

// Looks up ids of a parent table once per request.
function existsIn(lookup, table, id) {
  if (!lookup[table]) {
    lookup[table] = {};
    dbList(table).forEach(function (row) {
      lookup[table][row.id] = true;
    });
  }
  return typeof id === 'string' && lookup[table][id] === true;
}

// One live zone per (cabinet, row, col). Slots taken earlier in the same
// batch count too, so a double-clicked save cannot create a second zone.
function claimZoneSlot(lookup, zone) {
  if (!lookup.zoneSlots) {
    lookup.zoneSlots = {};
    dbList('Zones').forEach(function (z) {
      lookup.zoneSlots[z.cabinetId + ':' + z.row + ':' + z.col] = true;
    });
  }
  var key = zone.cabinetId + ':' + zone.row + ':' + zone.col;
  if (lookup.zoneSlots[key]) throw invalid(zone.row + '단 ' + zone.col + '칸에는 이미 구역이 있습니다. 화면을 새로 고쳐 주세요.');
  lookup.zoneSlots[key] = true;
}

function validateRecord(table, values, isCreate, lookup) {
  Object.keys(values).forEach(function (key) {
    if (RECORD_TABLES[table].indexOf(key) < 0) throw invalid('알 수 없는 항목입니다: ' + key);
  });
  if (table === 'Rooms') {
    checkText(values, 'name', '교실 이름', isCreate || values.name !== undefined, 100);
    checkBoolean(values, 'isLab', '과학실 여부');
    checkText(values, 'note', '메모', false, 500);
  }
  if (table === 'Cabinets') {
    if ((isCreate || values.roomId !== undefined) && !existsIn(lookup, 'Rooms', values.roomId)) {
      throw apiError('NOT_FOUND', '교실을 찾을 수 없습니다.');
    }
    checkText(values, 'name', '보관장 이름', isCreate || values.name !== undefined, 100);
    if ((isCreate || values.type !== undefined) && CABINET_TYPE_IDS.indexOf(values.type) < 0) {
      throw invalid('보관장 종류가 올바르지 않습니다.');
    }
    checkBoolean(values, 'locked', '잠금 여부');
    checkInteger(values, 'rows', '단 수', isCreate, 1, 20);
    checkInteger(values, 'cols', '칸 수', isCreate, 1, 20);
    checkText(values, 'note', '메모', false, 500);
  }
  if (table === 'Zones') {
    if ((isCreate || values.cabinetId !== undefined) && !existsIn(lookup, 'Cabinets', values.cabinetId)) {
      throw apiError('NOT_FOUND', '보관장을 찾을 수 없습니다.');
    }
    checkInteger(values, 'row', '단', isCreate, 1, 20);
    checkInteger(values, 'col', '칸', isCreate, 1, 20);
    if (isCreate) claimZoneSlot(lookup, values);
    checkText(values, 'name', '구역 이름', false, 100);
    if (values.allowedClasses !== undefined) {
      if (typeof values.allowedClasses !== 'string') throw invalid('허용 보관 분류 값이 올바르지 않습니다.');
      values.allowedClasses.split(',').forEach(function (id) {
        if (id && STORAGE_CLASS_IDS.indexOf(id) < 0) throw invalid('알 수 없는 보관 분류입니다: ' + id);
      });
    }
  }
  return values;
}

function copyOf(values) {
  return Object.assign({}, values || {});
}

function recordsList(payload) {
  return dbList(recordTable(payload.table), { where: payload.where || {}, includeDeleted: !!payload.includeDeleted });
}

function recordsCreate(payload, user) {
  var table = recordTable(payload.table);
  return dbCreate(table, validateRecord(table, copyOf(payload.values), true, {}), user);
}

function recordsCreateMany(payload, user) {
  var table = recordTable(payload.table);
  if (!Array.isArray(payload.rows)) throw invalid('rows 값이 올바르지 않습니다.');
  var lookup = {};
  var rows = payload.rows.map(function (values) {
    return validateRecord(table, copyOf(values), true, lookup);
  });
  return dbCreateMany(table, rows, user);
}

function recordsUpdate(payload, user) {
  var table = recordTable(payload.table);
  return dbUpdate(table, payload.id, validateRecord(table, copyOf(payload.changes), false, {}), user);
}

function recordsDelete(payload, user) {
  return dbSoftDelete(recordTable(payload.table), payload.id, user);
}

function recordsDeleteMany(payload, user) {
  var table = recordTable(payload.table);
  if (!Array.isArray(payload.ids)) throw invalid('ids 값이 올바르지 않습니다.');
  return payload.ids.map(function (id) {
    return dbSoftDelete(table, id, user);
  });
}

function recordsRestore(payload, user) {
  var table = recordTable(payload.table);
  var row = dbGet(table, payload.id);
  if (row && table === 'Zones' && row.deleted) claimZoneSlot({}, row);
  return dbRestore(table, payload.id, user);
}

// Newest first. Account history also shows logins (kept in 접속 기록).
function auditList(payload) {
  var limit = Math.min(Math.max(Number(payload.limit) || 100, 1), 1000);
  var groups;
  if (!payload.table) groups = Object.keys(HISTORY_TABS);
  else if (payload.table === 'Users') groups = ['users', 'access'];
  else groups = [historyGroupFor(payload.table, '')];
  // A reagent's history also shows changes to its in/out records.
  var txIds = payload.table === 'Reagents' && payload.recordId ? reagentTxIds(payload.recordId) : null;
  return historyEntries(groups)
    .filter(function (a) {
      if (txIds && a.table === 'ReagentTx') return txIds[a.recordId] === true;
      return (!payload.table || a.table === payload.table) && (!payload.recordId || a.recordId === payload.recordId);
    })
    .reverse()
    .slice(0, limit)
    .map(function (a) {
      return {
        id: a.id,
        at: a.at,
        userId: a.userId,
        userName: a.userName,
        table: a.table,
        recordId: a.recordId,
        action: a.action,
        before: a.before ? JSON.parse(a.before) : null,
        after: a.after ? JSON.parse(a.after) : null,
      };
    });
}

// Ids of all the reagent's in/out records, deleted ones included.
function reagentTxIds(reagentId) {
  var ids = {};
  dbList('ReagentTx', { where: { reagentId: reagentId }, includeDeleted: true }).forEach(function (t) {
    ids[t.id] = true;
  });
  return ids;
}

// ===== Schema.js =====

// Reagent columns a person fills in (stock is kept by the server).
var REAGENT_COLUMNS_INPUT = [
  'name', 'concentration', 'formula', 'casNo', 'grade', 'unit', 'mainUse', 'expiryDate', 'purchaseDate', 'openedDate',
  'maker', 'supplier', 'zoneId', 'toxic', 'accidentPrep', 'hazardManual', 'poison', 'banned', 'permitted', 'restricted', 'note',
];

// Table definitions. Code uses the keys (Users, roomId …); the spreadsheet
// shows Korean tab names and headers (SHEET_NAMES, COLUMN_LABELS).

// Columns the caller may write, per table. Every table also gets the common columns.
var TABLES = {
  Users: ['loginId', 'name', 'role', 'salt', 'hash', 'mustChangePassword', 'active'],
  Settings: ['key', 'label', 'value'],
  Rooms: ['name', 'isLab', 'note'],
  Cabinets: ['roomId', 'name', 'type', 'locked', 'rows', 'cols', 'note'],
  Zones: ['cabinetId', 'row', 'col', 'name', 'allowedClasses'],
  Reagents: REAGENT_COLUMNS_INPUT.concat(['stock']),
  ReagentTx: ['reagentId', 'reagentName', 'date', 'kind', 'amount', 'purpose', 'price', 'note'],
};

var SHEET_NAMES = { Settings: '환경설정', Users: '계정', Rooms: '교실', Cabinets: '보관장', Zones: '보관장 구역', Reagents: '시약', ReagentTx: '시약 수불' };
var TABLE_LABELS = { Settings: '환경설정', Users: '계정', Rooms: '교실', Cabinets: '보관장', Zones: '보관장 구역', Reagents: '시약', ReagentTx: '시약 수불', System: '시트' };

// Column order in a new tab: the table's readable columns, who/when, then ids and secrets.
var COMMON_VISIBLE = ['createdByName', 'createdAt', 'updatedByName', 'updatedAt', 'deleted', 'deletedByName', 'deletedAt'];
var COMMON_IDS = ['id', 'createdBy', 'updatedBy', 'deletedBy'];
var TABLE_LAYOUT = {
  Users: [['loginId', 'name', 'role', 'mustChangePassword', 'active'], ['salt', 'hash']],
  Settings: [['label', 'value'], ['key']],
  Rooms: [['name', 'isLab', 'note'], []],
  Cabinets: [['name', 'type', 'locked', 'rows', 'cols', 'note'], ['roomId']],
  Zones: [['row', 'col', 'name', 'allowedClasses'], ['cabinetId']],
  Reagents: [
    ['name', 'concentration', 'formula', 'casNo', 'grade', 'unit', 'stock', 'mainUse', 'expiryDate', 'purchaseDate', 'openedDate',
      'maker', 'supplier', 'toxic', 'accidentPrep', 'hazardManual', 'poison', 'banned', 'permitted', 'restricted', 'note'],
    ['zoneId'],
  ],
  ReagentTx: [['reagentName', 'date', 'kind', 'amount', 'purpose', 'price', 'note'], ['reagentId']],
};

var COLUMN_LABELS = {
  id: 'ID',
  createdBy: '작성자 ID',
  createdByName: '작성자',
  createdAt: '작성일시',
  updatedBy: '수정자 ID',
  updatedByName: '수정자',
  updatedAt: '수정일시',
  deleted: '삭제됨',
  deletedBy: '삭제자 ID',
  deletedByName: '삭제자',
  deletedAt: '삭제일시',
  loginId: '아이디',
  name: '이름',
  role: '역할',
  mustChangePassword: '비밀번호 변경 필요',
  active: '사용 여부',
  salt: 'salt (암호용)',
  hash: 'hash (암호용)',
  key: '항목 키',
  label: '항목',
  value: '값',
  isLab: '과학실 여부',
  note: '메모',
  type: '종류',
  locked: '잠금',
  rows: '단 수',
  cols: '칸 수',
  roomId: '교실 ID',
  row: '단',
  col: '칸',
  allowedClasses: '허용 보관 분류',
  cabinetId: '보관장 ID',
  concentration: '농도(%)',
  formula: '화학식',
  casNo: 'CAS No.',
  grade: '규격',
  unit: '단위',
  stock: '현재 보유량',
  mainUse: '주용도',
  expiryDate: '유효기간',
  purchaseDate: '구입일',
  openedDate: '개봉일',
  maker: '제조사',
  supplier: '구입처',
  zoneId: '보관 구역 ID',
  toxic: '유독물질',
  accidentPrep: '사고대비물질',
  hazardManual: '판정 직접 지정',
  poison: '독극물',
  banned: '금지물질',
  permitted: '허가물질',
  restricted: '제한물질',
  reagentId: '시약 ID',
  reagentName: '약품명',
  date: '일자',
  kind: '구분',
  amount: '수량',
  purpose: '용도',
  price: '금액(원)',
};

// Headers that differ in one table (the ledger forms call these 약품명 and 비고).
var TABLE_COLUMN_LABELS = {
  Reagents: { name: '약품명', note: '비고' },
  ReagentTx: { note: '비고' },
};

function columnLabel(table, column) {
  var own = TABLE_COLUMN_LABELS[table];
  return (own && own[column]) || COLUMN_LABELS[column];
}

var SETTING_LABELS = {
  schoolName: '학교 이름',
  managerName: '관리 교사',
  schoolLevel: '학교급',
  region: '장부 양식 지역',
  signerScienceHead: '과학부장',
  signerVicePrincipal: '교감',
  signerPrincipal: '교장',
  labOver100m2: '실험실 면적 100㎡ 이상',
  wasteDisposal: '폐수 처리 방식',
};

// History is split by area into its own tabs. Left columns are for people,
// right columns (grey header) are the raw data the app reads back.
var HISTORY_TABS = {
  settings: '환경설정 이력',
  users: '계정 이력',
  access: '접속 기록',
  rooms: '교실 이력',
  reagents: '시약 이력',
  other: '기타 이력',
};
var HISTORY_GROUP_OF_TABLE = { Settings: 'settings', System: 'settings', Users: 'users', Rooms: 'rooms', Cabinets: 'rooms', Zones: 'rooms', Reagents: 'reagents', ReagentTx: 'reagents' };
var HISTORY_COLUMNS = ['when', 'userName', 'tableLabel', 'target', 'actionLabel', 'summary', 'id', 'at', 'userId', 'table', 'recordId', 'action', 'before', 'after'];
var HISTORY_RAW_FROM = 'id';
var HISTORY_LABELS = {
  when: '일시',
  userName: '사람',
  tableLabel: '표',
  target: '대상',
  actionLabel: '동작',
  summary: '바뀐 내용',
  id: '기록 ID',
  at: '시각(원자료)',
  userId: '사람 ID',
  table: '표 키',
  recordId: '대상 ID',
  action: '동작 키',
  before: '이전 값(원자료)',
  after: '새 값(원자료)',
};
var ACTION_LABELS = {
  create: '추가',
  update: '수정',
  delete: '삭제',
  restore: '복구',
  login: '로그인',
  passwordChange: '비밀번호 변경',
  passwordReset: '비밀번호 초기화',
  close: '운영 종료',
  reopen: '운영 종료 풀기',
  continueCopy: '사본 계속 쓰기',
  startFresh: '새 학교 시트로 시작',
};
var TAB_COLORS = { data: '#2563eb', history: '#94a3b8' };
var RAW_HEADER_BACKGROUND = '#e2e8f0';

function columnsOf(table) {
  var layout = TABLE_LAYOUT[table];
  if (!layout) throw apiError('INVALID', '알 수 없는 표입니다: ' + table);
  return layout[0].concat(COMMON_VISIBLE, COMMON_IDS, layout[1]);
}

// Header text → column key. Old English headers (the key itself) are accepted too.
function keyForLabel(table, label) {
  var columns = columnsOf(table);
  for (var i = 0; i < columns.length; i++) {
    if (columnLabel(table, columns[i]) === label || columns[i] === label) return columns[i];
  }
  return null;
}

function historyKeyForLabel(label) {
  for (var i = 0; i < HISTORY_COLUMNS.length; i++) {
    if (HISTORY_LABELS[HISTORY_COLUMNS[i]] === label || HISTORY_COLUMNS[i] === label) return HISTORY_COLUMNS[i];
  }
  return null;
}

function historyGroupFor(table, action) {
  if (action === 'login') return 'access';
  return HISTORY_GROUP_OF_TABLE[table] || 'other';
}

var BOOLEAN_COLUMNS = ['deleted', 'locked', 'active', 'mustChangePassword', 'labOver100m2', 'isLab', 'hazardManual', 'poison', 'banned', 'permitted', 'restricted'];
var NUMBER_COLUMNS = ['rows', 'cols', 'row', 'col', 'concentration', 'stock', 'amount', 'price'];

// Never copied into the audit log.
var SECRET_COLUMNS = ['salt', 'hash'];

// Tables the generic records.* actions may touch, and the columns they may write.
var RECORD_TABLES = {
  Rooms: ['name', 'isLab', 'note'],
  Cabinets: ['roomId', 'name', 'type', 'locked', 'rows', 'cols', 'note'],
  Zones: ['cabinetId', 'row', 'col', 'name', 'allowedClasses'],
};

// Same ids as web/src/domain/storage.ts.
var CABINET_TYPE_IDS = ['sealed', 'flammable', 'general', 'waste', 'equipment', 'fridge'];
var STORAGE_CLASS_IDS = [
  'inorganic_acid',
  'organic_acid',
  'base',
  'reactive_inorganic',
  'metal',
  'flammable',
  'general_inorganic',
  'general_organic',
];

// ===== Settings.js =====

// School settings, stored as key/value rows. History is keyed by setting name.

var SETTINGS_DEFAULTS = {
  schoolName: '',
  managerName: '',
  schoolLevel: 'middle',
  region: 'chungbuk',
  signerScienceHead: '',
  signerVicePrincipal: '',
  signerPrincipal: '',
  labOver100m2: false,
  wasteDisposal: 'office',
};

var SETTINGS_CHOICES = {
  schoolLevel: ['middle', 'high'],
  region: ['chungbuk', 'seoul', 'gyeonggi'],
  wasteDisposal: ['office', 'self'],
};

function settingsActions() {
  return {
    'settings.get': { auth: 'user', write: false, handler: settingsGet },
    'settings.update': { auth: 'user', write: true, handler: settingsUpdate },
  };
}

function settingsRows() {
  var rows = {};
  dbList('Settings').forEach(function (r) {
    rows[r.key] = r;
  });
  return rows;
}

function settingValue(key, stored) {
  if (typeof SETTINGS_DEFAULTS[key] === 'boolean') return stored === 'true';
  return stored;
}

function settingsGet() {
  var rows = settingsRows();
  var out = {};
  Object.keys(SETTINGS_DEFAULTS).forEach(function (key) {
    out[key] = rows[key] ? settingValue(key, rows[key].value) : SETTINGS_DEFAULTS[key];
  });
  return out;
}

function checkSetting(key, value) {
  if (!Object.prototype.hasOwnProperty.call(SETTINGS_DEFAULTS, key)) throw apiError('INVALID', '알 수 없는 설정입니다: ' + key);
  if (typeof SETTINGS_DEFAULTS[key] === 'boolean') {
    if (typeof value !== 'boolean') throw apiError('INVALID', '설정 값이 올바르지 않습니다: ' + key);
    return;
  }
  if (typeof value !== 'string' || value.length > 100) throw apiError('INVALID', '설정 값이 올바르지 않습니다: ' + key);
  if (SETTINGS_CHOICES[key] && SETTINGS_CHOICES[key].indexOf(value) < 0) {
    throw apiError('INVALID', '설정 값이 올바르지 않습니다: ' + key);
  }
}

// Entered from the sheet menu (LabKeeper → 학교 정보 입력); the web only shows them.
var SHEET_ONLY_SETTINGS = ['schoolName', 'managerName'];

function settingsUpdate(payload, user) {
  Object.keys(payload).forEach(function (key) {
    if (SHEET_ONLY_SETTINGS.indexOf(key) >= 0) {
      throw apiError('INVALID', '학교 이름과 관리 교사는 스프레드시트의 시트 메뉴 LabKeeper → 학교 정보 입력에서 바꿀 수 있습니다.');
    }
  });
  return writeSettings(payload, user);
}

// Checks and stores settings; each changed key gets its own history line.
function writeSettings(payload, user) {
  Object.keys(payload).forEach(function (key) {
    checkSetting(key, payload[key]);
  });
  var current = settingsGet();
  var rows = settingsRows();
  Object.keys(payload).forEach(function (key) {
    var value = typeof payload[key] === 'string' ? payload[key].trim() : payload[key];
    if (value === current[key]) return;
    var stored = String(value);
    if (rows[key]) dbUpdate('Settings', rows[key].id, { value: stored }, user, { skipAudit: true });
    else dbCreate('Settings', { key: key, label: SETTING_LABELS[key] || key, value: stored }, user, { skipAudit: true });
    var before = {};
    var after = {};
    before[key] = current[key];
    after[key] = value;
    dbAudit(user, 'Settings', key, 'update', before, after);
  });
  return settingsGet();
}

// ===== System.js =====

// App identity, version and copy detection.

// Raise together with REQUIRED_API_VERSION in web/src/api/system.ts whenever
// the web app starts using a new action. Each school redeploys its own copy
// of this code, so the web app checks this number.
var API_VERSION = 4;
var OWNER_PROP = 'OWNER_SPREADSHEET_ID';
// Set by the sheet menu 운영 종료: {at, note}. A closed sheet answers only system.info.
var CLOSED_PROP = 'SHEET_CLOSED';
// Id of the sheet that was made the distribution template (배포용 원본). Copies
// have another id, so the mark never applies to a school's copy.
var TEMPLATE_PROP = 'TEMPLATE_SPREADSHEET_ID';
var TEMPLATE_MESSAGE = '배포용 원본 시트입니다. 원본을 "사본 만들기"로 복사한 시트에서 웹 앱을 배포해 쓰세요.';

function isTemplateSheet() {
  return PropertiesService.getScriptProperties().getProperty(TEMPLATE_PROP) === String(SpreadsheetApp.getActive().getId());
}

function systemActions() {
  return {
    'system.info': { auth: 'none', write: false, handler: systemInfo },
    'system.sheetUrl': { auth: 'admin', write: false, handler: systemSheetUrl },
  };
}

// Users rows, read without creating the sheet.
function usersSheetHasRows() {
  ensureLayout();
  var sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAMES.Users);
  return !!sheet && sheet.getLastRow() > 1;
}

// Script properties travel with "Make a copy", so they remember which
// spreadsheet they belong to. A copy of a blank template is a new school and
// is adopted; a copy that already has accounts carries another school's data
// and is refused until someone runs "start fresh" from the sheet menu.
function sheetOwnerState() {
  var id = String(SpreadsheetApp.getActive().getId());
  var props = PropertiesService.getScriptProperties();
  var owner = props.getProperty(OWNER_PROP);
  if (owner === id) return 'ok';
  if (owner && usersSheetHasRows()) return 'copied';
  props.setProperty(OWNER_PROP, id);
  return 'ok';
}

function sheetClosedInfo() {
  var raw = PropertiesService.getScriptProperties().getProperty(CLOSED_PROP);
  return raw ? JSON.parse(raw) : null;
}

function systemInfo() {
  var copied = sheetOwnerState() === 'copied';
  var closed = sheetClosedInfo();
  var settings = copied ? { schoolName: '', managerName: '' } : settingsGet();
  return {
    name: 'LabKeeper',
    apiVersion: API_VERSION,
    needsSetup: !hasAnyUser(),
    copied: copied,
    template: isTemplateSheet(),
    closed: !!closed,
    closedNote: closed ? closed.note : '',
    schoolName: settings.schoolName,
    managerName: settings.managerName,
  };
}

function systemSheetUrl() {
  return { url: SpreadsheetApp.getActive().getUrl() };
}

// ===== Users.js =====

// Account management (admin only) and the name directory (everyone).

var ROLES = ['admin', 'teacher'];

function usersActions() {
  return {
    'directory.list': { auth: 'user', write: false, handler: directoryList },
    'users.list': { auth: 'admin', write: false, handler: usersList },
    'users.create': { auth: 'admin', write: true, handler: usersCreate },
    'users.resetPassword': { auth: 'admin', write: true, handler: usersResetPassword },
    'users.update': { auth: 'admin', write: true, handler: usersUpdate },
  };
}

function tempPassword() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 10);
}

function directoryList() {
  return [SYSTEM_USER, SHEET_OWNER].concat(
    dbList('Users', { includeDeleted: true }).map(function (u) {
      return { id: u.id, name: u.name };
    }),
  );
}

function usersList() {
  return dbList('Users').map(publicUser);
}

function checkRole(role) {
  if (ROLES.indexOf(role) < 0) throw apiError('INVALID', '역할은 운영 교사 또는 일반 교사여야 합니다.');
}

function usersCreate(payload, user) {
  var loginId = normalizeLoginId(payload.loginId);
  var name = String(payload.name || '').trim();
  checkLoginId(loginId);
  if (!name) throw apiError('INVALID', '이름을 입력해 주세요.');
  checkRole(payload.role);
  var taken = dbList('Users', { includeDeleted: true }).some(function (u) {
    return u.loginId === loginId;
  });
  if (taken) throw apiError('INVALID', '이미 사용 중인 아이디입니다.');
  var password = tempPassword();
  var salt = newSalt();
  var row = dbCreate(
    'Users',
    { loginId: loginId, name: name, role: payload.role, salt: salt, hash: hashPassword(password, salt), mustChangePassword: true, active: true },
    user,
  );
  return { user: publicUser(row), tempPassword: password };
}

function usersResetPassword(payload, user) {
  var row = dbGet('Users', payload.id);
  if (!row || row.deleted) throw apiError('NOT_FOUND', '해당 계정을 찾을 수 없습니다.');
  var password = tempPassword();
  var salt = newSalt();
  dbUpdate('Users', row.id, { salt: salt, hash: hashPassword(password, salt), mustChangePassword: true }, user, { skipAudit: true });
  dbAudit(user, 'Users', row.id, 'passwordReset', null, null, row.name);
  CacheService.getScriptCache().remove('fail:' + row.loginId);
  return { tempPassword: password };
}

function usersUpdate(payload, user) {
  var row = dbGet('Users', payload.id);
  if (!row || row.deleted) throw apiError('NOT_FOUND', '해당 계정을 찾을 수 없습니다.');
  var changes = {};
  if (payload.name !== undefined) {
    changes.name = String(payload.name).trim();
    if (!changes.name) throw apiError('INVALID', '이름을 입력해 주세요.');
  }
  if (payload.role !== undefined) {
    checkRole(payload.role);
    changes.role = payload.role;
  }
  if (payload.active !== undefined) {
    if (typeof payload.active !== 'boolean') throw apiError('INVALID', '사용 여부 값이 올바르지 않습니다.');
    changes.active = payload.active;
  }
  var stillAdmin = (changes.role || row.role) === 'admin' && (changes.active === undefined ? row.active : changes.active);
  if (!stillAdmin) {
    var otherAdmins = activeUsers().filter(function (u) {
      return u.role === 'admin' && u.id !== row.id;
    });
    if (otherAdmins.length === 0) throw apiError('INVALID', '운영 교사가 최소 1명 있어야 합니다.');
  }
  return publicUser(dbUpdate('Users', row.id, changes, user));
}
