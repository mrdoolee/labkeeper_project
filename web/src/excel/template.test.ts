// @vitest-environment node
import ExcelJS from 'exceljs'
import { expect, test } from 'vitest'
import { IMPORT_COLUMNS, cellToDate, parseImport } from '../domain/reagentImport'
import { buildTemplate, readWorkbook } from './template'

const place = { zoneId: 'z1', cabinetId: 'c1', label: '제1과학실 › A 시약장 › 진한 산' }

test('the template reads back: headers, example row, and drop-down lists', async () => {
  const blob = await buildTemplate([place])
  const rows = await readWorkbook(new File([blob], 'a.xlsx'))
  expect(rows[0]).toEqual(IMPORT_COLUMNS.map((c) => c.header))
  expect(String(rows[1][0])).toMatch(/^예시/)

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await blob.arrayBuffer())
  const input = wb.getWorksheet('입력')!
  const unitCol = IMPORT_COLUMNS.findIndex((c) => c.key === 'unit') + 1
  const placeCol = IMPORT_COLUMNS.findIndex((c) => c.key === 'zoneId') + 1
  expect(input.getCell(3, unitCol).dataValidation.formulae).toEqual(['"mL,g"'])
  expect(input.getCell(3, placeCol).dataValidation.formulae).toEqual(["'위치목록'!$A$1:$A$1"])
  expect(wb.getWorksheet('위치목록')!.getCell(1, 1).value).toBe(place.label)
  expect(wb.getWorksheet('안내')!.getCell(2, 1).value).toBe('약품명')
})

test('dates typed as real Excel dates come back as the same day', async () => {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('입력')
  ws.addRow(IMPORT_COLUMNS.map((c) => c.header))
  const values: unknown[] = IMPORT_COLUMNS.map(() => null)
  values[0] = '붕산'
  values[IMPORT_COLUMNS.findIndex((c) => c.key === 'unit')] = 'g'
  values[IMPORT_COLUMNS.findIndex((c) => c.key === 'initialAmount')] = 100
  values[IMPORT_COLUMNS.findIndex((c) => c.key === 'initialDate')] = new Date(Date.UTC(2026, 2, 1))
  values[IMPORT_COLUMNS.findIndex((c) => c.key === 'expiryDate')] = new Date(Date.UTC(2028, 1, 29))
  ws.addRow(values)
  const buffer = await wb.xlsx.writeBuffer()
  const rows = await readWorkbook(new File([buffer], 'b.xlsx'))
  const [parsed] = parseImport(rows, { places: new Map(), existingKeys: new Set(), defaultDate: '2026-10-01', today: '2026-10-27' })
  expect(parsed).toMatchObject({ status: 'ok', initialDate: '2026-03-01', values: { expiryDate: '2028-02-29' } })
  expect(cellToDate(rows[1][IMPORT_COLUMNS.findIndex((c) => c.key === 'initialDate')])).toBe('2026-03-01')
})

test('a concentration typed as 35% in Excel (stored 0.35 with a % format) reads as 35', async () => {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('입력')
  ws.addRow(IMPORT_COLUMNS.map((c) => c.header))
  const values: unknown[] = IMPORT_COLUMNS.map(() => null)
  values[0] = '염화 수소(염산)'
  values[IMPORT_COLUMNS.findIndex((c) => c.key === 'casNo')] = '7647-01-0'
  values[IMPORT_COLUMNS.findIndex((c) => c.key === 'unit')] = 'mL'
  values[IMPORT_COLUMNS.findIndex((c) => c.key === 'initialAmount')] = 500
  ws.addRow(values)
  const conc = ws.getCell(2, IMPORT_COLUMNS.findIndex((c) => c.key === 'concentration') + 1)
  conc.value = 0.35
  conc.numFmt = '0%'
  const rows = await readWorkbook(new File([await wb.xlsx.writeBuffer()], 'c.xlsx'))
  const [parsed] = parseImport(rows, { places: new Map(), existingKeys: new Set(), defaultDate: '2026-03-01', today: '2026-10-27' })
  expect(parsed.values).toMatchObject({ concentration: 35, toxic: '해당', accidentPrep: '해당' })
})

test('the template keeps the concentration column as text so 35% is not turned into 0.35', async () => {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await (await buildTemplate([])).arrayBuffer())
  const col = IMPORT_COLUMNS.findIndex((c) => c.key === 'concentration') + 1
  expect(wb.getWorksheet('입력')!.getCell(3, col).numFmt).toBe('@')
})
