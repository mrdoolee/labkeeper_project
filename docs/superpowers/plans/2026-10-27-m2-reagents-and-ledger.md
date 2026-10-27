# M2 시약과 대장 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teachers register reagents (one by one or from an app-made Excel file), record every use right after an experiment, and print the chemical ledger in the Chungbuk, Seoul or Gyeonggi format by school year. They can also find where each reagent is stored.

**Architecture:** The sheet stores only reagent info, a server-maintained `stock`, and in/out records (`ReagentTx`). GAS validates, keeps every running balance ≥ 0 under the existing script lock, and recomputes `stock`. The web app computes ledger lines (carry-over, before/after amounts) with pure functions in `web/src/domain`. Hazard judgment uses the Gyeonggi appendix 9 table in the browser.

**Tech Stack:** GAS (global functions, V8), Vite + React 19 + TypeScript, Vitest, Playwright, ExcelJS 4.4.0 (loaded only on the import page).

**Spec:** `docs/superpowers/specs/2026-10-27-m2-reagents-and-ledger-design.md`. Read it; section numbers below refer to it.

## Global Constraints

- Record rules: every row has who/when columns, deletes are soft, every change goes to history (`시약 이력` tab). User-facing text is Korean.
- Dates are `YYYY-MM-DD` strings. "Today" means the KST date (GAS `kstParts(new Date()).date`). No future dates. No date before the reagent's 기초 재고 date.
- Amounts are > 0 (0 only for a 기초 재고 of 0), rounded to 3 decimals. Every sum is rounded with `Math.round(x * 1000) / 1000`.
- School year N = `N-03-01` … last day of February in N+1.
- Raise `API_VERSION` (gas/src/System.js) and `REQUIRED_API_VERSION` (web/src/api/system.ts) from 3 to 4 together.
- After any gas/src change: `cd gas && npm run bundle`. The bundle test fails otherwise.
- New GAS files are global functions only. Register actions in `Code.js` `registerActions()`.
- CSS: extend `web/src/styles.css` tokens. Icons come from lucide-react. No Tailwind.
- Each task ends green: `cd gas && npm test`, `cd web && npm test && npx tsc -b && npm run lint` (no new lint errors).

## Review Focus

1. Excel date cells arrive as JS `Date` objects (UTC midnight from ExcelJS), as serial numbers, or as text. All three must become the same KST `YYYY-MM-DD` with no off-by-one day. Test: Task 9.
2. Decimal amounts (`0.1 + 0.2`, `2.5 g`) must show as `0.3` and `2.5` in the ledger and in stock, never `0.30000000000000004`. Tests: Task 2 and Task 4.
3. A school year ending in a leap year (`2027-03-01 … 2028-02-29`). A record on 2028-02-29 belongs to school year 2027. Test: Task 2.
4. Duplicate names that differ only in spaces or case (`"염산 "` vs `"염산"`, `"Ethanol"` vs `"ethanol"`) with the same concentration count as duplicates. A blank concentration is its own value, so blank ≠ 100. Test: Task 3.
5. A usage dialog opened with stale stock (another teacher used some meanwhile). The server rejects the record and the dialog shows the server's message instead of closing. Test: Task 6.

---

### Task 1: Hazard table, CAS check and judgment (web domain)

**Files:**
- Create: `web/src/data/hazardThresholds.ts`, `web/src/domain/hazard.ts`
- Test: `web/src/domain/hazard.test.ts`

**Interfaces:**
- Produces:
  - `export type HazardStatus = '해당' | '해당 없음' | '판정 불가'`
  - `export interface HazardRow { no: number; name: string; formula: string; cas: string; toxic: number | null; accident: number | null }`, where `null` means 해당없음
  - `export const HAZARD_THRESHOLDS: HazardRow[]` (46 rows)
  - `export function isValidCas(cas: string): boolean`
  - `export function judgeHazard(casNo: string, concentration: number | null): { toxic: HazardStatus; accidentPrep: HazardStatus }`
  - `export function isHazardous(r: { toxic: string; accidentPrep: string }): boolean` (true when either is `해당`)
  - `export function needsCheck(r: { toxic: string; accidentPrep: string }): boolean` (true when either is `판정 불가`)

