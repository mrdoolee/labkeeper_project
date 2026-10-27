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

// Newest first. Account history also shows logins (kept in 접속 기록).
function auditList(payload) {
  var limit = Math.min(Math.max(Number(payload.limit) || 100, 1), 1000);
  var groups;
  if (!payload.table) groups = Object.keys(HISTORY_TABS);
  else if (payload.table === 'Users') groups = ['users', 'access'];
  else groups = [historyGroupFor(payload.table, '')];
  // A reagent's history also shows changes to its in/out records.
  var txIds = payload.table === 'Reagents' && payload.recordId ? reagentTxIds(payload.recordId) : null;
  return historyEntries(groups)
    .filter(function (a) {
      if (txIds && a.table === 'ReagentTx') return txIds[a.recordId] === true;
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

// Ids of all the reagent's in/out records, deleted ones included.
function reagentTxIds(reagentId) {
  var ids = {};
  dbList('ReagentTx', { where: { reagentId: reagentId }, includeDeleted: true }).forEach(function (t) {
    ids[t.id] = true;
  });
  return ids;
}
