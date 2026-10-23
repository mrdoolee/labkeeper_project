# 여러 학교 공용 연결 구조 + 디자인 B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 웹앱이 빌드에 박힌 GAS 주소 대신 첫 화면에서 학교 스프레드시트(GAS)를 연결해 쓰게 하고, 첫 운영 교사 계정은 시트 메뉴에서 만들며, 화면 전체를 디자인 B로 바꾼다.

**Architecture:** GAS에 `system.info`(버전·첫 계정 필요 여부·사본 여부·학교 이름)와 시트 메뉴 함수들을 추가하고, 웹은 localStorage에 GAS 주소를 저장해 그 주소로 요청한다. 앱 시작 시 `system.info` 결과에 따라 연결/오류/사본/옛 버전/첫 계정 안내/로그인 화면으로 갈라진다. 디자인은 styles.css 토큰과 Layout만 바꾸고 아이콘은 lucide-react를 쓴다.

**Tech Stack:** Apps Script(V8, 전역 함수), Vite + React 19 + TypeScript, Vitest + RTL, Playwright, lucide-react

**Spec:** docs/superpowers/specs/2026-10-23-multi-school-connect-and-redesign-design.md

## Global Constraints

- 사용자와 화면 문구는 한국어. 화면 문구는 쉬운 말.
- GAS 코드는 모듈 없는 전역 함수. 최상위에서는 정의만 하고, 액션은 `registerActions()`에서 모은다.
- 기록 원칙: 계정 생성·비밀번호 초기화·사본 해제 모두 AuditLog에 남긴다. 작성자 표기는 메뉴 계정 생성 `{id:'system', name:'첫 설정'}`, 메뉴 비밀번호 초기화 `{id:'sheet-owner', name:'시트 소유자'}`.
- `API_VERSION`(GAS) = `REQUIRED_API_VERSION`(웹) = `2`.
- 받아들이는 GAS 주소: `https://script.google.com/macros/s/<id>/exec`, `https://script.google.com/a/macros/<도메인>/s/<id>/exec`. 개발 빌드(`import.meta.env.DEV`)에서만 `http://127.0.0.1:<포트>/…`, `http://localhost:<포트>/…`.
- localStorage 키: GAS 주소 `labkeeper.gasUrl`, 메뉴 접힘 `labkeeper.navCollapsed`. 저장소 오류는 모두 try/catch로 무시하고 메모리 값으로 동작.
- `VITE_GAS_URL`은 코드·설정·문서에서 모두 없앤다.
- 새 의존성은 `lucide-react` 하나만. Tailwind·shadcn·QR 라이브러리 금지.
- 모바일 전용 작업 금지(PC 먼저).
- 디자인 B 값: 배경 `#f1f5f9`, 메뉴 `#0f172a`, 메뉴 선택·주요 버튼 `#2563eb`(흰 글자), 카드 흰 바탕 + 1px `#e2e8f0` 테두리 + 그림자 `0 1px 3px rgba(15,23,42,.06)` + 모서리 10px, 입력칸·버튼 모서리 8px. 그라데이션 없음.

## Review Focus

1. 접속 링크의 `?gas=` 값 앞뒤 공백·URL 인코딩 → 디코드하고 공백을 잘라 검사해야 한다 (Task 4 테스트).
2. localStorage에 남은 옛·잘못된 주소 → 저장된 주소가 없는 것처럼 연결 화면으로 가야 한다 (Task 4 테스트).
3. 원본(빈) 시트를 복사한 새 학교: Users 시트 자체가 아직 없음 → 사본으로 보지 않고 주인을 새로 적어야 한다 (Task 1 테스트).
4. 설정(Settings) 시트가 아직 없는 학교의 `system.info` → `schoolName: ''`로 정상 응답해야 한다 (Task 1 테스트).
5. 연결 학교를 바꿀 때 이전 학교의 로그인 토큰이 새 학교로 가면 안 된다 → 주소가 바뀌면 토큰을 지운다 (Task 4 테스트).

---

## 1부 — 연결 구조

### Task 1: GAS `system.info`, 버전, 사본 감지

