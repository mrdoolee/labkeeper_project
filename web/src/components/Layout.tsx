import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { ChevronLeft, FlaskConical, Home, LayoutGrid, LogOut, SlidersHorizontal, Users, type LucideIcon } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import CabinetSearch from './CabinetSearch'

const COLLAPSED_KEY = 'labkeeper.navCollapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function NavItem({ to, end, icon: Icon, label, collapsed }: { to: string; end?: boolean; icon: LucideIcon; label: string; collapsed: boolean }) {
  return (
    <NavLink to={to} end={end} className="nav-item" aria-label={collapsed ? label : undefined} title={collapsed ? label : undefined}>
      <Icon size={20} aria-hidden="true" />
      {!collapsed && <span>{label}</span>}
    </NavLink>
  )
}

export default function Layout() {
  const { user, logout } = useAuth()
  const [collapsed, setCollapsed] = useState(readCollapsed)

  function toggle() {
    const next = !collapsed
    setCollapsed(next)
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0')
    } catch {
      // Storage blocked: the menu still toggles for this visit.
    }
  }

  return (
    <div className={`shell${collapsed ? ' nav-collapsed' : ''}`}>
      <nav className={`sidebar${collapsed ? ' collapsed' : ''}`} aria-label="주 메뉴">
        <div className="sidebar-head">
          <span className="logo-tile" aria-hidden="true">
            <FlaskConical size={18} />
          </span>
          {!collapsed && <span className="brand">LabKeeper</span>}
          <button type="button" className="icon-button collapse-button" aria-label={collapsed ? '메뉴 펴기' : '메뉴 접기'} onClick={toggle}>
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="nav-items">
          <NavItem to="/" end icon={Home} label="홈" collapsed={collapsed} />
          <NavItem to="/rooms" icon={LayoutGrid} label="교실·보관장" collapsed={collapsed} />
          <NavItem to="/settings" icon={SlidersHorizontal} label="설정" collapsed={collapsed} />
          {user?.role === 'admin' && <NavItem to="/users" icon={Users} label="계정 관리" collapsed={collapsed} />}
        </div>
        <div className="user-box">
          <span className="avatar" aria-hidden="true">
            {user?.name.slice(0, 1)}
          </span>
          {!collapsed && (
            <span className="user-text">
              <span className="user-name">{user?.name} 선생님</span>
              <span className="user-role">{user?.role === 'admin' ? '운영 교사' : '일반 교사'}</span>
            </span>
          )}
          <button type="button" className="icon-button" aria-label="로그아웃" title="로그아웃" onClick={() => logout()}>
            <LogOut size={18} aria-hidden="true" />
          </button>
        </div>
      </nav>
      <div className="main">
        <header className="topbar">
          <CabinetSearch />
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
