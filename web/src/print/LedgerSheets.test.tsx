import { render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { Reagent } from '../api/reagents'
import type { LedgerLine } from '../domain/ledger'
import { LedgerSheets } from './LedgerSheets'

const stamp = { createdBy: 'u1', createdAt: '', updatedBy: 'u1', updatedAt: '', deleted: false, deletedBy: '', deletedAt: '' }
const HCL: Reagent = {
  id: 'hcl', name: '염화 수소(염산)', concentration: 35, formula: 'HCl', casNo: '7647-01-0', grade: '시약용', unit: 'mL', mainUse: '실험용',
  expiryDate: '2028-03-01', purchaseDate: '', openedDate: '', maker: '', supplier: '○○과학', zoneId: '', toxic: '해당', accidentPrep: '해당',
  hazardManual: false, poison: true, banned: false, permitted: false, restricted: false, stock: 720, note: '', ...stamp,
}
const UNKNOWN: Reagent = { ...HCL, id: 'x', name: '포름알데하이드', concentration: 37, casNo: '50-00-0', formula: 'CH2O', toxic: '판정 불가', accidentPrep: '판정 불가', poison: false }
const SALT: Reagent = { ...HCL, id: 'nacl', name: '염화 나트륨', concentration: null, casNo: '7647-14-5', formula: 'NaCl', unit: 'g', toxic: '해당 없음', accidentPrep: '해당 없음', poison: false }

const LINES: LedgerLine[] = [
  { date: '2026-03-01', kind: 'carry', amount: null, before: null, after: 300, purpose: '', price: null, note: '' },
  { date: '2026-03-16', kind: 'in', amount: 500, before: 300, after: 800, purpose: '○○과학', price: 25000, note: '' },
  { date: '2026-04-08', kind: 'out', amount: 50, before: 800, after: 750, purpose: '2학년 중화 반응 실험', price: null, note: '조별' },
]

function bodyRows(sheet: HTMLElement) {
  const table = sheet.querySelector('table.ledger-rows')!
  return [...table.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent))
}

function headers(sheet: HTMLElement) {
  return [...sheet.querySelector('table.ledger-rows')!.querySelectorAll('thead th')].map((th) => th.textContent)
}

describe('Chungbuk 서식3', () => {
  test('title, header and columns follow the form', () => {
    render(<LedgerSheets region="chungbuk" year={2026} items={[{ reagent: HCL, lines: LINES }]} />)
    const sheet = screen.getByRole('region', { name: '염화 수소(염산) 35% 1쪽' })
    expect(within(sheet).getByRole('heading', { name: '화학물질 관리대장' })).toBeInTheDocument()
    expect(within(sheet).getByText('염화 수소(염산) 35%')).toHaveClass('hl')
    expect(sheet.textContent).toContain('★ 국제연합번호(CAS No.): 7647-01-0')
    expect(sheet.textContent).toContain('금지물질( ), 허가물질( ), 제한물질( ), 유독물질( ○ ), 사고대비물질( ○ )')
    expect(headers(sheet)).toEqual(['연월일', '수불구분', '수불량', '보유량', '잔량', '용도', '확인', '비고'])
    expect(bodyRows(sheet).slice(0, 3)).toEqual([
      ['2026.03.01', '이월', '', '', '300', '', '', ''],
      ['2026.03.16', '입고', '500', '300', '800', '○○과학', '', ''],
      ['2026.04.08', '출고', '50', '800', '750', '2학년 중화 반응 실험', '', '조별'],
    ])
    expect(sheet.textContent).toContain('※ 관리대장(구입, 보관, 폐기량 기록) 5년 비치(화학물질관리법 시행규칙 제56조)')
  })

  test('an unjudged reagent prints 확인 필요, a harmless one leaves the boxes empty', () => {
    render(<LedgerSheets region="chungbuk" year={2026} items={[{ reagent: UNKNOWN, lines: LINES }, { reagent: SALT, lines: LINES }]} />)
    expect(screen.getByRole('region', { name: '포름알데하이드 37% 1쪽' }).textContent).toContain('유독물질( 확인 필요 ), 사고대비물질( 확인 필요 )')
    const salt = screen.getByRole('region', { name: '염화 나트륨 1쪽' })
    expect(salt.textContent).toContain('유독물질( ), 사고대비물질( )')
    expect(within(salt).getByText('염화 나트륨')).not.toHaveClass('hl')
  })

  test('long ledgers continue on a new page with the header repeated; the last page is padded', () => {
    const many: LedgerLine[] = Array.from({ length: 20 }, (_, i) => ({ date: `2026-04-${String(i + 1).padStart(2, '0')}`, kind: 'out', amount: 1, before: 300 - i, after: 299 - i, purpose: '실험', price: null, note: '' }))
    render(<LedgerSheets region="chungbuk" year={2026} items={[{ reagent: HCL, lines: many }]} />)
    const pages = screen.getAllByRole('region')
    expect(pages).toHaveLength(2)
    expect(within(pages[1]).getByRole('heading', { name: '화학물질 관리대장' })).toBeInTheDocument()
    expect(bodyRows(pages[0])).toHaveLength(bodyRows(pages[1]).length)
    expect(bodyRows(pages[1]).at(-1)!.every((c) => c === '')).toBe(true)
  })
})