- [ ] **Step 1: Write failing tests** in `hazard.test.ts`
  - `HAZARD_THRESHOLDS` has 46 rows, `no` runs 1..46, and every `cas` passes `isValidCas`.
  - Row 14 (시안화 칼륨) has `cas === '151-50-8'`. Row 18 (에탄올) has `formula === 'C2H5OH'`.
  - `isValidCas('7647-01-0')` is true. `isValidCas('7647-01-1')`, `'97-1-90'` and `'abc'` are false.
  - HCl `7647-01-0` (toxic 10, accident 10):
    - concentration 9.9 → both `해당 없음`
    - concentration 10 → both `해당`
    - concentration `null` → both `해당`
  - KMnO4 `7722-64-7` at 50 → toxic `해당`, accident `해당 없음` (needs 98).
  - Ethanol `64-17-5` at 95 → both `해당 없음`.
  - `'50-00-0'` (valid CAS, not in the table) → both `판정 불가`. An empty CAS → both `판정 불가`.
  - `isHazardous`/`needsCheck` truth tables.
- [ ] **Step 2: Run** `cd web && npx vitest run src/domain/hazard.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement.**
  - Copy the 46 rows from the spec source (경기 부록9). The rendered page image is the source of truth, not the text layer, whose columns are shifted.
  - Add a header comment citing the source and the two corrections (spec §6).
  - CAS check digit: digits without the last one, read right to left, each multiplied by 1, 2, 3, …; the sum mod 10 equals the last digit. Format `^\d{2,7}-\d{2}-\d$`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): hazard thresholds from Gyeonggi appendix 9 and judgment`

### Task 2: Ledger domain: school year, running balance, ledger lines

**Files:**
- Create: `web/src/domain/ledger.ts`
- Test: `web/src/domain/ledger.test.ts`

**Interfaces:**
- Produces:
  - `export type TxKind = 'initial' | 'in' | 'out'`
  - `export interface TxRow { id: string; reagentId: string; date: string; kind: TxKind; amount: number; purpose: string; price: number | null; note: string; createdAt: string; deleted: boolean }`
  - `export function round3(x: number): number`
  - `export function schoolYearOf(date: string): number`
  - `export function schoolYearRange(year: number): { start: string; end: string }`
  - `export function sortTx(txs: TxRow[]): TxRow[]`: live rows only. Sort by `date`, then `initial` first, then `Date.parse(createdAt)`, then `id`.
  - `export function runningBalances(txs: TxRow[]): { tx: TxRow; before: number; after: number }[]`
  - `export function firstNegative(txs: TxRow[]): { tx: TxRow; after: number } | null`
  - `export type LedgerLineKind = 'carry' | 'initial' | 'in' | 'out'`
  - `export interface LedgerLine { date: string; kind: LedgerLineKind; amount: number | null; before: number | null; after: number; purpose: string; price: number | null; note: string }`
  - `export function ledgerLines(txs: TxRow[], year: number): LedgerLine[]`, empty when the reagent does not belong in that year
  - `export function paginate<T>(lines: T[], perPage: number): (T | null)[][]`: the last page is padded with `null`, and at least one page is always returned

- [ ] **Step 1: Write failing tests**
  - `schoolYearOf('2026-03-01') === 2026`, `schoolYearOf('2027-02-28') === 2026`, `schoolYearOf('2028-02-29') === 2027`.
  - `schoolYearRange(2027).end === '2028-02-29'` and `schoolYearRange(2026).end === '2027-02-28'`.
  - `round3(0.1 + 0.2) === 0.3`.
  - `runningBalances`:
    - initial 300 → in 500 → out 50 gives before/after 0/300, 300/800, 800/750.
    - Deleted rows are ignored.
    - Same-date rows are ordered by `createdAt`.
  - `firstNegative` returns the first row whose `after < 0`. Example: initial 100, out 80, then a back-dated out of 30 dated before the first out.
  - `ledgerLines` with initial 2025-09-01 300, in 2026-03-16 500, out 2026-04-08 50, out 2027-03-02 10, for year 2026:
    - First line `{kind:'carry', date:'2026-03-01', after:300, amount:null, before:null}`.
    - Then the in and out lines with before/after.
    - The 2027 line is excluded.
  - Initial dated 2026-03-01 in year 2026 → first line `{kind:'initial', date:'2026-03-01', after:300}`, no carry line.
  - Year 2027 for the same reagent with no records in 2027 but stock 740 > 0 → one carry line only.
  - A reagent fully used up before the year (carry 0, no records that year) → `[]`.
  - `paginate([1,2,3], 2)` → `[[1,2],[3,null]]`. `paginate([], 2)` → `[[null,null]]`.
- [ ] **Step 2: Run** `npx vitest run src/domain/ledger.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** in `ledger.ts`. Write `runningBalances` as plain code that Task 4 can mirror line for line in GAS, because Task 4 copies the same cases.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): ledger lines, school year and running balance`

### Task 3: GAS tables, reagent actions and duplicate rule

