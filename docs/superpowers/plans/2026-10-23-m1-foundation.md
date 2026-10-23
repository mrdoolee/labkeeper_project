# M1 기본 틀 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 로그인·계정 관리, 학교 설정, 교실·보관장·구역 관리가 되고, 모든 변경이 작성자와 함께 기록되는 LabKeeper의 기본 틀을 만든다.

**Architecture:** `gas/`는 Apps Script 웹앱(스프레드시트에 붙은 스크립트)으로, 로그인·표 읽기/쓰기·변경 이력만 맡는 얇은 서버다. Node에서 가짜 Google 서비스로 같은 코드를 실행해 테스트하고, 같은 방식으로 로컬 개발 서버도 띄운다. `web/`은 Vite + React + TypeScript 화면이고, 판정·계산 같은 순수 로직은 `web/src/domain`에 둔다.

**Tech Stack:** Node 22, TypeScript 5, Vite 8, React 19, react-router-dom 7, Vitest 5, @testing-library/react 16, jsdom, Playwright(설치된 Chromium 사용), Google Apps Script(V8)

**Spec:** `docs/superpowers/specs/2026-10-23-labkeeper-phase1-design.md` (5장 구조·로그인·권한·기록 원칙, 6장 데이터, 7-4장 보관 분류, 8장 M1)

## Global Constraints

- 화면 문구는 한국어. PC 브라우저 기준이며 모바일 전용 작업은 하지 않는다.
- GAS 코드는 `gas/src/*.js`의 전역 함수(모듈·import 없음, V8 문법). 스프레드시트에 붙은 스크립트로 `SpreadsheetApp.getActive()`를 쓴다.
- 요청: `POST`, `Content-Type: text/plain`, 본문 `{"action": string, "token"?: string, "payload"?: object}`.
- 응답: 성공 `{"ok": true, "data": ...}`, 실패 `{"ok": false, "error": {"code": string, "message": string}}`. 오류 코드: `AUTH_REQUIRED`, `FORBIDDEN`, `INVALID`, `NOT_FOUND`, `LOCKED_OUT`, `SETUP_DONE`, `UNKNOWN_ACTION`, `SERVER_ERROR`. `message`는 한국어.
- 모든 표(AuditLog 제외)의 공통 열: `id, createdBy, createdAt, updatedBy, updatedAt, deleted, deletedBy, deletedAt`. 작성자 열에는 사용자 `name`(이름)과 `id`를 함께 남기지 않고 **사용자 id**를 저장하고, 화면은 id→이름으로 바꿔 보여 준다. 일시는 ISO 8601 문자열.
- 삭제는 `deleted=true` 표시(소프트 삭제)이고 복구할 수 있다. 목록 조회는 기본적으로 삭제된 행을 빼고 돌려준다.
- 모든 추가·수정·삭제·복구·설정 변경·로그인 성공은 `AuditLog`에 남긴다: `id, at, userId, userName, table, recordId, action(create|update|delete|restore|login), before(JSON 문자열), after(JSON 문자열)`. `Users`의 `salt`, `hash`는 이력에 넣지 않는다.
- 비밀번호: 사용자별 무작위 salt 16바이트(hex), SHA-256을 1000번 반복한 hex 해시. 평문 저장·로그 금지.
- 세션: 무작위 토큰, `CacheService`에 21600초(6시간) 보관, 요청마다 연장. 같은 loginId로 5회 연속 실패하면 600초 동안 `LOCKED_OUT`.
- 권한: 운영 교사(`admin`)와 일반 교사(`teacher`)는 모든 기능을 같이 쓴다. `users.*`(계정 만들기, 비밀번호 초기화, 역할 변경, 사용 중지)만 `admin` 전용. 작성자 이름 표시는 `directory.list`(모든 사용자)로 한다.
- 쓰기 요청은 `LockService.getScriptLock().waitLock(10000)` 안에서 처리한다.
- 보관 분류 id(7-4장): `inorganic_acid`(무기산), `organic_acid`(유기산), `base`(염기), `reactive_inorganic`(위험이 높은 무기화합물), `metal`(금속·물반응성), `flammable`(인화성·휘발성), `general_inorganic`(일반 무기화합물), `general_organic`(일반 유기화합물·지시약).
- 보관장 종류 id: `sealed`(밀폐형 약품장), `flammable`(가연성 물질 전용 보관장), `general`(일반 약품 보관장), `waste`(폐수·폐시약 보관장), `equipment`(교구장), `fridge`(냉장고).
- 설정 키: `schoolName`, `schoolLevel`(`middle`|`high`), `region`(`chungbuk`|`seoul`|`gyeonggi`, 기본 `chungbuk`), `signerScienceHead`, `signerVicePrincipal`, `signerPrincipal`, `labOver100m2`(boolean), `wasteDisposal`(`office`|`self`).

## Review Focus

