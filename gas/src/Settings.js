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
