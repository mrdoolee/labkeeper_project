import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { callApi } from '../api/client'
import CabinetSearch from '../components/CabinetSearch'
import { createFakeApi } from '../test/fakeApi'
import RoomsPage from './RoomsPage'

vi.mock('../api/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api/client')>()
  return { ...real, callApi: vi.fn() }
})

let fake: ReturnType<typeof createFakeApi>

const cab = (id: string, roomId: string, name: string) => ({
  id,
  roomId,
  name,
  type: 'sealed',
  locked: true,
  rows: 3,
  cols: 2,
  deleted: false,
  updatedBy: 'u1',
  updatedAt: '2026-03-02T09:00:00.000Z',
})

beforeEach(() => {
  fake = createFakeApi({
    Rooms: [
      { id: 'r1', name: '제1과학실', isLab: true, deleted: false, updatedBy: 'u1', updatedAt: '2026-03-02T09:00:00.000Z' },
      { id: 'r2', name: '과학 준비실', isLab: false, deleted: false, updatedBy: 'u1', updatedAt: '2026-03-02T09:00:00.000Z' },
      { id: 'r3', name: '제2과학실', isLab: true, deleted: false, updatedBy: 'u1', updatedAt: '2026-03-02T09:00:00.000Z' },
    ],
    Cabinets: [
      cab('c1', 'r1', 'A 시약장'),
      cab('c2', 'r1', 'B 시약장'),
      cab('c3', 'r1', '교구장 1'),
      cab('c4', 'r2', '밀폐형 시약장'),
      cab('c5', 'r2', '가연성 보관장'),
      cab('c6', 'r2', '폐수 보관함'),
      cab('c7', 'r3', '교구장 2'),
    ],
  })
  vi.mocked(callApi).mockImplementation(fake.handle as typeof callApi)
})

function renderRooms() {
  return render(
    <MemoryRouter>
      <RoomsPage />
    </MemoryRouter>,
  )
}

function rowOf(name: string) {
  return screen.getByRole('row', { name: new RegExp(name) })
}

describe('RoomsPage', () => {
  test('counts cabinets per room from one cabinet list', async () => {
    renderRooms()
    await screen.findByRole('link', { name: '제1과학실' })
    expect(within(rowOf('제1과학실')).getByText('3개')).toBeInTheDocument()
    expect(within(rowOf('과학 준비실')).getByText('3개')).toBeInTheDocument()
    expect(within(rowOf('제2과학실')).getByText('1개')).toBeInTheDocument()
    expect(fake.called('records.list').filter((p) => p.table === 'Cabinets')).toHaveLength(1)
    expect(within(rowOf('제1과학실')).getByText(/김운영/)).toBeInTheDocument()
  })

  test('filters by name and by science-lab only', async () => {
    renderRooms()
    await screen.findByRole('link', { name: '제1과학실' })
    await userEvent.click(screen.getByLabelText('과학실만 보기'))
    expect(screen.queryByRole('link', { name: '과학 준비실' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '제2과학실' })).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('교실 이름 검색'), '제1')
    expect(screen.queryByRole('link', { name: '제2과학실' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '제1과학실' })).toBeInTheDocument()
  })

  test('a double click on add creates one room', async () => {
    renderRooms()
    await screen.findByRole('link', { name: '제1과학실' })
    const release = fake.hold('records.create')
    await userEvent.type(screen.getByLabelText('새 교실 이름'), '제3과학실')
    const add = screen.getByRole('button', { name: '교실 추가' })
    await userEvent.click(add)
    await userEvent.click(add)
    release()
    expect(await screen.findByRole('link', { name: '제3과학실' })).toBeInTheDocument()
    expect(fake.called('records.create')).toHaveLength(1)
  })

  test('adds, renames and deletes a room', async () => {
    renderRooms()
    await screen.findByRole('link', { name: '제1과학실' })
    await userEvent.type(screen.getByLabelText('새 교실 이름'), '제3과학실')
    await userEvent.click(screen.getByRole('button', { name: '교실 추가' }))
    expect(fake.called('records.create')[0]).toEqual({ table: 'Rooms', values: { name: '제3과학실', isLab: true } })
    expect(await screen.findByRole('link', { name: '제3과학실' })).toBeInTheDocument()

    vi.spyOn(window, 'prompt').mockReturnValue('제3 과학실(2층)')
    await userEvent.click(within(rowOf('제3과학실')).getByRole('button', { name: '이름 변경' }))
    expect(await screen.findByRole('link', { name: '제3 과학실(2층)' })).toBeInTheDocument()

    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await userEvent.click(within(rowOf('제3 과학실')).getByRole('button', { name: '삭제' }))
    expect(fake.called('records.delete')).toHaveLength(1)
  })
})

describe('CabinetSearch', () => {
  test('finds cabinets by part of the name as "room › cabinet" and opens one', async () => {
    render(
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<CabinetSearch />} />
          <Route path="/cabinets/:cabinetId" element={<p>열린 보관장</p>} />
        </Routes>
      </MemoryRouter>,
    )
    await userEvent.type(screen.getByLabelText('보관장 찾기'), '교구장')
    const results = await screen.findAllByRole('option')
    expect(results.map((r) => r.textContent)).toEqual(['제1과학실 › 교구장 1', '제2과학실 › 교구장 2'])
    await userEvent.click(results[1])
    expect(await screen.findByText('열린 보관장')).toBeInTheDocument()
  })
})