1. 시트에 `=`, `+`, `-`, `@`로 시작하는 문자열(예: 이름 "-1번 시약장")을 쓰면 Sheets가 수식으로 해석한다 → 앞에 `'`를 붙여 글자 그대로 저장되고, 읽을 때 원래 문자열이 나와야 한다. (Task 3)
2. 사용자가 시트에서 열 순서를 바꾸거나 열을 추가해도 데이터가 엉키지 않아야 한다 → 열은 1행 머리글 이름으로 찾는다. (Task 3)
3. 마지막 남은 활성 운영 교사를 `teacher`로 바꾸거나 사용 중지하면 아무도 계정을 관리할 수 없다 → `INVALID`로 거절. (Task 5)
4. 사용 중지된 사용자가 이미 받은 토큰으로 요청하면 거절돼야 한다 → `AUTH_REQUIRED`. (Task 4)
5. 보관장의 행·열 수를 줄이면 밖으로 나간 구역이 사라져야 하지만 이력은 남아야 한다 → 소프트 삭제로 처리. (Task 8, Task 12)

---

## File Structure

```
gas/
  package.json            vitest만 (GAS 코드 테스트·개발 서버용)
  src/
    Code.js               doGet, doPost, 액션 라우팅, 응답 생성
    Schema.js             표 이름·열 정의, 쓰기 허용 열, 설정 기본값
    Db.js                 표 읽기/쓰기, 공통 열, 소프트 삭제, 이력 기록, 수식 방지
    Auth.js               해시, 세션, 로그인 잠금, 첫 관리자, 비밀번호 변경
    Users.js              users.* (admin 전용)
    Settings.js           settings.get / settings.update
    Records.js            records.* 공통 CRUD (Rooms, Cabinets, Zones), audit.list
  test/
    fakes.js              가짜 SpreadsheetApp, Utilities, CacheService, LockService, ContentService
    loadGas.js            src/*.js를 node:vm 컨텍스트에 올리고 call(action, payload, token) 도우미 제공
    *.test.js
  dev-server.mjs          가짜 서비스로 GAS 코드를 띄우는 로컬 HTTP 서버 (포트 8787)
web/
  package.json, vite.config.ts, tsconfig*.json, index.html
  src/
    main.tsx, App.tsx     라우팅, 로그인 상태에 따른 화면 분기
    api/client.ts         callApi, 토큰 저장
    auth/AuthContext.tsx  로그인 상태
    domain/storage.ts     보관 분류·보관장 종류 데이터, 기본 허용 분류, 구역 격자 계산
    pages/                SetupPage, LoginPage, ChangePasswordPage, HomePage, UsersPage, SettingsPage, RoomsPage, RoomPage, CabinetPage
    components/           Layout, HistoryDialog
    styles.css
docs/setup-guide.md       GAS 배포·Vercel 연결 안내
```

---

### Task 1: 저장소 뼈대와 테스트 실행 환경

**Files:**
- Create: `web/` (Vite React TS 템플릿), `web/vite.config.ts`, `web/src/setupTests.ts`, `web/src/smoke.test.ts`
- Create: `gas/package.json`, `gas/test/smoke.test.js`
- Modify: `.gitignore` (node_modules, dist, .env*)

**Interfaces:**
- Produces: `cd web && npm test`, `cd web && npm run build`, `cd gas && npm test` 명령

- [ ] **Step 1:** `npm create vite@latest web -- --template react-ts`로 만든 뒤 예제 화면·로고를 지운다. 의존성: `react-router-dom@7`, 개발용 `vitest@5`, `@testing-library/react@16`, `@testing-library/jest-dom`, `jsdom`, `typescript@5`. `vite.config.ts`에 `test: { environment: 'jsdom', setupFiles: './src/setupTests.ts' }`. `package.json` 스크립트 `"test": "vitest run"`.
- [ ] **Step 2:** `gas/package.json`(`"type": "commonjs"`, 개발용 `vitest@5`, 스크립트 `"test": "vitest run"`, `"dev": "node dev-server.mjs"`).
- [ ] **Step 3:** 두 곳에 `expect(1 + 1).toBe(2)` 스모크 테스트를 두고 실행. Expected: 둘 다 PASS, `web`의 `npm run build` 성공.
- [ ] **Step 4:** 커밋 `chore: scaffold web and gas packages`

### Task 2: GAS 테스트 장치와 요청 라우터

**Files:**
- Create: `gas/test/fakes.js`, `gas/test/loadGas.js`, `gas/src/Code.js`
- Test: `gas/test/router.test.js`

