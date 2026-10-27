// 엑셀 일괄 등록: 양식의 열과 줄 검사 (설계 M2 8-5).
import type { ReagentInput } from '../api/reagents'
import { isValidCas, judgeHazard } from './hazard'
import type { Place } from './location'

type ColumnKey = keyof ReagentInput | 'initialAmount' | 'initialDate'

export interface ImportColumn {
  key: ColumnKey
  header: string
  required: boolean
  choices?: string[]
  help: string
}

const YES_NO = ['예', '아니오']

export const IMPORT_COLUMNS: ImportColumn[] = [
  { key: 'name', header: '약품명 *', required: true, help: '예: 염화 수소(염산). 같은 약품·같은 농도는 한 줄만 적습니다.' },
  { key: 'concentration', header: '농도(%)', required: false, help: '% 숫자만 (예: 35). 고체 등 순물질은 비워 둡니다. 몰농도(M)는 %로 바꾸거나 비워 두고 앱에서 판정을 직접 고릅니다.' },
  { key: 'formula', header: '화학식', required: false, help: '예: HCl' },
  { key: 'casNo', header: 'CAS No.', required: false, help: '예: 7647-01-0. 유독물질·사고대비물질 자동 판정에 씁니다.' },
  { key: 'grade', header: '규격', required: false, choices: ['시약용', '공업용'], help: '목록에서 고릅니다(서울 양식).' },
  { key: 'unit', header: '단위 *', required: true, choices: ['mL', 'g'], help: '액체는 mL, 고체는 g' },
  { key: 'initialAmount', header: '기초 재고량 *', required: true, help: '기준일에 있던 양(단위에 맞춘 숫자). 대장의 첫 줄이 됩니다.' },
  { key: 'initialDate', header: '기준일', required: false, help: '2026-03-01 형식. 비우면 올리기 화면에서 정한 날짜를 씁니다.' },
  { key: 'mainUse', header: '주용도', required: false, help: '비우면 "실험용"' },
  { key: 'expiryDate', header: '유효기간', required: false, help: '날짜 (예: 2028-03-01)' },
  { key: 'purchaseDate', header: '구입일', required: false, help: '날짜' },
  { key: 'openedDate', header: '개봉일', required: false, help: '날짜' },
  { key: 'maker', header: '제조사', required: false, help: '' },
  { key: 'supplier', header: '구입처', required: false, help: '입고 기록의 구입처 기본값' },
  { key: 'zoneId', header: '보관 위치', required: false, help: '목록에서 고릅니다(교실 › 보관장 › 구역). 비워 두고 나중에 앱에서 정해도 됩니다.' },
  { key: 'poison', header: '독극물', required: false, choices: YES_NO, help: '서울 양식 "독극물" 칸' },
  { key: 'banned', header: '금지물질', required: false, choices: YES_NO, help: '충북 양식 머리의 ○ 칸' },
  { key: 'permitted', header: '허가물질', required: false, choices: YES_NO, help: '충북 양식 머리의 ○ 칸' },
  { key: 'restricted', header: '제한물질', required: false, choices: YES_NO, help: '충북 양식 머리의 ○ 칸' },
  { key: 'note', header: '비고', required: false, help: '' },
]

export interface ParsedRow {
  line: number
  status: 'ok' | 'error' | 'skip'
  errors: string[]
  values?: Partial<ReagentInput>
  initialAmount?: number
  initialDate?: string
}

/** Same rule as reagentKey in gas/src/Reagents.js. */
export function duplicateKey(name: string, concentration: number | null): string {
  return `${name.replace(/\s+/g, '').toLowerCase()}|${concentration === null ? '' : String(concentration)}`
}

function isoFromUtc(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function validIso(y: number, m: number, d: number): string | null {
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? isoFromUtc(date) : null
}

/** Excel date cell → YYYY-MM-DD. ExcelJS gives dates as UTC midnight; numbers are Excel serial days. */
export function cellToDate(v: unknown): string | null {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : isoFromUtc(v)
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? isoFromUtc(new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000)) : null
  if (typeof v === 'string') {
    const m = /^\s*(\d{4})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})\.?\s*$/.exec(v)
    return m ? validIso(Number(m[1]), Number(m[2]), Number(m[3])) : null
  }
  return null
}

/** Plain text of an ExcelJS cell value (rich text, formula results, hyperlinks). */
function text(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object' && !(v instanceof Date)) {
    const o = v as { text?: unknown; result?: unknown; richText?: { text: string }[] }
    if (o.richText) return o.richText.map((r) => r.text).join('').trim()
    if (o.text !== undefined) return text(o.text)
    if (o.result !== undefined) return text(o.result)
    return ''
  }
  return String(v).trim()
}

function isEmpty(v: unknown): boolean {
  return v instanceof Date ? false : text(v) === ''
}

