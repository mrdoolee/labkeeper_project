import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'
import { callApi } from '../api/client'
import { createFakeApi } from '../test/fakeApi'
import FindPage from './FindPage'

vi.mock('../api/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api/client')>()
  return { ...real, callApi: vi.fn() }
})

const stamp = { deleted: false, createdBy: 'u1', updatedBy: 'u1', updatedAt: '2026-03-02T09:00:00.000Z' }
let fake: ReturnType<typeof createFakeApi>

beforeEach(() => {
  fake = createFakeApi({
    Rooms: [{ id: 'r1', name: '제1과학실', isLab: true, ...stamp }],
    Cabinets: [{ id: 'c1', roomId: 'r1', name: 'A 시약장', type: 'sealed', locked: true, rows: 1, cols: 1, ...stamp }],
    Zones: [{ id: 'z1', cabinetId: 'c1', row: 1, col: 1, name: '진한 산', allowedClasses: '', ...stamp }],
    Reagents: [
      { id: 'hcl', name: '염화 수소(염산)', concentration: 35, formula: 'HCl', casNo: '7647-01-0', unit: 'mL', stock: 500, zoneId: 'z1', toxic: '해당', accidentPrep: '해당', ...stamp },
      { id: 'dil', name: '묽은 염산', concentration: 9, formula: 'HCl', casNo: '7647-01-0', unit: 'mL', stock: 20, zoneId: '', toxic: '해당 없음', accidentPrep: '해당 없음', ...stamp },
    ],
  })
  vi.mocked(callApi).mockImplementation(fake.handle as typeof callApi)
})

function Where() {
  const loc = useLocation()
  return <p>위치: {loc.pathname + loc.search}</p>
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/find']}>
      <Routes>
        <Route path="/find" element={<FindPage />} />
        <Route path="/cabinets/:cabinetId" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

test('nothing is listed until something is typed', async () => {
  renderPage()
  await screen.findByLabelText('찾을 시약')
  expect(screen.queryByRole('list', { name: '찾은 시약' })).not.toBeInTheDocument()
})

test.each(['염산', 'HCl', '7647'])('%s finds the reagents with place and stock', async (q) => {
  renderPage()
  await userEvent.type(await screen.findByLabelText('찾을 시약'), q)
  const list = await screen.findByRole('list', { name: '찾은 시약' })
  const hcl = within(list).getByText('염화 수소(염산) 35%').closest('li')!
  expect(within(hcl).getByText('제1과학실 › A 시약장 › 진한 산')).toBeInTheDocument()
  expect(within(hcl).getByText('500 mL')).toBeInTheDocument()
  const dil = within(list).getByText('묽은 염산 9%').closest('li')!
  expect(within(dil).getByText('위치 미지정')).toBeInTheDocument()
  expect(within(dil).queryByRole('link', { name: /›/ })).not.toBeInTheDocument()
})

test('a result opens the cabinet with the zone marked', async () => {
  renderPage()
  await userEvent.type(await screen.findByLabelText('찾을 시약'), '염화 수소')
  await userEvent.click(await screen.findByRole('link', { name: /제1과학실 › A 시약장 › 진한 산/ }))
  expect(await screen.findByText('위치: /cabinets/c1?zone=z1')).toBeInTheDocument()
})
