import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { ApiError, callApi } from '../api/client'
import { createFakeApi } from '../test/fakeApi'
import CabinetPage from './CabinetPage'
import RoomPage from './RoomPage'

vi.mock('../api/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api/client')>()
  return { ...real, callApi: vi.fn() }
})

let fake: ReturnType<typeof createFakeApi>
const stamp = { deleted: false, updatedBy: 'u1', updatedAt: '2026-03-02T09:00:00.000Z' }

function zones(cabinetId: string, rows: number, cols: number) {
  const out = []
  for (let row = 1; row <= rows; row++)
    for (let col = 1; col <= cols; col++)
      out.push({ id: `${cabinetId}-${row}-${col}`, cabinetId, row, col, name: `${row}단 ${col}칸`, allowedClasses: 'inorganic_acid,base', ...stamp })
  return out
}

beforeEach(() => {
  fake = createFakeApi({
    Rooms: [{ id: 'r1', name: '제1과학실', isLab: true, ...stamp }],
    Cabinets: [{ id: 'c1', roomId: 'r1', name: 'A 시약장', type: 'sealed', locked: true, rows: 3, cols: 2, ...stamp }],
    Zones: zones('c1', 3, 2),
  })
  vi.mocked(callApi).mockImplementation(fake.handle as typeof callApi)
})

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/rooms/:roomId" element={<RoomPage />} />
        <Route path="/cabinets/:cabinetId" element={<CabinetPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RoomPage', () => {
  test('a new 3×2 sealed cabinet gets its 6 zones', async () => {
    renderAt('/rooms/r1')
    await screen.findByRole('link', { name: 'A 시약장' })
    await userEvent.type(screen.getByLabelText('새 보관장 이름'), 'B 시약장')
    await userEvent.selectOptions(screen.getByLabelText('종류'), 'sealed')
    await userEvent.clear(screen.getByLabelText('단 수'))
    await userEvent.type(screen.getByLabelText('단 수'), '3')
    await userEvent.clear(screen.getByLabelText('칸 수'))
    await userEvent.type(screen.getByLabelText('칸 수'), '2')
    await userEvent.click(screen.getByRole('button', { name: '보관장 추가' }))
    expect(fake.called('records.create')[0]).toMatchObject({ table: 'Cabinets', values: { roomId: 'r1', name: 'B 시약장', type: 'sealed', rows: 3, cols: 2 } })
    const many = fake.called('records.createMany')[0] as { table: string; rows: { name: string }[] }
    expect(many.table).toBe('Zones')
    expect(many.rows).toHaveLength(6)
    expect(await screen.findByRole('link', { name: 'B 시약장' })).toBeInTheDocument()
  })

  test('a double click on add creates one cabinet', async () => {
    renderAt('/rooms/r1')
    await screen.findByRole('link', { name: 'A 시약장' })
    const release = fake.hold('records.create')
    await userEvent.type(screen.getByLabelText('새 보관장 이름'), 'B 시약장')
    const add = screen.getByRole('button', { name: '보관장 추가' })
    await userEvent.click(add)
    await userEvent.click(add)
    release()
    expect(await screen.findByRole('link', { name: 'B 시약장' })).toBeInTheDocument()
    expect(fake.called('records.create')).toHaveLength(1)
  })

  test('copying a cabinet copies its zone names', async () => {
    fake.tables.Zones[0].name = '진한 산'
    renderAt('/rooms/r1')
    await screen.findByRole('link', { name: 'A 시약장' })
    vi.spyOn(window, 'prompt').mockReturnValue('A 시약장 2')
    await userEvent.click(within(screen.getByRole('row', { name: /A 시약장/ })).getByRole('button', { name: '복제' }))
    expect(fake.called('records.create')[0]).toMatchObject({ table: 'Cabinets', values: { name: 'A 시약장 2', type: 'sealed', rows: 3, cols: 2 } })
    const many = fake.called('records.createMany')[0] as { rows: { name: string; cabinetId: string }[] }
    expect(many.rows).toHaveLength(6)
    expect(many.rows[0].name).toBe('진한 산')
    expect(many.rows[0].cabinetId).not.toBe('c1')
  })
})

describe('deleted cabinets', () => {
  test('can be listed and restored from the room page', async () => {
    fake.tables.Cabinets.push({ id: 'c9', roomId: 'r1', name: '옛 시약장', type: 'general', locked: false, rows: 1, cols: 1, ...stamp, deleted: true, deletedBy: 'u1', deletedAt: stamp.updatedAt })
    renderAt('/rooms/r1')
    await screen.findByRole('link', { name: 'A 시약장' })
    await userEvent.click(screen.getByLabelText('삭제된 보관장 보기'))
    const deleted = await screen.findByRole('table', { name: '삭제된 보관장' })
    await userEvent.click(within(deleted).getByRole('button', { name: '복구' }))
    expect(fake.called('records.restore')).toEqual([{ table: 'Cabinets', id: 'c9' }])
    expect(await screen.findByRole('link', { name: '옛 시약장' })).toBeInTheDocument()
  })
})