**Files:**
- Modify: `gas/src/Schema.js` (TABLES, SHEET_NAMES, TABLE_LABELS, TABLE_LAYOUT, COLUMN_LABELS, HISTORY_TABS, HISTORY_GROUP_OF_TABLE, BOOLEAN_COLUMNS, NUMBER_COLUMNS), `gas/src/Db.js:271` (`recordLabel` also uses `row.reagentName`), `gas/src/Code.js` (register `reagentsActions()`), `gas/src/System.js` (API_VERSION 4), `web/src/api/system.ts` (REQUIRED_API_VERSION 4)
- Create: `gas/src/Reagents.js`
- Test: `gas/test/reagents.test.js`

**Interfaces:**
- Sheet tables:
  - `Reagents` columns: `name, concentration, formula, casNo, grade, unit, mainUse, expiryDate, purchaseDate, openedDate, maker, supplier, zoneId, toxic, accidentPrep, hazardManual, poison, banned, permitted, restricted, stock, note`. Tab `시약`. Layout: all readable columns left, `zoneId` right.
  - `ReagentTx` columns: `reagentName, date, kind, amount, purpose, price, note, reagentId`. Tab `시약 수불`. `reagentId` goes right.
  - Korean labels per spec §5-1 and §5-2.
- `kind` is stored in the sheet as `기초 재고`/`입고`/`출고`. `Reagents.js` converts it to and from `initial`/`in`/`out`. The API speaks keys only.
- History group `reagents` → tab `시약 이력`, for both tables.
- Actions (all `auth:'user'`), each returning the stored typed row(s):
  - `reagents.list {includeDeleted?}` → `Reagent[]`
  - `reagents.create {values, initialAmount, initialDate}` → `Reagent` (also writes the `initial` tx; `stock = initialAmount`)
  - `reagents.createMany {rows: [{line, values, initialAmount, initialDate}]}` → `{created: Reagent[], skippedLines: number[]}`
  - `reagents.update {id, changes}` → `Reagent`
  - `reagents.delete {id}` / `reagents.restore {id}` → `Reagent`
- `Reagents` and `ReagentTx` are NOT added to `RECORD_TABLES`.

- [ ] **Step 1: Write failing tests** in `gas/test/reagents.test.js`. Use the `beforeEach` from `records.test.js` (admin + teacher). The fake clock is 2026-03-02 KST.
  - `create` with `{name:'염화 수소(염산)', concentration:35, unit:'mL', toxic:'해당', accidentPrep:'해당'}`, `initialAmount:500`, `initialDate:'2026-03-01'`:
    - Returns `stock 500`.
    - `gas.rows('ReagentTx')` has one row with `구분` cell `기초 재고`.
    - The history tab `시약 이력` gets 2 entries.
  - Validation is INVALID for each of:
    - missing name
    - unit `'L'`
    - concentration 0 or 101
    - CAS `'7647-01-1'`
    - toxic `'yes'`
    - future `initialDate` `'2026-03-03'`
    - initialAmount -1
    - `stock` inside `values`
    - a date `'2026-02-30'`
  - Duplicates:
    - A second create with name `' 염화 수소(염산) '` and concentration 35 is INVALID with a message containing `이미 등록`.
    - The same name with concentration 9 is OK.
    - The same name with concentration `null` is OK, and `null` vs `null` is a duplicate.
    - Names that differ only in case are duplicates.
  - `update {changes:{stock:1}}` is INVALID. `update` that renames into a duplicate is INVALID.
  - Restore of a deleted reagent while a live duplicate exists is INVALID.
  - `createMany`:
    - Rows with one invalid row (line 4) → INVALID whose message starts with `4번째 줄`. Nothing is written.
    - Two rows in the file with the same key → INVALID.
    - A row duplicating an existing reagent → skipped (`skippedLines:[3]`); the others are created.
  - `records.list {table:'Reagents'}` is FORBIDDEN.
