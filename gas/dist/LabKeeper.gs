// LabKeeper 학교용 코드 (API_VERSION 2)
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
  dbAudit({ id: row.id, name: row.name }, 'Users', row.id, 'login', null, null);
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
  dbAudit(user, 'Users', user.id, 'passwordChange', null, null);
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
  var groups = [systemActions(), authActions(), usersActions(), settingsActions(), recordsActions()];
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
    if (req.action !== 'system.info' && sheetOwnerState() === 'copied') {
      throw apiError('SHEET_COPIED', '운영 중인 시트의 사본입니다. 시트 메뉴 LabKeeper → 사본을 새 학교 시트로 시작을 먼저 실행하세요.');
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

// Table storage on top of one spreadsheet: one sheet per table, row 1 is the
// header. Columns are always located by header name, so people can reorder
// columns or add their own in the sheet without breaking anything.
// Deletes are soft, and every change is written to AuditLog.

function columnsOf(table) {
  if (table === 'AuditLog') return AUDIT_COLUMNS;
  if (!TABLES[table]) throw apiError('INVALID', '알 수 없는 표입니다: ' + table);
  return ['id'].concat(TABLES[table], COMMON_COLUMNS.slice(1));
}

// Returns { sheet, header } and makes sure every expected column has a header.
function openTable(table) {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(table) || ss.insertSheet(table);
  var expected = columnsOf(table);
  var header = sheet.getLastRow() === 0 ? [] : sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  var missing = expected.filter(function (c) {
    return header.indexOf(c) < 0;
  });
  if (missing.length) {
    var extraColumns = header.length + missing.length - sheet.getMaxColumns();
    if (extraColumns > 0) sheet.insertColumnsAfter(sheet.getMaxColumns(), extraColumns);
    sheet.getRange(1, header.length + 1, 1, missing.length).setValues([missing.map(toCell)]);
    header = header.concat(missing);
  }
  return { sheet: sheet, header: header };
}

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
      obj[column] = line[c];
    });
    if (obj.id === '' || obj.id === null) return;
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

function nowIso() {
  return new Date().toISOString();
}

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
        return toCell(obj[column] === undefined ? '' : obj[column]);
      });
    }),
  );
}

// options.skipAudit: the caller writes its own audit entry (Settings does,
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
    row.createdAt = now;
    row.updatedBy = user.id;
    row.updatedAt = now;
    row.deleted = false;
    row.deletedBy = '';
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

function dbUpdate(table, id, changes, user, options) {
  checkColumns(table, changes);
  var fields = Object.assign({}, changes, { updatedBy: user.id, updatedAt: nowIso() });
  var result = writeFields(table, id, fields);
  var before = {};
  var after = {};
  Object.keys(changes).forEach(function (key) {
    if (result.before[key] !== result.after[key]) {
      before[key] = result.before[key];
      after[key] = result.after[key];
    }
  });
  if (!(options && options.skipAudit)) dbAudit(user, table, id, 'update', before, after);
  return result.after;
}

function dbSoftDelete(table, id, user) {
  var now = nowIso();
  var result = writeFields(table, id, { deleted: true, deletedBy: user.id, deletedAt: now, updatedBy: user.id, updatedAt: now });
  dbAudit(user, table, id, 'delete', result.before, null);
  return result.after;
}

function dbRestore(table, id, user) {
  var result = writeFields(table, id, { deleted: false, deletedBy: '', deletedAt: '', updatedBy: user.id, updatedAt: nowIso() });
  dbAudit(user, table, id, 'restore', null, result.after);
  return result.after;
}

function withoutSecrets(values) {
  if (!values) return values;
  var copy = {};
  Object.keys(values).forEach(function (key) {
    if (SECRET_COLUMNS.indexOf(key) < 0) copy[key] = values[key];
  });
  return copy;
}

function dbAudit(user, table, recordId, action, before, after) {
  dbAuditMany(user, table, [{ recordId: recordId, action: action, before: before, after: after }]);
}

function dbAuditMany(user, table, items) {
  var at = nowIso();
  appendObjects(
    openTable('AuditLog'),
    items.map(function (item) {
      return {
        id: Utilities.getUuid(),
        at: at,
        userId: user ? user.id : '',
        userName: user ? user.name : '',
        table: table,
        recordId: item.recordId,
        action: item.action,
        before: item.before ? JSON.stringify(withoutSecrets(item.before)) : '',
        after: item.after ? JSON.stringify(withoutSecrets(item.after)) : '',
      };
    }),
  );
}

// ===== Menu.js =====

// The "LabKeeper" menu in the spreadsheet. Only people who can open the
// sheet can use it, so the first admin account is created here (never from
// the web). The sheet* functions hold the logic and are tested; the menu*
// functions only show dialogs.

