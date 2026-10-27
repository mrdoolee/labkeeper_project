// 화학약품 관리대장 인쇄 양식 (설계 M2 8-6). One reagent starts on a new A4 sheet;
// long ledgers continue on the next sheet with the header repeated.
// Sources: 충북 「2026 과학교육 기본 계획」 [서식3], 경기 「과학실 안전관리 계획 2025」 서식3,
// 서울 「2025학년도 과학실 안전관리 및 안전매뉴얼」 화학약품 관리(출납)대장.
import type { ReactNode } from 'react'
import type { Reagent } from '../api/reagents'
import { isHazardous } from '../domain/hazard'
import { paginate, type LedgerLine } from '../domain/ledger'
import { reagentLabel } from '../domain/location'

export type Region = 'chungbuk' | 'seoul' | 'gyeonggi'

export interface LedgerItem {
  reagent: Reagent
  lines: LedgerLine[]
}

const ROWS_PER_PAGE: Record<Region, number> = { chungbuk: 16, gyeonggi: 20, seoul: 12 }
const KIND = { carry: '이월', initial: '기초 재고', in: '입고', out: '출고' } as const

const dot = (date: string) => date.replaceAll('-', '.')
const num = (n: number | null) => (n === null ? '' : String(n))
const won = (n: number | null) => (n === null ? '' : n.toLocaleString('ko-KR'))

function Name({ reagent }: { reagent: Reagent }) {
  return <span className={isHazardous(reagent) ? 'hl' : undefined}>{reagentLabel(reagent)}</span>
}

/** ○ when it applies, 확인 필요 when it could not be judged, blank otherwise. */
function judged(status: string): string {
  return status === '해당' ? '○' : status === '판정 불가' ? '확인 필요' : ''
}

function slot(mark: string): string {
  return mark ? ` ${mark} ` : ' '
}