- [ ] **Step 2: Run** `cd gas && npx vitest run test/reagents.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the schema entries and `Reagents.js`:
  - Validation helpers come from `Records.js`: `checkText`, `checkBoolean`, `invalid`.
  - Add a local `checkDate(values, key, label, required)` and `checkNumber(values, key, label, required, min, max, allowZero)`.
  - `isValidCas` mirrors the web version.
  - Duplicate key: `name.trim().toLowerCase() + '|' + (concentration === null || concentration === '' ? '' : concentration)`.
  - In `createMany`, validate every row first, then write with `dbCreateMany` (one write each for `Reagents` and `ReagentTx`).
  - Bump the API versions.
- [ ] **Step 4: Run** `npm test` (all GAS tests). Expected: PASS. Then run `npm run bundle`.
- [ ] **Step 5: Commit** `feat(gas): reagent tables and registration actions (API 4)`

### Task 4: GAS in/out records, running-balance guard, stock recompute

**Files:**
- Modify: `gas/src/Reagents.js`
- Test: `gas/test/reagents.test.js`

**Interfaces:**
- Actions:
  - `reagentTx.list {reagentId?, from?, to?, includeDeleted?}` → `TxRow[]` (keys as in Task 2's `TxRow`)
  - `reagentTx.create {reagentId, date, kind:'in'|'out', amount, purpose, price?, note?}` → `{tx: TxRow, stock: number}`
  - `reagentTx.update {id, changes}` → `{tx, stock}`
  - `reagentTx.delete {id}` → `{tx, stock}`
  - `reagentTx.restore {id}` → `{tx, stock}`
  - `reagentTx.recentPurposes {}` → `string[]`: up to 8 distinct `out` purposes, newest first
- The GAS function `txBalances(rows)` mirrors `runningBalances` from Task 2 (same sort order, same `round3`).

- [ ] **Step 1: Write failing tests**
  - out 50 from a stock of 500 → `stock 450`, and the sheet row has `구분 출고`, `약품명` filled, and `작성자 이교사`.
  - out 600 from 500 → INVALID with message `남은 양(500 mL)보다 많습니다.`
  - The out `purpose` is required (INVALID when blank). An in `purpose` may be blank. `price` is only accepted for `in`.
  - A date before the initial date → INVALID. A future date → INVALID.
  - Back-dated record: initial 100 on 03-01, out 80 on 03-02. Creating out 30 dated 03-01 makes the balance 70 on 03-01 and -10 on 03-02, so it is INVALID with a message containing `2026-03-02` (the first date that goes negative).
  - `audit.list {table:'Reagents', recordId}` also returns the history of that reagent's `ReagentTx` rows (matched by `reagentId` in before/after), newest first.
  - `update` of an out amount from 80 to 90 → `stock 10`. `delete` of it → `stock 100`. `restore` → `stock 10`. A restore that would go negative is INVALID.
  - The initial row: `update {amount: 200}` works and stock follows. `update {kind:'out'}` and `delete` are INVALID.
  - Decimal amounts: 0.1 + 0.2 as two `in` records on stock 0 → stock 0.3.
  - Changing `stock` is not audited separately: after one out there is exactly one new history entry.
  - `recentPurposes` returns unique purposes newest first, max 8.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - On every tx change, load the reagent's live tx (`dbList('ReagentTx', {where:{reagentId}})`) and apply the change in memory.
  - Run `txBalances`. Reject at the first `after < 0`.
  - Write the row, then `dbUpdate('Reagents', id, {stock}, user, {skipAudit:true})`.
  - Extend `auditList` in `Records.js` for the `Reagents` + `recordId` case.
  - Error messages:
    - Create: `남은 양(<before> <unit>)보다 많습니다.`
    - Other changes: `이렇게 바꾸면 <date>에 남은 양이 음수가 됩니다.`
- [ ] **Step 4: Run** `npm test`, then `npm run bundle`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(gas): reagent in/out records with balance guard`

### Task 5: Block deleting places that hold reagents; fix resize order

**Files:**
- Modify: `gas/src/Records.js` (`recordsDelete`, `recordsDeleteMany`), `web/src/pages/CabinetPage.tsx:96-111` (`saveCabinet`)
- Test: `gas/test/reagents.test.js`, `web/src/pages/CabinetPage.test.tsx`

**Interfaces:**
- Produces the GAS function `reagentsInPlaces(table, ids)` → `string[]`: the names (with concentration) of live reagents whose zone is inside those Zones, Cabinets or Rooms.

- [ ] **Step 1: Write failing tests**
  - GAS: a reagent stored in a zone, then each of these is INVALID with a message containing `염화 수소(염산) 35%` and `먼저 시약의 보관 위치를 옮겨 주세요`:
    - `records.delete` of that zone
    - `records.deleteMany` of zones that include it
    - delete of its cabinet
    - delete of its room
  - GAS: deleting an empty zone still works.
  - Web: on resize to fewer rows, when `records.deleteMany` rejects, `records.update` for the cabinet is never called and the error text is shown. When it succeeds, the call order is `records.deleteMany` → `records.update` → `records.createMany`.
- [ ] **Step 2: Run** both test files. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - In `recordsDelete`/`recordsDeleteMany`, call the guard before soft delete when the table is Zones, Cabinets or Rooms.
  - In `saveCabinet`, remove zones first, then update the cabinet, then create zones.
