// Table storage on top of one spreadsheet: one tab per table, row 1 is the
// header. Tabs and headers are Korean (Schema.js); columns are always found by
// header, so people can reorder columns or add their own without breaking
// anything. Deletes are soft, and every change goes to an 이력 tab.

// ---- time ----

// Korean time as ISO text, e.g. 2026-10-24T14:20:00+09:00: readable in the sheet,
// and Date() in the browser reads it correctly.
function nowIso() {
  return kstIso(new Date());
}

function kstParts(date) {
  var d = new Date(date.getTime() + 9 * 3600 * 1000);
  var pad = function (n) {
    return (n < 10 ? '0' : '') + n;
  };
  return {
    date: d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()),
    time: pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()),
    seconds: pad(d.getUTCSeconds()),
  };
}

function kstIso(date) {
  var p = kstParts(date);
  return p.date + 'T' + p.time + ':' + p.seconds + '+09:00';
}

// "2026-10-24 14:20" for the 일시 column; old UTC values are converted too.
function kstText(iso) {
  var d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso || '');
  var p = kstParts(d);
  return p.date + ' ' + p.time;
}

// ---- tabs ----

var layoutChecked = false;

// Opens (or creates) a tab and makes sure every expected column has a header.
// Returns { sheet, header } where header[i] is the column key of column i+1
// (null for a column a person added).
function openTab(name, columns, labelOf, keyOf, kind) {
  ensureLayout();
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(name) || createTab(ss, name, kind);
  var labels = sheet.getLastRow() === 0 ? [] : sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  var header = labels.map(keyOf);
  var missing = columns.filter(function (c) {
    return header.indexOf(c) < 0;
  });
  if (missing.length) {
    var extraColumns = header.length + missing.length - sheet.getMaxColumns();
    if (extraColumns > 0) sheet.insertColumnsAfter(sheet.getMaxColumns(), extraColumns);
    sheet.getRange(1, header.length + 1, 1, missing.length).setValues([missing.map(function (c) {
      return toCell(labelOf(c));
    })]);
    sheet.getRange(1, header.length + 1, 1, missing.length).setFontWeight('bold');
    if (kind === 'history') {
      missing.forEach(function (c, i) {
        if (HISTORY_COLUMNS.indexOf(c) >= HISTORY_COLUMNS.indexOf(HISTORY_RAW_FROM)) {
          sheet.getRange(1, header.length + 1 + i).setBackground(RAW_HEADER_BACKGROUND);
        }
      });
    }
    header = header.concat(missing);
  }
  return { sheet: sheet, header: header };
}

// Data tabs go before the history tabs; colours tell the two apart.
function createTab(ss, name, kind) {
  var sheet;
  if (kind === 'data') {
    var dataNames = Object.keys(SHEET_NAMES).map(function (k) {
      return SHEET_NAMES[k];
    });
    var position = ss.getSheets().filter(function (s) {
      return dataNames.indexOf(s.getName()) >= 0;
    }).length;
    sheet = ss.insertSheet(name, position);
  } else {
    sheet = ss.insertSheet(name);
  }
  sheet.setTabColor(TAB_COLORS[kind]);
  sheet.setFrozenRows(1);
  return sheet;
}

function openTable(table) {
  return openTab(
    SHEET_NAMES[table] || table,
    columnsOf(table),
    function (c) {
      return COLUMN_LABELS[c];
    },
    function (label) {
      return keyForLabel(table, label);
    },
    'data',
  );
}

function openHistory(group) {
  return openTab(
    HISTORY_TABS[group],
    HISTORY_COLUMNS,
    function (c) {
      return HISTORY_LABELS[c];
    },
    historyKeyForLabel,
    'history',
  );
}

// ---- cells ----

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
      if (column) obj[column] = line[c];
    });
    if (obj.id === '' || obj.id === null || obj.id === undefined) return;
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

// ---- records ----

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
        return column ? toCell(obj[column] === undefined ? '' : obj[column]) : '';
      });
    }),
  );
}

// options.skipAudit: the caller writes its own history entry (Settings does,
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
    row.createdByName = user.name;
    row.createdAt = now;
    row.updatedBy = user.id;
    row.updatedByName = user.name;
    row.updatedAt = now;
    row.deleted = false;
    row.deletedBy = '';
    row.deletedByName = '';
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

function recordLabel(row) {
  return row ? row.name || row.loginId || '' : '';
}

function dbUpdate(table, id, changes, user, options) {
  checkColumns(table, changes);
  var fields = Object.assign({}, changes, { updatedBy: user.id, updatedByName: user.name, updatedAt: nowIso() });
  var result = writeFields(table, id, fields);
  var before = {};
  var after = {};
  Object.keys(changes).forEach(function (key) {
    if (result.before[key] !== result.after[key]) {
      before[key] = result.before[key];
      after[key] = result.after[key];
    }
  });
  if (!(options && options.skipAudit)) dbAudit(user, table, id, 'update', before, after, recordLabel(result.after));
  return result.after;
}

