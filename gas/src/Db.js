// Table storage on top of one spreadsheet: one sheet per table, row 1 is the
// header. Columns are always located by header name, so people can reorder
// columns or add their own in the sheet without breaking anything.
// Deletes are soft, and every change is written to AuditLog.

function columnsOf(table) {
  if (table === 'AuditLog') return AUDIT_COLUMNS;
  if (!TABLES[table]) throw apiError('INVALID', '알 수 없는 표입니다: ' + table);
  return ['id'].concat(TABLES[table], COMMON_COLUMNS.slice(1));
}

// Returns { sheet, header } and makes sure every expected column has a header.
function openTable(table) {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(table) || ss.insertSheet(table);
  var expected = columnsOf(table);
  var header = sheet.getLastRow() === 0 ? [] : sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  var missing = expected.filter(function (c) {
    return header.indexOf(c) < 0;
  });
  if (missing.length) {
    var extraColumns = header.length + missing.length - sheet.getMaxColumns();
    if (extraColumns > 0) sheet.insertColumnsAfter(sheet.getMaxColumns(), extraColumns);
    sheet.getRange(1, header.length + 1, 1, missing.length).setValues([missing.map(toCell)]);
    header = header.concat(missing);
  }
  return { sheet: sheet, header: header };
}

// Strings always get a leading apostrophe so Sheets keeps them as text
// (no formulas from "=...", no numbers from "0123").
function toCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value === '' ? '' : "'" + value;
  return value;
}

function fromCell(column, value) {
  if (BOOLEAN_COLUMNS.indexOf(column) >= 0) return value === true || String(value).toLowerCase() === 'true';
  if (NUMBER_COLUMNS.indexOf(column) >= 0) return value === '' || value === null ? null : Number(value);
  return value === null || value === undefined ? '' : String(value);
}

function readRows(t) {
  var last = t.sheet.getLastRow();
  if (last < 2) return [];
  var values = t.sheet.getRange(2, 1, last - 1, t.header.length).getValues();
  var rows = [];
  values.forEach(function (line, i) {
    var obj = {};
    t.header.forEach(function (column, c) {
      obj[column] = line[c];
    });
    if (obj.id === '' || obj.id === null) return;
    rows.push({ rowNumber: i + 2, record: obj });
  });
  return rows;
}

function typed(table, raw) {
  var out = {};
  columnsOf(table).forEach(function (column) {
    out[column] = fromCell(column, raw[column] === undefined ? '' : raw[column]);
  });
  return out;
}

function checkColumns(table, values) {
  var allowed = TABLES[table];
  Object.keys(values).forEach(function (key) {
    if (allowed.indexOf(key) < 0) throw apiError('INVALID', '알 수 없는 항목입니다: ' + key);
  });
}

function nowIso() {
  return new Date().toISOString();
}

function dbList(table, options) {
  options = options || {};
  var where = options.where || {};
  return readRows(openTable(table))
    .map(function (r) {
      return typed(table, r.record);
    })
    .filter(function (row) {
      if (!options.includeDeleted && row.deleted) return false;
      return Object.keys(where).every(function (key) {
        return row[key] === where[key];
      });
    });
}

function findRow(t, id) {
  var rows = readRows(t);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].record.id) === String(id)) return rows[i];
  }
  return null;
}

function dbGet(table, id) {
  var found = findRow(openTable(table), id);
  return found ? typed(table, found.record) : null;
}

// Appends objects as rows in one sheet write (Apps Script is slow per call).
function appendObjects(t, objects) {
  if (!objects.length) return;
  var start = Math.max(t.sheet.getLastRow(), 1) + 1;
  // setValues does not grow the sheet (a new sheet has 1000 rows), so add rows first.
  var extraRows = start + objects.length - 1 - t.sheet.getMaxRows();
  if (extraRows > 0) t.sheet.insertRowsAfter(t.sheet.getMaxRows(), extraRows);
  t.sheet.getRange(start, 1, objects.length, t.header.length).setValues(
    objects.map(function (obj) {
      return t.header.map(function (column) {
        return toCell(obj[column] === undefined ? '' : obj[column]);
      });
    }),
  );
}