describe('Gyeonggi 서식3', () => {
  test('title with the school year, header table and columns', () => {
    render(<LedgerSheets region="gyeonggi" year={2026} items={[{ reagent: HCL, lines: LINES }, { reagent: SALT, lines: LINES }, { reagent: UNKNOWN, lines: LINES }]} />)
    const sheet = screen.getByRole('region', { name: '염화 수소(염산) 35% 1쪽' })
    expect(within(sheet).getByRole('heading', { name: '2026학년도 과학실험실 화학약품 관리(출납)대장' })).toBeInTheDocument()
    const head = [...sheet.querySelectorAll('table.ledger-head th')].map((th) => th.textContent)
    expect(head).toEqual(['약품명', '유효기간', '농도', '주용도', '유해화학물질 여부', '단위'])
    expect(sheet.querySelector('table.ledger-head')!.textContent).toContain('2028.03.01')
    expect(within(sheet.querySelector('table.ledger-head') as HTMLElement).getByTestId('hazard').textContent).toBe('○')
    expect(within(screen.getByRole('region', { name: '염화 나트륨 1쪽' })).getByTestId('hazard').textContent).toBe('×')
    expect(within(screen.getByRole('region', { name: '포름알데하이드 37% 1쪽' })).getByTestId('hazard').textContent).toBe('확인 필요')
    expect(headers(sheet)).toEqual(['수불일자', '수불구분', '수불량', '보유량', '잔량', '용도', '확인(서명)'])
    expect(bodyRows(sheet)[1]).toEqual(['2026.03.16', '입고', '500', '300', '800', '○○과학', ''])
  })
})

describe('Seoul 화학약품 관리(출납)대장', () => {
  test('landscape form with 결재, 적요, 취득 and 사용량', () => {
    render(<LedgerSheets region="seoul" year={2026} items={[{ reagent: HCL, lines: LINES }]} />)
    const sheet = screen.getByRole('region', { name: '염화 수소(염산) 35% 1쪽' })
    expect(sheet).toHaveClass('sheet-landscape')
    expect(within(sheet).getByRole('heading', { name: '2026학년도 과학실험실 화학약품 관리(출납)대장' })).toBeInTheDocument()
    const head = [...sheet.querySelectorAll('table.ledger-head th')].map((th) => th.textContent)
    expect(head).toEqual(['품명', '규격', '단위', '독극물', '주용도', '유효기간'])
    expect(sheet.querySelector('table.ledger-head')!.textContent).toContain('HCl')
    expect(headers(sheet)).toEqual(['일자', '결재', '적요', '취득', '사용량', '재고량', '비고', '부장', '담당', '수량', '금액(원)'])
    expect(bodyRows(sheet).slice(0, 3)).toEqual([
      ['2026.03.01', '', '', '전년도 이월', '', '', '', '300', ''],
      ['2026.03.16', '', '', '구입 (○○과학)', '500', '25,000', '', '800', ''],
      ['2026.04.08', '', '', '2학년 중화 반응 실험', '', '', '50', '750', '조별'],
    ])
  })

  test('an unjudged reagent shows nothing extra in the Seoul form', () => {
    render(<LedgerSheets region="seoul" year={2026} items={[{ reagent: UNKNOWN, lines: LINES }]} />)
    expect(screen.getByRole('region').textContent).not.toContain('확인 필요')
  })
})
