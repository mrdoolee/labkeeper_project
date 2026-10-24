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
    dbAudit(actor, 'Users', row.id, 'passwordReset', null, null);
    CacheService.getScriptCache().remove('fail:' + row.loginId);
    return { tempPassword: password };
  });
}

// Deletes every data row of every table and the history; headers stay.
function clearAllRows() {
  var ss = SpreadsheetApp.getActive();
  Object.keys(TABLES)
    .concat(['AuditLog'])
    .forEach(function (name) {
      var sheet = ss.getSheetByName(name);
      if (sheet && sheet.getLastRow() > 1) sheet.deleteRows(2, sheet.getLastRow() - 1);
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
    'google.script.run.withSuccessHandler(function(){m.style.color="#15803d";m.textContent="저장했습니다. 변경 기록은 AuditLog 탭에 남습니다.";})' +
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
