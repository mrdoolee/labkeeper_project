import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { callApi } from '../api/client'
import HistoryDialog from '../components/HistoryDialog'
import SettingsPage from './SettingsPage'

vi.mock('../api/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api/client')>()
  return { ...real, callApi: vi.fn() }
})

const api = vi.mocked(callApi)

const SETTINGS = {
  schoolName: '청주중학교',
  schoolLevel: 'middle',
  region: 'chungbuk',
  signerScienceHead: '',
  signerVicePrincipal: '',
  signerPrincipal: '',
  labOver100m2: false,
  wasteDisposal: 'office',
}

const HISTORY = [
  {
    id: 'a2',
    at: '2026-03-03T01:05:00.000Z',
    userId: 'u2',
    userName: '이교사',
    table: 'Rooms',
    recordId: 'r1',
    action: 'update',
    before: { name: '과학실', isLab: false },
    after: { name: '제2과학실', isLab: true },
  },
  { id: 'a1', at: '2026-03-02T01:00:00.000Z', userId: 'u1', userName: '김운영', table: 'Rooms', recordId: 'r1', action: 'create', before: null, after: { name: '과학실' } },
]

beforeEach(() => {
  api.mockReset()
  api.mockImplementation(async (action: string, payload?: object) => {
    if (action === 'settings.get') return SETTINGS
    if (action === 'settings.update') return { ...SETTINGS, ...payload }
    if (action === 'audit.list') return HISTORY
    throw new Error('unexpected ' + action)
  })
})

describe('SettingsPage', () => {
  test('shows saved settings and sends only what changed', async () => {
    render(<SettingsPage />)
    const school = await screen.findByLabelText('학교 이름')
    expect(school).toHaveValue('청주중학교')
    expect(screen.getByLabelText('장부 양식 지역')).toHaveValue('chungbuk')
    await userEvent.clear(school)
    await userEvent.type(school, '청주고등학교')
    await userEvent.selectOptions(screen.getByLabelText('학교급'), 'high')
    await userEvent.type(screen.getByLabelText('과학부장'), '박부장')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(api).toHaveBeenCalledWith('settings.update', { schoolName: '청주고등학교', schoolLevel: 'high', signerScienceHead: '박부장' })
    expect(await screen.findByRole('status')).toHaveTextContent('저장했습니다')
  })

  test('has all regions, levels and waste options from the design', async () => {
    render(<SettingsPage />)
    const region = await screen.findByLabelText('장부 양식 지역')
    expect(within(region).getAllByRole('option').map((o) => o.textContent)).toEqual(['충북', '서울', '경기'])
    expect(within(screen.getByLabelText('학교급')).getAllByRole('option').map((o) => o.textContent)).toEqual(['중학교', '고등학교'])
    expect(within(screen.getByLabelText('폐수 처리 방식')).getAllByRole('option').map((o) => o.textContent)).toEqual([
      '교육청 위탁',
      '학교 자체 처리',
    ])
    expect(screen.getByLabelText('실험실 면적 100㎡ 이상')).not.toBeChecked()
  })

  test('the history button opens the settings history', async () => {
    render(<SettingsPage />)
    await screen.findByLabelText('학교 이름')
    await userEvent.click(screen.getByRole('button', { name: '변경 이력' }))
    expect(api).toHaveBeenCalledWith('audit.list', { table: 'Settings' })
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })
})

describe('HistoryDialog', () => {
  test('lists who changed what, newest first, as before → after', async () => {
    render(<HistoryDialog table="Rooms" recordId="r1" onClose={() => {}} />)
    const dialog = await screen.findByRole('dialog')
    const rows = await within(dialog).findAllByRole('row')
    expect(rows[1]).toHaveTextContent('이교사')
    expect(rows[1]).toHaveTextContent('수정')
    expect(rows[1]).toHaveTextContent('이름: 과학실 → 제2과학실')
    expect(rows[1]).toHaveTextContent('과학실 여부: 아니요 → 예')
    expect(rows[2]).toHaveTextContent('김운영')
    expect(rows[2]).toHaveTextContent('추가')
    expect(api).toHaveBeenCalledWith('audit.list', { table: 'Rooms', recordId: 'r1' })
  })

  test('closes with the close button', async () => {
    const onClose = vi.fn()
    render(<HistoryDialog table="Rooms" recordId="r1" onClose={onClose} />)
    await userEvent.click(await screen.findByRole('button', { name: '닫기' }))
    expect(onClose).toHaveBeenCalled()
  })

  test('the whole-table view names each record, including deleted ones', async () => {
    api.mockImplementation(async (action: string) => {
      if (action !== 'audit.list') throw new Error('unexpected ' + action)
      return [
        { id: 'a3', at: '2026-03-04T01:00:00.000Z', userId: 'u2', userName: '이교사', table: 'Rooms', recordId: 'r2', action: 'delete', before: { name: '준비실' }, after: null },
        { ...HISTORY[0] },
      ]
    })
    render(<HistoryDialog table="Rooms" names={{ r1: '제1과학실' }} onClose={() => {}} />)
    const rows = await within(await screen.findByRole('dialog')).findAllByRole('row')
    expect(rows[0]).toHaveTextContent('대상')
    expect(rows[1]).toHaveTextContent('준비실')
    expect(rows[1]).toHaveTextContent('삭제')
    expect(rows[2]).toHaveTextContent('제1과학실')
  })

  test('password changes and resets read as such', async () => {
    api.mockImplementation(async () => [
      { id: 'a5', at: '2026-03-05T01:00:00.000Z', userId: 'u1', userName: '김운영', table: 'Users', recordId: 'u2', action: 'passwordReset', before: null, after: null },
      { id: 'a4', at: '2026-03-04T01:00:00.000Z', userId: 'u2', userName: '이교사', table: 'Users', recordId: 'u2', action: 'passwordChange', before: null, after: null },
    ])
    render(<HistoryDialog table="Users" recordId="u2" onClose={() => {}} />)
    const rows = await within(await screen.findByRole('dialog')).findAllByRole('row')
    expect(rows[1]).toHaveTextContent('비밀번호 초기화')
    expect(rows[2]).toHaveTextContent('비밀번호 변경')
  })
})
