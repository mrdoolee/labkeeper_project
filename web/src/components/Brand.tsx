import { FlaskConical } from 'lucide-react'

/** Logo for the sign-in and connection screens. */
export function Brand() {
  return (
    <div className="auth-brand">
      <span className="logo-tile" aria-hidden="true">
        <FlaskConical size={18} />
      </span>
      <span>LabKeeper</span>
    </div>
  )
}