**Files:**
- Modify: `gas/test/fakes.js` (ScriptProperties, `spreadsheet.getId()`/`getUrl()`, `options.spreadsheetId`, `fakes.setSpreadsheetId(id)`)
- Create: `gas/src/System.js`
- Modify: `gas/src/Code.js` (registerActions에 `systemActions()`, doPost에서 사본 검사), `gas/src/Auth.js` (`setup.status`·`setup.createAdmin` 액션 제거; `setupCreateAdmin` 로직은 Task 2가 `sheetCreateAdmin`으로 옮김)
- Test: `gas/test/system.test.js`; 기존 `auth.test.js`·`users.test.js`·`records.test.js`·`settings.test.js`·`router.test.js`의 첫 계정 만들기를 `gas.ctx.sheetCreateAdmin(...)`로 바꾼다 (Task 2와 함께; Task 1에서는 도우미 `gas/test/helpers.js`의 `createAdmin(gas, loginId, name, password)`가 임시로 `setupCreateAdmin`을 직접 호출하고 `{token, user}`를 돌려준다)

**Interfaces:**
- Produces (GAS 전역): `API_VERSION = 2`; `systemInfo() → {name:'LabKeeper', apiVersion, needsSetup, copied, schoolName}`; `sheetOwnerState() → 'ok' | 'copied'` (필요하면 주인 ID를 적거나 바꿈); 오류 코드 `SHEET_COPIED` (메시지: "운영 중인 시트의 사본입니다. 시트 메뉴 LabKeeper → 사본을 새 학교 시트로 시작을 먼저 실행하세요.")
- Produces (액션): `system.info` (auth none, write false)
- Produces (fakes): `createFakes({spreadsheetId})`, `fakes.setSpreadsheetId(id)`, `globals.PropertiesService.getScriptProperties()` (getProperty/setProperty/deleteProperty), `fakes.properties` (Map)

- [ ] **Step 1: 실패하는 테스트 작성** — `gas/test/system.test.js`

```js
test('reports version, setup need and school name on an empty sheet', () => {
  expect(gas.call('system.info').data).toEqual({ name: 'LabKeeper', apiVersion: 2, needsSetup: true, copied: false, schoolName: '' })
})
test('after an admin and a school name exist', () => {
  const { token } = createAdmin(gas, 'kim', '김운영', 'first-pass-1')
  gas.call('settings.update', { schoolName: '청주중학교' }, token)
  expect(gas.call('system.info').data).toMatchObject({ needsSetup: false, schoolName: '청주중학교' })
})
test('a copy of a blank template adopts the new sheet', () => {
  gas.call('system.info')                    // owner = sheet-A
  gas.fakes.setSpreadsheetId('sheet-B')      // copied, no Users sheet yet
  expect(gas.call('system.info').data.copied).toBe(false)
  expect(gas.fakes.properties.get('OWNER_SPREADSHEET_ID')).toBe('sheet-B')
})
test('a copy of a sheet in use is flagged and refuses other requests', () => {
  const { token } = createAdmin(gas, 'kim', '김운영', 'first-pass-1')
  gas.fakes.setSpreadsheetId('sheet-B')
  expect(gas.call('system.info').data.copied).toBe(true)
  expect(gas.call('auth.login', { loginId: 'kim', password: 'first-pass-1' }).error.code).toBe('SHEET_COPIED')
  expect(gas.call('records.list', { table: 'Rooms' }, token).error.code).toBe('SHEET_COPIED')
})
test('a sheet used before this feature (no owner yet, has users) is adopted, not flagged', () => {
  createAdmin(gas, 'kim', '김운영', 'first-pass-1')
  gas.fakes.properties.clear()
  expect(gas.call('system.info').data.copied).toBe(false)
})
test('the web setup actions are gone', () => {
  expect(gas.call('setup.createAdmin', { loginId: 'x', name: 'x', password: 'xxxxxxxx' }).error.code).toBe('UNKNOWN_ACTION')
  expect(gas.call('setup.status').error.code).toBe('UNKNOWN_ACTION')
})
```

- [ ] **Step 2: 실행해서 실패 확인** — Run: `cd gas && npx vitest run test/system.test.js` / Expected: FAIL (`system.info` UNKNOWN_ACTION, helpers 없음)
- [ ] **Step 3: 구현** — fakes에 위 Interfaces 추가(기본 `spreadsheetId` = `'sheet-A'`, `getUrl()` = `https://docs.google.com/spreadsheets/d/<id>/edit`). `System.js`에 `systemActions()`, `systemInfo`, `sheetOwnerState`. `sheetOwnerState` 규칙은 스펙 4.4 그대로: 주인 없음 → 적기; 같음 → ok; 다르고 Users 행 없음(시트 없음 포함) → 바꿔 적기; 다르고 Users 행 있음 → copied. `doPost`는 액션을 찾은 뒤 `system.info`가 아니면 `sheetOwnerState()==='copied'`일 때 `SHEET_COPIED`로 거절. `schoolName`은 Settings 값을 쓰되 시트가 없으면 `''`(설정 읽기는 기존 Settings 함수를 재사용). 기존 테스트의 첫 계정 생성은 `helpers.createAdmin`으로 바꾼다.
- [ ] **Step 4: 통과 확인** — Run: `cd gas && npm test` / Expected: 전부 PASS
- [ ] **Step 5: Commit** — `git commit -m "Add system.info with API version and copy detection; drop web setup actions"`

