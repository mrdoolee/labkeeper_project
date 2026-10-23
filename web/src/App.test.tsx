import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import App from './App'
import { ApiError, callApi, getToken } from './api/client'
import { AuthProvider } from './auth/AuthContext'

vi.mock('./api/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('./api/client')>()
  return { ...real, callApi: vi.fn(), getToken: vi.fn(), setToken: vi.fn() }
})

const api = vi.mocked(callApi)
type Handler = (payload: Record<string, unknown>) => unknown

function serve(handlers: Record<string, Handler | unknown>) {
  api.mockImplementation(async (action: string, payload?: object) => {
    if (!(action in handlers)) throw new Error('unexpected action ' + action)
    const h = handlers[action]
    return typeof h === 'function' ? (h as Handler)((payload ?? {}) as Record<string, unknown>) : h
  })
}

const admin = { id: 'u1', loginId: 'kim', name: '김운영', role: 'admin', mustChangePassword: false, active: true }
const teacher = { ...admin, id: 'u2', loginId: 'lee', name: '이교사', role: 'teacher' }

function renderApp() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  api.mockReset()
  vi.mocked(getToken).mockReturnValue(null)
})

describe('first run', () => {
  test('shows the admin setup form and creates the account', async () => {
    serve({ 'setup.status': { needsSetup: true }, 'setup.createAdmin': { token: 't', user: admin } })
    renderApp()
    expect(await screen.findByRole('heading', { name: '운영 교사 계정 만들기' })).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('아이디'), 'kim')
    await userEvent.type(screen.getByLabelText('이름'), '김운영')
    await userEvent.type(screen.getByLabelText('비밀번호'), 'first-pass-1')
    await userEvent.type(screen.getByLabelText('비밀번호 확인'), 'first-pass-1')
    await userEvent.click(screen.getByRole('button', { name: '계정 만들기' }))
    expect(api).toHaveBeenCalledWith('setup.createAdmin', { loginId: 'kim', name: '김운영', password: 'first-pass-1' })
    expect(await screen.findByText('김운영 선생님')).toBeInTheDocument()
  })

  test('a short password is caught before calling the server', async () => {
    serve({ 'setup.status': { needsSetup: true } })
    renderApp()
    await userEvent.type(await screen.findByLabelText('아이디'), 'kim')
    await userEvent.type(screen.getByLabelText('이름'), '김운영')
    await userEvent.type(screen.getByLabelText('비밀번호'), 'short')
    await userEvent.type(screen.getByLabelText('비밀번호 확인'), 'short')
    await userEvent.click(screen.getByRole('button', { name: '계정 만들기' }))
    expect(screen.getByRole('alert')).toHaveTextContent('8자 이상')
    expect(api).not.toHaveBeenCalledWith('setup.createAdmin', expect.anything())
  })
})

describe('login', () => {
  test('shows id and password fields when nobody is logged in', async () => {
    serve({ 'setup.status': { needsSetup: false } })
    renderApp()
    expect(await screen.findByLabelText('아이디')).toBeInTheDocument()
    expect(screen.getByLabelText('비밀번호')).toBeInTheDocument()
  })

  test('shows the server message when login fails', async () => {
    serve({
      'setup.status': { needsSetup: false },
      'auth.login': () => {
        throw new ApiError('INVALID', '아이디 또는 비밀번호가 맞지 않습니다.')
      },
    })
    renderApp()
    await userEvent.type(await screen.findByLabelText('아이디'), 'kim')
    await userEvent.type(screen.getByLabelText('비밀번호'), 'wrong-pass')
    await userEvent.click(screen.getByRole('button', { name: '로그인' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('아이디 또는 비밀번호가 맞지 않습니다.')
  })
})

describe('forced password change', () => {
  test('a user with a temporary password must change it, and mismatches are caught', async () => {
    vi.mocked(getToken).mockReturnValue('t')
    let me = { ...teacher, mustChangePassword: true }
    serve({
      'setup.status': { needsSetup: false },
      'auth.me': () => me,
      'auth.changePassword': () => {
        me = { ...teacher }
        return true
      },
    })
    renderApp()
    expect(await screen.findByRole('heading', { name: '비밀번호 변경' })).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('현재 비밀번호'), 'temp123456')
    await userEvent.type(screen.getByLabelText('새 비밀번호'), 'teacher-pass-1')
    await userEvent.type(screen.getByLabelText('새 비밀번호 확인'), 'teacher-pass-2')
    await userEvent.click(screen.getByRole('button', { name: '비밀번호 바꾸기' }))
    expect(screen.getByRole('alert')).toHaveTextContent('일치하지 않습니다')

    await userEvent.clear(screen.getByLabelText('새 비밀번호 확인'))
    await userEvent.type(screen.getByLabelText('새 비밀번호 확인'), 'teacher-pass-1')
    await userEvent.click(screen.getByRole('button', { name: '비밀번호 바꾸기' }))
    expect(api).toHaveBeenCalledWith('auth.changePassword', { currentPassword: 'temp123456', newPassword: 'teacher-pass-1' })
    expect(await screen.findByText('이교사 선생님')).toBeInTheDocument()
  })
})

describe('menu', () => {
  test('a teacher does not see account management', async () => {
    vi.mocked(getToken).mockReturnValue('t')
    serve({ 'setup.status': { needsSetup: false }, 'auth.me': teacher })
    renderApp()
    const menu = await screen.findByRole('navigation', { name: '주 메뉴' })
    expect(within(menu).getByRole('link', { name: '교실·보관장' })).toBeInTheDocument()
    expect(within(menu).queryByRole('link', { name: '계정 관리' })).not.toBeInTheDocument()
  })

  test('an admin sees account management and can log out', async () => {
    vi.mocked(getToken).mockReturnValue('t')
    serve({ 'setup.status': { needsSetup: false }, 'auth.me': admin, 'auth.logout': true })
    renderApp()
    expect(await screen.findByRole('link', { name: '계정 관리' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '로그아웃' }))
    await waitFor(() => expect(screen.getByLabelText('아이디')).toBeInTheDocument())
  })
})
