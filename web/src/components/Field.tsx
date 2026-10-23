import { useId, type InputHTMLAttributes } from 'react'

/** A labelled input. The label text is also the accessible name. */
export function Field({ label, hint, ...input }: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} {...input} />
      {hint && <span className="hint">{hint}</span>}
    </div>
  )
}

export function ErrorMessage({ message }: { message: string | null }) {
  return message ? (
    <div role="alert" className="error">
      {message}
    </div>
  ) : null
}

/** Message of an ApiError or any other thrown value. */
export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.'
}