### Task 2: 시트 메뉴 (첫 계정, 비밀번호 초기화, 사본 해제, 구조 점검) + 시트 주소

**Files:**
- Create: `gas/src/Menu.js`
- Modify: `gas/src/Auth.js` (`setupCreateAdmin` 제거 → `sheetCreateAdmin`), `gas/src/Users.js` (`directory.list`에 `SHEET_OWNER`), `gas/src/System.js` (`system.sheetUrl`)
- Modify: `gas/test/helpers.js` (`createAdmin`이 `gas.ctx.sheetCreateAdmin` 뒤 `auth.login`으로 `{token, user}` 반환)
- Test: `gas/test/menu.test.js`

**Interfaces:**
- Produces (GAS 전역, 화면 없이 테스트되는 함수):
  - `SHEET_OWNER = {id:'sheet-owner', name:'시트 소유자'}`
  - `sheetCreateAdmin({loginId, name, password}) → {loginId, name}`; 계정이 이미 있으면 `apiError('SETUP_DONE', '이미 운영 교사 계정이 있습니다.')`; 검증은 `checkLoginId`·`checkPasswordRule`·이름 필수 그대로
  - `sheetResetAdminPassword(loginId) → {tempPassword}`; 활성 운영 교사가 아니면 `NOT_FOUND`; 동작은 `users.resetPassword`와 같음(mustChangePassword, 실패 횟수 초기화, salt 교체로 세션 끊김), 이력 `passwordReset`, 작성자 `SHEET_OWNER`
  - `sheetStartFresh() → true`: 모든 TABLES 시트와 AuditLog의 데이터 행 삭제(머리글 유지), 주인 ID를 지금 시트로 기록
  - `checkSheetStructure() → string[]`: 문제 목록(시트 없음 "○○ 시트가 없습니다", 머리글 없음 "○○ 시트에 ○○ 열이 없습니다"). 문제 없으면 `[]`
  - UI 래퍼(테스트 안 함, 얇게): `onOpen()` 메뉴 "LabKeeper" — "운영 교사 계정 만들기", "운영 교사 비밀번호 초기화", "시트 구조 점검", "사본을 새 학교 시트로 시작", "사용 가이드". 계정 만들기는 `HtmlService.createHtmlOutput(<문자열>)` 대화상자(비밀번호 `type="password"`)에서 `google.script.run.sheetCreateAdminFromDialog(form)` 호출. 나머지는 `SpreadsheetApp.getUi().prompt/alert`. 사본 해제는 확인(YES_NO) 뒤 실행. 별도 .html 파일 없음(묶음 한 파일 유지).
- Produces (액션): `system.sheetUrl` (auth admin) → `{url}`

- [ ] **Step 1: 실패하는 테스트 작성** — `gas/test/menu.test.js`

