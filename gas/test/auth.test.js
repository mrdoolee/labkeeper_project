import { beforeEach, describe, expect, test } from 'vitest'
import { loadGas } from './loadGas.js'

let gas

beforeEach(() => {
  gas = loadGas()
})

function setupAdmin() {
  return gas.call('setup.createAdmin', { loginId: 'Kim', name: '김운영', password: 'first-pass-1' }).data
}

function login(loginId, password) {
  return gas.call('auth.login', { loginId, password })
}

describe('hashPassword', () => {
  test('is a stable 64-char hex value that depends on the salt', () => {
    const a = gas.ctx.hashPassword('pw', 'aa')
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(gas.ctx.hashPassword('pw', 'aa')).toBe(a)
    expect(gas.ctx.hashPassword('pw', 'ab')).not.toBe(a)
    expect(gas.ctx.hashPassword('pw2', 'aa')).not.toBe(a)
  })

  test('newSalt gives 32 hex chars and differs each time', () => {
    expect(gas.ctx.newSalt()).toMatch(/^[0-9a-f]{32}$/)
    expect(gas.ctx.newSalt()).not.toBe(gas.ctx.newSalt())
  })
})

describe('first admin setup', () => {
  test('needsSetup until the first admin exists, then SETUP_DONE', () => {
    expect(gas.call('setup.status').data).toEqual({ needsSetup: true })
    const res = gas.call('setup.createAdmin', { loginId: 'kim', name: '김운영', password: 'first-pass-1' })
    expect(res.ok).toBe(true)
    expect(res.data.user).toMatchObject({ loginId: 'kim', name: '김운영', role: 'admin', mustChangePassword: false, active: true })
    expect(res.data.token).toMatch(/^[0-9a-f]{64}$/)
    expect(gas.call('setup.status').data).toEqual({ needsSetup: false })
    const again = gas.call('setup.createAdmin', { loginId: 'lee', name: '이', password: 'another-pass' })
    expect(again.error.code).toBe('SETUP_DONE')
  })

  test('the password is never stored or returned in plain text', () => {
    const res = gas.call('setup.createAdmin', { loginId: 'kim', name: '김운영', password: 'first-pass-1' })
    expect(JSON.stringify(gas.sheet('Users'))).not.toContain('first-pass-1')
    expect(JSON.stringify(gas.sheet('AuditLog'))).not.toContain('first-pass-1')
    expect(res.data.user.salt).toBeUndefined()
    expect(res.data.user.hash).toBeUndefined()
  })

  test('rejects a short password', () => {
    const res = gas.call('setup.createAdmin', { loginId: 'kim', name: '김', password: 'short' })
    expect(res.error.code).toBe('INVALID')
  })
})

describe('login', () => {
  test('a correct login gives a token that auth.me accepts; no secrets in the reply', () => {
    setupAdmin()
    const res = login('kim', 'first-pass-1')
    expect(res.ok).toBe(true)
    const me = gas.call('auth.me', {}, res.data.token)
    expect(me.data).toMatchObject({ loginId: 'kim', role: 'admin' })
    expect(JSON.stringify(res)).not.toMatch(/salt|hash/)
    expect(JSON.stringify(me)).not.toMatch(/salt|hash/)
  })

  test('a successful login is written to the audit log', () => {
    setupAdmin()
    login('kim', 'first-pass-1')
    const log = gas.sheet('AuditLog')
    expect(log[log.length - 1]).toContain('login')
  })

  test('a wrong password is INVALID with a Korean message', () => {
    setupAdmin()
    const res = login('kim', 'wrong-pass')
    expect(res.error).toEqual({ code: 'INVALID', message: '아이디 또는 비밀번호가 맞지 않습니다.' })
  })

  test('four failures still allow a correct login, which resets the count', () => {
    setupAdmin()
    for (let i = 0; i < 4; i++) login('kim', 'wrong')
    expect(login('kim', 'first-pass-1').ok).toBe(true)
    for (let i = 0; i < 4; i++) login('kim', 'wrong')
    expect(login('kim', 'first-pass-1').ok).toBe(true)
  })

  test('five failures lock the id for 600 seconds', () => {
    setupAdmin()
    for (let i = 0; i < 5; i++) login('kim', 'wrong')
    expect(login('kim', 'first-pass-1').error.code).toBe('LOCKED_OUT')
    gas.fakes.advanceTime(600)
    expect(login('kim', 'first-pass-1').ok).toBe(true)
  })
})

