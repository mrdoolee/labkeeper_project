import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import App from './App'
import { ApiError, callApi, getToken, setToken } from './api/client'
import { setGasUrl } from './api/connection'
import { AuthProvider } from './auth/AuthContext'

vi.mock('./api/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('./api/client')>()
  return { ...real, callApi: vi.fn() }
})

const api = vi.mocked(callApi)
type Handler = (payload: Record<string, unknown>, url?: string | null) => unknown

const A = 'https://script.google.com/macros/s/AKfyA/exec'
const B = 'https://script.google.com/macros/s/AKfyB/exec'
const READY = { name: 'LabKeeper', apiVersion: 3, needsSetup: false, copied: false, closed: false, closedNote: '', schoolName: '청주중학교', managerName: '김운영' }

// system.info answers READY unless a test says otherwise.
function serve(handlers: Record<string, Handler | unknown>) {
  const all: Record<string, Handler | unknown> = { 'system.info': READY, ...handlers }
  api.mockImplementation(async (action: string, payload?: object, url?: string | null) => {
    if (!(action in all)) throw new Error('unexpected action ' + action)
    const h = all[action]
    return typeof h === 'function' ? (h as Handler)((payload ?? {}) as Record<string, unknown>, url) : h
  })
}

function networkDown(): never {
  throw new ApiError('NETWORK', '서버에 연결할 수 없습니다.')
}

const admin = { id: 'u1', loginId: 'kim', name: '김운영', role: 'admin', mustChangePassword: false, active: true }
const teacher = { ...admin, id: 'u2', loginId: 'lee', name: '이교사', role: 'teacher' }

function renderApp(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  api.mockReset()
  setToken(null)
  localStorage.clear()
  setGasUrl(null)
  setGasUrl(A)
  history.replaceState(null, '', '/')
})