- [ ] **Step 4: Run** `cd gas && npm test && npm run bundle`, then `cd web && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: keep places that hold reagents from being deleted`

### Task 6: Reagent API, location labels, list page with usage and receive dialogs

**Files:**
- Create: `web/src/api/reagents.ts`, `web/src/domain/location.ts`, `web/src/pages/ReagentsPage.tsx`, `web/src/components/TxDialog.tsx`
- Modify: `web/src/test/fakeApi.ts` (Reagents, ReagentTx tables and the `reagents.*`/`reagentTx.*` actions, using `runningBalances` to reject negatives exactly like GAS), `web/src/App.tsx` (routes), `web/src/components/Layout.tsx` (menu items 시약 `FlaskConical`, 위치 찾기 `Search`, placed after 교실·보관장), `web/src/components/HistoryDialog.tsx` (labels for the new fields and tables), `web/src/styles.css`
- Test: `web/src/domain/location.test.ts`, `web/src/pages/ReagentsPage.test.tsx`

**Interfaces:**
- Consumes: `TxRow`, `round3` (Task 2); `isHazardous`, `needsCheck` (Task 1).
- Produces:
  - `export interface Reagent extends Stamped { name; concentration: number | null; formula; casNo; grade: '' | '시약용' | '공업용'; unit: 'mL' | 'g'; mainUse; expiryDate; purchaseDate; openedDate; maker; supplier; zoneId; toxic: HazardStatus; accidentPrep: HazardStatus; hazardManual: boolean; poison; banned; permitted; restricted: boolean; stock: number; note }` (the string fields are `string`)
  - `export const reagentsApi = { list(includeDeleted?), create(values, initialAmount, initialDate), createMany(rows), update(id, changes), remove(id), restore(id), txList(q), txCreate(v), txUpdate(id, changes), txRemove(id), txRestore(id), recentPurposes() }`. The action names and payloads are those of Tasks 3 and 4.
  - `export function reagentLabel(r: Pick<Reagent,'name'|'concentration'>): string`: `"염화 수소(염산) 35%"`, or the name alone when the concentration is null
  - `export interface Place { zoneId: string; cabinetId: string; label: string }`
  - `export function buildPlaces(rooms: Room[], cabinets: Cabinet[], zones: Zone[]): Map<string, Place>`. The label is `"<교실> › <보관장> › <구역 이름 또는 'N단 M칸'>"`, live rows only, sorted by label.
  - `export function TxDialog(props: { reagent: Reagent; mode: 'in' | 'out'; tx?: TxRow; onClose(): void; onSaved(stock: number): void })`
- Routes added: `/reagents`, `/reagents/new`, `/reagents/import`, `/reagents/ledger`, `/reagents/:id`, `/find`. Pages for later tasks start as a stub `<h1>` so the routes compile.

- [ ] **Step 1: Write failing tests**
  - `location.test.ts`: label format; a zone with an empty name → `3단 2칸`; deleted rows are skipped.
  - `ReagentsPage.test.tsx`:
    - The list shows the name with concentration, stock with unit, place label (or `위치 미지정`) and a hazard mark.
    - The search `염산` filters by name, CAS and formula part.
    - "유해화학물질만" filters.
    - Usage: click `사용 기록` on a row of stock 500 → dialog. Type 50 → shows `기록 후 남는 양 450 mL`. Type 600 → the save button is disabled and `남은 양보다 많습니다` is shown.
    - Saving 50 with purpose `2학년 중화 반응 실험` sends `reagentTx.create {kind:'out', amount:50, date:'<today>'}`, the dialog closes, and the row shows `450 mL`.
    - Stale stock: the fake rejects with INVALID `남은 양(30 mL)보다 많습니다.` → the dialog stays open and shows that message.
    - Receive (`입고`): the purpose defaults to the reagent's `supplier`; price is optional.
    - A recent purpose button fills the purpose field.
    - The `삭제된 시약` section lists deleted reagents with a `복구` button that sends `reagents.restore`.
    - The toolbar has links `시약 등록` (`/reagents/new`), `엑셀로 등록` (`/reagents/import`) and `대장 출력` (`/reagents/ledger`).