**Interfaces:**
- Produces (test): `loadGas(): { ctx, call(action: string, payload?: object, token?: string): Promise<object>|object, sheet(name): string[][] }` — `call`은 `ctx.doPost({ postData: { contents: JSON.stringify({action, token, payload}) } })`의 응답 문자열을 JSON으로 풀어 돌려준다. `sheet(name)`은 가짜 시트의 2차원 값.
- Produces (fakes): `SpreadsheetApp.getActive()` → `getSheetByName(name)`, `insertSheet(name)`; 시트는 `getDataRange().getValues()`, `getLastRow()`, `getLastColumn()`, `getRange(row, col, numRows?, numCols?).getValues()/setValues()/setValue()`, `appendRow(values)`. 값은 메모리 2차원 배열. `Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, string|bytes, Utilities.Charset.UTF_8)` → 부호 있는 바이트 배열(node `crypto`), `Utilities.getUuid()`, `CacheService.getScriptCache().get/put(key, value, seconds)/remove` (만료 시간은 테스트에서 `fakes.advanceTime(seconds)`로 진행), `LockService.getScriptLock().waitLock(ms)/releaseLock()` (호출 횟수 기록), `ContentService.createTextOutput(s).setMimeType(m)` → `getContent()`, `ContentService.MimeType.JSON`.
- Produces (gas): `doPost(e)`, `doGet(e)`, `ACTIONS` 객체(액션 이름 → `{ handler(payload, user), auth: 'none'|'user'|'admin', write: boolean }`), `ok(data)`, `fail(code, message)` (`ApiError` 던지기용 `throw apiError(code, message)`).

- [ ] **Step 1: 실패하는 테스트** — `router.test.js`
  - `call('nope')` → `{ ok: false, error: { code: 'UNKNOWN_ACTION' } }`
  - 본문이 JSON이 아니면 → `error.code === 'INVALID'`
  - `ACTIONS`에 테스트용 `ping`(auth `none`)을 넣으면 `call('ping')` → `{ ok: true, data: 'pong' }`
  - 핸들러가 예상하지 못한 예외를 던지면 → `error.code === 'SERVER_ERROR'`, 응답에 스택이 없음
  - `doGet()`은 `{ ok: true, data: { name: 'LabKeeper' } }`
- [ ] **Step 2:** `cd gas && npm test` → FAIL
- [ ] **Step 3:** `fakes.js`, `loadGas.js`(`gas/src/*.js`를 이름순으로 읽어 하나의 `vm.createContext`에 실행), `Code.js` 구현. `doPost`는 액션의 `auth`에 따라 Task 4의 `requireUser(token)` / `requireAdmin(token)`을 부르고(이 Task에서는 `auth: 'none'`만 사용), `write: true`면 락을 잡는다.
- [ ] **Step 4:** `npm test` → PASS
- [ ] **Step 5:** 커밋 `feat(gas): request router and test harness`

### Task 3: 표 저장 계층 (공통 열, 소프트 삭제, 변경 이력)

**Files:**
- Create: `gas/src/Schema.js`, `gas/src/Db.js`
- Test: `gas/test/db.test.js`

**Interfaces:**
- Produces: `TABLES` — `{ Users: [...], Settings: [...], Rooms: [...], Cabinets: [...], Zones: [...], AuditLog: [...] }` 열 이름 배열(공통 열 포함, AuditLog 제외).
  - Users: `loginId, name, role, salt, hash, mustChangePassword, active`
  - Settings: `key, value`
  - Rooms: `name, isLab, note` (`isLab`: 과학실이면 true → 월간 점검표 대상)
  - Cabinets: `roomId, name, type, locked, rows, cols, note`
  - Zones: `cabinetId, row, col, name, allowedClasses` (`allowedClasses`는 쉼표로 이은 분류 id, `row` 1이 맨 위)
- Produces: `dbList(table, { includeDeleted?: boolean, where?: object }): object[]`, `dbGet(table, id): object|null`, `dbCreate(table, values, user): object`, `dbUpdate(table, id, changes, user): object`, `dbSoftDelete(table, id, user): object`, `dbRestore(table, id, user): object`, `dbAudit(user, table, recordId, action, before, after): void`. `user`는 `{ id, name }`. 반환 객체의 boolean·숫자 열은 JS 타입으로 돌려준다(`deleted`, `locked`, `active`, `mustChangePassword`, `labOver100m2`, `isLab` → boolean, `rows`, `cols`, `row`, `col` → number).

- [ ] **Step 1: 실패하는 테스트** — `db.test.js`
  - `dbCreate('Rooms', { name: '제1과학실', isLab: true }, u)` → `id` 생성, `createdBy === u.id`, `createdAt`이 ISO 문자열, `deleted === false`; 시트가 없으면 머리글 행과 함께 만들어진다.
  - `dbUpdate`가 `updatedBy/updatedAt`을 바꾸고, `AuditLog`에 `action: 'update'`와 `before.name`/`after.name`이 남는다.
  - `dbSoftDelete` 후 `dbList('Rooms')`에 없고 `dbList('Rooms', { includeDeleted: true })`에는 `deleted: true, deletedBy: u.id`로 있음. `dbRestore` 후 다시 보임. 둘 다 이력에 남음.
  - (Review Focus 1) `dbCreate('Rooms', { name: '=SUM(A1)' }, u)` → 가짜 시트 셀 값이 `"'=SUM(A1)"`, `dbGet`은 `'=SUM(A1)'`을 돌려준다. `-1번`, `+`, `@` 시작도 같은 방식.
  - (Review Focus 2) 가짜 시트의 열 순서를 바꾸고(머리글과 값을 함께 섞음) 머리글에 없는 `메모` 열을 끼워 넣어도 `dbList`가 같은 객체를 돌려주고, `dbCreate`가 머리글 위치에 맞게 쓴다.
  - `dbUpdate`에 표에 없는 열을 넣으면 `INVALID`.
