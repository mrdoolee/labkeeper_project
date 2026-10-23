import { afterEach, expect, test } from 'vitest'
import { startDevServer } from '../dev-server.mjs'

let server

afterEach(async () => {
  await server?.close()
})

test('serves doPost over HTTP with CORS for the web app', async () => {
  server = await startDevServer(0)
  const res = await fetch(server.url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'system.info' }),
  })
  expect(res.headers.get('access-control-allow-origin')).toBe('*')
  expect((await res.json()).data).toMatchObject({ name: 'LabKeeper', needsSetup: true })
})

test('serves doGet', async () => {
  server = await startDevServer(0)
  expect(await (await fetch(server.url)).json()).toEqual({ ok: true, data: { name: 'LabKeeper' } })
})

test('uses the real clock so records get real timestamps', async () => {
  server = await startDevServer(0)
  server.gas.ctx.sheetCreateAdmin({ loginId: 'kim', name: '김운영', password: 'first-pass-1' })
  const login = await (
    await fetch(server.url, { method: 'POST', body: JSON.stringify({ action: 'auth.login', payload: { loginId: 'kim', password: 'first-pass-1' } }) })
  ).json()
  const token = login.data.token
  const history = await (
    await fetch(server.url, { method: 'POST', body: JSON.stringify({ action: 'audit.list', token, payload: {} }) })
  ).json()
  expect(Math.abs(Date.parse(history.data[0].at) - Date.now())).toBeLessThan(60_000)
})

test('can create the first admin for local testing', async () => {
  server = await startDevServer(0)
  const made = await fetch(server.url + '__dev/createAdmin', {
    method: 'POST',
    body: JSON.stringify({ loginId: 'kim', name: '김운영', password: 'first-pass-1' }),
  })
  expect(await made.json()).toEqual({ ok: true })
  const login = await (
    await fetch(server.url, { method: 'POST', body: JSON.stringify({ action: 'auth.login', payload: { loginId: 'kim', password: 'first-pass-1' } }) })
  ).json()
  expect(login.ok).toBe(true)
})