function dbSoftDelete(table, id, user) {
  var now = nowIso();
  var result = writeFields(table, id, {
    deleted: true,
    deletedBy: user.id,
    deletedByName: user.name,
    deletedAt: now,
    updatedBy: user.id,
    updatedByName: user.name,
    updatedAt: now,
  });
  dbAudit(user, table, id, 'delete', result.before, null);
  return result.after;
}

function dbRestore(table, id, user) {
  var result = writeFields(table, id, {
    deleted: false,
    deletedBy: '',
    deletedByName: '',
    deletedAt: '',
    updatedBy: user.id,
    updatedByName: user.name,
    updatedAt: nowIso(),
  });
  dbAudit(user, table, id, 'restore', null, result.after);
  return result.after;
}

// ---- history ----

function withoutSecrets(values) {
  if (!values) return values;
  var copy = {};
  Object.keys(values).forEach(function (key) {
    if (SECRET_COLUMNS.indexOf(key) < 0) copy[key] = values[key];
  });
  return copy;
}

function showValue(value) {
  if (value === true) return '예';
  if (value === false) return '아니요';
  if (value === null || value === undefined || value === '') return '(없음)';
  return String(value);
}

function fieldLabel(table, key) {
  if (table === 'Settings') return SETTING_LABELS[key] || key;
  return COLUMN_LABELS[key] || key;
}

// The 바뀐 내용 sentence: "이름: A → B" for updates, the filled-in fields for adds.
function historySummary(table, action, before, after) {
  if (action === 'update' && after) {
    return Object.keys(after)
      .map(function (key) {
        return fieldLabel(table, key) + ': ' + showValue(before ? before[key] : null) + ' → ' + showValue(after[key]);
      })
      .join(', ');
  }
  if (action === 'create' && after) {
    var own = TABLE_LAYOUT[table] ? TABLE_LAYOUT[table][0] : Object.keys(after);
    return own
      .filter(function (key) {
        return after[key] !== undefined && after[key] !== null && after[key] !== '';
      })
      .map(function (key) {
        return fieldLabel(table, key) + ': ' + showValue(after[key]);
      })
      .join(', ');
  }
  if (after && after.note) return String(after.note);
  return '';
}

// Name of what the entry is about, for the 대상 column.
function historyTarget(table, recordId, before, after, label) {
  if (label) return label;
  if (table === 'Settings') return SETTING_LABELS[recordId] || recordId;
  if (table === 'System') return '시트';
  var named = recordLabel(after) || recordLabel(before);
  if (named) return named;
  try {
    return recordLabel(TABLES[table] ? dbGet(table, recordId) : null);
  } catch (err) {
    return '';
  }
}

// One history line; before/after are objects (or null), at is ISO text.
function historyRow(entry) {
  var before = withoutSecrets(entry.before);
  var after = withoutSecrets(entry.after);
  return {
    when: kstText(entry.at),
    userName: entry.userName,
    tableLabel: TABLE_LABELS[entry.table] || entry.table,
    target: historyTarget(entry.table, entry.recordId, before, after, entry.label),
    actionLabel: ACTION_LABELS[entry.action] || entry.action,
    summary: historySummary(entry.table, entry.action, before, after),
    id: entry.id,
    at: entry.at,
    userId: entry.userId,
    table: entry.table,
    recordId: entry.recordId,
    action: entry.action,
    before: before ? JSON.stringify(before) : '',
    after: after ? JSON.stringify(after) : '',
  };
}

function appendHistory(entries) {
  var byGroup = {};
  entries.forEach(function (entry) {
    var group = historyGroupFor(entry.table, entry.action);
    (byGroup[group] = byGroup[group] || []).push(historyRow(entry));
  });
  Object.keys(byGroup).forEach(function (group) {
    appendObjects(openHistory(group), byGroup[group]);
  });
}

// label (optional) names the record when before/after do not carry its name.
function dbAudit(user, table, recordId, action, before, after, label) {
  dbAuditMany(user, table, [{ recordId: recordId, action: action, before: before, after: after, label: label }]);
}

function dbAuditMany(user, table, items) {
  var at = nowIso();
  appendHistory(
    items.map(function (item) {
      return {
        id: Utilities.getUuid(),
        at: at,
        userId: user ? user.id : '',
        userName: user ? user.name : '',
        table: table,
        recordId: item.recordId,
        action: item.action,
        before: item.before,
        after: item.after,
        label: item.label,
      };
    }),
  );
}