describe('connecting the school spreadsheet', () => {
  test('with no stored address it asks for one, tests it, saves it and shows login', async () => {
    setGasUrl(null)
    serve({})
    renderApp()
    expect(await screen.findByRole('heading', { name: '스프레드시트 연결' })).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('GAS 웹 앱 주소'), A)
    await userEvent.click(screen.getByRole('button', { name: '연결 테스트' }))
    expect(api).toHaveBeenCalledWith('system.info', undefined, A)
    expect(await screen.findByText('연결됨: 청주중학교')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '저장하고 계속' }))
    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
    expect(screen.getByText('연결된 학교: 청주중학교')).toBeInTheDocument()
    expect(localStorage.getItem('labkeeper.gasUrl')).toBe(A)
  })

  test('a failed test explains the usual causes', async () => {
    setGasUrl(null)
    serve({ 'system.info': networkDown })
    renderApp()
    await userEvent.type(await screen.findByLabelText('GAS 웹 앱 주소'), A)
    await userEvent.click(screen.getByRole('button', { name: '연결 테스트' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('연결하지 못했습니다')
    expect(alert).toHaveTextContent('모든 사용자')
    expect(screen.queryByRole('button', { name: '저장하고 계속' })).not.toBeInTheDocument()
  })

  test('a malformed address is refused before any request', async () => {
    setGasUrl(null)
    serve({})
    renderApp()
    await userEvent.type(await screen.findByLabelText('GAS 웹 앱 주소'), 'https://example.com/exec')
    await userEvent.click(screen.getByRole('button', { name: '연결 테스트' }))
    expect(screen.getByRole('alert')).toHaveTextContent('구글 Apps Script 웹 앱 주소')
    expect(api).not.toHaveBeenCalled()
  })

  test('a school without a name is shown as such', async () => {
    serve({ 'system.info': { ...READY, schoolName: '' } })
    renderApp()
    expect(await screen.findByText('연결된 학교: 학교 이름 미설정')).toBeInTheDocument()
  })

  test('a network failure at start shows an error screen; retry recovers', async () => {
    let down = true
    serve({ 'system.info': () => (down ? networkDown() : READY) })
    renderApp()
    expect(await screen.findByRole('heading', { name: '스프레드시트에 연결할 수 없습니다' })).toBeInTheDocument()
    down = false
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
  })

  test('주소 바꾸기 on the error screen goes to the connect screen with the old address filled in', async () => {
    serve({ 'system.info': networkDown })
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: '주소 바꾸기' }))
    expect(await screen.findByLabelText('GAS 웹 앱 주소')).toHaveValue(A)
  })

  test('a copied sheet shows the copy screen', async () => {
    serve({ 'system.info': { ...READY, copied: true } })
    renderApp()
    expect(await screen.findByRole('heading', { name: '운영 중인 시트의 사본입니다' })).toBeInTheDocument()
    expect(screen.getByText(/사본을 새 학교 시트로 시작/)).toBeInTheDocument()
  })

  test('an old GAS version asks for a redeploy', async () => {
    serve({ 'system.info': { ...READY, apiVersion: 2 } })
    renderApp()
    expect(await screen.findByRole('heading', { name: '학교 시트의 프로그램이 옛 버전입니다' })).toBeInTheDocument()
  })

  test('no admin yet points to the sheet menu and offers no account form', async () => {
    let info = { ...READY, needsSetup: true }
    serve({ 'system.info': () => info })
    renderApp()
    expect(await screen.findByRole('heading', { name: '운영 교사 계정을 먼저 만들어 주세요' })).toBeInTheDocument()
    expect(screen.getByText(/LabKeeper → 운영 교사 계정 만들기/)).toBeInTheDocument()
    expect(screen.queryByLabelText('비밀번호')).not.toBeInTheDocument()
    info = READY
    await userEvent.click(screen.getByRole('button', { name: '다시 확인' }))
    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
  })

  test('a school still on the old GAS (no system.info) is told to redeploy, not that it cannot connect', async () => {
    serve({
      'system.info': () => {
        throw new ApiError('UNKNOWN_ACTION', '알 수 없는 요청입니다.')
      },
    })
    renderApp()
    expect(await screen.findByRole('heading', { name: '학교 시트의 프로그램이 옛 버전입니다' })).toBeInTheDocument()
  })

  test('testing an address whose GAS is too old says so', async () => {
    setGasUrl(null)
    serve({
      'system.info': () => {
        throw new ApiError('UNKNOWN_ACTION', '알 수 없는 요청입니다.')
      },
    })
    renderApp()
    await userEvent.type(await screen.findByLabelText('GAS 웹 앱 주소'), A)
    await userEvent.click(screen.getByRole('button', { name: '연결 테스트' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('옛 버전')
  })

  test.each([
    ['needsSetup', { needsSetup: true }, '운영 교사 계정을 먼저 만들어 주세요'],
    ['old version', { apiVersion: 1 }, '학교 시트의 프로그램이 옛 버전입니다'],
  ])('the %s screen offers 주소 바꾸기', async (_name, info, heading) => {
    serve({ 'system.info': { ...READY, ...info } })
    renderApp()
    await screen.findByRole('heading', { name: heading })
    await userEvent.click(screen.getByRole('button', { name: '주소 바꾸기' }))
    expect(await screen.findByRole('heading', { name: '스프레드시트 연결' })).toBeInTheDocument()
  })

  test('the distribution template cannot be used and says to use a copy', async () => {
    serve({ 'system.info': { ...READY, template: true, needsSetup: true, schoolName: '', managerName: '' } })
    renderApp()
    expect(await screen.findByRole('heading', { name: '배포용 원본 시트입니다' })).toBeInTheDocument()
    expect(screen.getByText(/사본 만들기/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '주소 바꾸기' }))
    expect(await screen.findByRole('heading', { name: '스프레드시트 연결' })).toBeInTheDocument()
  })

  test('a closed sheet shows the closing note and a way to another address', async () => {
    serve({ 'system.info': { ...READY, closed: true, closedNote: '새 접속 링크는 운영 교사에게 받으세요.' } })
    renderApp()
    expect(await screen.findByRole('heading', { name: '이 학교 시트는 운영이 종료되었습니다' })).toBeInTheDocument()
    expect(screen.getByText('새 접속 링크는 운영 교사에게 받으세요.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '주소 바꾸기' }))
    expect(await screen.findByRole('heading', { name: '스프레드시트 연결' })).toBeInTheDocument()
  })

  test('다른 스프레드시트에 연결 returns to the connect screen', async () => {
    serve({})
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: '다른 스프레드시트에 연결' }))
    expect(await screen.findByRole('heading', { name: '스프레드시트 연결' })).toBeInTheDocument()
  })
})

