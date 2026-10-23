import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { callApi, getToken, setOnAuthRequired, setToken } from '../api/client'

export interface User {
  id: string
  loginId: string
  name: string
  role: 'admin' | 'teacher'
  mustChangePassword: boolean
  active: boolean
}

interface AuthState {
  user: User | null
  loading: boolean
  needsSetup: boolean
  login(loginId: string, password: string): Promise<void>
  setupAdmin(loginId: string, name: string, password: string): Promise<void>
  logout(): Promise<void>
  refresh(): Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [needsSetup, setNeedsSetup] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const status = await callApi<{ needsSetup: boolean }>('setup.status')
      setNeedsSetup(status.needsSetup)
      setUser(!status.needsSetup && getToken() ? await callApi<User>('auth.me').catch(() => null) : null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setOnAuthRequired(() => setUser(null))
    refresh().catch(() => {})
  }, [refresh])

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      needsSetup,
      refresh,
      async login(loginId, password) {
        const res = await callApi<{ token: string; user: User }>('auth.login', { loginId, password })
        setToken(res.token)
        setUser(res.user)
      },
      async setupAdmin(loginId, name, password) {
        const res = await callApi<{ token: string; user: User }>('setup.createAdmin', { loginId, name, password })
        setToken(res.token)
        setNeedsSetup(false)
        setUser(res.user)
      },
      async logout() {
        await callApi('auth.logout').catch(() => {})
        setToken(null)
        setUser(null)
      },
    }),
    [user, loading, needsSetup, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
