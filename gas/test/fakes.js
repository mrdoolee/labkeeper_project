// In-memory stand-ins for the Google services the GAS code uses.
// Cell writes mimic how Google Sheets parses typed input, so tests catch
// values that the real sheet would turn into numbers, booleans or formulas.
import crypto from 'node:crypto'

function parseLikeSheets(value) {
  if (typeof value !== 'string') return value
  if (value.startsWith("'")) return value.slice(1)
  if (/^[=+\-@]/.test(value) && !/^[+-]?\d+(\.\d+)?$/.test(value)) return '#ERROR!'
  if (/^[+-]?\d+(\.\d+)?$/.test(value)) return Number(value)
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === 'true'
  return value
}

class FakeRange {
  constructor(sheet, row, col, numRows, numCols) {
    Object.assign(this, { sheet, row, col, numRows, numCols })
  }
  getValues() {
    const out = []
    for (let r = 0; r < this.numRows; r++) {
      const src = this.sheet.data[this.row - 1 + r] || []
      const line = []
      for (let c = 0; c < this.numCols; c++) {
        const v = src[this.col - 1 + c]
        line.push(v === undefined ? '' : v)
      }
      out.push(line)
    }
    return out
  }
  getValue() {
    return this.getValues()[0][0]
  }
  setValues(values) {
    this.sheet.writeCalls++
    values.forEach((line, r) => {
      line.forEach((v, c) => this.sheet.set(this.row + r, this.col + c, v))
    })
    return this
  }
  setValue(v) {
    this.sheet.writeCalls++
    this.sheet.set(this.row, this.col, v)
    return this
  }
  // Formatting is remembered per cell so tests can check header colours.
  setBackground(color) {
    for (let c = 0; c < this.numCols; c++) this.sheet.backgrounds[`${this.row},${this.col + c}`] = color
    return this
  }
  setFontColor() {
    return this
  }
  setFontWeight() {
    return this
  }
}

class FakeSheet {
  constructor(name) {
    this.name = name
    this.data = []
    this.writeCalls = 0
    // New Google sheets are 1000 rows × 26 columns; writing outside throws.
    this.maxRows = 1000
    this.maxColumns = 26
    this.frozenRows = 0
    this.tabColor = null
    this.backgrounds = {}
    this.spreadsheet = null
  }
  setName(name) {
    this.spreadsheet.renameSheet(this, name)
    return this
  }
  setTabColor(color) {
    this.tabColor = color
    return this
  }
  setFrozenRows(n) {
    this.frozenRows = n
    return this
  }
  getFrozenRows() {
    return this.frozenRows
  }
  getMaxRows() {
    return this.maxRows
  }
  getMaxColumns() {
    return this.maxColumns
  }
  insertRowsAfter(afterPosition, howMany) {
    this.maxRows += howMany
  }
  deleteRows(rowPosition, howMany) {
    if (howMany >= this.maxRows) throw new Error("You can't delete all the rows on the sheet.")
    // Sheets refuses to delete every row below the frozen ones.
    if (this.maxRows - howMany <= this.frozenRows) throw new Error('Sorry, it is not possible to delete all non-frozen rows.')
    this.data.splice(rowPosition - 1, howMany)
    this.maxRows -= howMany
  }
  insertColumnsAfter(afterPosition, howMany) {
    this.maxColumns += howMany
  }
  set(row, col, v) {
    if (row > this.maxRows || col > this.maxColumns) {
      throw new Error('The coordinates of the range are outside the dimensions of the sheet.')
    }
    while (this.data.length < row) this.data.push([])
    const line = this.data[row - 1]
    while (line.length < col) line.push('')
    line[col - 1] = parseLikeSheets(v)
  }
  getName() {
    return this.name
  }
  getLastRow() {
    return this.data.length
  }
  getLastColumn() {
    return this.data.reduce((m, line) => Math.max(m, line.length), 0)
  }
  getRange(row, col, numRows = 1, numCols = 1) {
    return new FakeRange(this, row, col, numRows, numCols)
  }
  getDataRange() {
    return new FakeRange(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn()))
  }
  appendRow(values) {
    this.writeCalls++
    const row = this.data.length + 1
    if (row > this.maxRows) this.maxRows = row // appendRow grows the sheet in Apps Script
    values.forEach((v, i) => this.set(row, i + 1, v))
    return this
  }
}

