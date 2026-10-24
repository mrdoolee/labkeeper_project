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