- [ ] **Step 2:** `npm test` → FAIL
- [ ] **Step 3:** 구현. 열 위치는 매번 1행 머리글로 찾는다. 머리글에 빠진 열이 있으면 맨 끝에 머리글을 추가한다. id는 `Utilities.getUuid()`. `Users`의 `salt`, `hash`는 `dbAudit`의 before/after에서 뺀다.
- [ ] **Step 4:** `npm test` → PASS
- [ ] **Step 5:** 커밋 `feat(gas): table storage with audit trail and soft delete`

### Task 4: 로그인, 세션, 첫 운영 교사

**Files:**
- Create: `gas/src/Auth.js`
- Modify: `gas/src/Code.js` (액션 등록)
- Test: `gas/test/auth.test.js`

**Interfaces:**
- Consumes: `dbList`, `dbCreate`, `dbUpdate`, `dbAudit` (Task 3)
- Produces: `hashPassword(password: string, saltHex: string): string`, `newSalt(): string`, `requireUser(token): { id, name, role, loginId, mustChangePassword }`, `requireAdmin(token)`, `publicUser(row)`(salt·hash 뺀 사용자).
- Produces (액션):
  - `setup.status` (auth none) → `{ needsSetup: boolean }` (활성 사용자가 0명이면 true)
  - `setup.createAdmin` (none, write) `{ loginId, name, password }` → `{ token, user }`; 사용자가 이미 있으면 `SETUP_DONE`
  - `auth.login` (none, write) `{ loginId, password }` → `{ token, user }`; 틀리면 `INVALID` "아이디 또는 비밀번호가 맞지 않습니다", 5회 연속 실패 시 그 뒤 600초 동안 `LOCKED_OUT`; 성공하면 실패 횟수 초기화, `AuditLog`에 `login`
  - `auth.me` (user) → `user`
  - `auth.logout` (user) → `true`
  - `auth.changePassword` (user, write) `{ currentPassword, newPassword }` → `true`; `mustChangePassword`를 false로; 새 비밀번호 8자 미만이면 `INVALID`

- [ ] **Step 1: 실패하는 테스트** — `auth.test.js`
  - `hashPassword('pw', 'aa')`가 같은 입력에 같은 값, salt가 다르면 다른 값, 길이 64의 hex
  - 처음에 `setup.status` → `needsSetup: true`; `setup.createAdmin` 후 `false`, 두 번째 `createAdmin` → `SETUP_DONE`; Users 시트에 비밀번호 평문이 어디에도 없음
  - `auth.login` 성공 → 토큰으로 `auth.me`가 `role: 'admin'`; 응답 어디에도 `salt`, `hash` 없음
  - 4회 실패 후 맞는 비밀번호 → 성공; 5회 실패 후 맞는 비밀번호 → `LOCKED_OUT`; `advanceTime(600)` 후 성공
  - 토큰 없이 `auth.me` → `AUTH_REQUIRED`; `advanceTime(21601)` 뒤 → `AUTH_REQUIRED`; 중간 요청이 있으면 만료가 연장됨
  - (Review Focus 4) 로그인한 사용자를 시트에서 `active=false`로 바꾸면 그 토큰의 다음 요청 → `AUTH_REQUIRED`
  - `auth.changePassword`: 현재 비밀번호가 틀리면 `INVALID`, 성공 후 새 비밀번호로만 로그인됨
- [ ] **Step 2:** FAIL 확인
- [ ] **Step 3:** 구현. 세션 값은 `{ userId }`만 저장하고 `requireUser`는 매번 Users에서 다시 읽어 `active`를 확인한다. 실패 횟수는 `CacheService` 키 `fail:<loginId>`.
- [ ] **Step 4:** PASS 확인
- [ ] **Step 5:** 커밋 `feat(gas): login, sessions and first admin setup`

### Task 5: 계정 관리와 설정

**Files:**
- Create: `gas/src/Users.js`, `gas/src/Settings.js`
- Modify: `gas/src/Code.js`
- Test: `gas/test/users.test.js`, `gas/test/settings.test.js`

**Interfaces:**
- Consumes: Task 3, Task 4
- Produces (액션, `users.*`는 admin, 나머지는 user):
  - `directory.list` (user) → `{ id, name }[]` (삭제·사용 중지된 사람 포함. 작성자 id를 이름으로 바꾸는 용도라 일반 교사도 부른다)
  - `users.list` → 사용자 목록(`publicUser`)
  - `users.create` (write) `{ loginId, name, role }` → `{ user, tempPassword }`; `mustChangePassword: true`; loginId 중복이면 `INVALID`
  - `users.resetPassword` (write) `{ id }` → `{ tempPassword }`; `mustChangePassword: true`
  - `users.update` (write) `{ id, name?, role?, active? }` → `user`
  - `settings.get` → `{ schoolName, schoolLevel, region, signerScienceHead, signerVicePrincipal, signerPrincipal, labOver100m2, wasteDisposal }` (값이 없으면 기본값: `region: 'chungbuk'`, `schoolLevel: 'middle'`, `labOver100m2: false`, `wasteDisposal: 'office'`, 나머지 빈 문자열)
  - `settings.update` (write) 위 키 일부 → 전체 설정; 키별로 바뀐 것만 `AuditLog`(`table: 'Settings'`, `recordId`: 키)
