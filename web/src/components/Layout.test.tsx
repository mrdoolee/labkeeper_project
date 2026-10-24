import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import Layout from './Layout'

const logout = vi.fn()
let role: 'admin' | 'teacher' = 'admin'
let info = { schoolName: '청주중학교', managerName: '김운영' }

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', loginId: 'kim', name: '김운영', role, mustChangePassword: false, active: true },
    logout,
    connection: { state: 'ready', info, pending: null, lastUrl: null },
  }),
}))

function renderLayout() {
  return render(
    <MemoryRouter>
      <Layout />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  role = 'admin'
  info = { schoolName: '청주중학교', managerName: '김운영' }
  logout.mockReset()
})

afterEach(() => vi.restoreAllMocks())

test('the menu shows icons with names, and the user box at the bottom', () => {
  renderLayout()
  const menu = screen.getByRole('navigation', { name: '주 메뉴' })
  for (const name of ['홈', '교실·보관장', '설정', '계정 관리']) expect(within(menu).getByRole('link', { name })).toBeVisible()
  expect(within(menu).getByText('김운영 선생님')).toBeInTheDocument()
  expect(within(menu).getByText('운영 교사')).toBeInTheDocument()
  expect(menu.querySelectorAll('svg').length).toBeGreaterThanOrEqual(5)
})

test('a teacher has no account management link', () => {
  role = 'teacher'
  renderLayout()
  expect(screen.queryByRole('link', { name: '계정 관리' })).not.toBeInTheDocument()
  expect(screen.getByText('일반 교사')).toBeInTheDocument()
})

test('collapsing hides the names but keeps the links reachable by name, and is remembered', async () => {
  const { unmount } = renderLayout()
  await userEvent.click(screen.getByRole('button', { name: '메뉴 접기' }))
  const menu = screen.getByRole('navigation', { name: '주 메뉴' })
  expect(menu).toHaveClass('collapsed')
  expect(within(menu).queryByText('설정')).not.toBeInTheDocument()
  expect(within(menu).getByRole('link', { name: '설정' })).toHaveAttribute('title', '설정')
  expect(screen.getByRole('button', { name: '메뉴 펴기' })).toBeInTheDocument()
  unmount()
  renderLayout()
  expect(screen.getByRole('navigation', { name: '주 메뉴' })).toHaveClass('collapsed')
  await userEvent.click(screen.getByRole('button', { name: '메뉴 펴기' }))
  expect(within(screen.getByRole('navigation', { name: '주 메뉴' })).getByText('설정')).toBeInTheDocument()
})

test('still renders when storage is blocked', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  renderLayout()
  await userEvent.click(screen.getByRole('button', { name: '메뉴 접기' }))
  expect(screen.getByRole('navigation', { name: '주 메뉴' })).toHaveClass('collapsed')
})

test('the logout icon button logs out', async () => {
  renderLayout()
  await userEvent.click(screen.getByRole('button', { name: '로그아웃' }))
  expect(logout).toHaveBeenCalled()
})

test('school name and manager from the sheet stay visible, also when the menu is collapsed', async () => {
  renderLayout()
  const menu = screen.getByRole('navigation', { name: '주 메뉴' })
  expect(within(menu).getByText('청주중학교')).toBeVisible()
  expect(within(menu).getByText('관리 교사 김운영')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: '메뉴 접기' }))
  const top = screen.getByRole('banner')
  expect(within(top).getByText('청주중학교')).toBeVisible()
  expect(within(top).getByText('관리 교사 김운영')).toBeVisible()
})

test('missing school info points to the sheet menu', () => {
  info = { schoolName: '', managerName: '' }
  renderLayout()
  expect(screen.getByText('학교 정보 미입력')).toBeInTheDocument()
  expect(screen.getByText('시트 메뉴 → 학교 정보 입력')).toBeInTheDocument()
})