```js
test('creates the first admin once, recorded as 첫 설정', () => {
  expect(gas.ctx.sheetCreateAdmin({ loginId: 'Kim', name: '김운영', password: 'first-pass-1' })).toEqual({ loginId: 'kim', name: '김운영' })
  expect(gas.call('auth.login', { loginId: 'kim', password: 'first-pass-1' }).ok).toBe(true)
  expect(() => gas.ctx.sheetCreateAdmin({ loginId: 'park', name: '박', password: 'first-pass-1' })).toThrow('이미 운영 교사 계정이 있습니다')
  expect(gas.call('system.info').data.needsSetup).toBe(false)
})
test('rejects a bad login id or short password', () => { /* checkLoginId / checkPasswordRule messages */ })
test('resets an admin password from the sheet, ending their sessions', () => {
  const { token, user } = createAdmin(gas, 'kim', '김운영', 'first-pass-1')
  const { tempPassword } = gas.ctx.sheetResetAdminPassword('kim')
  expect(tempPassword).toMatch(/^[a-z0-9]{10}$/)
  expect(gas.call('auth.me', {}, token).error.code).toBe('AUTH_REQUIRED')
  const login = gas.call('auth.login', { loginId: 'kim', password: tempPassword })
  expect(login.data.user.mustChangePassword).toBe(true)
  const last = gas.call('audit.list', { table: 'Users', recordId: user.id }, login.data.token).data
    .find((e) => e.action === 'passwordReset')
  expect(last.userName).toBe('시트 소유자')
})
test('refuses to reset a teacher or unknown id', () => { /* NOT_FOUND */ })
test('start fresh clears every data row and un-flags the copy', () => {
  const { token } = createAdmin(gas, 'kim', '김운영', 'first-pass-1')
  gas.call('records.create', { table: 'Rooms', values: { name: '제1과학실', isLab: true, note: '' } }, token)
  gas.fakes.setSpreadsheetId('sheet-B')
  expect(gas.call('system.info').data.copied).toBe(true)
  gas.ctx.sheetStartFresh()
  expect(gas.call('system.info').data).toMatchObject({ copied: false, needsSetup: true })
  expect(gas.sheet('Rooms').length).toBe(1)   // header only
})
test('structure check lists a renamed header', () => {
  createAdmin(gas, 'kim', '김운영', 'first-pass-1')
  gas.fakes.sheets.get('Users').data[0][1] = 'loginid'   // header row edited by hand
  expect(gas.ctx.checkSheetStructure()).toContain('Users 시트에 loginId 열이 없습니다')
})
test('only an admin gets the sheet address', () => {
  const { token } = createAdmin(gas, 'kim', '김운영', 'first-pass-1')
  expect(gas.call('system.sheetUrl', {}, token).data.url).toBe('https://docs.google.com/spreadsheets/d/sheet-A/edit')
  // a teacher token → FORBIDDEN
})
test('the directory names the sheet owner', () => { /* directory.list contains {id:'sheet-owner', name:'시트 소유자'} */ })
```

  (주석으로 적은 세 테스트도 같은 방식으로 실제 assertion을 써서 채운다.)
- [ ] **Step 2: 실패 확인** — Run: `cd gas && npx vitest run test/menu.test.js` / Expected: FAIL (`sheetCreateAdmin is not a function`)
- [ ] **Step 3: 구현** — 위 Interfaces대로. `checkSheetStructure`는 `openTable`을 쓰지 말 것(머리글을 자동으로 채워 버리므로) — 시트를 직접 읽는다. 메뉴 함수 실행은 `LockService`로 감싼다.
- [ ] **Step 4: 통과 확인** — Run: `cd gas && npm test` / Expected: 전부 PASS
- [ ] **Step 5: Commit** — `git commit -m "Add LabKeeper sheet menu: first admin, admin reset, start fresh, structure check"`

### Task 3: 학교용 코드 한 파일 묶음 + 개발 서버 첫 계정

**Files:**
- Create: `gas/bundle.mjs` (exports `bundleSource() → string`, CLI는 `gas/dist/LabKeeper.gs`에 씀), `gas/dist/LabKeeper.gs`
- Modify: `gas/package.json` (`"bundle": "node bundle.mjs"`), `gas/dev-server.mjs` (`POST /__dev/createAdmin` body `{loginId,name,password}` → `gas.ctx.sheetCreateAdmin`, 응답 `{ok:true}`; 127.0.0.1 전용 개발 서버이므로 그대로 둠)
- Test: `gas/test/bundle.test.js`, `gas/test/dev-server.test.js`

**Interfaces:**
- Produces: `bundleSource()` — 머리말 주석("LabKeeper 학교용 코드. gas/src에서 자동 생성 — 직접 고치지 말 것. API_VERSION n") + `gas/src/*.js`를 이름순으로 각 파일 이름 주석과 함께 이어 붙인 문자열
- Produces: dev server `POST /__dev/createAdmin`