- 임시 비밀번호: 영문 소문자+숫자 10자.

- [ ] **Step 1: 실패하는 테스트**
  - teacher 토큰으로 `users.list` → `FORBIDDEN`; admin은 성공; teacher도 `directory.list`는 성공하고 결과에 `salt`, `hash`, `loginId`가 없음
  - `users.create` → 받은 임시 비밀번호로 로그인되고 `user.mustChangePassword === true`
  - `users.resetPassword` 후 옛 비밀번호 실패, 임시 비밀번호 성공
  - (Review Focus 3) 활성 admin이 1명일 때 그 사람을 `role: 'teacher'` 또는 `active: false`로 바꾸면 `INVALID` "운영 교사가 최소 1명 있어야 합니다"; admin이 2명이면 허용
  - teacher도 `settings.update` 가능; `region: 'busan'` → `INVALID`; `settings.get`이 기본값을 돌려줌; 변경 이력에 바꾼 사람 id
- [ ] **Step 2:** FAIL 확인
- [ ] **Step 3:** 구현
- [ ] **Step 4:** PASS 확인
- [ ] **Step 5:** 커밋 `feat(gas): user management and settings`

### Task 6: 공통 기록 액션 (교실·보관장·구역)과 변경 이력 조회

**Files:**
- Create: `gas/src/Records.js`
- Modify: `gas/src/Schema.js` (쓰기 허용 표·열), `gas/src/Code.js`
- Test: `gas/test/records.test.js`

**Interfaces:**
- Consumes: Task 3
- Produces: `RECORD_TABLES` — 쓰기 허용 표와 열: `Rooms: ['name','isLab','note']`, `Cabinets: ['roomId','name','type','locked','rows','cols','note']`, `Zones: ['cabinetId','row','col','name','allowedClasses']`. 이후 단계(M2~)는 여기에 표를 추가한다.
- Produces (액션, 모두 user):
  - `records.list` `{ table, where?, includeDeleted? }` → 행 배열
  - `records.create` (write) `{ table, values }` → 행
  - `records.createMany` (write) `{ table, rows: object[] }` → 행 배열 (한 번의 락 안에서)
  - `records.update` (write) `{ table, id, changes }` → 행
  - `records.delete` (write) `{ table, id }` → 행
  - `records.restore` (write) `{ table, id }` → 행
  - `audit.list` `{ table?, recordId?, limit? }` → 최근 순 이력(기본 100개)
- 검사: `RECORD_TABLES`에 없는 표(`Users`, `AuditLog`, `Settings` 포함) → `FORBIDDEN`; 허용되지 않은 열 → `INVALID`; `Cabinets.type`은 보관장 종류 id 중 하나, `rows`·`cols`는 1~20 정수; `Zones.allowedClasses`의 각 값은 보관 분류 id 중 하나; `Cabinets.roomId`, `Zones.cabinetId`는 존재하는 행이어야 함(`NOT_FOUND`); `records.list`의 `where`는 같은 값 비교로 걸러서 보낸다(예: `{ cabinetId }`로 한 보관장의 구역만). 교실·보관장이 많아도 화면이 필요한 것만 받도록 한다.

- [ ] **Step 1: 실패하는 테스트** — 위 검사 각각, 보관장 30개·구역 600개가 있을 때 `records.list({ table: 'Zones', where: { cabinetId } })`가 그 보관장의 구역만 돌려줌, teacher가 `records.delete` 가능, `records.createMany`가 락을 한 번만 잡음(fakes의 락 호출 횟수), `audit.list({ table: 'Rooms', recordId })`가 create→update→delete 순서의 반대로 나옴
- [ ] **Step 2:** FAIL 확인
- [ ] **Step 3:** 구현
- [ ] **Step 4:** PASS 확인
- [ ] **Step 5:** 커밋 `feat(gas): generic record actions and audit log query`

### Task 7: 로컬 개발 서버

**Files:**
- Create: `gas/dev-server.mjs`
- Test: `gas/test/dev-server.test.js`

**Interfaces:**
- Consumes: `gas/test/loadGas.js`
- Produces: `node gas/dev-server.mjs` → `http://localhost:8787`에서 `POST /` 본문을 그대로 `doPost`에 넘겨 응답, `GET /`은 `doGet`. 응답 헤더 `Access-Control-Allow-Origin: *`. 데이터는 메모리(재시작하면 초기화). `startDevServer(port): Promise<{ close() }>`를 내보낸다.

