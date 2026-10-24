import { expect, test, type Page } from '@playwright/test'

const SHOTS = '../docs/screenshots/m1'
const GAS = 'http://127.0.0.1:8787/'

async function answerNextDialog(page: Page, value?: string) {
  page.once('dialog', (d) => (value === undefined ? d.accept() : d.accept(value)))
}

test('M1: accounts, rooms, cabinets and history end to end', async ({ page, request }) => {
  // First run: connect this browser to the school's spreadsheet (the local GAS dev server)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '스프레드시트 연결' })).toBeVisible()
  await page.getByLabel('GAS 웹 앱 주소').fill(GAS)
  await page.getByRole('button', { name: '연결 테스트' }).click()
  await expect(page.getByText('연결됨: 학교 이름 미설정')).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/01-connect.png` })
  await page.getByRole('button', { name: '저장하고 계속' }).click()

  // No account yet: the first admin is made from the sheet menu
  await expect(page.getByRole('heading', { name: '운영 교사 계정을 먼저 만들어 주세요' })).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/01b-needs-admin.png` })
  const made = await request.post(`${GAS}__dev/createAdmin`, { data: { loginId: 'kim', name: '김운영', password: 'first-pass-1' } })
  expect(await made.json()).toEqual({ ok: true })
  // School name and operating teacher are entered from the sheet menu too
  const info = await request.post(`${GAS}__dev/schoolInfo`, { data: { schoolName: '청주중학교', managerName: '김운영' } })
  expect(await info.json()).toEqual({ ok: true })
  await page.getByRole('button', { name: '다시 확인' }).click()
  await expect(page.getByText('연결된 학교: 청주중학교')).toBeVisible()

  await expect(page.getByRole('heading', { name: '로그인' })).toBeVisible()
  await page.getByLabel('아이디', { exact: true }).fill('kim')
  await page.getByLabel('비밀번호', { exact: true }).fill('first-pass-1')
  await page.getByRole('button', { name: '로그인' }).click()
  await expect(page.getByRole('heading', { name: '안녕하세요, 김운영 선생님' })).toBeVisible()
  const menu = page.getByRole('navigation', { name: '주 메뉴' })
  await expect(menu.getByText('청주중학교')).toBeVisible()
  await expect(menu.getByText('관리 교사 김운영')).toBeVisible()

  // Admin creates a teacher account and reads the temporary password
  await page.getByRole('link', { name: '계정 관리' }).click()
  await page.getByLabel('새 계정 아이디').fill('lee')
  await page.getByLabel('새 계정 이름').fill('이교사')
  await page.getByRole('button', { name: '계정 만들기' }).click()
  const notice = page.getByRole('status')
  await expect(notice).toContainText('이교사')
  const tempPassword = (await notice.locator('code').textContent())!.trim()
  expect(tempPassword).toMatch(/^[a-z0-9]{10}$/)
  await expect(page.getByRole('textbox', { name: '접속 링크' })).toHaveValue(/\/\?gas=http%3A%2F%2F127\.0\.0\.1%3A8787%2F$/)
  await page.screenshot({ path: `${SHOTS}/02-users.png` })
  await page.getByRole('button', { name: '로그아웃' }).click()

  // Teacher logs in with the temporary password and must change it
  await expect(page.getByRole('heading', { name: '로그인' })).toBeVisible()
  await page.getByLabel('아이디', { exact: true }).fill('lee')
  await page.getByLabel('비밀번호', { exact: true }).fill(tempPassword)
  await page.getByRole('button', { name: '로그인' }).click()
  await expect(page.getByRole('heading', { name: '비밀번호 변경' })).toBeVisible()
  await page.getByLabel('현재 비밀번호').fill(tempPassword)
  await page.getByLabel('새 비밀번호', { exact: true }).fill('teacher-pass-1')
  await page.getByLabel('새 비밀번호 확인').fill('teacher-pass-1')
  await page.getByRole('button', { name: '비밀번호 바꾸기' }).click()
  await expect(page.getByRole('heading', { name: '안녕하세요, 이교사 선생님' })).toBeVisible()
  await expect(page.getByRole('link', { name: '계정 관리' })).toHaveCount(0)

  // Two rooms: a science lab and a prep room
  await page.getByRole('navigation', { name: '주 메뉴' }).getByRole('link', { name: '교실·보관장' }).click()
  await page.getByLabel('새 교실 이름').fill('제1과학실')
  await page.getByRole('button', { name: '교실 추가' }).click()
  await expect(page.getByRole('link', { name: '제1과학실' })).toBeVisible()
  await page.getByLabel('새 교실 이름').fill('과학 준비실')
  await page.getByLabel('과학실 (월간 점검 대상)').uncheck()
  await page.getByRole('button', { name: '교실 추가' }).click()
  await expect(page.getByRole('link', { name: '과학 준비실' })).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/03-rooms.png` })

  // A 3×2 sealed cabinet in the lab
  await page.getByRole('link', { name: '제1과학실' }).click()
  await page.getByLabel('새 보관장 이름').fill('A 시약장')
  await page.getByLabel('종류').selectOption('sealed')
  await page.getByLabel('단 수').fill('3')
  await page.getByLabel('칸 수').fill('2')
  await page.getByRole('button', { name: '보관장 추가' }).click()
  await page.getByRole('link', { name: 'A 시약장' }).click()
  await expect(page.getByRole('gridcell')).toHaveCount(6)

  // Rename a zone
  await page.getByRole('gridcell').first().click()
  await page.getByLabel('구역 이름').fill('진한 산')
  await page.getByRole('button', { name: '구역 저장' }).click()
  await expect(page.getByRole('gridcell').first()).toContainText('진한 산')
  await page.screenshot({ path: `${SHOTS}/04-cabinet.png` })

  // Copy the cabinet from the room page
  await page.getByRole('link', { name: '제1과학실' }).click()
  await answerNextDialog(page, 'B 시약장')
  await page.getByRole('row', { name: /A 시약장/ }).getByRole('button', { name: '복제' }).click()
  await expect(page.getByRole('link', { name: 'B 시약장' })).toBeVisible()

  // Find the copy with the top-bar search
  await page.getByLabel('보관장 찾기').fill('B 시')
  await page.getByRole('option', { name: '제1과학실 › B 시약장' }).click()
  await expect(page.getByRole('heading', { name: 'B 시약장' })).toBeVisible()
  await expect(page.getByRole('gridcell').first()).toContainText('진한 산')

  // The cabinet history names the teacher
  await page.getByRole('button', { name: '변경 이력' }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('이교사')
  await expect(dialog).toContainText('추가')
  await page.screenshot({ path: `${SHOTS}/05-history.png` })
})