- [ ] **Step 1: 실패하는 테스트** — `bundle.test.js`: (a) `fs.readFileSync('dist/LabKeeper.gs','utf8') === bundleSource()` — 실패 메시지 "run npm run bundle"; (b) 묶음을 vm 한 컨텍스트에서 실행하면 `doPost`·`onOpen`·`sheetCreateAdmin`이 함수로 존재. `dev-server.test.js`: `/__dev/createAdmin` 후 `auth.login` 성공.
- [ ] **Step 2: 실패 확인** — Run: `cd gas && npx vitest run test/bundle.test.js test/dev-server.test.js` / Expected: FAIL
- [ ] **Step 3: 구현 후 `npm run bundle`**
- [ ] **Step 4: 통과 확인** — Run: `cd gas && npm test` / Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "Bundle GAS into one school file; dev server can create the first admin"`

### Task 4: 웹 — GAS 주소 저장과 요청

**Files:**
- Create: `web/src/api/connection.ts`, `web/src/api/connection.test.ts`
- Modify: `web/src/api/client.ts` (저장된 주소로 요청), `web/src/vite-env.d.ts`, `web/.env.example` (VITE_GAS_URL 제거)
- Test: `web/src/api/client.test.ts` (기존 테스트가 env 대신 `setGasUrl`을 쓰게)

**Interfaces:**
- Produces:
  - `isValidGasUrl(url: string): boolean`
  - `getGasUrl(): string | null` — 저장값이 유효하지 않으면 null
  - `setGasUrl(url: string | null): boolean` — 유효하지 않으면 false·변경 없음; 값이 바뀌면 `setToken(null)`
  - `takeGasFromQuery(): string | null` — `location.search`의 `gas`를 디코드·trim해 유효하면 반환하고, 주소창에서 `gas` 파라미터를 지운다(`history.replaceState`, 다른 파라미터·경로 유지). 저장은 하지 않음(저장 여부는 Task 5가 결정)
  - `schoolLink(gasUrl: string): string` — `${location.origin}/?gas=${encodeURIComponent(gasUrl)}`
  - `callApi<T>(action, payload?, url?: string)` — `url` 생략 시 `getGasUrl()`; 주소가 없으면 `ApiError('NO_CONNECTION', '연결된 스프레드시트가 없습니다.')`

- [ ] **Step 1: 실패하는 테스트** — `connection.test.ts`

```ts
test.each([
  ['https://script.google.com/macros/s/AKfy123/exec', true],
  ['https://script.google.com/a/macros/cbe.go.kr/s/AKfy123/exec', true],
  ['https://script.google.com/macros/s/AKfy123/dev', false],
  ['http://script.google.com/macros/s/AKfy123/exec', false],
  ['https://evil.example.com/macros/s/AKfy123/exec', false],
  ['https://script.google.com.evil.com/macros/s/x/exec', false],
  ['', false],
])('isValidGasUrl(%s) → %s', (url, ok) => expect(isValidGasUrl(url)).toBe(ok))
test('localhost is accepted only in dev builds')        // vi.stubEnv('DEV', false) → false; true → true
test('an invalid stored address reads as none', () => { localStorage.setItem('labkeeper.gasUrl', 'https://x.com/'); expect(getGasUrl()).toBeNull() })
test('changing the address clears the login token', () => { setToken('t'); setGasUrl(A); setToken('t'); setGasUrl(B); expect(getToken()).toBeNull() })
test('setting the same address keeps the token')
test('takeGasFromQuery decodes, trims and removes only gas from the address bar', () => {
  history.replaceState(null, '', '/rooms?x=1&gas=' + encodeURIComponent('  ' + A + ' '))
  expect(takeGasFromQuery()).toBe(A)
  expect(location.pathname + location.search).toBe('/rooms?x=1')
})
test('takeGasFromQuery ignores an invalid address but still removes it')
test('schoolLink builds the share link', () => expect(schoolLink(A)).toBe(location.origin + '/?gas=' + encodeURIComponent(A)))
```

  `client.test.ts`: 주소가 없으면 `NO_CONNECTION`; `callApi('x', {}, other)`는 `other`로 보냄.
- [ ] **Step 2: 실패 확인** — Run: `cd web && npx vitest run src/api` / Expected: FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — Run: `cd web && npm test && npx tsc -b` / Expected: PASS (App 테스트가 깨지면 Task 5에서 고치므로, 이 단계에서는 `src/api`만 통과 확인 후 Task 5와 한 커밋으로 묶어도 된다 — 그렇게 하면 ledger에 Ruling으로 적는다)
- [ ] **Step 5: Commit** — `git commit -m "Store the school's GAS address in the browser and send requests to it"`

### Task 5: 웹 — 시작 흐름과 연결 화면들

**Files:**
- Create: `web/src/api/system.ts` (`REQUIRED_API_VERSION = 2`, `type SystemInfo = {name, apiVersion, needsSetup, copied, schoolName}`, `fetchSystemInfo(url?: string): Promise<SystemInfo>`)
- Create: `web/src/pages/ConnectPage.tsx`, `web/src/pages/StatusScreens.tsx` (연결 오류, 사본, 옛 버전, 첫 계정 필요, 학교 바꾸기 확인 — 작은 화면 5개를 한 파일에)
- Modify: `web/src/auth/AuthContext.tsx` (`setup.status`·`setupAdmin` 제거; `connection: {state, info, pendingGasUrl}` 제공), `web/src/App.tsx`, `web/src/pages/LoginPage.tsx` (학교 이름 + "다른 스프레드시트에 연결")
- Delete: `web/src/pages/SetupPage.tsx`
- Test: `web/src/App.test.tsx`

**Interfaces:**
- Consumes: Task 4의 `getGasUrl`, `setGasUrl`, `takeGasFromQuery`, `callApi`
- Produces (`useAuth()`에 추가): `connection.state: 'none' | 'checking' | 'error' | 'copied' | 'outdated' | 'needsAdmin' | 'switch' | 'ready'`, `connection.info: SystemInfo | null`, `connection.pending: string | null`(학교 바꾸기 확인 중인 새 주소), `connect(url: string): Promise<void>`(저장 + 다시 확인), `disconnect(): void`(주소 지우고 'none'), `recheck(): Promise<void>`, `acceptSwitch(): void`, `rejectSwitch(): void`
- 시작 규칙(스펙 4.3, 4.5): `takeGasFromQuery()` 결과가 있으면 — 저장 주소 없음 → 저장; 같음 → 그대로; 다름 → `state='switch'`(새 주소의 `system.info`로 학교 이름을 받아 확인 화면에 "지금: A학교 / 새 링크: B학교"). 그다음 `system.info` → 실패 'error', copied 'copied', `apiVersion < REQUIRED_API_VERSION` 'outdated', needsSetup 'needsAdmin', 그 밖 'ready'(이후 기존 `auth.me` 흐름).

화면 문구(정확히):
- 연결: 제목 "스프레드시트 연결", 입력 라벨 "GAS 웹 앱 주소", 버튼 "연결 테스트", 성공 시 "연결됨: {학교 이름 또는 '학교 이름 미설정'}" + 버튼 "저장하고 계속", 실패 시 "연결하지 못했습니다" + 도움말 3줄(주소가 …/exec로 끝나는지 / 배포 액세스가 '모든 사용자'인지 / 방금 배포했다면 10초 뒤 다시) + 설치 안내 링크(GitHub `docs/setup-guide.md`). 형식이 틀리면 "구글 Apps Script 웹 앱 주소(https://script.google.com/…/exec)를 넣어 주세요."
- 연결 오류: "스프레드시트에 연결할 수 없습니다" + 버튼 "다시 시도", "주소 바꾸기"
- 사본: "운영 중인 시트의 사본입니다" + "시트 메뉴 LabKeeper → 사본을 새 학교 시트로 시작을 실행한 뒤 다시 확인하세요." + "다시 확인", "주소 바꾸기"
- 옛 버전: "학교 시트의 프로그램이 옛 버전입니다" + "설치 안내의 '코드 업데이트' 순서대로 다시 배포해 주세요." + "다시 확인"
- 첫 계정 필요: "운영 교사 계정을 먼저 만들어 주세요" + "스프레드시트 메뉴 LabKeeper → 운영 교사 계정 만들기에서 만든 뒤 다시 확인을 누르세요." + "다시 확인"
- 학교 바꾸기: "다른 학교 스프레드시트로 연결을 바꿀까요?" + 두 학교 이름 + "바꾸기", "그대로 두기"
- 로그인 화면 위: "연결된 학교: {이름 또는 '학교 이름 미설정'}" + 링크 버튼 "다른 스프레드시트에 연결"

- [ ] **Step 1: 실패하는 테스트** — `App.test.tsx`의 `serve()`가 `system.info`를 응답하도록 바꾸고 아래 추가. (`connection` 모듈은 실제 것을 쓰고 localStorage로 상태를 만든다.)

```ts
test('no stored address shows the connect screen; a good test then saves and goes to login', ...)
  // '스프레드시트 연결' heading → type A → '연결 테스트' → callApi('system.info', undefined, A) → '연결됨: 청주중학교' → '저장하고 계속' → heading '로그인' + '연결된 학교: 청주중학교'
