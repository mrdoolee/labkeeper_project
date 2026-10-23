import { describe, expect, test } from 'vitest'
import { loadGas } from './loadGas.js'

describe('request router', () => {
  test('unknown action is rejected', () => {
    const gas = loadGas()
    const res = gas.call('nope')
    expect(res.ok).toBe(false)
    expect(res.error.code).toBe('UNKNOWN_ACTION')
  })

  test('a body that is not JSON is rejected as INVALID', () => {
    const gas = loadGas()
    const res = gas.post('not json')
    expect(res).toEqual({ ok: false, error: { code: 'INVALID', message: expect.any(String) } })
  })

  test('a registered action returns its data', () => {
    const gas = loadGas()
    gas.ctx.ACTIONS.ping = { auth: 'none', write: false, handler: () => 'pong' }
    expect(gas.call('ping')).toEqual({ ok: true, data: 'pong' })
  })

  test('an unexpected exception becomes SERVER_ERROR without a stack trace', () => {
    const gas = loadGas()
    gas.ctx.ACTIONS.boom = {
      auth: 'none',
      write: false,
      handler: () => {
        throw new Error('secret internals at Code.js:12')
      },
    }
    const res = gas.call('boom')
    expect(res.ok).toBe(false)
    expect(res.error.code).toBe('SERVER_ERROR')
    expect(JSON.stringify(res)).not.toContain('Code.js')
  })

  test('a write action holds the script lock and releases it', () => {
    const gas = loadGas()
    gas.ctx.ACTIONS.save = { auth: 'none', write: true, handler: () => true }
    gas.call('save')
    expect(gas.fakes.lockCalls).toEqual({ wait: 1, release: 1 })
  })

  test('doGet reports the app name', () => {
    const gas = loadGas()
    expect(JSON.parse(gas.ctx.doGet({}).getContent())).toEqual({ ok: true, data: { name: 'LabKeeper' } })
  })
})
