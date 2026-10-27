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