test('a failed test explains the usual causes', ...)          // '연결하지 못했습니다', '모든 사용자'
test('a malformed address is refused before any request', ...) // api not called
test('a network failure at start shows the error screen with retry', ...)  // M9
test('a copied sheet shows the copy screen', ...)
test('an old GAS version asks for a redeploy', ...)           // apiVersion 1
test('no admin yet points to the sheet menu', ...)            // needsSetup true, no account form on screen
test('a ?gas= link to another school asks before switching; 그대로 두기 keeps the old one', ...)
test('a ?gas= link when nothing is stored connects straight away', ...)
test('다른 스프레드시트에 연결 returns to the connect screen', ...)
```

  기존 테스트 중 웹 계정 만들기(SetupPage) 테스트는 지운다.
- [ ] **Step 2: 실패 확인** — Run: `cd web && npx vitest run src/App.test.tsx` / Expected: FAIL
- [ ] **Step 3: 구현** — 화면들은 기존 `.auth-screen` + `.card` 마크업과 `Field`/`ErrorMessage` 부품을 쓴다.
- [ ] **Step 4: 통과 확인** — Run: `cd web && npm test && npx tsc -b` / Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "Start by connecting the school spreadsheet; explain connection, copy, version and first-admin states"`

### Task 6: 웹 — 접속 링크와 시트 열기 (계정 관리)

