import { beforeEach, describe, expect, test } from 'vitest'
import { createAdmin } from './helpers.js'
import { loadGas } from './loadGas.js'

// Response bodies trimmed from real calls on 2026-10-29.
const KOSHA_HCL = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><response><header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header><body><items>
<item><casNo>18251-82-6</casNo><chemId>011111</chemId><chemNameKor>디이소부틸아민 염화수소</chemNameKor></item>
<item><casNo>7647-01-0</casNo><chemId>000123</chemId><chemNameKor>염화수소&lt;br/&gt;( 관용명 : 염화 수소 )</chemNameKor></item>
<item><chemId>000999</chemId><chemNameKor>CAS 없는 물질</chemNameKor></item>
<item><casNo>7647-01-0</casNo><chemId>000124</chemId><chemNameKor>염화수소&lt;br/&gt;( 관용명 : 염화 수소 )</chemNameKor></item>
</items><totalCount>4</totalCount></body></response>`
const KOSHA_EMPTY = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><response><header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header><body><items></items><totalCount>0</totalCount></body></response>`
const KECO_HCL = JSON.stringify({
  header: { resultCode: '200', resultMsg: 'NORMAL SERVICE.' },
  body: {
    items: [
      {
        casNo: '7647-01-0', sbstnNmKor: '염화 수소', sbstnNm2Kor: '염산; 염산 2 N', mlcfrm: 'H-Cl',
        typeList: [
          { sbstnClsfTypeNm: '기존화학물질', contInfo: '', excpInfo: '' },
          { sbstnClsfTypeNm: '인체등유해성물질', contInfo: '인체급성유해성 : 10%', excpInfo: '' },
          { sbstnClsfTypeNm: '사고대비물질', contInfo: '염화 수소 및 이를 10% 이상 함유한 혼합물', excpInfo: '' },
          { sbstnClsfTypeNm: '등록대상기존화학물질', contInfo: '', excpInfo: '' },
        ],
      },
      {
        casNo: '7647-01-0', sbstnNmKor: '염산', sbstnNm2Kor: '', mlcfrm: '',
        typeList: [
          { sbstnClsfTypeNm: '인체등유해성물질', contInfo: '인체급성유해성 : 10%', excpInfo: '' },
          { sbstnClsfTypeNm: '제한물질', contInfo: '염산 및 이를 1% 이상 함유한 혼합물', excpInfo: '실험용' },
        ],
      },
    ],
    totalCount: 2,
  },
})
const KECO_NAMELESS = JSON.stringify({ header: { resultCode: '200' }, body: { items: [{ casNo: '7647-14-5', sbstnNmKor: '', sbstnNm2Kor: '', mlcfrm: '', typeList: [{ sbstnClsfTypeNm: '기존화학물질', contInfo: '' }] }] } })
const KECO_EMPTY = JSON.stringify({ header: { resultCode: '200' }, body: { items: [], totalCount: 0 } })
const GATEWAY = (code) => JSON.stringify({ OpenAPI_ServiceResponse: { cmmMsgHeader: { errMsg: 'ERR', returnReasonCode: code } } })
const GATEWAY_XML = (code) => `<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>ERR</errMsg><returnReasonCode>${code}</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>`

let gas, token, urls, routes

beforeEach(() => {
  gas = loadGas()
  token = createAdmin(gas, 'kim', '김운영', 'first-pass-1').token
  urls = []
  routes = []
  gas.ctx.UrlFetchApp = {
    fetch(url, options) {
      urls.push(url)
      expect(options.muteHttpExceptions).toBe(true)
      const route = routes.find((r) => r.match(url))
      if (!route) throw new Error('no route for ' + url)
      return { getResponseCode: () => route.status ?? 200, getContentText: () => route.body }
    },
  }
  gas.ctx.sheetSetDataKey('abc%2Fdef%3D%3D')
})

function route(match, body, status) {
  routes.unshift({ match: typeof match === 'string' ? (u) => u.includes(match) : match, body, status })
}

const call = (action, payload) => gas.call(action, payload, token)

describe('chem.search', () => {
  test('a name goes to the KOSHA list; names are cleaned, rows without CAS dropped, duplicates merged, the exact name first', () => {
    route('getChemList001', KOSHA_HCL)
    const res = call('chem.search', { query: '염화 수소' })
    expect(res.ok).toBe(true)
    expect(res.data.items).toEqual([
      { name: '염화수소 ( 관용명 : 염화 수소 )', casNo: '7647-01-0' },
      { name: '디이소부틸아민 염화수소', casNo: '18251-82-6' },
    ])
    const url = urls[0]
    expect(url).toContain('https://apis.data.go.kr/B552468/msdschem1/getChemList001?')
    expect(url).toContain('serviceKey=abc%2Fdef%3D%3D')
    expect(url).toContain('searchCnd=0')
    expect(url).toContain('searchWrd=' + encodeURIComponent('염화 수소'))
  })

  test('no result with spaces tries once more without them', () => {
    route('getChemList001', KOSHA_EMPTY)
    route((u) => u.includes('searchWrd=' + encodeURIComponent('염화수소')), KOSHA_HCL)
    expect(call('chem.search', { query: '염화 수소' }).data.items).toHaveLength(2)
    expect(urls).toHaveLength(2)
  })

  test('a CAS No. goes to the KECO list; a nameless row falls back to its other name or the CAS', () => {
    route('chemSbstnList', KECO_HCL)
    expect(call('chem.search', { query: ' 7647-01-0 ' }).data.items).toEqual([
      { name: '염화 수소', casNo: '7647-01-0' },
      { name: '염산', casNo: '7647-01-0' },
    ])
    expect(urls[0]).toContain('https://apis.data.go.kr/B552584/kecoapi/ncissbstn/chemSbstnList?')
    expect(urls[0]).toContain('searchGubun=2')
    expect(urls[0]).toContain('searchNm=7647-01-0')
    expect(urls[0]).toContain('returnType=JSON')
    route('chemSbstnList', KECO_NAMELESS)
    expect(call('chem.search', { query: '7647-14-5' }).data.items).toEqual([{ name: '7647-14-5', casNo: '7647-14-5' }])
  })

  test('an empty query is refused', () => {
    expect(call('chem.search', { query: '  ' }).error.code).toBe('INVALID')
  })
})