describe('sessions', () => {
  test('no token is AUTH_REQUIRED', () => {
    setupAdmin()
    expect(gas.call('auth.me').error.code).toBe('AUTH_REQUIRED')
    expect(gas.call('auth.me', {}, 'made-up').error.code).toBe('AUTH_REQUIRED')
  })

  test('a session expires after 6 hours without requests, and each request extends it', () => {
    const { token } = setupAdmin()
    gas.fakes.advanceTime(20000)
    expect(gas.call('auth.me', {}, token).ok).toBe(true)
    gas.fakes.advanceTime(20000)
    expect(gas.call('auth.me', {}, token).ok).toBe(true)
    gas.fakes.advanceTime(21601)
    expect(gas.call('auth.me', {}, token).error.code).toBe('AUTH_REQUIRED')
  })

  test('a user deactivated in the sheet is refused with the token they already hold', () => {
    const { token, user } = setupAdmin()
    gas.ctx.dbUpdate('Users', user.id, { active: false }, { id: 'x', name: 'x' })
    expect(gas.call('auth.me', {}, token).error.code).toBe('AUTH_REQUIRED')
  })

  test('logout ends the session', () => {
    const { token } = setupAdmin()
    expect(gas.call('auth.logout', {}, token).ok).toBe(true)
    expect(gas.call('auth.me', {}, token).error.code).toBe('AUTH_REQUIRED')
  })
})

describe('changePassword', () => {
  test('needs the current password, then only the new one works', () => {
    const { token } = setupAdmin()
    expect(gas.call('auth.changePassword', { currentPassword: 'nope', newPassword: 'brand-new-1' }, token).error.code).toBe('INVALID')
    expect(gas.call('auth.changePassword', { currentPassword: 'first-pass-1', newPassword: 'short' }, token).error.code).toBe('INVALID')
    expect(gas.call('auth.changePassword', { currentPassword: 'first-pass-1', newPassword: 'brand-new-1' }, token).ok).toBe(true)
    expect(login('kim', 'first-pass-1').ok).toBe(false)
    expect(login('kim', 'brand-new-1').ok).toBe(true)
  })

  test('clears mustChangePassword', () => {
    const { token, user } = setupAdmin()
    gas.ctx.dbUpdate('Users', user.id, { mustChangePassword: true }, { id: 'x', name: 'x' })
    gas.call('auth.changePassword', { currentPassword: 'first-pass-1', newPassword: 'brand-new-1' }, token)
    expect(gas.call('auth.me', {}, token).data.mustChangePassword).toBe(false)
  })
})

describe('setup cannot be reopened', () => {
  test('renaming the active header in the sheet does not let anyone create a new admin', () => {
    setupAdmin()
    const sheet = gas.fakes.sheets.get('Users')
    sheet.data[0][sheet.data[0].indexOf('active')] = '사용'
    expect(gas.call('setup.status').data).toEqual({ needsSetup: false })
    expect(gas.call('setup.createAdmin', { loginId: 'evil', name: 'x', password: 'takeover-123' }).error.code).toBe('SETUP_DONE')
  })

  test('a Users sheet with only deactivated people is not a fresh install', () => {
    const { user } = setupAdmin()
    gas.ctx.dbUpdate('Users', user.id, { active: false }, { id: 'x', name: 'x' })
    expect(gas.call('setup.status').data).toEqual({ needsSetup: false })
    expect(gas.call('setup.createAdmin', { loginId: 'evil', name: 'x', password: 'takeover-123' }).error.code).toBe('SETUP_DONE')
  })
})
