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
