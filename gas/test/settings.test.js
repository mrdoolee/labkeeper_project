import { beforeEach, describe, expect, test } from 'vitest'
import { loadGas } from './loadGas.js'

let gas, adminToken, teacherToken, teacherId

beforeEach(() => {
  gas = loadGas()
  adminToken = gas.call('setup.createAdmin', { loginId: 'kim', name: '김운영', password: 'first-pass-1' }).data.token
  const created = gas.call('users.create', { loginId: 'lee', name: '이교사', role: 'teacher' }, adminToken).data
  teacherId = created.user.id
  teacherToken = gas.call('auth.login', { loginId: 'lee', password: created.tempPassword }).data.token
})

function auditRows() {
  const data = gas.sheet('AuditLog')
  return data.slice(1).map((line) => Object.fromEntries(data[0].map((h, i) => [h, line[i]])))
}

describe('settings', () => {
  test('settings.get returns defaults before anything is saved', () => {
    expect(gas.call('settings.get', {}, teacherToken).data).toEqual({
      schoolName: '',
      schoolLevel: 'middle',
      region: 'chungbuk',
      signerScienceHead: '',
      signerVicePrincipal: '',
      signerPrincipal: '',
      labOver100m2: false,
      wasteDisposal: 'office',
    })
  })

  test('a teacher can update settings and gets the full settings back', () => {
    const res = gas.call('settings.update', { schoolName: '청주과학고', region: 'seoul', labOver100m2: true }, teacherToken)
    expect(res.ok).toBe(true)
    expect(res.data).toMatchObject({ schoolName: '청주과학고', region: 'seoul', labOver100m2: true, schoolLevel: 'middle' })
    expect(gas.call('settings.get', {}, adminToken).data).toMatchObject({ schoolName: '청주과학고', region: 'seoul', labOver100m2: true })
  })

  test('only changed keys are audited, keyed by setting name, with who changed them', () => {
    gas.call('settings.update', { schoolName: '청주중', region: 'chungbuk' }, teacherToken)
    const logs = auditRows().filter((a) => a.table === 'Settings')
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ recordId: 'schoolName', userId: teacherId, userName: '이교사', action: 'update' })
    expect(JSON.parse(logs[0].before)).toEqual({ schoolName: '' })
    expect(JSON.parse(logs[0].after)).toEqual({ schoolName: '청주중' })
  })

  test.each([
    [{ region: 'busan' }],
    [{ schoolLevel: 'elementary' }],
    [{ wasteDisposal: 'river' }],
    [{ labOver100m2: 'yes' }],
    [{ favouriteColour: 'blue' }],
    [{ toString: 'x' }],
  ])('rejects %j as INVALID', (change) => {
    expect(gas.call('settings.update', change, teacherToken).error.code).toBe('INVALID')
  })
})
