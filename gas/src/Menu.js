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
