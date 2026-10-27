import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth/AuthContext'
import Layout from './components/Layout'
import CabinetPage from './pages/CabinetPage'
import ChangePasswordPage from './pages/ChangePasswordPage'
import ConnectPage from './pages/ConnectPage'
import FindPage from './pages/FindPage'
import HomePage from './pages/HomePage'
import ImportPage from './pages/ImportPage'
import LedgerPage from './pages/LedgerPage'
import LoginPage from './pages/LoginPage'
import ReagentPage from './pages/ReagentPage'
import ReagentsPage from './pages/ReagentsPage'
import RoomPage from './pages/RoomPage'
import RoomsPage from './pages/RoomsPage'
import SettingsPage from './pages/SettingsPage'
import { ClosedScreen, TemplateScreen, ConnectionErrorScreen, CopiedScreen, NeedsAdminScreen, OutdatedScreen, SwitchSchoolScreen } from './pages/StatusScreens'
import UsersPage from './pages/UsersPage'

export default function App() {
  const { user, loading, connection } = useAuth()

  switch (connection.state) {
    case 'checking':
      return <p className="auth-screen">불러오는 중…</p>
    case 'none':
      return <ConnectPage />
    case 'error':
      return <ConnectionErrorScreen />
    case 'copied':
      return <CopiedScreen />
    case 'template':
      return <TemplateScreen />
    case 'closed':
      return <ClosedScreen />
    case 'outdated':
      return <OutdatedScreen />
    case 'needsAdmin':
      return <NeedsAdminScreen />
    case 'switch':
      return <SwitchSchoolScreen />
  }
  if (loading && !user) return <p className="auth-screen">불러오는 중…</p>
  if (!user) return <LoginPage />
  if (user.mustChangePassword) return <ChangePasswordPage />

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="rooms" element={<RoomsPage />} />
        <Route path="rooms/:roomId" element={<RoomPage />} />
        <Route path="cabinets/:cabinetId" element={<CabinetPage />} />
        <Route path="reagents" element={<ReagentsPage />} />
        <Route path="reagents/new" element={<ReagentPage />} />
        <Route path="reagents/import" element={<ImportPage />} />
        <Route path="reagents/ledger" element={<LedgerPage />} />
        <Route path="reagents/:reagentId" element={<ReagentPage />} />
        <Route path="find" element={<FindPage />} />
        <Route path="settings" element={<SettingsPage />} />
        {user.role === 'admin' && <Route path="users" element={<UsersPage />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