- [ ] **Step 2: Run** `npx vitest run src/domain/location.test.ts src/pages/ReagentsPage.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Today's date in the browser: `new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date())`. Put it in `ledger.ts` as `export function todayKst(): string` and test it.
  - The dialog uses the existing `.card`/`.field`/`ErrorMessage` patterns.
- [ ] **Step 4: Run** `npm test && npx tsc -b && npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): reagent list with usage and receive records`

### Task 7: Register and detail pages

**Files:**
- Create: `web/src/pages/ReagentPage.tsx` (one component: `/reagents/new` when `id` is absent, detail otherwise), `web/src/components/PlacePicker.tsx`
- Test: `web/src/pages/ReagentPage.test.tsx`

**Interfaces:**
- Consumes: `reagentsApi`, `buildPlaces`, `TxDialog`, `judgeHazard`, `isValidCas`, `ledgerLines`/`runningBalances`, `schoolYearOf`, `schoolYearRange`, `todayKst`.
- Produces: `export function PlacePicker(props: { value: string; onChange(zoneId: string): void })`, which loads rooms, cabinets and zones and offers 교실 → 보관장 → 구역 selects plus `위치 미지정`.

- [ ] **Step 1: Write failing tests**
  - New reagent:
    - Entering CAS `7647-01-0` and concentration 35 shows `유독물질: 해당`, `사고대비물질: 해당` live.
    - Entering CAS `50-00-0` shows `판정 불가` and the kreach hint `kreach.me.go.kr`.
    - Picking `해당 없음` manually sends `hazardManual:true`.
    - Then changing the concentration keeps the manual value.
  - The `이 학년도 3월 1일` button sets 기준일 to `2026-03-01` when today is 2026-10-27 and to `2026-03-01` when today is 2027-02-10.
  - Save sends `reagents.create` with `initialAmount`/`initialDate` and goes to `/reagents/<id>`.
  - Detail:
    - The school-year select defaults to the current year.
    - The table lists that year's records with before/after.
    - Editing a row opens `TxDialog` with the values filled and sends `reagentTx.update`.
    - Delete sends `reagentTx.delete`.
    - The initial row has no delete button.
    - The `이력 보기` button (`HistoryButton table="Reagents"`) and the `대장 출력` link (to `/reagents/ledger?ids=<id>`) exist.
    - The edit form saves only the changed fields through `reagents.update`.
    - Delete of the reagent goes back to the list.
- [ ] **Step 2: Run** `npx vitest run src/pages/ReagentPage.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** with the fields of spec §5-1. `mainUse` defaults to `실험용`. The unit is a `mL`/`g` select. Hazard results are recomputed on CAS or concentration change unless `hazardManual`.
- [ ] **Step 4: Run** `npm test && npx tsc -b && npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): reagent register and detail pages`

### Task 8: Ledger print page for three regions

**Files:**
- Create: `web/src/pages/LedgerPage.tsx`, `web/src/print/LedgerSheets.tsx` (one component per region: `ChungbukLedger`, `GyeonggiLedger`, `SeoulLedger`), `web/src/print/print.css` (imported by LedgerPage)
- Test: `web/src/print/LedgerSheets.test.tsx`, `web/src/pages/LedgerPage.test.tsx`

**Interfaces:**
- Consumes: `ledgerLines`, `paginate`, `schoolYearOf`, `isHazardous`, `needsCheck`, `reagentLabel`, the `region` setting (`settings.get` as SettingsPage loads it).
- Produces: `export function LedgerSheets(props: { region: 'chungbuk' | 'seoul' | 'gyeonggi'; year: number; items: { reagent: Reagent; lines: LedgerLine[] }[] })`

- [ ] **Step 1: Write failing tests**
  - Chungbuk:
    - The title `화학물질 관리대장`.
    - The header has `★ 약품명`, `CAS No.`, and the line `금지물질( ), 허가물질( ), 제한물질( ), 유독물질( ○ ), 사고대비물질( ○ )` for HCl 35%.
    - Column headers exactly `연월일, 수불구분, 수불량, 보유량, 잔량, 용도, 확인, 비고`.
    - The carry line shows `이월` with only 잔량. An in line shows `입고 500 300 800 <supplier>`.
    - The 확인 cells are empty.
  - Gyeonggi:
    - The title `2026학년도 과학실험실 화학약품 관리(출납)대장`.
    - The header table has `약품명, 유효기간, 농도, 주용도, 유해화학물질 여부, 단위`, with 여부 `○` for hazardous and `×` otherwise.
    - Columns `수불일자, 수불구분, 수불량, 보유량, 잔량, 용도, 확인(서명)`.
  - Seoul:
    - The title `2026학년도 과학실험실 화학약품 관리(출납)대장`.
    - Header `품명, 규격, 단위, 독극물, 주용도, 유효기간`.
    - Columns `일자, 결재(부장, 담당), 적요, 취득(수량, 금액(원)), 사용량, 재고량, 비고`.
    - An in line shows 적요 `구입 (○○과학)` with 수량 and 금액 `25,000`. An out line shows 적요 = purpose and 사용량.
  - A `판정 불가` reagent prints `확인 필요` in Chungbuk's 유독물질 and 사고대비물질 slots and in Gyeonggi's 여부. Seoul shows nothing.
  - A hazardous reagent's name has class `hl`.
  - Pagination: more lines than one page → a second page that repeats the header. The last page is padded with empty rows.
  - LedgerPage:
    - The year select defaults to the current school year.
    - `?ids=a,b` limits to those reagents. Otherwise it shows all reagents (including deleted ones) whose `ledgerLines` is non-empty, sorted by name with `localeCompare('ko')`.
    - It shows `판정이 안 된 시약 N개` with links when any have `needsCheck`.
    - The `인쇄` button calls `window.print`.
    - The deleted-reagent option in the picker is marked `(삭제됨)`.
