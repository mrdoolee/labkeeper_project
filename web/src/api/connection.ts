// Which school spreadsheet (GAS web app) this browser talks to. Each school
// deploys its own GAS; the address is kept in this browser and can arrive in
// a "우리 학교 접속 링크" as ?gas=<address>.

const KEY = 'labkeeper.gasUrl'
let memoryUrl: string | null = null

// client.ts registers here to forget the login token when the school changes
// (one-way dependency: client → connection).
let onChange: () => void = () => {}
export function onGasUrlChange(fn: () => void): void {
  onChange = fn
}

const GAS_PATH = /^\/(macros|a\/macros\/[^/]+)\/s\/[^/]+\/exec$/

/** Only Google Apps Script web app addresses, so a forged link cannot send passwords elsewhere. */
export function isValidGasUrl(url: string): boolean {
  let u: URL
  try {
    u = new URL(url.trim())
  } catch {
    return false
  }
  if (u.search || u.hash) return false
  if (u.protocol === 'https:' && u.hostname === 'script.google.com' && GAS_PATH.test(u.pathname)) return true
  // The local GAS dev server (npm run dev, e2e) in development builds only.
  return Boolean(import.meta.env.DEV) && u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')
}

export function getGasUrl(): string | null {
  let stored: string | null = null
  try {
    stored = localStorage.getItem(KEY)
  } catch {
    // Storage blocked: fall back to memory.
  }
  const url = stored ?? memoryUrl
  return url && isValidGasUrl(url) ? url.trim() : null
}

/** Saves the address (null forgets it). A different address logs the user out. */
export function setGasUrl(url: string | null): boolean {
  const next = url === null ? null : url.trim()
  if (next !== null && !isValidGasUrl(next)) return false
  if (next !== getGasUrl()) onChange()
  memoryUrl = next
  try {
    if (next === null) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, next)
  } catch {
    // Storage blocked: the in-memory copy is used.
  }
  return true
}

/** Reads ?gas= from the address bar and removes it. Does not save. */
export function takeGasFromQuery(): string | null {
  const params = new URLSearchParams(location.search)
  if (!params.has('gas')) return null
  const raw = (params.get('gas') ?? '').trim()
  params.delete('gas')
  const search = params.toString()
  history.replaceState(history.state, '', location.pathname + (search ? '?' + search : '') + location.hash)
  return isValidGasUrl(raw) ? raw : null
}

export function schoolLink(gasUrl: string): string {
  return `${location.origin}/?gas=${encodeURIComponent(gasUrl)}`
}
