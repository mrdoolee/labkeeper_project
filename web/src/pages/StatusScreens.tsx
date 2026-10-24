import type { ReactNode } from 'react'
import { GUIDE_URL, schoolLabel } from '../api/system'
import { useAuth } from '../auth/AuthContext'
import { Brand } from '../components/Brand'

function Screen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="auth-screen">
      <section className="card">
        <Brand />
        <h1>{title}</h1>
        {children}
      </section>
    </div>
  )
}

export function ConnectionErrorScreen() {
  const { recheck, disconnect } = useAuth()
  return (
    <Screen title="스프레드시트에 연결할 수 없습니다">
      <p>인터넷 연결을 확인해 주세요. 학교 시트의 배포가 바뀌었다면 주소를 다시 넣어야 합니다.</p>
      <div className="toolbar">
        <button className="primary" type="button" onClick={() => recheck()}>
          다시 시도
        </button>
        <button type="button" onClick={disconnect}>
          주소 바꾸기
        </button>
      </div>
    </Screen>
  )
}

export function CopiedScreen() {
  const { recheck, disconnect } = useAuth()
  return (
    <Screen title="운영 중인 시트의 사본입니다">
      <p>다른 학교(또는 원래 시트)의 계정과 기록이 들어 있는 사본이라 사용할 수 없습니다.</p>
      <p>시트 메뉴 LabKeeper → 사본을 새 학교 시트로 시작을 실행한 뒤 다시 확인하세요.</p>
      <div className="toolbar">
        <button className="primary" type="button" onClick={() => recheck()}>
          다시 확인
        </button>
        <button type="button" onClick={disconnect}>
          주소 바꾸기
        </button>
      </div>
    </Screen>
  )
}

export function ClosedScreen() {
  const { connection, recheck, disconnect } = useAuth()
  return (
    <Screen title="이 학교 시트는 운영이 종료되었습니다">
      {connection.info?.closedNote && <p className="closed-note">{connection.info.closedNote}</p>}
      <p>운영 교사에게 새 접속 링크를 받아 주세요.</p>
      <div className="toolbar">
        <button className="primary" type="button" onClick={() => recheck()}>
          다시 확인
        </button>
        <button type="button" onClick={disconnect}>
          주소 바꾸기
        </button>
      </div>
    </Screen>
  )
}

export function OutdatedScreen() {
  const { recheck, disconnect } = useAuth()
  return (
    <Screen title="학교 시트의 프로그램이 옛 버전입니다">
      <p>
        <a href={GUIDE_URL} target="_blank" rel="noreferrer">
          설치 안내
        </a>
        의 '코드 업데이트' 순서대로 다시 배포해 주세요.
      </p>
      <div className="toolbar">
        <button className="primary" type="button" onClick={() => recheck()}>
          다시 확인
        </button>
        <button type="button" onClick={disconnect}>
          주소 바꾸기
        </button>
      </div>
    </Screen>
  )
}

export function NeedsAdminScreen() {
  const { recheck, disconnect } = useAuth()
  return (
    <Screen title="운영 교사 계정을 먼저 만들어 주세요">
      <p>스프레드시트 메뉴 LabKeeper → 운영 교사 계정 만들기에서 만든 뒤 다시 확인을 누르세요.</p>
      <div className="toolbar">
        <button className="primary" type="button" onClick={() => recheck()}>
          다시 확인
        </button>
        <button type="button" onClick={disconnect}>
          주소 바꾸기
        </button>
      </div>
    </Screen>
  )
}

export function SwitchSchoolScreen() {
  const { connection, acceptSwitch, rejectSwitch } = useAuth()
  const current = connection.info ? schoolLabel(connection.info) : '확인할 수 없음'
  const next = connection.pending?.info ? schoolLabel(connection.pending.info) : '확인할 수 없음'
  return (
    <Screen title="다른 학교 스프레드시트로 연결을 바꿀까요?">
      <p>열어 본 접속 링크가 지금 연결된 곳과 다른 스프레드시트를 가리킵니다. 운영 교사에게 직접 받은 링크인지 확인해 주세요.</p>
      <ul>
        <li>지금: {current}</li>
        <li>새 링크: {next}</li>
      </ul>
      {connection.info && connection.pending?.info && current === next && (
        <div role="alert" className="error">
          이름은 같지만 다른 스프레드시트입니다. 운영 교사에게 받은 링크가 맞는지 꼭 확인해 주세요.
        </div>
      )}
      <div className="toolbar">
        <button className="primary" type="button" onClick={() => rejectSwitch()}>
          그대로 두기
        </button>
        <button type="button" onClick={() => acceptSwitch()}>
          바꾸기
        </button>
      </div>
    </Screen>
  )
}