- [ ] **Step 2: Run** `npx vitest run src/print src/pages/LedgerPage.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Each sheet is a `<section class="sheet sheet-portrait|sheet-landscape">`.
  - `print.css` sets `@page { size: A4 portrait }` and a named page for landscape (`@page seoul { size: A4 landscape }` with `.sheet-landscape { page: seoul }`), plus `break-after: page`.
  - Hide the app's sidebar and toolbar in `@media print`.
  - Footnotes are copied verbatim from the spec §8-6 sources:
    - 충북: `※ 관리대장(구입, 보관, 폐기량 기록) 5년 비치(화학물질관리법 시행규칙 제56조)`, `※ 확인: 위임전결규정에 의한 결재`, `※ 유해화학물질(유독물질, 사고대비 물질)일 경우 약품명에 형광펜 등을 사용해 쉽게 인식할 수 있도록 표시 권장`
    - 경기/서울: `※ 화학물질을 에듀파인에 등록하지 않고 수기로 관리할 경우 본 양식 사용`
  - Rows per page are the builder's call (spec §11). Pick values so one page fits A4 at print preview.
- [ ] **Step 4: Run** `npm test && npx tsc -b && npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): chemical ledger print for Chungbuk, Seoul and Gyeonggi`

### Task 9: Excel template and bulk import

**Files:**
- Create: `web/src/domain/reagentImport.ts`, `web/src/pages/ImportPage.tsx`, `web/src/excel/template.ts` (ExcelJS write/read, dynamically imported)
- Modify: `web/package.json` (`exceljs@4.4.0`)
- Test: `web/src/domain/reagentImport.test.ts`, `web/src/pages/ImportPage.test.tsx`

**Interfaces:**
- Consumes: `judgeHazard`, `isValidCas`, `buildPlaces`, `todayKst`, `reagentsApi.createMany`.
- Produces:
  - `export const IMPORT_COLUMNS: { key: string; header: string; required: boolean; choices?: string[]; help: string }[]`. Order: 약품명*, 농도(%), 화학식, CAS No., 규격, 단위*, 기초 재고량*, 기준일, 주용도, 유효기간, 구입일, 개봉일, 제조사, 구입처, 보관 위치, 독극물, 금지물질, 허가물질, 제한물질, 비고. Choices: 단위 `mL,g`; 규격 `시약용,공업용`; yes/no columns `예,아니오`.
  - `export function cellToDate(v: unknown): string | null`, which handles `Date` (read with UTC getters, as ExcelJS gives UTC midnight), Excel serial numbers, and `YYYY-MM-DD`/`YYYY.MM.DD` text
  - `export interface ParsedRow { line: number; status: 'ok' | 'error' | 'skip'; errors: string[]; values?: Record<string, unknown>; initialAmount?: number; initialDate?: string }`
  - `export function parseImport(rows: unknown[][], ctx: { places: Map<string, Place>; existingKeys: Set<string>; defaultDate: string; today: string }): ParsedRow[]`. `rows[0]` is the header. The row whose 약품명 starts with `예시` is skipped silently.
  - `export function duplicateKey(name: string, concentration: number | null): string` (same rule as GAS Task 3)
  - In `template.ts`: `export async function buildTemplate(places: Place[]): Promise<Blob>`, `export async function readWorkbook(file: File): Promise<unknown[][]>`

- [ ] **Step 1: Write failing tests**
  - `cellToDate`:
    - `new Date(Date.UTC(2026,2,1))` → `'2026-03-01'`
    - serial `46082` → `'2026-03-01'`
    - `'2026.3.1'` → `'2026-03-01'`
    - `'2026-02-30'` → `null`
  - `parseImport`:
    - A good row → `ok` with the hazard fields filled and `initialDate` = defaultDate when 기준일 is blank.
    - Missing name or unit, bad CAS, an unknown place label, a future date, a negative amount → `error` with Korean reasons.
    - A row duplicating an `existingKeys` entry → `skip`.
    - Two rows in the file with the same key → both `error`.
    - 독극물 `예` → `poison:true`.
    - Concentration `35%` text → 35.
    - Concentration `1M` → error `농도는 %로 입력`.
  - ImportPage:
    - The `양식 내려받기` button calls `buildTemplate` (mocked) with the places.
    - Choosing a file (with `readWorkbook` mocked) shows a preview: error rows get class `row-error` with the reason, skip rows show `이미 등록됨 – 건너뜀`, and the counts summary is shown.
    - `저장` is disabled while any error exists.
    - Saving sends `reagents.createMany` in chunks of 200 with `line` numbers, then shows `N건 등록, M건 건너뜀`.
    - A failure in the second chunk shows `200건까지 저장됨`.
- [ ] **Step 2: Run** `npx vitest run src/domain/reagentImport.test.ts src/pages/ImportPage.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `npm install exceljs@4.4.0`.
  - `template.ts` builds sheet `입력` (header row bold, example row 2 starting `예시 –`, list data validation on the choice columns, and the 보관 위치 list from a hidden sheet `위치목록`) and sheet `안내` (one row per column: header, required, help).
  - `readWorkbook` returns the first sheet's values. Import it lazily: `const { buildTemplate } = await import('../excel/template')`.
  - Run `npm run build` and confirm Vite bundles ExcelJS in a separate chunk. If the `exceljs` import fails in the browser build, import `exceljs/dist/exceljs.min.js` instead.