function withScriptLock(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function sheetCreateAdmin(form) {
  return withScriptLock(function () {
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
    dbUpdate('Users', row.id, { salt: salt, hash: hashPassword(password, salt), mustChangePassword: true }, SHEET_OWNER, { skipAudit: true });
    dbAudit(SHEET_OWNER, 'Users', row.id, 'passwordReset', null, null);
    CacheService.getScriptCache().remove('fail:' + row.loginId);
    return { tempPassword: password };
  });
}

// Empties every table (headers stay) and makes this spreadsheet the owner.
// Used when someone copied a sheet that was already in use.
function sheetStartFresh() {
  return withScriptLock(function () {
    var ss = SpreadsheetApp.getActive();
    Object.keys(TABLES)
      .concat(['AuditLog'])
      .forEach(function (name) {
        var sheet = ss.getSheetByName(name);
        if (sheet && sheet.getLastRow() > 1) sheet.deleteRows(2, sheet.getLastRow() - 1);
      });
    var id = String(ss.getId());
    PropertiesService.getScriptProperties().setProperty(OWNER_PROP, id);
    dbAudit(SHEET_OWNER, 'System', id, 'startFresh', null, null);
    return true;
  });
}

// Lists problems without fixing anything (openTable would add headers).
function checkSheetStructure() {
  var ss = SpreadsheetApp.getActive();
  var problems = [];
  Object.keys(TABLES)
    .concat(['AuditLog'])
    .forEach(function (name) {
      var sheet = ss.getSheetByName(name);
      if (!sheet) {
        problems.push(name + ' 시트가 없습니다');
        return;
      }
      var header = sheet.getLastColumn() ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String) : [];
      columnsOf(name).forEach(function (column) {
        if (header.indexOf(column) < 0) problems.push(name + ' 시트에 ' + column + ' 열이 없습니다');
      });
    });
  return problems;
}

// ---- Menu and dialogs (not unit tested: they only call the functions above) ----

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('LabKeeper')
    .addItem('운영 교사 계정 만들기', 'menuCreateAdmin')
    .addItem('운영 교사 비밀번호 초기화', 'menuResetAdminPassword')
    .addSeparator()
    .addItem('시트 구조 점검', 'menuCheckStructure')
    .addItem('사본을 새 학교 시트로 시작', 'menuStartFresh')
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
  sheetStartFresh();
  ui.alert('모든 기록을 지웠습니다. "운영 교사 계정 만들기"로 첫 계정을 만드세요.');
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

function auditList(payload) {
  var limit = Math.min(Math.max(Number(payload.limit) || 100, 1), 1000);
  return dbList('AuditLog')
    .filter(function (a) {
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

// ===== Schema.js =====

// Table definitions. Every table except AuditLog also gets COMMON_COLUMNS.

var COMMON_COLUMNS = ['id', 'createdBy', 'createdAt', 'updatedBy', 'updatedAt', 'deleted', 'deletedBy', 'deletedAt'];

var TABLES = {
  Users: ['loginId', 'name', 'role', 'salt', 'hash', 'mustChangePassword', 'active'],
  Settings: ['key', 'value'],
  Rooms: ['name', 'isLab', 'note'],
  Cabinets: ['roomId', 'name', 'type', 'locked', 'rows', 'cols', 'note'],
  Zones: ['cabinetId', 'row', 'col', 'name', 'allowedClasses'],
};

var AUDIT_COLUMNS = ['id', 'at', 'userId', 'userName', 'table', 'recordId', 'action', 'before', 'after'];

var BOOLEAN_COLUMNS = ['deleted', 'locked', 'active', 'mustChangePassword', 'labOver100m2', 'isLab'];
var NUMBER_COLUMNS = ['rows', 'cols', 'row', 'col'];

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

function settingsUpdate(payload, user) {
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
    else dbCreate('Settings', { key: key, value: stored }, user, { skipAudit: true });
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
var API_VERSION = 2;
var OWNER_PROP = 'OWNER_SPREADSHEET_ID';

function systemActions() {
  return {
    'system.info': { auth: 'none', write: false, handler: systemInfo },
    'system.sheetUrl': { auth: 'admin', write: false, handler: systemSheetUrl },
  };
}

// Users rows, read without creating the sheet.
function usersSheetHasRows() {
  var sheet = SpreadsheetApp.getActive().getSheetByName('Users');
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

function systemInfo() {
  var copied = sheetOwnerState() === 'copied';
  return {
    name: 'LabKeeper',
    apiVersion: API_VERSION,
    needsSetup: !hasAnyUser(),
    copied: copied,
    schoolName: copied ? '' : settingsGet().schoolName,
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
  dbAudit(user, 'Users', row.id, 'passwordReset', null, null);
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
