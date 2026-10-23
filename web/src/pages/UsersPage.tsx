import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { callApi } from '../api/client'
import type { User } from '../auth/AuthContext'
import { ErrorMessage, errorText } from '../components/Field'
import { HistoryButton } from '../components/HistoryDialog'

/** Temporary password shown once after creating or resetting an account. */
function TempPassword({ who, password, onClose }: { who: string; password: string; onClose: () => void }) {
  return (
    <div role="status" className="notice temp-password">
      <div>
        <strong>{who}</strong> 선생님의 임시 비밀번호입니다. 이 화면을 닫으면 다시 볼 수 없습니다.
      </div>
      <code className="big">{password}</code>
      <div className="toolbar">
        <button type="button" onClick={() => navigator.clipboard?.writeText(password)}>
          복사
        </button>
        <button type="button" onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  )
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [error, setError] = useState<string | null>(null)
  const [temp, setTemp] = useState<{ who: string; password: string } | null>(null)
  const [loginId, setLoginId] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<User['role']>('teacher')

  const load = useCallback(() => callApi<User[]>('users.list').then(setUsers), [])

  useEffect(() => {
    load().catch((err) => setError(errorText(err)))
  }, [load])

  async function run(action: () => Promise<unknown>) {
    setError(null)
    try {
      await action()
      await load()
    } catch (err) {
      setError(errorText(err))
    }
  }

  function create(e: FormEvent) {
    e.preventDefault()
    run(async () => {
      const res = await callApi<{ user: User; tempPassword: string }>('users.create', { loginId, name, role })
      setTemp({ who: res.user.name, password: res.tempPassword })
      setLoginId('')
      setName('')
    })
  }

  return (
    <section>
      <div className="toolbar">
        <h1>계정 관리</h1>
        <span className="spacer" />
        <HistoryButton table="Users" />
      </div>
      <ErrorMessage message={error} />
      {temp && <TempPassword who={temp.who} password={temp.password} onClose={() => setTemp(null)} />}

      <form className="card toolbar" onSubmit={create} aria-label="새 계정">
        <input aria-label="새 계정 아이디" placeholder="아이디" value={loginId} onChange={(e) => setLoginId(e.target.value)} required />
        <input aria-label="새 계정 이름" placeholder="이름" value={name} onChange={(e) => setName(e.target.value)} required />
        <select aria-label="새 계정 역할" value={role} onChange={(e) => setRole(e.target.value as User['role'])}>
          <option value="teacher">일반 교사</option>
          <option value="admin">운영 교사</option>
        </select>
        <button className="primary" type="submit">
          계정 만들기
        </button>
      </form>

      <table>
        <thead>
          <tr>
            <th>아이디</th>
            <th>이름</th>
            <th>역할</th>
            <th>상태</th>
            <th>관리</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.loginId}</td>
              <td>{u.name}</td>
              <td>
                <select aria-label="역할" value={u.role} onChange={(e) => run(() => callApi('users.update', { id: u.id, role: e.target.value }))}>
                  <option value="teacher">일반 교사</option>
                  <option value="admin">운영 교사</option>
                </select>
              </td>
              <td>{u.active ? (u.mustChangePassword ? '사용 중 (비밀번호 변경 전)' : '사용 중') : '사용 중지됨'}</td>
              <td className="toolbar">
                <button
                  type="button"
                  onClick={() =>
                    run(async () => {
                      const res = await callApi<{ tempPassword: string }>('users.resetPassword', { id: u.id })
                      setTemp({ who: u.name, password: res.tempPassword })
                    })
                  }
                >
                  비밀번호 초기화
                </button>
                <button type="button" className={u.active ? 'danger' : ''} onClick={() => run(() => callApi('users.update', { id: u.id, active: !u.active }))}>
                  {u.active ? '사용 중지' : '다시 사용'}
                </button>
                <HistoryButton table="Users" recordId={u.id} label="이력" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