// options.skipAudit: the caller writes its own audit entry (Settings does,
// so its history is keyed by setting name).
function dbCreate(table, values, user, options) {
  return dbCreateMany(table, [values], user, options)[0];
}

function dbCreateMany(table, valuesList, user, options) {
  valuesList.forEach(function (values) {
    checkColumns(table, values);
  });
  var t = openTable(table);
  var now = nowIso();
  var rows = valuesList.map(function (values) {
    var row = {};
    columnsOf(table).forEach(function (column) {
      row[column] = values[column] === undefined ? '' : values[column];
    });
    row.id = Utilities.getUuid();
    row.createdBy = user.id;
    row.createdAt = now;
    row.updatedBy = user.id;
    row.updatedAt = now;
    row.deleted = false;
    row.deletedBy = '';
    row.deletedAt = '';
    return row;
  });
  appendObjects(t, rows);
  var created = rows.map(function (row) {
    return typed(table, row);
  });
  if (!(options && options.skipAudit)) {
    dbAuditMany(
      user,
      table,
      created.map(function (row) {
        return { recordId: row.id, action: 'create', before: null, after: row };
      }),
    );
  }
  return created;
}

// Writes the given columns of one row and returns the typed row before and after.
function writeFields(table, id, fields) {
  var t = openTable(table);
  var found = findRow(t, id);
  if (!found) throw apiError('NOT_FOUND', '해당 기록을 찾을 수 없습니다.');
  var before = typed(table, found.record);
  Object.keys(fields).forEach(function (column) {
    t.sheet.getRange(found.rowNumber, t.header.indexOf(column) + 1).setValue(toCell(fields[column]));
    found.record[column] = fields[column];
  });
  return { before: before, after: typed(table, found.record) };
}

function dbUpdate(table, id, changes, user, options) {
  checkColumns(table, changes);
  var fields = Object.assign({}, changes, { updatedBy: user.id, updatedAt: nowIso() });
  var result = writeFields(table, id, fields);
  var before = {};
  var after = {};
  Object.keys(changes).forEach(function (key) {
    if (result.before[key] !== result.after[key]) {
      before[key] = result.before[key];
      after[key] = result.after[key];
    }
  });
  if (!(options && options.skipAudit)) dbAudit(user, table, id, 'update', before, after);
  return result.after;
}

function dbSoftDelete(table, id, user) {
  var now = nowIso();
  var result = writeFields(table, id, { deleted: true, deletedBy: user.id, deletedAt: now, updatedBy: user.id, updatedAt: now });
  dbAudit(user, table, id, 'delete', null, null);
  return result.after;
}

function dbRestore(table, id, user) {
  var result = writeFields(table, id, { deleted: false, deletedBy: '', deletedAt: '', updatedBy: user.id, updatedAt: nowIso() });
  dbAudit(user, table, id, 'restore', null, null);
  return result.after;
}

function withoutSecrets(values) {
  if (!values) return values;
  var copy = {};
  Object.keys(values).forEach(function (key) {
    if (SECRET_COLUMNS.indexOf(key) < 0) copy[key] = values[key];
  });
  return copy;
}

function dbAudit(user, table, recordId, action, before, after) {
  dbAuditMany(user, table, [{ recordId: recordId, action: action, before: before, after: after }]);
}

function dbAuditMany(user, table, items) {
  var at = nowIso();
  appendObjects(
    openTable('AuditLog'),
    items.map(function (item) {
      return {
        id: Utilities.getUuid(),
        at: at,
        userId: user ? user.id : '',
        userName: user ? user.name : '',
        table: table,
        recordId: item.recordId,
        action: item.action,
        before: item.before ? JSON.stringify(withoutSecrets(item.before)) : '',
        after: item.after ? JSON.stringify(withoutSecrets(item.after)) : '',
      };
    }),
  );
}
