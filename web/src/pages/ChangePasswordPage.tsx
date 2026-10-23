import { useState, type FormEvent } from 'react'
import { callApi, setToken } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { ErrorMessage, Field, errorText } from '../components/Field'
import { checkNewPassword } from './passwordRules'

export default function ChangePasswordPage() {
  const { user, refresh, logout } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const problem = checkNewPassword(next, confirm)
    if (problem) return setError(problem)
    setBusy(true)
    setError(null)
    try {
      // The server ends every older session, including this one.
      const { token } = await callApi<{ token: string }>('auth.changePassword', { currentPassword: current, newPassword: next })
      setToken(token)
      await refresh()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-screen">
      <form className="card" onSubmit={submit}>
        <div className="brand">LabKeeper</div>
        <h1>비밀번호 변경</h1>
        {user?.mustChangePassword && <p className="hint">임시 비밀번호로 로그인했습니다. 계속하려면 새 비밀번호를 정해 주세요.</p>}
        <ErrorMessage message={error} />
        <Field label="현재 비밀번호" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" />
        <Field label="새 비밀번호" type="password" value={next} onChange={(e) => setNext(e.target.value)} hint="8자 이상" required autoComplete="new-password" />
        <Field label="새 비밀번호 확인" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
        <div className="toolbar">
          <button className="primary" type="submit" disabled={busy}>
            비밀번호 바꾸기
          </button>
          <button type="button" onClick={() => logout()}>
            로그아웃
          </button>
        </div>
      </form>
    </div>
  )
}
