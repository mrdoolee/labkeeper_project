import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ApiError, callApi } from '../api/client'
import { IMPORT_COLUMNS } from '../domain/reagentImport'
import { buildTemplate, readWorkbook } from '../excel/template'
import { createFakeApi } from '../test/fakeApi'
import ImportPage from './ImportPage'

vi.mock('../api/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api/client')>()
  return { ...real, callApi: vi.fn() }
})
vi.mock('../excel/template', () => ({ buildTemplate: vi.fn(async () => new Blob(['xlsx'])), readWorkbook: vi.fn() }))

const stamp = { deleted: false, createdBy: 'u1', updatedBy: 'u1', updatedAt: '2026-03-02T09:00:00.000Z' }
const header = IMPORT_COLUMNS.map((c) => c.header)
function row(values: Record<string, unknown>): unknown[] {
  return header.map((h) => values[h.replace(' *', '')] ?? null)
}

let fake: ReturnType<typeof createFakeApi>

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-27T03:00:00Z'))
  fake = createFakeApi({
    Rooms: [{ id: 'r1', name: '제1과학실', isLab: true, ...stamp }],
    Cabinets: [{ id: 'c1', roomId: 'r1', name: 'A 시약장', type: 'sealed', locked: true, rows: 1, cols: 1, ...stamp }],
    Zones: [{ id: 'z1', cabinetId: 'c1', row: 1, col: 1, name: '진한 산', allowedClasses: '', ...stamp }],
    Reagents: [{ id: 'nacl', name: '염화 나트륨', concentration: null, unit: 'g', stock: 1, ...stamp }],
  })
  vi.mocked(callApi).mockImplementation(fake.handle as typeof callApi)
})

afterEach(() => {
  vi.useRealTimers()
})

function renderPage() {
  return render(
    <MemoryRouter>
      <ImportPage />
    </MemoryRouter>,
  )
}

async function upload(rows: unknown[][]) {
  vi.mocked(readWorkbook).mockResolvedValue([header, ...rows])
  renderPage()
  await userEvent.upload(await screen.findByLabelText('엑셀 파일'), new File(['x'], '시약.xlsx'))
}

test('the template is built with this school\'s places', async () => {
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: '양식 내려받기' }))
  expect(buildTemplate).toHaveBeenCalledWith([{ zoneId: 'z1', cabinetId: 'c1', label: '제1과학실 › A 시약장 › 진한 산' }])
})

test('the preview marks errors and already registered rows; saving waits until errors are fixed', async () => {
  await upload([row({ 약품명: '붕산', 단위: 'g', '기초 재고량': 100 }), row({ 약품명: '염화 나트륨', 단위: 'g', '기초 재고량': 5 }), row({ 약품명: '질산', 단위: 'L', '기초 재고량': 1 })])
  const table = await screen.findByRole('table', { name: '미리보기' })
  const bad = within(table).getByText('질산').closest('tr')!
  expect(bad).toHaveClass('row-error')
  expect(within(bad).getByText(/단위는 mL 또는 g/)).toBeInTheDocument()
  expect(within(within(table).getByText('염화 나트륨').closest('tr')!).getByText('이미 등록됨 – 건너뜀')).toBeInTheDocument()
  expect(screen.getByText('등록 1건 · 건너뜀 1건 · 오류 1건')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '저장' })).toBeDisabled()
})

test('blank start dates use the date chosen on the page (3월 1일 by default)', async () => {
  await upload([row({ 약품명: '붕산', 단위: 'g', '기초 재고량': 100 })])
  expect(screen.getByLabelText('비어 있는 기준일')).toHaveValue('2026-03-01')
  await userEvent.click(await screen.findByRole('button', { name: '저장' }))
  expect(fake.called('reagents.createMany')[0]).toMatchObject({ rows: [{ line: 2, initialAmount: 100, initialDate: '2026-03-01', values: { name: '붕산', unit: 'g' } }] })
  expect(await screen.findByText('1건 등록, 0건 건너뜀')).toBeInTheDocument()
})

test('large files go in chunks of 200', async () => {
  await upload(Array.from({ length: 250 }, (_, i) => row({ 약품명: `시약 ${i}`, 단위: 'g', '기초 재고량': 1 })))
  await userEvent.click(await screen.findByRole('button', { name: '저장' }))
  await screen.findByText('250건 등록, 0건 건너뜀')
  expect(fake.called('reagents.createMany').map((p) => (p.rows as unknown[]).length)).toEqual([200, 50])
})

test('a failure in a later chunk says how far it got', async () => {
  let calls = 0
  vi.mocked(callApi).mockImplementation(((action: string, payload?: object) => {
    if (action === 'reagents.createMany' && ++calls === 2) return Promise.reject(new ApiError('SERVER_ERROR', '서버 오류가 발생했습니다.'))
    return fake.handle(action, payload)
  }) as typeof callApi)
  await upload(Array.from({ length: 250 }, (_, i) => row({ 약품명: `시약 ${i}`, 단위: 'g', '기초 재고량': 1 })))
  await userEvent.click(await screen.findByRole('button', { name: '저장' }))
  expect(await screen.findByText(/200건까지 저장됨/)).toBeInTheDocument()
})
