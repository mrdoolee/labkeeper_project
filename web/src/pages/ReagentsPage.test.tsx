import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { callApi } from '../api/client'
import { todayKst } from '../domain/ledger'
import { createFakeApi } from '../test/fakeApi'
import ReagentsPage from './ReagentsPage'

vi.mock('../api/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api/client')>()
  return { ...real, callApi: vi.fn() }
})

const stamp = { deleted: false, createdBy: 'u1', updatedBy: 'u1', updatedAt: '2026-03-02T09:00:00.000Z' }
const base = { formula: '', grade: '', mainUse: '실험용', expiryDate: '', purchaseDate: '', openedDate: '', maker: '', note: '', hazardManual: false, poison: false, banned: false, permitted: false, restricted: false }

function seed() {
  return {
    Rooms: [{ id: 'r1', name: '제1과학실', isLab: true, ...stamp }],
    Cabinets: [{ id: 'c1', roomId: 'r1', name: 'A 시약장', type: 'sealed', locked: true, rows: 1, cols: 1, ...stamp }],
    Zones: [{ id: 'z1', cabinetId: 'c1', row: 1, col: 1, name: '진한 산', allowedClasses: '', ...stamp }],
    Reagents: [
      { id: 'hcl', name: '염화 수소(염산)', concentration: 35, casNo: '7647-01-0', unit: 'mL', stock: 500, zoneId: 'z1', supplier: '○○과학', toxic: '해당', accidentPrep: '해당', ...base, ...stamp },
      { id: 'nacl', name: '염화 나트륨', concentration: null, casNo: '7647-14-5', unit: 'g', stock: 1000, zoneId: '', supplier: '', toxic: '해당 없음', accidentPrep: '해당 없음', ...base, ...stamp },
      { id: 'old', name: '오래된 시약', concentration: null, casNo: '', unit: 'g', stock: 0, zoneId: '', supplier: '', toxic: '판정 불가', accidentPrep: '판정 불가', ...base, ...stamp, deleted: true },
    ],
    ReagentTx: [
      { id: 't1', reagentId: 'hcl', date: '2026-03-01', kind: 'initial', amount: 500, purpose: '', price: null, note: '', createdAt: '2026-03-01T09:00:00+09:00', ...stamp },
      { id: 't2', reagentId: 'nacl', date: '2026-03-01', kind: 'initial', amount: 1000, purpose: '', price: null, note: '', createdAt: '2026-03-01T09:00:00+09:00', ...stamp },
      { id: 't3', reagentId: 'nacl', date: '2026-03-01', kind: 'out', amount: 1, purpose: '1학년 물질의 성질', price: null, note: '', createdAt: '2026-03-01T10:00:00+09:00', ...stamp },
    ],
  }
}

let fake: ReturnType<typeof createFakeApi>

beforeEach(() => {
  fake = createFakeApi(seed())
  vi.mocked(callApi).mockImplementation(fake.handle as typeof callApi)
})

function renderPage() {
  return render(
    <MemoryRouter>
      <ReagentsPage />
    </MemoryRouter>,
  )
}

async function rowOf(name: RegExp) {
  return (await screen.findByRole('cell', { name })).closest('tr')!
}

describe('reagent list', () => {
  test('shows name with concentration, stock with unit, place and hazard mark', async () => {
    renderPage()
    const hcl = await rowOf(/염화 수소\(염산\) 35%/)
    expect(within(hcl).getByText('500 mL')).toBeInTheDocument()
    expect(within(hcl).getByText('제1과학실 › A 시약장 › 진한 산')).toBeInTheDocument()
    expect(within(hcl).getByText('유해')).toBeInTheDocument()
    const nacl = await rowOf(/염화 나트륨/)
    expect(within(nacl).getByText('위치 미지정')).toBeInTheDocument()
    expect(within(nacl).queryByText('유해')).not.toBeInTheDocument()
    expect(screen.queryByText('오래된 시약')).not.toBeInTheDocument()
  })

  test('search matches part of the name, CAS No. or formula; hazardous-only filter', async () => {
    renderPage()
    await rowOf(/염화 나트륨/)
    await userEvent.type(screen.getByLabelText('시약 검색'), '7647-01')
    expect(screen.queryByRole('cell', { name: /염화 나트륨/ })).not.toBeInTheDocument()
    expect(screen.getByRole('cell', { name: /염화 수소/ })).toBeInTheDocument()
    await userEvent.clear(screen.getByLabelText('시약 검색'))
    await userEvent.click(screen.getByLabelText('유해화학물질만'))
    expect(screen.queryByRole('cell', { name: /염화 나트륨/ })).not.toBeInTheDocument()
  })

  test('links to register, Excel import and ledger print', async () => {
    renderPage()
    await rowOf(/염화 나트륨/)
    expect(screen.getByRole('link', { name: '시약 등록' })).toHaveAttribute('href', '/reagents/new')
    expect(screen.getByRole('link', { name: '엑셀로 등록' })).toHaveAttribute('href', '/reagents/import')
    expect(screen.getByRole('link', { name: '대장 출력' })).toHaveAttribute('href', '/reagents/ledger')
  })
})