**Files:**
- Modify: `web/src/pages/UsersPage.tsx`
- Test: `web/src/pages/UsersPage.test.tsx`

**Interfaces:**
- Consumes: `schoolLink(getGasUrl()!)`, 액션 `system.sheetUrl` → `{url}`

화면: 섹션 제목 "우리 학교 접속 링크", 읽기 전용 입력(라벨 "접속 링크")에 링크, 버튼 "복사"(성공 시 status "복사했습니다", `navigator.clipboard` 실패 시 입력칸을 선택하고 "직접 복사해 주세요(Ctrl+C)"), 안내 "새 선생님께 이 링크와 임시 비밀번호를 함께 전해 주세요.". 버튼 "스프레드시트 열기"(누르면 `system.sheetUrl`을 받아 `window.open(url, '_blank', 'noopener')`).

- [ ] **Step 1: 실패하는 테스트** — 링크 값이 `schoolLink(A)`와 같음; 복사 버튼이 `navigator.clipboard.writeText(link)` 호출 후 "복사했습니다"; clipboard 거절 시 안내 문구; 시트 열기 버튼이 `system.sheetUrl` 후 `window.open` 호출.
- [ ] **Step 2: 실패 확인** — Run: `cd web && npx vitest run src/pages/UsersPage.test.tsx` / Expected: FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — Run: `cd web && npm test && npx tsc -b` / Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "Share the school link and open the spreadsheet from account management"`

### Task 7: e2e와 문서

**Files:**
- Modify: `web/playwright.config.ts` (`VITE_GAS_URL` env 제거), `web/e2e/m1.spec.ts` → 처음에 연결 화면에서 `http://127.0.0.1:8787/` 입력 → 연결 테스트 → "첫 계정 필요" 화면 → `request.post('http://127.0.0.1:8787/__dev/createAdmin', …)` → 다시 확인 → 로그인. 이후 기존 시나리오. 마지막에 계정 관리에서 접속 링크가 보이는지 확인. 스크린샷 `01-connect.png`, `01b-needs-admin.png` 추가(기존 `01-setup.png` 삭제).
- Modify: `docs/setup-guide.md` (스펙 4.1 흐름 전체 재작성: 원본 사본 링크 자리 `<원본 사본 링크>` + 원본 만드는 법(관리자용 절), 배포, 시트 메뉴로 첫 계정, 공용 주소에서 연결, 접속 링크 전하기, 코드 업데이트(`gas/dist/LabKeeper.gs` 하나 붙여 넣기 → 기존 스크립트 파일 삭제 → 배포 관리에서 새 버전), Workspace 계정 주의, 머리글 이름 바꾸지 말 것 경고 유지)
- Modify: `CLAUDE.md` (배포 구조 결정을 새 구조로; 개발 명령에 `npm run bundle`; e2e 설명), `README.md` (진행 상황)

- [ ] **Step 1: e2e 수정 후 실행** — Run: `cd web && npm run e2e` / Expected: 1 passed
- [ ] **Step 2: 문서 수정**
- [ ] **Step 3: 전체 확인** — Run: `cd gas && npm test` 그리고 `cd web && npm test && npx tsc -b && npm run build` / Expected: 모두 PASS
- [ ] **Step 4: Commit** — `git commit -m "Update e2e and guides for the shared multi-school setup"`

## 2부 — 디자인 B

### Task 8: 색·모양 토큰과 새 왼쪽 메뉴

