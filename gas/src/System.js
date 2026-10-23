// App identity, version and copy detection.

// Raise together with REQUIRED_API_VERSION in web/src/api/system.ts whenever
// the web app starts using a new action. Each school redeploys its own copy
// of this code, so the web app checks this number.
var API_VERSION = 2;
var OWNER_PROP = 'OWNER_SPREADSHEET_ID';

function systemActions() {
  return {
    'system.info': { auth: 'none', write: false, handler: systemInfo },
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
