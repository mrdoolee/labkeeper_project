import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import CabinetSearch from './CabinetSearch'

export default function Layout() {
  const { user, logout } = useAuth()
  return (
    <div className="shell">
      <nav className="sidebar" aria-label="주 메뉴">
        <div className="brand">LabKeeper</div>
        <NavLink to="/" end>
          홈
        </NavLink>
        <NavLink to="/rooms">교실·보관장</NavLink>
        <NavLink to="/settings">설정</NavLink>
        {user?.role === 'admin' && <NavLink to="/users">계정 관리</NavLink>}
      </nav>
      <div className="main">
        <header className="topbar">
          <CabinetSearch />
          <span className="spacer" />
          <span>{user?.name} 선생님</span>
          <span className="meta">{user?.role === 'admin' ? '운영 교사' : '일반 교사'}</span>
          <button type="button" onClick={() => logout()}>
            로그아웃
          </button>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