- [ ] **Step 4: Run** `npm test && npx tsc -b && npm run lint && npm run build`. Expected: PASS, and the build output lists a separate exceljs chunk.
- [ ] **Step 5: Commit** `feat(web): Excel template and bulk reagent import`

### Task 10: Location search and zone highlight

**Files:**
- Create: `web/src/pages/FindPage.tsx`
- Modify: `web/src/pages/CabinetPage.tsx` (read `?zone=`, add class `zone-highlight`, scroll into view), `web/src/styles.css`
- Test: `web/src/pages/FindPage.test.tsx`, `web/src/pages/CabinetPage.test.tsx`

**Interfaces:**
- Consumes: `reagentsApi.list`, `buildPlaces`, `reagentLabel`.

- [ ] **Step 1: Write failing tests**
  - Searching `HCl`, `7647` or `염산` finds the reagent.
  - Each result shows the label, place and `500 mL`. A reagent without a place shows `위치 미지정` and has no link.
  - Clicking a result navigates to `/cabinets/c1?zone=<zoneId>`.
  - An empty search shows nothing (not every reagent).
  - CabinetPage at `/cabinets/c1?zone=c1-2-1` marks that zone cell with class `zone-highlight`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npx tsc -b && npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): location search for reagents`

### Task 11: End-to-end scenario, docs, deploy

**Files:**
- Create: `web/e2e/m2.spec.ts`
- Modify: `docs/project-status.md` (M2 done section, what the teacher checks, deferred items), `README.md` (progress checklist), `CLAUDE.md` (new tabs `시약`, `시약 수불`, `시약 이력`; decisions from spec §12 that are project-wide)

- [ ] **Step 1: Write the e2e scenario.** It starts the same way as `m1.spec.ts` (connect, `__dev/createAdmin`, login), then:
  - Creates a room, a cabinet and a zone.
  - Registers `염화 수소(염산)` 35% CAS `7647-01-0` with 500 mL on 2026-03-01 in that zone.
  - Records uses of 50 and 30.
  - Opens 대장 출력 and checks the 잔량 cells `500`, `450`, `420` and the title.
  - Switches the region in 설정 to 서울 and back, taking a screenshot of each region.
  - Searches `염산` in 위치 찾기 and lands on the cabinet with the zone highlighted.
  - Screenshots go to `docs/screenshots/m2/`.
  - Note: the dev server's clock is real time, so dates the test types must not be in the future. Use `todayKst()` logic in the test, and use a 2026-03-01 기초 재고 only if today ≥ 2026-03-01.
- [ ] **Step 2: Run** `cd web && npm run e2e`. Expected: both m1 and m2 pass.
- [ ] **Step 3: Update the docs.** Then run all checks: `cd gas && npm test`; `cd web && npm test && npx tsc -b && npm run lint && npm run build`.
- [ ] **Step 4: Commit** `test: M2 end-to-end scenario; docs for M2`
- [ ] **Step 5: Deploy to the dev sheet.** Run `cd gas && npm run deploy`. Expected: `Deployed … @5 - git <sha>`, and `curl -sL <exec url>` returns `{"ok":true,"data":{"name":"LabKeeper"}}`.