function ChungbukPage({ reagent, rows }: { reagent: Reagent; rows: (LedgerLine | null)[] }) {
  const flags =
    `금지물질(${slot(reagent.banned ? '○' : '')}), 허가물질(${slot(reagent.permitted ? '○' : '')}), 제한물질(${slot(reagent.restricted ? '○' : '')}), ` +
    `유독물질(${slot(judged(reagent.toxic))}), 사고대비물질(${slot(judged(reagent.accidentPrep))})`
  return (
    <>
      <h2 className="ledger-title">화학물질 관리대장</h2>
      <p className="ledger-meta">
        ★ 약품명: <Name reagent={reagent} />
      </p>
      <p className="ledger-meta">★ 국제연합번호(CAS No.): {reagent.casNo}</p>
      <p className="ledger-meta flags">{flags}(해당란에 ○)</p>
      <table className="ledger-rows">
        <thead>
          <tr>
            {['연월일', '수불구분', '수불량', '보유량', '잔량', '용도', '확인', '비고'].map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((l, i) => (
            <tr key={i}>
              <td>{l ? dot(l.date) : ''}</td>
              <td>{l ? KIND[l.kind] : ''}</td>
              <td>{l ? num(l.amount) : ''}</td>
              <td>{l ? num(l.before) : ''}</td>
              <td>{l ? num(l.after) : ''}</td>
              <td className="left">{l?.purpose ?? ''}</td>
              <td></td>
              <td className="left">{l?.note ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ledger-notes">
        <p>※ 관리대장(구입, 보관, 폐기량 기록) 5년 비치(화학물질관리법 시행규칙 제56조)</p>
        <p>※ 확인: 위임전결규정에 의한 결재</p>
        <p>※ 유해화학물질(유독물질, 사고대비 물질)일 경우 약품명에 형광펜 등을 사용해 쉽게 인식할 수 있도록 표시 권장</p>
        <p>※ 단위: {reagent.unit}</p>
      </div>
    </>
  )
}

const EDUFINE_NOTE = '※ 화학물질을 에듀파인에 등록하지 않고 수기로 관리할 경우 본 양식 사용'

function hazardMark(reagent: Reagent): string {
  if (isHazardous(reagent)) return '○'
  return reagent.toxic === '판정 불가' || reagent.accidentPrep === '판정 불가' ? '확인 필요' : '×'
}

function GyeonggiPage({ reagent, rows, year }: { reagent: Reagent; rows: (LedgerLine | null)[]; year: number }) {
  return (
    <>
      <h2 className="ledger-title">{year}학년도 과학실험실 화학약품 관리(출납)대장</h2>
      <table className="ledger-head">
        <tbody>
          <tr>
            <th>약품명</th>
            <td>
              <Name reagent={{ ...reagent, concentration: null }} />
            </td>
            <th>유효기간</th>
            <td>{dot(reagent.expiryDate)}</td>
          </tr>
          <tr>
            <th>농도</th>
            <td>{reagent.concentration === null ? '' : `${reagent.concentration}%`}</td>
            <th>주용도</th>
            <td>{reagent.mainUse}</td>
          </tr>
          <tr>
            <th>유해화학물질 여부</th>
            <td data-testid="hazard">{hazardMark(reagent)}</td>
            <th>단위</th>
            <td>{reagent.unit}</td>
          </tr>
        </tbody>
      </table>
      <table className="ledger-rows">
        <thead>
          <tr>
            {['수불일자', '수불구분', '수불량', '보유량', '잔량', '용도', '확인(서명)'].map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((l, i) => (
            <tr key={i}>
              <td>{l ? dot(l.date) : ''}</td>
              <td>{l ? KIND[l.kind] : ''}</td>
              <td>{l ? num(l.amount) : ''}</td>
              <td>{l ? num(l.before) : ''}</td>
              <td>{l ? num(l.after) : ''}</td>
              <td className="left">{l?.purpose ?? ''}</td>
              <td></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ledger-notes">
        <p>{EDUFINE_NOTE}</p>
      </div>
    </>
  )
}

function seoulSummary(l: LedgerLine): string {
  if (l.kind === 'carry') return '전년도 이월'
  if (l.kind === 'initial') return '기초 재고'
  if (l.kind === 'in') return l.purpose ? `구입 (${l.purpose})` : '구입'
  return l.purpose
}

function SeoulPage({ reagent, rows, year }: { reagent: Reagent; rows: (LedgerLine | null)[]; year: number }) {
  return (
    <>
      <h2 className="ledger-title">{year}학년도 과학실험실 화학약품 관리(출납)대장</h2>
      <div className="seoul-head">
        <strong className="seoul-label">화학약품 관리 대장</strong>
        <table className="ledger-head">
          <thead>
            <tr>
              {['품명', '규격', '단위', '독극물', '주용도', '유효기간'].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <Name reagent={reagent} />
                {reagent.formula && (
                  <>
                    <br />
                    {reagent.formula}
                  </>
                )}
              </td>
              <td>{reagent.grade}</td>
              <td>{reagent.unit}</td>
              <td>{reagent.poison ? '○' : ''}</td>
              <td>{reagent.mainUse}</td>
              <td>{dot(reagent.expiryDate)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <table className="ledger-rows">
        <thead>
          <tr>
            <th rowSpan={2}>일자</th>
            <th colSpan={2}>결재</th>
            <th rowSpan={2}>적요</th>
            <th colSpan={2}>취득</th>
            <th rowSpan={2}>사용량</th>
            <th rowSpan={2}>재고량</th>
            <th rowSpan={2}>비고</th>
          </tr>
          <tr>
            <th>부장</th>
            <th>담당</th>
            <th>수량</th>
            <th>금액(원)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l, i) => (
            <tr key={i}>
              <td>{l ? dot(l.date) : ''}</td>
              <td></td>
              <td></td>
              <td className="left">{l ? seoulSummary(l) : ''}</td>
              <td>{l?.kind === 'in' ? num(l.amount) : ''}</td>
              <td>{l?.kind === 'in' ? won(l.price) : ''}</td>
              <td>{l?.kind === 'out' ? num(l.amount) : ''}</td>
              <td>{l ? num(l.after) : ''}</td>
              <td className="left">{l?.note ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ledger-notes">
        <p>{EDUFINE_NOTE}</p>
      </div>
    </>
  )
}

export function LedgerSheets({ region, year, items }: { region: Region; year: number; items: LedgerItem[] }) {
  const sheets: ReactNode[] = []
  for (const { reagent, lines } of items) {
    paginate(lines, ROWS_PER_PAGE[region]).forEach((rows, i) => {
      const page =
        region === 'chungbuk' ? (
          <ChungbukPage reagent={reagent} rows={rows} />
        ) : region === 'gyeonggi' ? (
          <GyeonggiPage reagent={reagent} rows={rows} year={year} />
        ) : (
          <SeoulPage reagent={reagent} rows={rows} year={year} />
        )
      sheets.push(
        <section key={`${reagent.id}-${i}`} className={`sheet ${region === 'seoul' ? 'sheet-landscape' : 'sheet-portrait'}`} aria-label={`${reagentLabel(reagent)} ${i + 1}쪽`}>
          {page}
        </section>,
      )
    })
  }
  return <div className="ledger-sheets">{sheets}</div>
}
