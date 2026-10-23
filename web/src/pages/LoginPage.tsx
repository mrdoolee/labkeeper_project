import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth/AuthContext'
import { ErrorMessage, Field, errorText } from '../components/Field'

export default function LoginPage() {
  const { login } = useAuth()
  const [loginId, setLoginId] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(loginId, password)
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
        <h1>로그인</h1>
        <ErrorMessage message={error} />
        <Field label="아이디" value={loginId} onChange={(e) => setLoginId(e.target.value)} required autoComplete="username" />
        <Field label="비밀번호" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
        <button className="primary" type="submit" disabled={busy}>
          로그인
        </button>
        <p className="hint">비밀번호를 잊었으면 운영 교사에게 초기화를 요청하세요.</p>
      </form>
    </div>
  )
}
