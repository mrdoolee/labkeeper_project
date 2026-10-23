import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

export default function HomePage() {
  const { user } = useAuth()
  return (
    <section>
      <h1>안녕하세요, {user?.name} 선생님</h1>
      <div className="card">
        <h2>시작하기</h2>
        <ol>
          <li>
            <Link to="/settings">설정</Link>에서 학교 이름과 서명자 이름을 입력하세요.
          </li>
          <li>
            <Link to="/rooms">교실·보관장</Link>에서 교실과 보관장을 등록하세요.
          </li>
        </ol>
      </div>
    </section>
  )
}
