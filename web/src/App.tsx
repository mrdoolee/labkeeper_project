import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth/AuthContext'
import Layout from './components/Layout'
import CabinetPage from './pages/CabinetPage'
import ChangePasswordPage from './pages/ChangePasswordPage'
import HomePage from './pages/HomePage'
import LoginPage from './pages/LoginPage'
import RoomPage from './pages/RoomPage'
import RoomsPage from './pages/RoomsPage'
import SettingsPage from './pages/SettingsPage'
import SetupPage from './pages/SetupPage'
import UsersPage from './pages/UsersPage'

export default function App() {
  const { user, loading, needsSetup } = useAuth()

  if (loading && !user) return <p className="auth-screen">불러오는 중…</p>
  if (needsSetup) return <SetupPage />
  if (!user) return <LoginPage />
  if (user.mustChangePassword) return <ChangePasswordPage />

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="rooms" element={<RoomsPage />} />
        <Route path="rooms/:roomId" element={<RoomPage />} />
        <Route path="cabinets/:cabinetId" element={<CabinetPage />} />
        <Route path="settings" element={<SettingsPage />} />
        {user.role === 'admin' && <Route path="users" element={<UsersPage />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
