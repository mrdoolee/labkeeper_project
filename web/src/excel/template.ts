// 엑셀 양식 만들기와 읽기 (ExcelJS). Loaded only on the import page: import('../excel/template').
import ExcelJS from 'exceljs'
import type { Place } from '../domain/location'
import { IMPORT_COLUMNS } from '../domain/reagentImport'

const INPUT_ROWS = 500

const EXAMPLE: Record<string, string | number> = {
  name: '예시 – 염화 수소(염산) (이 줄은 등록되지 않습니다)',
  concentration: 35,
  formula: 'HCl',
  casNo: '7647-01-0',
  grade: '시약용',
  unit: 'mL',
  initialAmount: 500,
  initialDate: '2026-03-01',
  mainUse: '실험용',
  expiryDate: '2028-03-01',
  supplier: '○○과학',
  poison: '예',
}

/** 입력 sheet (with drop-downs), 안내 sheet, and a hidden list of this school's places. */
export async function buildTemplate(places: Place[]): Promise<Blob> {
  const wb = new ExcelJS.Workbook()
  const input = wb.addWorksheet('입력', { views: [{ state: 'frozen', ySplit: 1 }] })
  const guide = wb.addWorksheet('안내')
  const list = wb.addWorksheet('위치목록', { state: 'hidden' })

  places.forEach((p, i) => (list.getCell(i + 1, 1).value = p.label))

  input.columns = IMPORT_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.key === 'zoneId' ? 36 : c.key === 'name' ? 28 : 14 }))
  input.getRow(1).font = { bold: true }
  input.addRow(IMPORT_COLUMNS.map((c) => EXAMPLE[c.key] ?? ''))
  input.getRow(2).font = { italic: true, color: { argb: 'FF64748B' } }

  // Text, so a typed "35%" stays "35%" instead of becoming 0.35.
  const concentrationCol = IMPORT_COLUMNS.findIndex((c) => c.key === 'concentration') + 1
  for (let r = 2; r <= INPUT_ROWS + 1; r++) input.getCell(r, concentrationCol).numFmt = '@'

  IMPORT_COLUMNS.forEach((c, i) => {
    const formulae = c.key === 'zoneId' ? (places.length ? [`'위치목록'!$A$1:$A$${places.length}`] : null) : c.choices ? [`"${c.choices.join(',')}"`] : null
    if (!formulae) return
    for (let r = 2; r <= INPUT_ROWS + 1; r++) {
      input.getCell(r, i + 1).dataValidation = { type: 'list', allowBlank: true, formulae, showErrorMessage: true, errorTitle: c.header, error: '목록에서 골라 주세요.' }
    }
  })

  guide.columns = [
    { header: '열', key: 'header', width: 16 },
    { header: '필수', key: 'required', width: 8 },
    { header: '설명', key: 'help', width: 90 },
  ]
  guide.getRow(1).font = { bold: true }
  IMPORT_COLUMNS.forEach((c) => guide.addRow({ header: c.header.replace(' *', ''), required: c.required ? '필수' : '', help: c.help }))
  guide.addRow({})
  guide.addRow({ header: '참고', help: '날짜는 2026-03-01 형식으로 적습니다. 같은 약품·같은 농도는 한 줄만 적습니다(여러 병이면 양을 합칩니다).' })
  guide.addRow({ help: '이미 등록된 시약과 같은 줄은 건너뜁니다. 2번째 줄(예시)은 등록되지 않습니다.' })

  const buffer = await wb.xlsx.writeBuffer()
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

/** Values of the 입력 sheet (or the first sheet), row by row, starting with the header row. */
export async function readWorkbook(file: File): Promise<unknown[][]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await file.arrayBuffer())
  const ws = wb.getWorksheet('입력') ?? wb.worksheets[0]
  if (!ws) return []
  const rows: unknown[][] = []
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const values: unknown[] = []
    for (let c = 1; c <= row.cellCount; c++) {
      const cell = row.getCell(c)
      // A percent-formatted number (typed "35%") is stored as 0.35.
      values.push(typeof cell.value === 'number' && String(cell.numFmt ?? '').includes('%') ? Math.round(cell.value * 1e8) / 1e6 : cell.value)
    }
    rows.push(values)
  }
  return rows
}