describe('CabinetPage', () => {
  test('draws the grid top shelf first and shows where the cabinet is', async () => {
    renderAt('/cabinets/c1')
    expect(await screen.findByText('제1과학실 › A 시약장')).toBeInTheDocument()
    const cells = await screen.findAllByRole('gridcell')
    expect(cells).toHaveLength(6)
    expect(cells[0]).toHaveTextContent('1단 1칸')
    expect(cells[1]).toHaveTextContent('1단 2칸')
    expect(cells[5]).toHaveTextContent('3단 2칸')
    expect(fake.called('records.list').find((p) => p.table === 'Zones')).toEqual({ table: 'Zones', where: { cabinetId: 'c1' } })
  })

  test('editing a zone saves its name and allowed classes', async () => {
    renderAt('/cabinets/c1')
    await userEvent.click((await screen.findAllByRole('gridcell'))[0])
    const name = screen.getByLabelText('구역 이름')
    await userEvent.clear(name)
    await userEvent.type(name, '진한 산')
    await userEvent.click(screen.getByLabelText('염기'))
    await userEvent.click(screen.getByLabelText('유기산'))
    await userEvent.click(screen.getByRole('button', { name: '구역 저장' }))
    expect(fake.called('records.update')[0]).toEqual({ table: 'Zones', id: 'c1-1-1', changes: { name: '진한 산', allowedClasses: 'inorganic_acid,organic_acid' } })
  })

  test('shrinking the cabinet asks first, naming the zones that go away', async () => {
    renderAt('/cabinets/c1')
    await screen.findAllByRole('gridcell')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await userEvent.clear(screen.getByLabelText('단 수'))
    await userEvent.type(screen.getByLabelText('단 수'), '2')
    await userEvent.click(screen.getByRole('button', { name: '보관장 저장' }))
    expect(confirm.mock.calls[0][0]).toContain('3단 1칸')
    expect(confirm.mock.calls[0][0]).toContain('3단 2칸')
    expect(fake.called('records.deleteMany')).toEqual([{ table: 'Zones', ids: ['c1-3-1', 'c1-3-2'] }])
    expect(fake.called('records.delete')).toHaveLength(0)
    expect(fake.called('records.update')[0]).toMatchObject({ table: 'Cabinets', id: 'c1', changes: { rows: 2 } })
    expect(await screen.findAllByRole('gridcell')).toHaveLength(4)
  })

  test('shrinking removes zones first; if a zone holds reagents nothing else changes', async () => {
    vi.mocked(callApi).mockImplementation(((action: string, payload?: object) =>
      action === 'records.deleteMany'
        ? Promise.reject(new ApiError('INVALID', '이 안에 시약이 있습니다: 염화 수소(염산) 35%. 먼저 시약의 보관 위치를 옮겨 주세요.'))
        : fake.handle(action, payload)) as typeof callApi)
    renderAt('/cabinets/c1')
    await screen.findAllByRole('gridcell')
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await userEvent.clear(screen.getByLabelText('단 수'))
    await userEvent.type(screen.getByLabelText('단 수'), '2')
    await userEvent.click(screen.getByRole('button', { name: '보관장 저장' }))
    expect(await screen.findByText(/먼저 시약의 보관 위치를 옮겨 주세요/)).toBeInTheDocument()
    expect(fake.called('records.update')).toHaveLength(0)
  })

  test('a successful shrink removes zones, then saves the cabinet', async () => {
    renderAt('/cabinets/c1')
    await screen.findAllByRole('gridcell')
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await userEvent.clear(screen.getByLabelText('단 수'))
    await userEvent.type(screen.getByLabelText('단 수'), '2')
    await userEvent.click(screen.getByRole('button', { name: '보관장 저장' }))
    await screen.findAllByRole('gridcell')
    const order = fake.calls.map((c) => c.action).filter((a) => a === 'records.deleteMany' || a === 'records.update')
    expect(order).toEqual(['records.deleteMany', 'records.update'])
  })

  test('cancelling the shrink changes nothing', async () => {
    renderAt('/cabinets/c1')
    await screen.findAllByRole('gridcell')
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    await userEvent.clear(screen.getByLabelText('단 수'))
    await userEvent.type(screen.getByLabelText('단 수'), '1')
    await userEvent.click(screen.getByRole('button', { name: '보관장 저장' }))
    expect(fake.called('records.update')).toHaveLength(0)
    expect(fake.called('records.deleteMany')).toHaveLength(0)
  })

  test('a double click on save while the first save is running does nothing', async () => {
    renderAt('/cabinets/c1')
    await screen.findAllByRole('gridcell')
    const release = fake.hold('records.update')
    await userEvent.clear(screen.getByLabelText('단 수'))
    await userEvent.type(screen.getByLabelText('단 수'), '4')
    const save = screen.getByRole('button', { name: '보관장 저장' })
    await userEvent.click(save)
    await userEvent.click(save)
    release()
    await waitFor(() => expect(screen.getAllByRole('gridcell')).toHaveLength(8))
    expect(fake.called('records.update')).toHaveLength(1)
    expect(fake.called('records.createMany')).toHaveLength(1)
  })
})

describe('missing pages', () => {
  test('an unknown or deleted cabinet says it cannot be found', async () => {
    renderAt('/cabinets/nope')
    expect(await screen.findByText('보관장을 찾을 수 없습니다. 삭제되었거나 주소가 잘못되었습니다.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '교실·보관장으로' })).toBeInTheDocument()
  })

  test('an unknown or deleted room says it cannot be found', async () => {
    fake.tables.Rooms[0].deleted = true
    renderAt('/rooms/r1')
    expect(await screen.findByText('교실을 찾을 수 없습니다. 삭제되었거나 주소가 잘못되었습니다.')).toBeInTheDocument()
  })
})

