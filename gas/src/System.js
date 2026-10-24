// App identity, version and copy detection.

// Raise together with REQUIRED_API_VERSION in web/src/api/system.ts whenever
// the web app starts using a new action. Each school redeploys its own copy
// of this code, so the web app checks this number.
var API_VERSION = 3;
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
