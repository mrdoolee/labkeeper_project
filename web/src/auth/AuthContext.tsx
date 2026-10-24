import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ApiError, callApi, getToken, setOnAuthRequired, setToken } from '../api/client'
import { getGasUrl, setGasUrl, takeGasFromQuery } from '../api/connection'
import { fetchSystemInfo, REQUIRED_API_VERSION, type SystemInfo } from '../api/system'

export interface User {
  id: string
  loginId: string
  name: string
  role: 'admin' | 'teacher'
  mustChangePassword: boolean
  active: boolean
}

export type ConnectionState = 'none' | 'checking' | 'error' | 'copied' | 'template' | 'closed' | 'outdated' | 'needsAdmin' | 'switch' | 'ready'

export interface Connection {
  state: ConnectionState
  info: SystemInfo | null
  /** A school link to a different spreadsheet, waiting for the user to accept it. */
  pending: { url: string; info: SystemInfo | null } | null
  /** The address used before "주소 바꾸기", to prefill the connect screen. */
  lastUrl: string | null
}

interface AuthState {
  user: User | null
  loading: boolean
  connection: Connection
  connect(url: string): Promise<void>
  disconnect(): void
  recheck(): Promise<void>
  acceptSwitch(): Promise<void>
  rejectSwitch(): Promise<void>
  login(loginId: string, password: string): Promise<void>
  logout(): Promise<void>
  refresh(): Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function isOldGas(err: unknown): boolean {
  return err instanceof ApiError && err.code === 'UNKNOWN_ACTION'
}

function stateFor(info: SystemInfo): ConnectionState {
  if (info.template) return 'template'
  if (info.copied) return 'copied'
  if (info.apiVersion < REQUIRED_API_VERSION) return 'outdated'
  if (info.closed) return 'closed'
  if (info.needsSetup) return 'needsAdmin'
  return 'ready'
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [connection, setConnection] = useState<Connection>({ state: 'checking', info: null, pending: null, lastUrl: null })
  const started = useRef(false)

  const loadUser = useCallback(async () => {
    setLoading(true)
    try {
      setUser(getToken() ? await callApi<User>('auth.me').catch(() => null) : null)
    } finally {
      setLoading(false)
    }
  }, [])

  // Asks the saved school's GAS how things stand, then loads the user when ready.
  const recheck = useCallback(async () => {
    if (!getGasUrl()) {
      setConnection((c) => ({ ...c, state: 'none', info: null, pending: null }))
      setUser(null)
      setLoading(false)
      return
    }
    setConnection((c) => ({ ...c, state: 'checking' }))
    let info: SystemInfo
    try {
      info = await fetchSystemInfo()
    } catch (err) {
      // GAS from before system.info existed answers UNKNOWN_ACTION: it needs a redeploy.
      const state = isOldGas(err) ? 'outdated' : 'error'
      setConnection((c) => ({ ...c, state, info: null, pending: null }))
      setLoading(false)
      return
    }
    const state = stateFor(info)
    setConnection((c) => ({ ...c, state, info, pending: null }))
    if (state === 'ready') await loadUser()
    else {
      setUser(null)
      setLoading(false)
    }
  }, [loadUser])

  useEffect(() => {
    setOnAuthRequired(() => setUser(null))
    if (started.current) return
    started.current = true
    const fromLink = takeGasFromQuery()
    const current = getGasUrl()
    if (fromLink && current && fromLink !== current) {
      // A link to another school: ask before switching (a forged link must not silently take over).
      Promise.all([fetchSystemInfo().catch(() => null), fetchSystemInfo(fromLink).catch(() => null)]).then(([info, linkInfo]) => {
        setConnection({ state: 'switch', info, pending: { url: fromLink, info: linkInfo }, lastUrl: null })
        setLoading(false)
      })
      return
    }
    if (fromLink && !current) setGasUrl(fromLink)
    recheck().catch(() => {})
  }, [recheck])

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      connection,
      recheck,
      refresh: recheck,
      async connect(url) {
        setGasUrl(url)
        await recheck()
      },
      disconnect() {
        const lastUrl = getGasUrl()
        setGasUrl(null)
        setUser(null)
        setConnection({ state: 'none', info: null, pending: null, lastUrl })
      },
      async acceptSwitch() {
        if (connection.pending) setGasUrl(connection.pending.url)
        await recheck()
      },
      async rejectSwitch() {
        await recheck()
      },
      async login(loginId, password) {
        const res = await callApi<{ token: string; user: User }>('auth.login', { loginId, password })
        setToken(res.token)
        setUser(res.user)
      },
      async logout() {
        await callApi('auth.logout').catch(() => {})
        setToken(null)
        setUser(null)
      },
    }),
    [user, loading, connection, recheck],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
