import { Link } from 'react-router-dom'

/** Shown when a room or cabinet id no longer exists (deleted, stale link). */
export function NotFound({ what }: { what: '교실' | '보관장' }) {
  return (
    <section className="card">
      <p>{what}을 찾을 수 없습니다. 삭제되었거나 주소가 잘못되었습니다.</p>
      <Link to="/rooms">교실·보관장으로</Link>
    </section>
  )
}