// History lines of the given groups as plain objects, oldest first.
function historyEntries(groups) {
  var ss = SpreadsheetApp.getActive();
  var out = [];
  groups.forEach(function (group) {
    if (!ss.getSheetByName(HISTORY_TABS[group])) return;
    readRows(openHistory(group)).forEach(function (r) {
      var e = {};
      HISTORY_COLUMNS.forEach(function (c) {
        e[c] = r.record[c] === undefined || r.record[c] === null ? '' : String(r.record[c]);
      });
      out.push(e);
    });
  });
  return out
    .map(function (e, i) {
      return { e: e, i: i };
    })
    .sort(function (a, b) {
      return Date.parse(a.e.at) - Date.parse(b.e.at) || a.i - b.i;
    })
    .map(function (x) {
      return x.e;
    });
}

// ---- moving an old (English) sheet to this layout ----

var LAYOUT_PROP = 'SHEET_LAYOUT';
var LAYOUT_VERSION = '2';

// Runs once per execution. A sheet made before the Korean layout gets its
// tabs renamed, headers translated, name columns filled and AuditLog moved
// into the 이력 tabs.
function ensureLayout() {
  if (layoutChecked) return;
  layoutChecked = true;
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(LAYOUT_PROP) === LAYOUT_VERSION) return;
  var ss = SpreadsheetApp.getActive();
  var legacy =
    !!ss.getSheetByName('AuditLog') ||
    Object.keys(SHEET_NAMES).some(function (k) {
      return !!ss.getSheetByName(k);
    });
  if (legacy) {
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      migrateLegacyLayout(ss);
    } finally {
      lock.releaseLock();
    }
  }
  props.setProperty(LAYOUT_PROP, LAYOUT_VERSION);
}

// Old history values are JSON; a line someone edited by hand must not stop the move.
function parseOldJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    return null;
  }
}

function migrateLegacyLayout(ss) {
  Object.keys(SHEET_NAMES).forEach(function (table) {
    var old = ss.getSheetByName(table);
    if (!old || ss.getSheetByName(SHEET_NAMES[table])) return;
    if (old.getLastColumn() > 0) {
      var labels = old
        .getRange(1, 1, 1, old.getLastColumn())
        .getValues()[0]
        .map(function (h) {
          var key = keyForLabel(table, String(h));
          return toCell(key ? COLUMN_LABELS[key] : String(h));
        });
      old.getRange(1, 1, 1, labels.length).setValues([labels]).setFontWeight('bold');
    }
    old.setName(SHEET_NAMES[table]);
    old.setTabColor(TAB_COLORS.data);
    old.setFrozenRows(1);
  });

  // Fill the new name columns from the account list.
  var names = {};
  names[SYSTEM_USER.id] = SYSTEM_USER.name;
  names[SHEET_OWNER.id] = SHEET_OWNER.name;
  if (ss.getSheetByName(SHEET_NAMES.Users)) {
    readRows(openTable('Users')).forEach(function (r) {
      names[String(r.record.id)] = String(r.record.name);
    });
  }
  Object.keys(SHEET_NAMES).forEach(function (table) {
    if (!ss.getSheetByName(SHEET_NAMES[table])) return;
    var t = openTable(table);
    var rows = readRows(t);
    ['createdBy', 'updatedBy', 'deletedBy'].forEach(function (idColumn) {
      var nameColumn = idColumn + 'Name';
      var col = t.header.indexOf(nameColumn) + 1;
      rows.forEach(function (r) {
        var id = String(r.record[idColumn] || '');
        if (id && !r.record[nameColumn]) t.sheet.getRange(r.rowNumber, col).setValue(toCell(names[id] || id));
      });
    });
  });

  // AuditLog → the 이력 tabs.
  var log = ss.getSheetByName('AuditLog');
  if (log) {
    if (log.getLastRow() > 1) {
      var head = log.getRange(1, 1, 1, log.getLastColumn()).getValues()[0].map(String);
      var lines = log.getRange(2, 1, log.getLastRow() - 1, head.length).getValues();
      appendHistory(
        lines
          .map(function (line) {
            var e = {};
            head.forEach(function (h, i) {
              e[h] = line[i] === null || line[i] === undefined ? '' : String(line[i]);
            });
            return e;
          })
          .filter(function (e) {
            return e.id;
          })
          .map(function (e) {
            return {
              id: e.id,
              at: e.at,
              userId: e.userId,
              userName: e.userName,
              table: e.table,
              recordId: e.recordId,
              action: e.action,
              before: parseOldJson(e.before),
              after: parseOldJson(e.after),
            };
          }),
      );
    }
    ss.deleteSheet(log);
  }
}
