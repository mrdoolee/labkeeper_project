import { useState, type FormEvent } from 'react'
import { isValidGasUrl } from '../api/connection'
import { fetchSystemInfo, GUIDE_URL, schoolLabel, type SystemInfo } from '../api/system'
import { isOldGas, useAuth } from '../auth/AuthContext'
import { Field } from '../components/Field'
import { Brand } from '../components/Brand'

/** First screen: which school spreadsheet (GAS web app) this browser uses. */
export default function ConnectPage() {
  const { connection, connect } = useAuth()
  const [url, setUrl] = useState(connection.lastUrl ?? '')
  const [tested, setTested] = useState<{ url: string; info: SystemInfo } | null>(null)
  const [problem, setProblem] = useState<'format' | 'failed' | 'old' | null>(null)
  const [busy, setBusy] = useState(false)

  async function test(e: FormEvent) {
    e.preventDefault()
    setTested(null)
    const value = url.trim()
    if (!isValidGasUrl(value)) return setProblem('format')
    setProblem(null)
    setBusy(true)
    try {
      setTested({ url: value, info: await fetchSystemInfo(value) })
    } catch (err) {
      setProblem(isOldGas(err) ? 'old' : 'failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-screen">
      <form className="card" onSubmit={test}>
        <Brand />
        <h1>스프레드시트 연결</h1>
        <p className="hint">학교 스프레드시트에서 배포한 Apps Script 웹 앱 주소를 넣어 주세요. 이 브라우저에 저장됩니다.</p>
        {problem === 'format' && (
          <div role="alert" className="error">
            구글 Apps Script 웹 앱 주소(https://script.google.com/…/exec)를 넣어 주세요.
          </div>
        )}
        {problem === 'old' && (
          <div role="alert" className="error">
            이 스프레드시트의 프로그램이 옛 버전입니다.{' '}
            <a href={GUIDE_URL} target="_blank" rel="noreferrer">
              설치 안내
            </a>
            의 '코드 업데이트' 순서대로 다시 배포한 뒤 연결해 주세요.
          </div>
        )}
        {problem === 'failed' && (
          <div role="alert" className="error">
            <strong>연결하지 못했습니다</strong>
            <ul>
              <li>주소가 …/exec로 끝나는지 확인해 주세요.</li>
              <li>배포할 때 액세스 권한을 '모든 사용자'로 했는지 확인해 주세요.</li>
              <li>방금 배포했다면 10초쯤 뒤에 다시 눌러 주세요.</li>
            </ul>
          </div>
        )}
        <Field
          label="GAS 웹 앱 주소"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value)
            setTested(null)
          }}
          placeholder="https://script.google.com/macros/s/…/exec"
          autoComplete="off"
          required
        />
        {tested && (
          <div role="status" className="notice">
            연결됨: {schoolLabel(tested.info)}
          </div>
        )}
        <div className="toolbar">
          <button type="submit" disabled={busy}>
            연결 테스트
          </button>
          {tested && (
            <button type="button" className="primary" onClick={() => connect(tested.url)}>
              저장하고 계속
            </button>
          )}
        </div>
        <p className="hint">
          처음이라면{' '}
          <a href={GUIDE_URL} target="_blank" rel="noreferrer">
            설치 안내
          </a>
          를 먼저 봐 주세요.
        </p>
      </form>
    </div>
  )
}
