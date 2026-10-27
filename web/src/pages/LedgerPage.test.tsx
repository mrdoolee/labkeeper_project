import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { callApi } from '../api/client'
import { createFakeApi } from '../test/fakeApi'
import LedgerPage from './LedgerPage'

vi.mock('../api/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api/client')>()
  return { ...real, callApi: vi.fn() }
})

const stamp = { deleted: false, createdBy: 'u1', updatedBy: 'u1', updatedAt: '2026-03-02T09:00:00.000Z' }
const base = { formula: '', grade: '', unit: 'mL', mainUse: '실험용', expiryDate: '', purchaseDate: '', openedDate: '', maker: '', supplier: '', zoneId: '', hazardManual: false, poison: false, banned: false, permitted: false, restricted: false, note: '' }
const reagent = (id: string, name: string, extra: object = {}) => ({ id, name, concentration: null, casNo: '', toxic: '해당 없음', accidentPrep: '해당 없음', stock: 100, ...base, ...stamp, ...extra })
const tx = (id: string, reagentId: string, date: string, kind: string, amount: number) => ({ id, reagentId, date, kind, amount, purpose: kind === 'out' ? '실험' : '', price: null, note: '', createdAt: `${date}T09:00:00+09:00`, ...stamp })

let fake: ReturnType<typeof createFakeApi>

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-27T03:00:00Z'))
  fake = createFakeApi({
    Reagents: [
      reagent('b', '황산', { concentration: 98 }),
      reagent('a', '아세톤', { toxic: '판정 불가', accidentPrep: '판정 불가' }),
      reagent('gone', '다 쓴 시약', { deleted: true }),
      reagent('old', '작년 시약'),
      reagent('gone2025', '작년에 지운 시약', { deleted: true, deletedAt: '2026-01-10T10:00:00+09:00' }),
    ],
    ReagentTx: [
      tx('t1', 'b', '2026-03-01', 'initial', 500),
      tx('t2', 'a', '2026-03-01', 'initial', 100),
      tx('t3', 'gone', '2026-03-01', 'initial', 10),
      tx('t4', 'gone', '2026-04-01', 'out', 10),
      tx('t5', 'old', '2024-03-01', 'initial', 5),
      tx('t6', 'old', '2024-04-01', 'out', 5),
      tx('t7', 'gone2025', '2025-03-01', 'initial', 50),
    ],
  })
  vi.mocked(callApi).mockImplementation(fake.handle as typeof callApi)
})

afterEach(() => {
  vi.useRealTimers()
})

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/reagents/ledger" element={<LedgerPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

test('prints every reagent of the school year, deleted ones included, in name order', async () => {
  renderAt('/reagents/ledger')
  expect(await screen.findByRole('region', { name: '다 쓴 시약 1쪽' })).toBeInTheDocument()
  expect(screen.getByLabelText('학년도')).toHaveValue('2026')
  expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(['다 쓴 시약 1쪽', '아세톤 1쪽', '황산 98% 1쪽'])
})

test('a reagent deleted before the school year is left out even with stock left', async () => {
  renderAt('/reagents/ledger')
  await screen.findByRole('region', { name: '황산 98% 1쪽' })
  expect(screen.queryByRole('region', { name: '작년에 지운 시약 1쪽' })).not.toBeInTheDocument()
  await userEvent.selectOptions(screen.getByLabelText('학년도'), '2025')
  expect(await screen.findByRole('region', { name: '작년에 지운 시약 1쪽' })).toBeInTheDocument()
})

test('ids in the address limit the ledger to those reagents', async () => {
  renderAt('/reagents/ledger?ids=b')
  expect(await screen.findByRole('region', { name: '황산 98% 1쪽' })).toBeInTheDocument()
  expect(screen.getAllByRole('region')).toHaveLength(1)
})

test('one reagent can be picked; deleted ones are marked', async () => {
  renderAt('/reagents/ledger')
  await screen.findByRole('region', { name: '황산 98% 1쪽' })
  expect(screen.getByRole('option', { name: '다 쓴 시약 (삭제됨)' })).toBeInTheDocument()
  await userEvent.selectOptions(screen.getByLabelText('시약'), 'a')
  expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(['아세톤 1쪽'])
})

test('another school year shows that year', async () => {
  renderAt('/reagents/ledger')
  await screen.findByRole('region', { name: '황산 98% 1쪽' })
  await userEvent.selectOptions(screen.getByLabelText('학년도'), '2024')
  expect(await screen.findByRole('region', { name: '작년 시약 1쪽' })).toBeInTheDocument()
})

test('unjudged reagents are listed before printing, with links', async () => {
  renderAt('/reagents/ledger')
  expect(await screen.findByText('판정이 안 된 시약 1개: 대장에 "확인 필요"로 찍힙니다.')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '아세톤' })).toHaveAttribute('href', '/reagents/a')
})

test('the region setting picks the form, and 인쇄 opens the print dialog', async () => {
  await fake.handle('settings.update', { region: 'seoul' })
  const print = vi.spyOn(window, 'print').mockImplementation(() => {})
  renderAt('/reagents/ledger')
  expect(await screen.findByRole('region', { name: '황산 98% 1쪽' })).toHaveClass('sheet-landscape')
  await userEvent.click(screen.getByRole('button', { name: '인쇄' }))
  expect(print).toHaveBeenCalled()
})
