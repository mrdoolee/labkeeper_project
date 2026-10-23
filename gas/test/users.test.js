import { beforeEach, describe, expect, test } from 'vitest'
import { loadGas } from './loadGas.js'

let gas, adminToken

beforeEach(() => {
  gas = loadGas()
  adminToken = gas.call('setup.createAdmin', { loginId: 'kim', name: '김운영', password: 'first-pass-1' }).data.token
})

function createUser(loginId, role = 'teacher', name = '이교사') {
  return gas.call('users.create', { loginId, name, role }, adminToken).data
}

function loginToken(loginId, password) {
  return gas.call('auth.login', { loginId, password }).data.token
}

describe('users.create', () => {
  test('gives a 10-char temporary password that works and must be changed', () => {
    const { user, tempPassword } = createUser('lee')
    expect(tempPassword).toMatch(/^[a-z0-9]{10}$/)
    expect(user).toMatchObject({ loginId: 'lee', name: '이교사', role: 'teacher', mustChangePassword: true, active: true })
    const res = gas.call('auth.login', { loginId: 'lee', password: tempPassword })
    expect(res.ok).toBe(true)
    expect(res.data.user.mustChangePassword).toBe(true)
  })

  test('a duplicate loginId is INVALID', () => {
    createUser('lee')
    expect(gas.call('users.create', { loginId: 'LEE', name: '다른 이', role: 'teacher' }, adminToken).error.code).toBe('INVALID')
  })

  test('an unknown role is INVALID', () => {
    expect(gas.call('users.create', { loginId: 'park', name: '박', role: 'owner' }, adminToken).error.code).toBe('INVALID')
  })

  test('records who created the account', () => {
    const { user } = createUser('lee')
    expect(gas.ctx.dbGet('Users', user.id).createdBy).toBe(gas.call('auth.me', {}, adminToken).data.id)
  })
})

describe('admin-only access', () => {
  test('a teacher cannot list or manage users, but can read the name directory', () => {
    const { tempPassword } = createUser('lee')
    const teacherToken = loginToken('lee', tempPassword)
    expect(gas.call('users.list', {}, teacherToken).error.code).toBe('FORBIDDEN')
    expect(gas.call('users.create', { loginId: 'x1x', name: 'x', role: 'teacher' }, teacherToken).error.code).toBe('FORBIDDEN')
    expect(gas.call('users.list', {}, adminToken).data).toHaveLength(2)

    const dir = gas.call('directory.list', {}, teacherToken)
    expect(dir.ok).toBe(true)
    expect(dir.data.map((p) => p.name)).toEqual(expect.arrayContaining(['김운영', '이교사', '첫 설정']))
    expect(JSON.stringify(dir.data)).not.toMatch(/salt|hash|loginId/)
  })

  test('the directory keeps people who were deactivated, so old records still show a name', () => {
    const { user } = createUser('lee')
    gas.call('users.update', { id: user.id, active: false }, adminToken)
    expect(gas.call('directory.list', {}, adminToken).data.map((p) => p.name)).toContain('이교사')
  })
})

describe('users.resetPassword', () => {
  test('the old password stops working and the temporary one works', () => {
    const { user, tempPassword } = createUser('lee')
    const teacherToken = loginToken('lee', tempPassword)
    gas.call('auth.changePassword', { currentPassword: tempPassword, newPassword: 'teacher-pass-1' }, teacherToken)
    const reset = gas.call('users.resetPassword', { id: user.id }, adminToken).data
    expect(reset.tempPassword).toMatch(/^[a-z0-9]{10}$/)
    expect(gas.call('auth.login', { loginId: 'lee', password: 'teacher-pass-1' }).ok).toBe(false)
    const res = gas.call('auth.login', { loginId: 'lee', password: reset.tempPassword })
    expect(res.ok).toBe(true)
    expect(res.data.user.mustChangePassword).toBe(true)
  })
})

describe('users.update and the last admin', () => {
  test('the only active admin cannot be demoted or deactivated', () => {
    const adminId = gas.call('auth.me', {}, adminToken).data.id
    const demote = gas.call('users.update', { id: adminId, role: 'teacher' }, adminToken)
    expect(demote.error).toEqual({ code: 'INVALID', message: '운영 교사가 최소 1명 있어야 합니다.' })
    expect(gas.call('users.update', { id: adminId, active: false }, adminToken).error.code).toBe('INVALID')
  })

  test('with two admins, one can be demoted', () => {
    const adminId = gas.call('auth.me', {}, adminToken).data.id
    createUser('park', 'admin', '박운영')
    const res = gas.call('users.update', { id: adminId, role: 'teacher' }, adminToken)
    expect(res.ok).toBe(true)
    expect(res.data.role).toBe('teacher')
  })

  test('renaming works and is audited', () => {
    const { user } = createUser('lee')
    expect(gas.call('users.update', { id: user.id, name: '이과학' }, adminToken).data.name).toBe('이과학')
    expect(JSON.stringify(gas.sheet('AuditLog'))).toContain('이과학')
  })
})