- [ ] **Step 1: 실패하는 테스트** — 임의 포트로 띄워 `fetch`로 `setup.status` POST(`Content-Type: text/plain`) → `{ ok: true, data: { needsSetup: true } }`
- [ ] **Step 2:** FAIL 확인
- [ ] **Step 3:** `node:http`로 구현
- [ ] **Step 4:** PASS 확인
- [ ] **Step 5:** 커밋 `feat(gas): local dev server`

### Task 8: 보관 분류·보관장 데이터와 구역 격자 계산

**Files:**
- Create: `web/src/domain/storage.ts`
- Test: `web/src/domain/storage.test.ts`

**Interfaces:**
- Produces:
  - `type StorageClassId = 'inorganic_acid'|'organic_acid'|'base'|'reactive_inorganic'|'metal'|'flammable'|'general_inorganic'|'general_organic'`
  - `STORAGE_CLASSES: { id: StorageClassId; label: string; examples: string }[]` (label·examples는 설계 7-4장 표 그대로)
  - `type CabinetType = 'sealed'|'flammable'|'general'|'waste'|'equipment'|'fridge'`
  - `CABINET_TYPES: { id: CabinetType; label: string; defaultClasses: StorageClassId[] }[]` — `sealed`: 무기산·유기산·염기·위험 무기·금속, `flammable`: 인화성, `general`: 일반 무기·일반 유기, 나머지: 빈 배열
  - `interface ZoneRow { id?: string; cabinetId: string; row: number; col: number; name: string; allowedClasses: string }`
  - `planZones(cabinet: { id: string; type: CabinetType; rows: number; cols: number }, existing: ZoneRow[]): { create: ZoneRow[]; remove: string[] }` — 격자 안에 없는 칸은 새로 만들고(이름 `"{row}단 {col}칸"`, 허용 분류는 보관장 종류 기본값), 격자 밖으로 나간 기존 구역 id는 `remove`에 넣는다. 이미 있는 칸은 건드리지 않는다.
  - `copyZones(source: ZoneRow[], newCabinetId: string): ZoneRow[]` — 보관장 복제용. id를 빼고 `cabinetId`만 바꿔 이름·허용 분류·위치를 그대로 복사한다. 삭제된 구역은 복사하지 않는다.

- [ ] **Step 1: 실패하는 테스트**
  - 3×2 밀폐형, 기존 없음 → `create` 6개, 첫 칸 이름 `"1단 1칸"`, `allowedClasses === 'inorganic_acid,organic_acid,base,reactive_inorganic,metal'`, `remove` 빈 배열
  - (Review Focus 5) 3×2 → 2×2로 줄이면 3단의 두 구역 id가 `remove`, `create` 빈 배열
  - 2×2 → 2×3으로 늘리면 `create` 2개만, 기존 이름을 바꾼 구역은 그대로 유지
  - `STORAGE_CLASSES`가 8개이고 id가 위 타입과 같음
  - `copyZones`: 이름을 바꾼 구역 2개를 복사하면 새 cabinetId, 같은 이름·허용 분류, id 없음
- [ ] **Step 2:** `cd web && npm test` → FAIL
- [ ] **Step 3:** 구현
- [ ] **Step 4:** PASS 확인
- [ ] **Step 5:** 커밋 `feat(web): storage classes and zone grid planning`

### Task 9: API 클라이언트와 로그인 상태

**Files:**
- Create: `web/src/api/client.ts`, `web/src/auth/AuthContext.tsx`, `web/.env.example`
- Test: `web/src/api/client.test.ts`

**Interfaces:**
- Produces:
  - `class ApiError extends Error { code: string }`
  - `callApi<T>(action: string, payload?: object): Promise<T>` — `import.meta.env.VITE_GAS_URL`로 `POST`(`Content-Type: text/plain;charset=utf-8`), 저장된 토큰을 함께 보냄. `ok:false`면 `ApiError`를 던지고, 코드가 `AUTH_REQUIRED`면 토큰을 지우고 `onAuthRequired` 콜백을 부른다. 네트워크 실패 → `ApiError('NETWORK', '서버에 연결할 수 없습니다')`.
  - `getToken()`, `setToken(token: string|null)` (localStorage 키 `labkeeper.token`, 접근 실패 시 메모리 사용)
  - `setOnAuthRequired(fn: () => void)`
  - `AuthProvider`, `useAuth(): { user: User|null; loading: boolean; needsSetup: boolean; login(loginId, password); setupAdmin(loginId, name, password); logout(); refresh() }`
  - `interface User { id: string; loginId: string; name: string; role: 'admin'|'teacher'; mustChangePassword: boolean; active: boolean }`
- `.env.example`: `VITE_GAS_URL=http://localhost:8787`

- [ ] **Step 1: 실패하는 테스트** (`fetch` 가짜): 요청 본문에 action·token·payload, 헤더 `text/plain`; `ok:true`면 data 반환; `AUTH_REQUIRED`면 토큰 삭제와 콜백 호출; fetch reject면 `code === 'NETWORK'`
- [ ] **Step 2:** FAIL 확인
- [ ] **Step 3:** 구현
- [ ] **Step 4:** PASS 확인
- [ ] **Step 5:** 커밋 `feat(web): api client and auth state`

