import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { ApiError, callApi } from '../api/client'
import UsersPage from './UsersPage'

vi.mock('../api/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api/client')>()
  return { ...real, callApi: vi.fn() }
})

const api = vi.mocked(callApi)
let users: Record<string, unknown>[]

beforeEach(() => {
  users = [
    { id: 'u1', loginId: 'kim', name: '김운영', role: 'admin', mustChangePassword: false, active: true },
    { id: 'u2', loginId: 'lee', name: '이교사', role: 'teacher', mustChangePassword: false, active: true },
  ]
  api.mockReset()
  api.mockImplementation(async (action: string, payload?: object) => {
    const p = (payload ?? {}) as Record<string, unknown>
    if (action === 'users.list') return users
    if (action === 'users.create') {
      const user = { id: 'u3', loginId: p.loginId, name: p.name, role: p.role, mustChangePassword: true, active: true }
      users = [...users, user]
      return { user, tempPassword: 'a1b2c3d4e5' }
    }
    if (action === 'users.resetPassword') return { tempPassword: 'f6e5d4c3b2' }
    if (action === 'users.update') {
      if (p.id === 'u1') throw new ApiError('INVALID', '운영 교사가 최소 1명 있어야 합니다.')
      users = users.map((u) => (u.id === p.id ? { ...u, ...p } : u))
      return users.find((u) => u.id === p.id)
    }
    throw new Error('unexpected ' + action)
  })
})

function rowOf(name: string) {
  return screen.getByRole('row', { name: new RegExp(name) })
}

describe('UsersPage', () => {
  test('lists accounts with login id, role and status', async () => {
    render(<UsersPage />)
    expect(await screen.findByRole('cell', { name: 'lee' })).toBeInTheDocument()
    expect(within(rowOf('이교사')).getByLabelText('역할')).toHaveValue('teacher')
    expect(within(rowOf('이교사')).getByText('사용 중')).toBeInTheDocument()
  })

  test('creating an account shows the temporary password once, with a copy button', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(<UsersPage />)
    await screen.findByRole('cell', { name: 'lee' })
    await userEvent.type(screen.getByLabelText('새 계정 아이디'), 'park')
    await userEvent.type(screen.getByLabelText('새 계정 이름'), '박교사')
    await userEvent.click(screen.getByRole('button', { name: '계정 만들기' }))
    expect(api).toHaveBeenCalledWith('users.create', { loginId: 'park', name: '박교사', role: 'teacher' })
    const notice = await screen.findByRole('status')
    expect(notice).toHaveTextContent('박교사')
    expect(notice).toHaveTextContent('a1b2c3d4e5')
    await userEvent.click(within(notice).getByRole('button', { name: '복사' }))
    expect(writeText).toHaveBeenCalledWith('a1b2c3d4e5')
    expect(await screen.findByRole('cell', { name: 'park' })).toBeInTheDocument()
  })

  test('resetting a password shows the new temporary password', async () => {
    render(<UsersPage />)
    await screen.findByRole('cell', { name: 'lee' })
    await userEvent.click(within(rowOf('이교사')).getByRole('button', { name: '비밀번호 초기화' }))
    expect(api).toHaveBeenCalledWith('users.resetPassword', { id: 'u2' })
    expect(await screen.findByRole('status')).toHaveTextContent('f6e5d4c3b2')
  })

  test('changing role and deactivating call users.update', async () => {
    render(<UsersPage />)
    await screen.findByRole('cell', { name: 'lee' })
    await userEvent.selectOptions(within(rowOf('이교사')).getByLabelText('역할'), 'admin')
    expect(api).toHaveBeenCalledWith('users.update', { id: 'u2', role: 'admin' })
    await userEvent.click(within(rowOf('이교사')).getByRole('button', { name: '사용 중지' }))
    expect(api).toHaveBeenCalledWith('users.update', { id: 'u2', active: false })
    expect(await within(rowOf('이교사')).findByText('사용 중지됨')).toBeInTheDocument()
  })

  test('shows the server message when the last admin would be removed', async () => {
    render(<UsersPage />)
    await screen.findByRole('cell', { name: 'kim' })
    await userEvent.click(within(rowOf('김운영')).getByRole('button', { name: '사용 중지' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('운영 교사가 최소 1명 있어야 합니다.')
  })
})
