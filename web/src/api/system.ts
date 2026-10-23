import { callApi } from './client'

/** Must match API_VERSION in gas/src/System.js. */
export const REQUIRED_API_VERSION = 2

export const GUIDE_URL = 'https://github.com/mrdoolee/labkeeper_project/blob/main/docs/setup-guide.md'

export interface SystemInfo {
  name: string
  apiVersion: number
  needsSetup: boolean
  copied: boolean
  schoolName: string
}

/** Asks a school's GAS who it is (the saved one, or `url` when testing an address). */
export function fetchSystemInfo(url?: string): Promise<SystemInfo> {
  return url === undefined ? callApi<SystemInfo>('system.info') : callApi<SystemInfo>('system.info', undefined, url)
}

export function schoolLabel(info: SystemInfo | null | undefined): string {
  return info?.schoolName || '학교 이름 미설정'
}