**Files:**
- Modify: `web/package.json` (`lucide-react` 추가), `web/src/styles.css`, `web/src/components/Layout.tsx`
- Test: `web/src/components/Layout.test.tsx` (새로)

**Interfaces:**
- Produces: CSS 클래스 `.sidebar`, `.sidebar.collapsed`, `.nav-item`, `.user-box`, `.logo-tile`, `.card-grid`, `.room-card`(Task 9가 씀)

메뉴 구성: 로고(`FlaskConical` in `.logo-tile` + "LabKeeper") + 접기 버튼(`ChevronLeft`, aria-label "메뉴 접기"/"메뉴 펴기", 접혔을 때 아이콘 회전), 메뉴 항목(`Home` 홈, `LayoutGrid` 교실·보관장, `SlidersHorizontal` 설정, `Users` 계정 관리(운영 교사만)) — 각 `NavLink`에 아이콘 + 이름 span. 접히면 이름 span을 숨기고 링크에 `aria-label`·`title`로 이름 유지. 아래 사용자 칸(이름 첫 글자 동그라미, "{이름} 선생님", 역할, `LogOut` 아이콘 버튼 aria-label "로그아웃"). 위쪽 줄은 보관장 찾기만(`Search` 아이콘). 접힘 상태는 `labkeeper.navCollapsed`에 저장.

- [ ] **Step 1: 실패하는 테스트** — `Layout.test.tsx`: 메뉴 링크 이름(홈, 교실·보관장, 설정, 계정 관리)이 보임; "메뉴 접기"를 누르면 이름 글자는 사라지고 `getByRole('link', {name:'설정'})`는 여전히 찾아짐, 버튼 이름이 "메뉴 펴기"로 바뀜; 다시 누르면 펴짐; 다시 렌더해도 접힘이 유지됨(localStorage); localStorage가 throw해도 렌더됨; "로그아웃" 버튼이 `logout` 호출; 일반 교사에게는 계정 관리 링크 없음.
- [ ] **Step 2: 실패 확인** — Run: `cd web && npx vitest run src/components/Layout.test.tsx` / Expected: FAIL
- [ ] **Step 3: 구현** — `npm install lucide-react`(정확한 버전 고정은 package-lock으로), 토큰을 Global Constraints의 B 값으로, 메뉴 너비 펼침 240px·접힘 72px.
- [ ] **Step 4: 통과 확인** — Run: `cd web && npm test && npx tsc -b` / Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "Redesign B: new colors and an icon sidebar that collapses"`

### Task 9: 교실 카드, 로그인·연결 화면 로고, 스크린샷

**Files:**
- Modify: `web/src/pages/RoomsPage.tsx`, `web/src/pages/RoomsPage.test.tsx`, `web/src/pages/LoginPage.tsx`·`ConnectPage.tsx`·`StatusScreens.tsx`·`ChangePasswordPage.tsx`(로고 타일), `web/src/styles.css`, `web/e2e/m1.spec.ts`(교실 목록 선택자만)

교실 카드(스펙 5.2): `Archive` 아이콘 타일, 교실 이름 링크(카드 제목, 누르면 교실 화면), "과학실" 배지(과학실일 때), "보관장 N개", 마지막 수정자·일시(`LastEdited`). 카드 아래 작은 버튼 줄: 과학실 체크박스(기존 라벨 유지), "이름 바꾸기", "삭제" — 기존 동작·접근 이름 그대로. 카드 목록은 `<ul aria-label="교실 목록">`의 `<li>`들.

- [ ] **Step 1: 실패하는 테스트** — `RoomsPage.test.tsx`: `getByRole('list', {name:'교실 목록'})` 안에 교실 수만큼 `listitem`; 한 카드에 "보관장 3개"와 "과학실" 배지; 기존 이름 바꾸기·삭제·과학실 전환 테스트는 표 대신 카드에서 찾도록 선택자만 바꾼다.
- [ ] **Step 2: 실패 확인** — Run: `cd web && npx vitest run src/pages/RoomsPage.test.tsx` / Expected: FAIL
- [ ] **Step 3: 구현** — 보관장 개수는 `records.list('Cabinets')`를 roomId별로 세어 쓴다(교실 화면이 이미 하는 방식과 같은 호출).
- [ ] **Step 4: 통과 확인** — Run: `cd web && npm test && npx tsc -b && npm run build && npm run e2e` / Expected: 모두 PASS, `docs/screenshots/m1/*.png` 새로 생성
- [ ] **Step 5: Commit** — `git commit -m "Redesign B: room cards, logo on sign-in screens, new screenshots"`
