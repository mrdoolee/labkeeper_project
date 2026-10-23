import { useState, type FormEvent } from 'react'
import { schoolLabel } from '../api/system'
import { useAuth } from '../auth/AuthContext'
import { ErrorMessage, Field, errorText } from '../components/Field'
import { Brand } from '../components/Brand'

export default function LoginPage() {
  const { login, connection, disconnect } = useAuth()
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
        <Brand />
        <h1>로그인</h1>
        <p className="school-line">
          <span>연결된 학교: {schoolLabel(connection.info)}</span>
          <button type="button" className="link-button" onClick={disconnect}>
            다른 스프레드시트에 연결
          </button>
        </p>
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