describe('chem.info', () => {
  test('merges the classes of every row, drops the inventory ones, and cleans the formula', () => {
    route('chemSbstnList', KECO_HCL)
    expect(call('chem.info', { casNo: '7647-01-0' }).data).toEqual({
      found: true,
      casNo: '7647-01-0',
      name: '염화 수소',
      formula: 'HCl',
      classes: [
        { type: '인체등유해성물질', content: '인체급성유해성 : 10%', exception: '' },
        { type: '사고대비물질', content: '염화 수소 및 이를 10% 이상 함유한 혼합물', exception: '' },
        { type: '제한물질', content: '염산 및 이를 1% 이상 함유한 혼합물', exception: '실험용' },
      ],
    })
  })

  test('a CAS No. KECO does not know is not found', () => {
    route('chemSbstnList', KECO_EMPTY)
    expect(call('chem.info', { casNo: '7647-01-0' }).data).toEqual({ found: false })
  })

  test('a bad CAS No. is refused before calling out', () => {
    expect(call('chem.info', { casNo: '7647-01-1' }).error.code).toBe('INVALID')
    expect(urls).toEqual([])
  })
})

describe('key and failures', () => {
  test('without a key the teacher is told where to put one', () => {
    gas.ctx.sheetSetDataKey('')
    const res = call('chem.search', { query: '황산' })
    expect(res.error.code).toBe('NO_API_KEY')
    expect(res.error.message).toContain('공공데이터 인증키 입력')
  })

  test('a decoded key is encoded for the URL', () => {
    gas.ctx.sheetSetDataKey(' abc/def== ')
    route('getChemList001', KOSHA_EMPTY)
    call('chem.search', { query: '황산' })
    expect(urls[0]).toContain('serviceKey=abc%2Fdef%3D%3D&')
  })

  test.each([
    ['30', '인증키가 등록되지 않았'],
    ['22', '하루 호출 한도'],
    ['99', '정보를 가져오지 못했습니다'],
  ])('gateway reason %s gives a clear message (JSON and XML)', (code, text) => {
    route('chemSbstnList', GATEWAY(code))
    let res = call('chem.info', { casNo: '7647-01-0' })
    expect(res.error.code).toBe('LOOKUP_FAILED')
    expect(res.error.message).toContain(text)
    route('getChemList001', GATEWAY_XML(code))
    res = call('chem.search', { query: '황산' })
    expect(res.error.code).toBe('LOOKUP_FAILED')
    expect(res.error.message).toContain(text)
  })

  test('an HTTP error or an unreadable body is a lookup failure, not a server error', () => {
    route('chemSbstnList', 'oops', 500)
    expect(call('chem.info', { casNo: '7647-01-0' }).error.code).toBe('LOOKUP_FAILED')
    route('chemSbstnList', '<html>maintenance</html>')
    expect(call('chem.info', { casNo: '7647-01-0' }).error.code).toBe('LOOKUP_FAILED')
    route('getChemList001', 'not xml at all')
    expect(call('chem.search', { query: '황산' }).error.code).toBe('LOOKUP_FAILED')
  })

  test('a network exception is a lookup failure too', () => {
    gas.ctx.UrlFetchApp = {
      fetch() {
        throw new Error('Address unavailable')
      },
    }
    expect(call('chem.info', { casNo: '7647-01-0' }).error.code).toBe('LOOKUP_FAILED')
  })

  test('needs a login', () => {
    expect(gas.call('chem.search', { query: '황산' }).ok).toBe(false)
    expect(gas.call('chem.info', { casNo: '7647-01-0' }).ok).toBe(false)
  })
})

describe('the key in the sheet', () => {
  test('is kept in the script properties, trimmed, and removed with an empty value', () => {
    gas.ctx.sheetSetDataKey('  my-key  ')
    expect(gas.fakes.properties.get('DATA_GO_KR_KEY')).toBe('my-key')
    expect(gas.ctx.dataKeyStatus()).toBe(true)
    gas.ctx.sheetSetDataKey('')
    expect(gas.fakes.properties.has('DATA_GO_KR_KEY')).toBe(false)
    expect(gas.ctx.dataKeyStatus()).toBe(false)
  })

  test('does not follow the sheet to a new school or into the template', () => {
    gas.fakes.setSpreadsheetId('sheet-B')
    gas.ctx.sheetStartFresh()
    expect(gas.fakes.properties.has('DATA_GO_KR_KEY')).toBe(false)
    gas.ctx.sheetSetDataKey('k2')
    gas.ctx.sheetMakeTemplate('원본으로 초기화')
    expect(gas.fakes.properties.has('DATA_GO_KR_KEY')).toBe(false)
  })

  test('stays when the copy is kept as the same school', () => {
    gas.fakes.setSpreadsheetId('sheet-B')
    gas.ctx.sheetContinueCopy()
    expect(gas.fakes.properties.get('DATA_GO_KR_KEY')).toBe('abc%2Fdef%3D%3D')
  })
})
