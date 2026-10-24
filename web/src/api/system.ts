import { callApi } from './client'

/** Must match API_VERSION in gas/src/System.js. */
export const REQUIRED_API_VERSION = 3

export const GUIDE_URL = 'https://github.com/mrdoolee/labkeeper_project/blob/main/docs/setup-guide.md'

export interface SystemInfo {
  name: string
  apiVersion: number
  needsSetup: boolean
  copied: boolean
  /** The distribution template (배포용 원본): never used as a school sheet. Absent on older GAS. */
  template?: boolean
  /** Locked from the sheet menu (운영 종료); closedNote is shown to teachers. */
  closed: boolean
  closedNote: string
  schoolName: string
  managerName: string
}

/** Asks a school's GAS who it is (the saved one, or `url` when testing an address). */
export function fetchSystemInfo(url?: string): Promise<SystemInfo> {
  return url === undefined ? callApi<SystemInfo>('system.info') : callApi<SystemInfo>('system.info', undefined, url)
}

export function schoolLabel(info: SystemInfo | null | undefined): string {
  return info?.schoolName || '학교 이름 미설정'
}
