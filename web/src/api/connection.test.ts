import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { getToken, setToken } from './client'
import { getGasUrl, isValidGasUrl, schoolLink, setGasUrl, takeGasFromQuery } from './connection'

const A = 'https://script.google.com/macros/s/AKfyA/exec'
const B = 'https://script.google.com/macros/s/AKfyB/exec'

beforeEach(() => {
  localStorage.clear()
  setGasUrl(null)
  setToken(null)
  history.replaceState(null, '', '/')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

test.each([
  ['https://script.google.com/macros/s/AKfy123/exec', true],
  ['https://script.google.com/a/macros/cbe.go.kr/s/AKfy123/exec', true],
  ['  https://script.google.com/macros/s/AKfy123/exec ', true],
  ['https://script.google.com/macros/s/AKfy123/dev', false],
  ['http://script.google.com/macros/s/AKfy123/exec', false],
  ['https://evil.example.com/macros/s/AKfy123/exec', false],
  ['https://script.google.com.evil.com/macros/s/x/exec', false],
  ['https://script.google.com/macros/s/AKfy123/exec?next=https://evil.example.com', false],
  ['not a url', false],
  ['', false],
])('isValidGasUrl(%s) → %s', (url, ok) => {
  vi.stubEnv('DEV', false)
  expect(isValidGasUrl(url)).toBe(ok)
})

test('a local dev server address is accepted only in dev builds', () => {
  vi.stubEnv('DEV', true)
  expect(isValidGasUrl('http://127.0.0.1:8787/')).toBe(true)
  expect(isValidGasUrl('http://localhost:8787/')).toBe(true)
  vi.stubEnv('DEV', false)
  expect(isValidGasUrl('http://127.0.0.1:8787/')).toBe(false)
})

test('the address is kept in localStorage', () => {
  expect(setGasUrl(A)).toBe(true)
  expect(localStorage.getItem('labkeeper.gasUrl')).toBe(A)
  expect(getGasUrl()).toBe(A)
})

test('an invalid address is refused and changes nothing', () => {
  setGasUrl(A)
  expect(setGasUrl('https://evil.example.com/exec')).toBe(false)
  expect(getGasUrl()).toBe(A)
})

test('an invalid stored address reads as none', () => {
  localStorage.setItem('labkeeper.gasUrl', 'https://x.example.com/')
  expect(getGasUrl()).toBeNull()
})

test('works when storage is blocked', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  expect(setGasUrl(A)).toBe(true)
  expect(getGasUrl()).toBe(A)
})

test('changing the address clears the login token', () => {
  setGasUrl(A)
  setToken('t1')
  setGasUrl(B)
  expect(getToken()).toBeNull()
})

test('setting the same address keeps the token', () => {
  setGasUrl(A)
  setToken('t1')
  setGasUrl(A)
  expect(getToken()).toBe('t1')
})

test('takeGasFromQuery decodes, trims and removes only gas from the address bar', () => {
  history.replaceState(null, '', '/rooms?x=1&gas=' + encodeURIComponent('  ' + A + ' ') + '#top')
  expect(takeGasFromQuery()).toBe(A)
  expect(location.pathname + location.search + location.hash).toBe('/rooms?x=1#top')
  expect(getGasUrl()).toBeNull() // reading the link does not save it
})

test('takeGasFromQuery ignores an invalid address but still removes it', () => {
  history.replaceState(null, '', '/?gas=' + encodeURIComponent('https://evil.example.com/exec'))
  expect(takeGasFromQuery()).toBeNull()
  expect(location.search).toBe('')
})

test('takeGasFromQuery is null without a gas parameter', () => {
  expect(takeGasFromQuery()).toBeNull()
})

test('schoolLink builds the share link', () => {
  expect(schoolLink(A)).toBe(location.origin + '/?gas=' + encodeURIComponent(A))
})