export function parseImport(rows: unknown[][], ctx: { places: Map<string, Place>; existingKeys: Set<string>; defaultDate: string; today: string }): ParsedRow[] {
  const headerRow = (rows[0] ?? []).map((h) => text(h).replace(/\s*\*$/, ''))
  const index = new Map(IMPORT_COLUMNS.map((c) => [c.key, headerRow.indexOf(c.header.replace(/\s*\*$/, ''))]))
  const zoneByLabel = new Map([...ctx.places.values()].map((p) => [p.label, p.zoneId]))
  const firstLineOf = new Map<string, number>()
  const out: ParsedRow[] = []

  rows.slice(1).forEach((cells, i) => {
    const line = i + 2
    const raw = (key: ColumnKey) => {
      const at = index.get(key) ?? -1
      return at < 0 ? null : cells[at]
    }
    const get = (key: ColumnKey) => text(raw(key))
    const name = get('name')
    if (cells.every(isEmpty) || name.startsWith('예시')) return

    const errors: string[] = []
    const values: Partial<ReagentInput> = { name }
    if (!name) errors.push('약품명을 입력해 주세요.')

    const concText = get('concentration').replace(/%$/, '').trim()
    let concentration: number | null = null
    if (concText) {
      const c = Number(concText)
      if (!Number.isFinite(c)) errors.push('농도는 %로 입력해 주세요 (예: 35). 모르면 비워 두세요.')
      else if (!(c > 0 && c <= 100)) errors.push('농도는 0보다 크고 100 이하여야 합니다.')
      else concentration = c
    }
    values.concentration = concentration

    const casNo = get('casNo')
    if (casNo && !isValidCas(casNo)) errors.push(`CAS No.가 올바르지 않습니다: ${casNo}`)
    values.casNo = casNo
    values.formula = get('formula')

    const grade = get('grade')
    if (grade && grade !== '시약용' && grade !== '공업용') errors.push(`규격은 시약용 또는 공업용입니다: ${grade}`)
    values.grade = grade as ReagentInput['grade']

    const unit = get('unit').toLowerCase()
    if (unit === 'ml') values.unit = 'mL'
    else if (unit === 'g') values.unit = 'g'
    else errors.push(unit ? `단위는 mL 또는 g입니다: ${get('unit')}` : '단위를 입력해 주세요 (mL 또는 g).')

    const amountRaw = get('initialAmount')
    const amount = Number(amountRaw)
    if (amountRaw === '' || !Number.isFinite(amount) || amount < 0) errors.push('기초 재고량은 0 이상의 숫자로 입력해 주세요.')

    let initialDate = ctx.defaultDate
    if (!isEmpty(raw('initialDate'))) {
      const d = cellToDate(raw('initialDate'))
      if (!d) errors.push('기준일 형식이 올바르지 않습니다 (예: 2026-03-01).')
      else if (d > ctx.today) errors.push('기준일은 오늘 이후일 수 없습니다.')
      else initialDate = d
    }

    for (const [key, label] of [
      ['expiryDate', '유효기간'],
      ['purchaseDate', '구입일'],
      ['openedDate', '개봉일'],
    ] as const) {
      if (isEmpty(raw(key))) values[key] = ''
      else {
        const d = cellToDate(raw(key))
        if (d) values[key] = d
        else errors.push(`${label} 형식이 올바르지 않습니다 (예: 2028-03-01).`)
      }
    }

    values.mainUse = get('mainUse') || '실험용'
    values.maker = get('maker')
    values.supplier = get('supplier')
    values.note = get('note')

    const place = get('zoneId')
    if (place && !zoneByLabel.has(place)) errors.push(`보관 위치를 찾을 수 없습니다: ${place}`)
    values.zoneId = zoneByLabel.get(place) ?? ''

    for (const key of ['poison', 'banned', 'permitted', 'restricted'] as const) {
      const v = get(key)
      values[key] = v === '예' || v === '○' || v.toUpperCase() === 'O' || v.toUpperCase() === 'TRUE'
    }

    Object.assign(values, judgeHazard(casNo, concentration), { hazardManual: false })

    const parsed: ParsedRow = { line, status: errors.length ? 'error' : 'ok', errors, values, initialAmount: amount, initialDate }
    if (name) {
      const key = duplicateKey(name, concentration)
      if (ctx.existingKeys.has(key) && !errors.length) parsed.status = 'skip'
      else if (firstLineOf.has(key)) {
        const first = out.find((r) => r.line === firstLineOf.get(key))!
        first.status = 'error'
        first.errors.push(`${line}번째 줄과 같은 시약입니다.`)
        parsed.status = 'error'
        parsed.errors.push(`${first.line}번째 줄과 같은 시약입니다.`)
      } else firstLineOf.set(key, line)
    }
    out.push(parsed)
  })
  return out
}