### Task 10: 첫 설정·로그인·비밀번호 변경 화면과 기본 화면 틀

**Files:**
- Create: `web/src/App.tsx`, `web/src/components/Layout.tsx`, `web/src/pages/SetupPage.tsx`, `LoginPage.tsx`, `ChangePasswordPage.tsx`, `HomePage.tsx`, `web/src/styles.css`
- Test: `web/src/App.test.tsx`

**Interfaces:**
- Consumes: Task 9
- Produces: 라우트 `/`(홈), `/settings`, `/rooms`, `/rooms/:roomId`, `/cabinets/:cabinetId`, `/users`(admin만 메뉴 표시). 분기 순서: `needsSetup` → SetupPage, 로그인 안 됨 → LoginPage, `mustChangePassword` → ChangePasswordPage, 그 외 Layout(왼쪽 메뉴: 홈, 교실·보관장, 설정, 계정 관리(admin)) 안의 화면. 상단에 로그인한 사람 이름과 로그아웃.
- 화면 디자인 방향은 `ui-ux-pro-max` 스킬로 정한다(관리 도구, 밀도 높은 표, 차분한 색). 색·글꼴은 `styles.css`의 CSS 변수 하나에 모은다.

- [ ] **Step 1: 실패하는 테스트** (`callApi` 가짜): `needsSetup: true`면 "운영 교사 계정 만들기" 화면; 로그인 안 됐으면 아이디·비밀번호 입력란; 로그인 실패 시 서버 메시지 표시; `mustChangePassword`면 비밀번호 변경 화면; teacher에게 "계정 관리" 메뉴가 없음
- [ ] **Step 2:** FAIL 확인
- [ ] **Step 3:** 구현 (비밀번호 입력은 8자 이상, 확인란 일치 검사)
- [ ] **Step 4:** PASS 확인
- [ ] **Step 5:** 커밋 `feat(web): setup, login and app shell`

### Task 11: 계정 관리·설정 화면과 변경 이력 보기

**Files:**
- Create: `web/src/pages/UsersPage.tsx`, `web/src/pages/SettingsPage.tsx`, `web/src/components/HistoryDialog.tsx`
- Test: `web/src/pages/UsersPage.test.tsx`, `web/src/pages/SettingsPage.test.tsx`

**Interfaces:**
- Consumes: Task 5 액션, Task 6 `audit.list`
- Produces: `<HistoryDialog table={string} recordId={string} />` — `audit.list`로 이력을 받아 "일시 · 사람 · 동작 · 바뀐 항목(전 → 후)"을 표로 보여 준다. 사람 이름은 이력에 함께 저장된 `userName`으로 표시한다.
- UsersPage: 목록(아이디, 이름, 역할, 사용 여부), 계정 만들기 → 임시 비밀번호를 한 번만 크게 보여 주고 "복사" 버튼, 비밀번호 초기화, 역할 변경, 사용 중지/다시 사용.
- SettingsPage: 학교명, 학교급(중학교/고등학교), 양식 지역(충북/서울/경기), 서명자 이름 3개, 실험실 100㎡ 이상 여부, 폐수 처리 방식(교육청 위탁/학교 자체 처리), 저장 버튼, "변경 이력" 버튼.

- [ ] **Step 1: 실패하는 테스트**: 계정 만들기 후 임시 비밀번호 표시; 설정 저장 시 `settings.update`에 바뀐 값만 전달; HistoryDialog가 이력 행을 "전 → 후"로 표시
- [ ] **Step 2:** FAIL 확인
- [ ] **Step 3:** 구현
- [ ] **Step 4:** PASS 확인
- [ ] **Step 5:** 커밋 `feat(web): user management, settings and history dialog`

### Task 12: 교실·보관장·구역 화면 (교실과 보관장이 많은 학교 기준)

**Files:**
- Create: `web/src/pages/RoomsPage.tsx`, `web/src/pages/RoomPage.tsx`, `web/src/pages/CabinetPage.tsx`, `web/src/components/CabinetSearch.tsx`
- Test: `web/src/pages/RoomsPage.test.tsx`, `web/src/pages/CabinetPage.test.tsx`