describe('school link (?gas=)', () => {
  // Without an explicit url, callApi uses the saved address.
  const infoFor: Handler = (_p, url) => ({
    ...READY,
    schoolName: (url ?? localStorage.getItem('labkeeper.gasUrl')) === B ? '충주고등학교' : '청주중학교',
  })

  test('with nothing stored it connects straight away', async () => {
    setGasUrl(null)
    history.replaceState(null, '', '/?gas=' + encodeURIComponent(B))
    serve({ 'system.info': infoFor })
    renderApp()
    expect(await screen.findByText('연결된 학교: 충주고등학교')).toBeInTheDocument()
    expect(localStorage.getItem('labkeeper.gasUrl')).toBe(B)
    expect(location.search).toBe('')
  })

  test('a link to another school asks first; 그대로 두기 keeps the old one', async () => {
    history.replaceState(null, '', '/?gas=' + encodeURIComponent(B))
    serve({ 'system.info': infoFor })
    renderApp()
    expect(await screen.findByRole('heading', { name: '다른 학교 스프레드시트로 연결을 바꿀까요?' })).toBeInTheDocument()
    expect(screen.getByText('지금: 청주중학교')).toBeInTheDocument()
    expect(screen.getByText('새 링크: 충주고등학교')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '그대로 두기' }))
    expect(await screen.findByText('연결된 학교: 청주중학교')).toBeInTheDocument()
    expect(localStorage.getItem('labkeeper.gasUrl')).toBe(A)
  })

  test('바꾸기 switches school and logs out', async () => {
    setToken('t')
    history.replaceState(null, '', '/?gas=' + encodeURIComponent(B))
    serve({ 'system.info': infoFor, 'auth.me': admin })
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: '바꾸기' }))
    expect(await screen.findByText('연결된 학교: 충주고등학교')).toBeInTheDocument()
    expect(localStorage.getItem('labkeeper.gasUrl')).toBe(B)
    expect(getToken()).toBeNull()
  })

  test('a link whose school name copies the current one is called out, and keeping is the main choice', async () => {
    history.replaceState(null, '', '/?gas=' + encodeURIComponent(B))
    serve({ 'system.info': READY })
    renderApp()
    await screen.findByRole('heading', { name: '다른 학교 스프레드시트로 연결을 바꿀까요?' })
    expect(screen.getByText(/이름은 같지만 다른 스프레드시트입니다/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '그대로 두기' })).toHaveClass('primary')
    expect(screen.getByRole('button', { name: '바꾸기' })).not.toHaveClass('primary')
  })

  test('when the current school cannot be reached the switch screen says so', async () => {
    history.replaceState(null, '', '/?gas=' + encodeURIComponent(B))
    serve({ 'system.info': (_p: Record<string, unknown>, url?: string | null) => (url === B ? { ...READY, schoolName: '충주고등학교' } : networkDown()) })
    renderApp()
    expect(await screen.findByText('지금: 확인할 수 없음')).toBeInTheDocument()
  })

  test('a link to the same school changes nothing', async () => {
    history.replaceState(null, '', '/?gas=' + encodeURIComponent(A))
    serve({ 'system.info': infoFor })
    renderApp()
    expect(await screen.findByText('연결된 학교: 청주중학교')).toBeInTheDocument()
  })
})

describe('login', () => {
  test('shows id and password fields when nobody is logged in', async () => {
    serve({})
    renderApp()
    expect(await screen.findByLabelText('아이디')).toBeInTheDocument()
    expect(screen.getByLabelText('비밀번호')).toBeInTheDocument()
  })

  test('shows the server message when login fails', async () => {
    serve({
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
    setToken('t')
    let me = { ...teacher, mustChangePassword: true }
    serve({
      'auth.me': () => me,
      'auth.changePassword': () => {
        me = { ...teacher }
        return { token: 'after-change' }
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
    // The server ends older sessions, so the new token must be kept.
    expect(getToken()).toBe('after-change')
  })
})

describe('menu', () => {
  test('a teacher does not see account management', async () => {
    setToken('t')
    serve({ 'auth.me': teacher })
    renderApp()
    const menu = await screen.findByRole('navigation', { name: '주 메뉴' })
    expect(within(menu).getByRole('link', { name: '교실·보관장' })).toBeInTheDocument()
    expect(within(menu).queryByRole('link', { name: '계정 관리' })).not.toBeInTheDocument()
  })

  test('an admin sees account management and can log out', async () => {
    setToken('t')
    serve({ 'auth.me': admin, 'auth.logout': true })
    renderApp()
    expect(await screen.findByRole('link', { name: '계정 관리' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '로그아웃' }))
    await waitFor(() => expect(screen.getByLabelText('아이디')).toBeInTheDocument())
  })
})

describe('routes', () => {
  test('an admin can open account management', async () => {
    setToken('t')
    serve({ 'auth.me': admin, 'users.list': [admin] })
    renderApp('/users')
    expect(await screen.findByRole('heading', { name: '계정 관리' })).toBeInTheDocument()
  })

  test('a teacher who types /users is sent home', async () => {
    setToken('t')
    serve({ 'auth.me': teacher })
    renderApp('/users')
    expect(await screen.findByRole('heading', { name: /안녕하세요/ })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '계정 관리' })).not.toBeInTheDocument()
  })

  test('settings opens for everyone', async () => {
    setToken('t')
    serve({
      'auth.me': teacher,
      'settings.get': { schoolName: '', schoolLevel: 'middle', region: 'chungbuk', signerScienceHead: '', signerVicePrincipal: '', signerPrincipal: '', labOver100m2: false, wasteDisposal: 'office' },
    })
    renderApp('/settings')
    expect(await screen.findByRole('heading', { name: '설정' })).toBeInTheDocument()
  })

  test('rooms and the top-bar cabinet search are available to everyone', async () => {
    setToken('t')
    serve({ 'auth.me': teacher, 'records.list': [], 'directory.list': [] })
    renderApp('/rooms')
    expect(await screen.findByRole('heading', { name: '교실·보관장' })).toBeInTheDocument()
    expect(screen.getByLabelText('보관장 찾기')).toBeInTheDocument()
  })
})