describe('usage record dialog', () => {
  async function openUse() {
    renderPage()
    const hcl = await rowOf(/염화 수소\(염산\) 35%/)
    await userEvent.click(within(hcl).getByRole('button', { name: '사용 기록' }))
    return screen.getByRole('dialog', { name: /사용 기록/ })
  }

  test('shows what will be left, and blocks using more than there is', async () => {
    const dialog = await openUse()
    expect(within(dialog).getByText(/지금 500 mL/)).toBeInTheDocument()
    await userEvent.type(within(dialog).getByLabelText('사용량 (mL)'), '50')
    expect(within(dialog).getByText('기록 후 남는 양 450 mL')).toBeInTheDocument()
    await userEvent.clear(within(dialog).getByLabelText('사용량 (mL)'))
    await userEvent.type(within(dialog).getByLabelText('사용량 (mL)'), '600')
    expect(within(dialog).getByText(/남은 양보다 많습니다/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '저장' })).toBeDisabled()
  })

  test('saving records today\'s use and updates the row', async () => {
    const dialog = await openUse()
    expect(within(dialog).getByLabelText('일자')).toHaveValue(todayKst())
    await userEvent.type(within(dialog).getByLabelText('사용량 (mL)'), '50')
    await userEvent.type(within(dialog).getByLabelText('용도'), '2학년 중화 반응 실험')
    await userEvent.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(fake.called('reagentTx.create')[0]).toMatchObject({ reagentId: 'hcl', kind: 'out', amount: 50, date: todayKst(), purpose: '2학년 중화 반응 실험' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(within(await rowOf(/염화 수소\(염산\) 35%/)).getByText('450 mL')).toBeInTheDocument()
  })

  test('a recent purpose fills the purpose field', async () => {
    const dialog = await openUse()
    await userEvent.click(await within(dialog).findByRole('button', { name: '1학년 물질의 성질' }))
    expect(within(dialog).getByLabelText('용도')).toHaveValue('1학년 물질의 성질')
  })

  test('when someone else used it meanwhile, the server message is shown and the dialog stays', async () => {
    fake.tables.ReagentTx[0].amount = 30 // the sheet now holds only 30 mL; the list still says 500
    const dialog = await openUse()
    await userEvent.type(within(dialog).getByLabelText('사용량 (mL)'), '50')
    await userEvent.type(within(dialog).getByLabelText('용도'), '실험')
    await userEvent.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(await within(dialog).findByText('남은 양(30 mL)보다 많습니다.')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('delivery dialog', () => {
  test('purpose starts as the supplier; price is optional', async () => {
    renderPage()
    const hcl = await rowOf(/염화 수소\(염산\) 35%/)
    await userEvent.click(within(hcl).getByRole('button', { name: '입고' }))
    const dialog = screen.getByRole('dialog', { name: /입고/ })
    expect(within(dialog).getByLabelText('구입처')).toHaveValue('○○과학')
    await userEvent.type(within(dialog).getByLabelText('입고량 (mL)'), '500')
    await userEvent.type(within(dialog).getByLabelText('금액(원, 선택)'), '25000')
    await userEvent.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(fake.called('reagentTx.create')[0]).toMatchObject({ kind: 'in', amount: 500, purpose: '○○과학', price: 25000 })
    expect(within(await rowOf(/염화 수소\(염산\) 35%/)).getByText('1000 mL')).toBeInTheDocument()
  })
})

describe('deleted reagents', () => {
  test('can be listed and restored', async () => {
    renderPage()
    await rowOf(/염화 나트륨/)
    await userEvent.click(screen.getByRole('button', { name: '삭제된 시약 보기' }))
    const item = (await screen.findByText('오래된 시약')).closest('li')!
    await userEvent.click(within(item).getByRole('button', { name: '복구' }))
    expect(fake.called('reagents.restore')).toEqual([{ id: 'old' }])
  })
})