**Interfaces:**
- Consumes: Task 6 `records.*`, Task 8 `planZones`, `copyZones`, `CABINET_TYPES`, `STORAGE_CLASSES`, Task 11 `HistoryDialog`, Task 5 `directory.list`(작성자 id → 이름)
- RoomsPage(`/rooms`): 교실 표(이름, 과학실 여부, 보관장 수, 마지막 수정자·일시), 이름 검색, "과학실만 보기", 교실 추가·이름 변경·삭제(확인 창). 보관장 수는 `records.list('Cabinets')` 한 번으로 세어 교실별로 묶는다.
- RoomPage(`/rooms/:roomId`): 그 교실의 보관장 표(이름, 종류, 잠금, 단×칸, 마지막 수정자·일시), 이름 검색, 보관장 추가(이름, 종류, 잠금 여부, 단 수, 칸 수), **복제**(새 이름을 받아 같은 종류·크기로 만들고 `copyZones` 결과를 `records.createMany('Zones')`), 삭제. 새 보관장 저장 후 `planZones` 결과로 구역을 만든다.
- CabinetSearch: 상단 바에 두는 보관장 이름 검색. 입력하면 "교실 › 보관장" 목록을 보여 주고 고르면 `/cabinets/:id`로 이동. 목록은 `records.list('Cabinets')`와 `records.list('Rooms')`를 한 번 받아 브라우저에서 거른다.
- CabinetPage(`/cabinets/:cabinetId`): 위치 경로("교실 › 보관장"), 보관장을 단(위→아래) × 칸 격자로 그림. 구역은 `records.list('Zones', { where: { cabinetId } })`로 그 보관장 것만 받는다. 칸을 누르면 오른쪽에 구역 이름과 허용 보관 분류(체크박스 8개) 편집, "변경 이력" 버튼. 단·칸 수를 바꾸면 줄어드는 구역 목록을 보여 주고 확인을 받은 뒤 반영(Review Focus 5).
- 각 행 옆에 마지막 수정자 이름(`directory.list`로 id → 이름)과 일시를 작게 표시.

- [ ] **Step 1: 실패하는 테스트**: 교실 3개·보관장 7개일 때 RoomsPage에 교실별 보관장 수가 맞게 나옴; "과학실만 보기"가 걸러짐; 3×2 보관장 저장 시 `records.createMany`에 6개 구역; 보관장 복제 시 새 보관장 생성 후 같은 이름의 구역이 `records.createMany`로 전달; CabinetSearch에 이름 일부를 치면 "교실 › 보관장"이 나오고 고르면 이동; 격자에 "1단 1칸"이 맨 위 왼쪽; 단 수를 줄이면 확인 창에 사라질 구역 이름이 나오고 확인 후 `records.delete` 호출
- [ ] **Step 2:** FAIL 확인
- [ ] **Step 3:** 구현
- [ ] **Step 4:** PASS 확인
- [ ] **Step 5:** 커밋 `feat(web): rooms, cabinets and zone grid screens`

### Task 13: 배포 안내서와 통합 확인

**Files:**
- Create: `docs/setup-guide.md`, `web/e2e/m1.spec.ts` (Playwright), `web/playwright.config.ts`
- Modify: `README.md` (진행 상황, 개발 방법), `CLAUDE.md` (개발 명령)

**Interfaces:**
- Consumes: Task 7 개발 서버, 화면 전체
- `docs/setup-guide.md` (한국어, 화면별 단계): ① 구글 스프레드시트 새로 만들기(이름 "LabKeeper DB") ② 확장 프로그램 → Apps Script ③ `gas/src`의 파일을 같은 이름으로 만들어 붙여 넣기 ④ 배포 → 새 배포 → 웹 앱, "다음 사용자 인증 정보로 실행: 나", "액세스 권한: 모든 사용자" ⑤ 권한 승인 ⑥ 웹 앱 URL 복사 ⑦ 코드를 고친 뒤에는 "배포 관리 → 수정 → 새 버전"으로 같은 URL 유지 ⑧ Vercel: 저장소 연결, Root Directory `web`, 환경 변수 `VITE_GAS_URL` ⑨ 첫 접속 시 운영 교사 계정 만들기.
- Playwright는 설치된 Chromium(`executablePath`는 `/opt/pw-browsers/chromium-*/chrome-linux/chrome`)을 쓰고 브라우저를 내려받지 않는다.

- [ ] **Step 1: 통합 시나리오 작성**: 개발 서버 + `vite` 실행 → 운영 교사 만들기 → 일반 교사 계정 만들기(임시 비밀번호 받기) → 로그아웃 → 일반 교사로 로그인, 비밀번호 변경 → 교실 2개 추가(과학실 1, 준비실 1) → 밀폐형 보관장 3×2 추가 → 구역 이름 바꾸기 → 보관장 복제 → 상단 검색으로 복제한 보관장 찾아 들어가기 → 변경 이력에 일반 교사 이름이 보임
- [ ] **Step 2:** 실행해 PASS 확인, 주요 화면 스크린샷을 `docs/screenshots/m1/`에 저장
- [ ] **Step 3:** 안내서·README·CLAUDE.md 작성
- [ ] **Step 4:** `cd gas && npm test && cd ../web && npm test && npm run build` 모두 PASS
- [ ] **Step 5:** 커밋 `docs: setup guide and M1 end-to-end check`

---

## 사용자 확인 (M1 끝)

- 선생님이 `docs/setup-guide.md`대로 GAS를 배포하고 URL을 알려 준다.
- Vercel 연결 후(또는 로컬 미리보기로) 운영 교사 계정을 만들고, 교실·보관장을 실제 학교 기준으로 입력해 본다.
- 실제 GAS에서만 확인할 수 있는 것: 해시 1000회 반복의 속도(로그인 1~2초 이내인지), 첫 실행 권한 승인 흐름.
