import { useRef, useState } from 'react'
import { callApi } from '../api/client'
import { getGasUrl, schoolLink } from '../api/connection'
import { errorText } from './Field'

/** For the admin: the link that connects another teacher's browser to this school, and the sheet itself. */
export function SchoolLink() {
  const gasUrl = getGasUrl()
  const link = gasUrl ? schoolLink(gasUrl) : ''
  const input = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      setMessage('복사했습니다')
    } catch {
      input.current?.select()
      setMessage('직접 복사해 주세요(Ctrl+C)')
    }
  }

  async function openSheet() {
    try {
      const { url } = await callApi<{ url: string }>('system.sheetUrl')
      window.open(url, '_blank', 'noopener')
    } catch (err) {
      setMessage(errorText(err))
    }
  }

  return (
    <section className="card school-link" aria-labelledby="school-link-title">
      <h2 id="school-link-title">우리 학교 접속 링크</h2>
      <div className="toolbar">
        <input ref={input} aria-label="접속 링크" value={link} readOnly onFocus={(e) => e.target.select()} />
        <button type="button" onClick={copy}>
          복사
        </button>
        <button type="button" onClick={openSheet}>
          스프레드시트 열기
        </button>
      </div>
      <p className="hint">새 선생님께 이 링크와 임시 비밀번호를 함께 전해 주세요.</p>
      {message && (
        <p role="status" className="hint">
          {message}
        </p>
      )}
    </section>
  )
}
