// Talks to the GAS web app. Requests are text/plain so the browser sends them
// without a CORS preflight, which Apps Script cannot answer.
import { getGasUrl } from './connection'

export class ApiError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

const TOKEN_KEY = 'labkeeper.token'
let memoryToken: string | null = null
let onAuthRequired: () => void = () => {}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? memoryToken
  } catch {
    return memoryToken
  }
}

export function setToken(token: string | null): void {
  memoryToken = token
  try {
    if (token === null) localStorage.removeItem(TOKEN_KEY)
    else localStorage.setItem(TOKEN_KEY, token)
  } catch {
    // Storage blocked (private window etc.): the in-memory copy is used.
  }
}

export function setOnAuthRequired(fn: () => void): void {
  onAuthRequired = fn
}

/** Sends to the connected school's GAS, or to `url` (used to test an address before saving it). */
export async function callApi<T>(action: string, payload?: object, url: string | null = getGasUrl()): Promise<T> {
  if (!url) throw new ApiError('NO_CONNECTION', '연결된 스프레드시트가 없습니다.')
  let body: { ok: boolean; data?: T; error?: { code: string; message: string } }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token: getToken() ?? undefined, payload }),
    })
    body = await res.json()
  } catch {
    throw new ApiError('NETWORK', '서버에 연결할 수 없습니다.')
  }
  if (body.ok) return body.data as T
  const { code, message } = body.error ?? { code: 'SERVER_ERROR', message: '서버 오류가 발생했습니다.' }
  if (code === 'AUTH_REQUIRED') {
    setToken(null)
    onAuthRequired()
  }
  throw new ApiError(code, message)
}
