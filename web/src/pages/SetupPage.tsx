import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth/AuthContext'
import { ErrorMessage, Field, errorText } from '../components/Field'
import { checkNewPassword } from './passwordRules'

export default function SetupPage() {
  const { setupAdmin } = useAuth()
  const [loginId, setLoginId] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const problem = checkNewPassword(password, confirm)
    if (problem) return setError(problem)
    setBusy(true)
    try {
      await setupAdmin(loginId, name, password)
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
        <h1>운영 교사 계정 만들기</h1>
        <p className="hint">처음 한 번만 하는 설정입니다. 이 계정으로 다른 선생님의 계정을 만들 수 있습니다.</p>
        <ErrorMessage message={error} />
        <Field label="아이디" value={loginId} onChange={(e) => setLoginId(e.target.value)} hint="영문 소문자, 숫자, . _ - 로 3~30자" required autoComplete="username" />
        <Field label="이름" value={name} onChange={(e) => setName(e.target.value)} required />
        <Field label="비밀번호" type="password" value={password} onChange={(e) => setPassword(e.target.value)} hint="8자 이상" required autoComplete="new-password" />
        <Field label="비밀번호 확인" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
        <button className="primary" type="submit" disabled={busy}>
          계정 만들기
        </button>
      </form>
    </div>
  )
}
