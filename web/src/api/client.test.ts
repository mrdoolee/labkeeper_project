import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ApiError, callApi, getToken, setOnAuthRequired, setToken } from './client'

const URL = 'http://gas.example/exec'
let fetchMock: ReturnType<typeof vi.fn>

function reply(body: unknown) {
  fetchMock.mockResolvedValueOnce({ json: async () => body } as Response)
}

beforeEach(() => {
  vi.stubEnv('VITE_GAS_URL', URL)
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  setToken(null)
  setOnAuthRequired(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('callApi', () => {
  test('posts action, token and payload as text/plain JSON to the GAS URL', async () => {
    setToken('tok-1')
    reply({ ok: true, data: { n: 1 } })
    await callApi('records.list', { table: 'Rooms' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(URL)
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('text/plain;charset=utf-8')
    expect(JSON.parse(init.body)).toEqual({ action: 'records.list', token: 'tok-1', payload: { table: 'Rooms' } })
  })

  test('returns data on ok:true', async () => {
    reply({ ok: true, data: [{ id: 'a' }] })
    expect(await callApi('records.list', { table: 'Rooms' })).toEqual([{ id: 'a' }])
  })

  test('throws ApiError with the server code and Korean message on ok:false', async () => {
    reply({ ok: false, error: { code: 'INVALID', message: '교실 이름을(를) 입력해 주세요.' } })
    const err = await callApi('records.create').catch((e: ApiError) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.code).toBe('INVALID')
    expect(err.message).toBe('교실 이름을(를) 입력해 주세요.')
  })

  test('AUTH_REQUIRED clears the token and calls the callback', async () => {
    const onAuth = vi.fn()
    setOnAuthRequired(onAuth)
    setToken('old')
    reply({ ok: false, error: { code: 'AUTH_REQUIRED', message: '로그인이 필요합니다.' } })
    await expect(callApi('auth.me')).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
    expect(getToken()).toBeNull()
    expect(onAuth).toHaveBeenCalledOnce()
  })

  test('a network failure becomes ApiError NETWORK', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(callApi('auth.me')).rejects.toMatchObject({ code: 'NETWORK', message: '서버에 연결할 수 없습니다.' })
  })

  test('a reply that is not JSON also becomes NETWORK', async () => {
    fetchMock.mockResolvedValueOnce({ json: async () => Promise.reject(new SyntaxError('bad')) } as unknown as Response)
    await expect(callApi('auth.me')).rejects.toMatchObject({ code: 'NETWORK' })
  })
})

describe('token storage', () => {
  test('keeps the token in localStorage', () => {
    setToken('abc')
    expect(localStorage.getItem('labkeeper.token')).toBe('abc')
    expect(getToken()).toBe('abc')
    setToken(null)
    expect(localStorage.getItem('labkeeper.token')).toBeNull()
  })

  test('falls back to memory when localStorage throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    setToken('mem')
    expect(getToken()).toBe('mem')
    spy.mockRestore()
  })
})
