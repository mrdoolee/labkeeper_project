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
