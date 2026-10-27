import { expect, test, type APIRequestContext } from '@playwright/test'

const SHOTS = '../docs/screenshots/m2'
const GAS = 'http://127.0.0.1:8787/'

async function gas(request: APIRequestContext, action: string, payload: object, token?: string) {
  const res = await request.post(GAS, { headers: { 'Content-Type': 'text/plain' }, data: JSON.stringify({ action, token, payload }) })
  const body = await res.json()
  expect(body.ok, `${action}: ${JSON.stringify(body.error)}`).toBe(true)
  return body.data
}

test('M2: register a reagent, record uses, print the ledger, find it', async ({ page, request }) => {
  // The first admin may already exist when the M1 scenario ran first on the same dev server.
  await request.post(`${GAS}__dev/createAdmin`, { data: { loginId: 'kim', name: '김운영', password: 'first-pass-1' } })
  await request.post(`${GAS}__dev/schoolInfo`, { data: { schoolName: '청주중학교', managerName: '김운영' } })
  const token = (await gas(request, 'auth.login', { loginId: 'kim', password: 'first-pass-1' })).token
  const room = await gas(request, 'records.create', { table: 'Rooms', values: { name: 'M2 화학실', isLab: true } }, token)
  const cabinet = await gas(request, 'records.create', { table: 'Cabinets', values: { roomId: room.id, name: 'M2 시약장', type: 'sealed', locked: true, rows: 1, cols: 1 } }, token)
  const [zone] = await gas(request, 'records.createMany', { table: 'Zones', rows: [{ cabinetId: cabinet.id, row: 1, col: 1, name: '진한 산' }] }, token)
  await gas(request, 'settings.update', { region: 'chungbuk' }, token)

  await page.goto('/')
  await page.getByLabel('GAS 웹 앱 주소').fill(GAS)
  await page.getByRole('button', { name: '연결 테스트' }).click()
  await page.getByRole('button', { name: '저장하고 계속' }).click()
  await page.getByLabel('아이디', { exact: true }).fill('kim')
  await page.getByLabel('비밀번호', { exact: true }).fill('first-pass-1')
  await page.getByRole('button', { name: '로그인' }).click()

  // Register: hazard judged from CAS No. + concentration, stock as of 3월 1일
  await page.getByRole('link', { name: '시약', exact: true }).click()
  await page.getByRole('link', { name: '시약 등록' }).click()
  await page.getByLabel('약품명').fill('염화 수소(염산)')
  await page.getByLabel('농도(%)').fill('35')
  await page.getByLabel('CAS No.').fill('7647-01-0')
  await expect(page.getByLabel('유독물질')).toHaveValue('해당')
  await page.getByLabel('보관장', { exact: true }).selectOption({ label: 'M2 시약장' })
  await page.getByLabel('구역', { exact: true }).selectOption({ label: '진한 산' })
  await page.getByLabel('기초 재고량 (mL)').fill('500')
  await page.getByRole('button', { name: '이 학년도 3월 1일' }).click()
  await page.screenshot({ path: `${SHOTS}/01-register.png`, fullPage: true })
  await page.getByRole('button', { name: '등록' }).click()
  await expect(page.getByRole('heading', { name: '염화 수소(염산) 35%' })).toBeVisible()

  // Two uses right after experiments
  for (const [amount, purpose] of [
    ['50', '2학년 중화 반응 실험'],
    ['30', '3학년 산과 염기'],
  ]) {
    await page.getByRole('button', { name: '사용 기록' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('사용량 (mL)').fill(amount)
    await dialog.getByLabel('용도', { exact: true }).fill(purpose)
    if (amount === '30') await page.screenshot({ path: `${SHOTS}/02-use.png` })
    await dialog.getByRole('button', { name: '저장' }).click()
    await expect(dialog).toBeHidden()
  }
  await expect(page.getByText('현재 보유량 420 mL')).toBeVisible()

  // Ledger in the three regional forms
  for (const region of ['chungbuk', 'seoul', 'gyeonggi']) {
    await gas(request, 'settings.update', { region }, token)
    await page.goto('/reagents/ledger')
    const sheet = page.getByRole('region', { name: '염화 수소(염산) 35% 1쪽' })
    await expect(sheet).toBeVisible()
    const remaining = region === 'seoul' ? 8 : 5
    const cells = sheet.locator(`table.ledger-rows tbody tr td:nth-child(${remaining})`)
    await expect(cells.nth(0)).toHaveText('500')
    await expect(cells.nth(1)).toHaveText('450')
    await expect(cells.nth(2)).toHaveText('420')
    await page.screenshot({ path: `${SHOTS}/03-ledger-${region}.png`, fullPage: true })
  }
  await gas(request, 'settings.update', { region: 'chungbuk' }, token)

  // Find where it is kept
  await page.getByRole('link', { name: '위치 찾기' }).click()
  await page.getByLabel('찾을 시약').fill('염산')
  await page.getByRole('link', { name: 'M2 화학실 › M2 시약장 › 진한 산' }).click()
  await expect(page).toHaveURL(`/cabinets/${cabinet.id}?zone=${zone.id}`)
  await expect(page.locator('.zone-highlight')).toContainText('진한 산')
  await page.screenshot({ path: `${SHOTS}/04-find.png` })
})