// options.realTime: follow the real clock (dev server) instead of a fixed
// test clock moved only by advanceTime().
export function createFakes(options = {}) {
  let offset = 0
  const start = Date.parse('2026-03-02T09:00:00Z')
  const clock = () => (options.realTime ? Date.now() : start) + offset
  const sheets = new Map()
  const cache = new Map()
  const lockCalls = { wait: 0, release: 0 }
  const properties = new Map()
  let activeUserEmail = ''
  let spreadsheetId = options.spreadsheetId ?? 'sheet-A'

  const spreadsheet = {
    getId: () => spreadsheetId,
    getUrl: () => `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    getSheetByName: (name) => sheets.get(name) || null,
    // Tab order is kept in `order`; index puts the new tab at that position.
    insertSheet: (name, index) => {
      if (sheets.has(name)) throw new Error(`A sheet with the name "${name}" already exists.`)
      const s = new FakeSheet(name)
      s.spreadsheet = spreadsheet
      sheets.set(name, s)
      if (index === undefined || index >= order.length) order.push(name)
      else order.splice(index, 0, name)
      return s
    },
    getSheets: () => order.map((n) => sheets.get(n)),
    deleteSheet: (sheet) => {
      sheets.delete(sheet.name)
      order.splice(order.indexOf(sheet.name), 1)
    },
    renameSheet: (sheet, name) => {
      if (sheets.has(name)) throw new Error(`A sheet with the name "${name}" already exists.`)
      sheets.delete(sheet.name)
      order[order.indexOf(sheet.name)] = name
      sheet.name = name
      sheets.set(name, sheet)
    },
  }
  const order = []

  const RealDate = Date
  class FakeDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(clock())
      else super(...args)
    }
    static now() {
      return clock()
    }
  }

  const globals = {
    Date: FakeDate,
    SpreadsheetApp: { getActive: () => spreadsheet, getActiveSpreadsheet: () => spreadsheet },
    Session: { getActiveUser: () => ({ getEmail: () => activeUserEmail }) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => (properties.has(key) ? properties.get(key) : null),
        setProperty(key, value) {
          properties.set(key, String(value))
          return this
        },
        deleteProperty(key) {
          properties.delete(key)
          return this
        },
      }),
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest(algorithm, value) {
        const input = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value.map((b) => b & 0xff))
        return Array.from(crypto.createHash(algorithm).update(input).digest()).map((b) => (b > 127 ? b - 256 : b))
      },
      getUuid: () => crypto.randomUUID(),
    },
    CacheService: {
      getScriptCache: () => ({
        get(key) {
          const hit = cache.get(key)
          if (!hit) return null
          if (hit.expires <= clock()) {
            cache.delete(key)
            return null
          }
          return hit.value
        },
        put(key, value, seconds = 600) {
          cache.set(key, { value: String(value), expires: clock() + seconds * 1000 })
        },
        remove(key) {
          cache.delete(key)
        },
      }),
    },
    LockService: {
      getScriptLock: () => ({
        waitLock() {
          lockCalls.wait++
        },
        releaseLock() {
          lockCalls.release++
        },
      }),
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput(content) {
        return {
          content,
          mimeType: null,
          setMimeType(m) {
            this.mimeType = m
            return this
          },
          getContent() {
            return this.content
          },
        }
      },
    },
  }

  return {
    globals,
    sheets,
    // Tab names in order, as the spreadsheet shows them.
    tabOrder: () => order.slice(),
    lockCalls,
    properties,
    // The Google account running a sheet-menu item ('' when Google hides it).
    setActiveUserEmail(email) {
      activeUserEmail = email
    },
    // Simulates "File → Make a copy": same script and data, new spreadsheet id.
    setSpreadsheetId(id) {
      spreadsheetId = id
    },
    advanceTime(seconds) {
      offset += seconds * 1000
    },
  }
}
