import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { callApi } from '../api/client'
import { createFakeApi } from '../test/fakeApi'
import ReagentPage from './ReagentPage'

vi.mock('../api/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api/client')>()
  return { ...real, callApi: vi.fn() }
})

const stamp = { deleted: false, createdBy: 'u1', updatedBy: 'u1', updatedAt: '2026-03-02T09:00:00.000Z' }
const HCL = {
  id: 'hcl', name: '염화 수소(염산)', concentration: 35, formula: 'HCl', casNo: '7647-01-0', grade: '시약용', unit: 'mL', mainUse: '실험용',
  expiryDate: '2028-03-01', purchaseDate: '', openedDate: '', maker: '', supplier: '○○과학', zoneId: 'z1', toxic: '해당', accidentPrep: '해당',
  hazardManual: false, poison: false, banned: false, permitted: false, restricted: false, stock: 720, note: '', ...stamp,
}
const tx = (id: string, date: string, kind: string, amount: number, purpose = '') => ({ id, reagentId: 'hcl', date, kind, amount, purpose, price: null, note: '', createdAt: `${date}T09:00:00+09:00`, ...stamp })

let fake: ReturnType<typeof createFakeApi>

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-27T03:00:00Z'))
  fake = createFakeApi({
    Rooms: [{ id: 'r1', name: '제1과학실', isLab: true, ...stamp }],
    Cabinets: [{ id: 'c1', roomId: 'r1', name: 'A 시약장', type: 'sealed', locked: true, rows: 1, cols: 2, ...stamp }],
    Zones: [
      { id: 'z1', cabinetId: 'c1', row: 1, col: 1, name: '진한 산', allowedClasses: '', ...stamp },
      { id: 'z2', cabinetId: 'c1', row: 1, col: 2, name: '', allowedClasses: '', ...stamp },
    ],
    Reagents: [HCL],
    ReagentTx: [tx('t0', '2025-09-01', 'initial', 300), tx('t1', '2026-03-16', 'in', 500, '○○과학'), tx('t2', '2026-04-08', 'out', 50, '2학년 중화 반응 실험'), tx('t3', '2026-05-13', 'out', 30, '3학년 산과 염기')],
  })
  vi.mocked(callApi).mockImplementation(fake.handle as typeof callApi)
})

afterEach(() => {
  vi.useRealTimers()
})

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/reagents" element={<h1>시약 목록</h1>} />
        <Route path="/reagents/new" element={<ReagentPage />} />
        <Route path="/reagents/:reagentId" element={<ReagentPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('new reagent', () => {
  async function fillBasics() {
    renderAt('/reagents/new')
    await userEvent.type(await screen.findByLabelText('약품명'), '염화 수소(염산)')
    await userEvent.type(screen.getByLabelText('농도(%)'), '35')
    await userEvent.type(screen.getByLabelText('CAS No.'), '7647-01-0')
  }

  test('judges the hazard as CAS No. and concentration are typed', async () => {
    await fillBasics()
    expect(screen.getByLabelText('유독물질')).toHaveValue('해당')
    expect(screen.getByLabelText('사고대비물질')).toHaveValue('해당')
    await userEvent.clear(screen.getByLabelText('농도(%)'))
    await userEvent.type(screen.getByLabelText('농도(%)'), '9')
    expect(screen.getByLabelText('유독물질')).toHaveValue('해당 없음')
  })

  test('a substance outside the table cannot be judged and points to kreach', async () => {
    renderAt('/reagents/new')
    await userEvent.type(await screen.findByLabelText('CAS No.'), '50-00-0')
    expect(screen.getByLabelText('유독물질')).toHaveValue('판정 불가')
    expect(screen.getByText(/kreach\.me\.go\.kr/)).toBeInTheDocument()
  })

  test('a bad CAS No. is pointed out', async () => {
    renderAt('/reagents/new')
    await userEvent.type(await screen.findByLabelText('CAS No.'), '7647-01-1')
    expect(screen.getByText('CAS No. 형식이나 검사 숫자가 맞지 않습니다.')).toBeInTheDocument()
  })

  test('a judgment chosen by hand stays when the concentration changes, and is saved as such', async () => {
    await fillBasics()
    await userEvent.selectOptions(screen.getByLabelText('유독물질'), '해당 없음')
    await userEvent.clear(screen.getByLabelText('농도(%)'))
    await userEvent.type(screen.getByLabelText('농도(%)'), '36')
    expect(screen.getByLabelText('유독물질')).toHaveValue('해당 없음')
    await userEvent.type(screen.getByLabelText('기초 재고량 (mL)'), '500')
    await userEvent.click(screen.getByRole('button', { name: '등록' }))
    expect(fake.called('reagents.create')[0]).toMatchObject({ values: { toxic: '해당 없음', accidentPrep: '해당', hazardManual: true } })
  })

  test('the start date defaults to today and has a 3월 1일 shortcut', async () => {
    renderAt('/reagents/new')
    expect(await screen.findByLabelText('기준일')).toHaveValue('2026-10-27')
    await userEvent.click(screen.getByRole('button', { name: '이 학년도 3월 1일' }))
    expect(screen.getByLabelText('기준일')).toHaveValue('2026-03-01')
  })

  test('in February the shortcut goes back to March of the previous year', async () => {
    vi.setSystemTime(new Date('2027-02-10T03:00:00Z'))
    renderAt('/reagents/new')
    await userEvent.click(await screen.findByRole('button', { name: '이 학년도 3월 1일' }))
    expect(screen.getByLabelText('기준일')).toHaveValue('2026-03-01')
  })

  test('saving sends the reagent with its initial stock and opens it', async () => {
    await fillBasics()
    await userEvent.selectOptions(screen.getByLabelText('보관장'), 'c1')
    await userEvent.selectOptions(screen.getByLabelText('구역'), 'z2')
    await userEvent.type(screen.getByLabelText('기초 재고량 (mL)'), '500')
    await userEvent.click(screen.getByRole('button', { name: '등록' }))
    const sent = fake.called('reagents.create')[0] as { values: Record<string, unknown>; initialAmount: number; initialDate: string }
    expect(sent).toMatchObject({ initialAmount: 500, initialDate: '2026-10-27' })
    expect(sent.values).toMatchObject({ name: '염화 수소(염산)', concentration: 35, casNo: '7647-01-0', unit: 'mL', mainUse: '실험용', zoneId: 'z2', hazardManual: false })
    expect(await screen.findByRole('heading', { name: '염화 수소(염산) 35%' })).toBeInTheDocument()
  })
})

describe('finding the chemical info (data.go.kr)', () => {
  const KMNO4 = {
    found: true, casNo: '7722-64-7', name: '과망간산 칼륨', formula: 'KMnO4',
    classes: [
      { type: '인체등유해성물질', content: '인체급성유해성 : 5%, 생태유해성 : 2.5%', exception: '' },
      { type: '사고대비물질', content: '과망간산 칼륨 및 이를 98% 이상 함유한 혼합물', exception: '' },
    ],
  }
  const FORMALDEHYDE = {
    found: true, casNo: '50-00-0', name: '포르말린', formula: 'CH2O',
    classes: [
      { type: '인체등유해성물질', content: '인체급성유해성 : 1%, 인체만성유해성 : 0.1%', exception: '' },
      { type: '제한물질', content: '폼알데하이드 및 이를 1% 이상 함유한 혼합물', exception: '가구용 무늬목' },
    ],
  }

  async function findAndPick(pick: string) {
    await userEvent.click(screen.getByRole('button', { name: '찾기' }))
    await userEvent.click(await screen.findByRole('button', { name: pick }))
  }

  test('a picked substance fills CAS No. and formula and is judged by the API, the ecological limit included', async () => {
    fake.chem.items = [{ name: '과망간산칼륨', casNo: '7722-64-7' }]
    fake.chem.info['7722-64-7'] = KMNO4
    renderAt('/reagents/new')
    await userEvent.type(await screen.findByLabelText('약품명'), '과망간산칼륨')
    await userEvent.type(screen.getByLabelText('농도(%)'), '3')
    await findAndPick('과망간산칼륨 · 7722-64-7')
    expect(fake.called('chem.search')).toEqual([{ query: '과망간산칼륨' }])
    expect(screen.getByLabelText('CAS No.')).toHaveValue('7722-64-7')
    expect(screen.getByLabelText('화학식')).toHaveValue('KMnO4')
    expect(screen.getByLabelText('약품명')).toHaveValue('과망간산칼륨')
    // the 46-substance table would say 해당 없음 below 5%; the API's 2.5% (생태) wins
    expect(screen.getByLabelText('유독물질')).toHaveValue('해당')
    expect(screen.getByLabelText('사고대비물질')).toHaveValue('해당 없음')
    expect(screen.getByText(/화학물질안전원 고시/)).toBeInTheDocument()
    expect(screen.getByText('인체등유해성물질: 인체급성유해성 : 5%, 생태유해성 : 2.5%')).toBeInTheDocument()

    await userEvent.clear(screen.getByLabelText('농도(%)'))
    await userEvent.type(screen.getByLabelText('농도(%)'), '2')
    expect(screen.getByLabelText('유독물질')).toHaveValue('해당 없음')
    await userEvent.clear(screen.getByLabelText('농도(%)'))
    await userEvent.type(screen.getByLabelText('농도(%)'), '4')
    expect(screen.getByLabelText('유독물질')).toHaveValue('해당')

    // typing another CAS No. drops the found info and goes back to the table
    await userEvent.clear(screen.getByLabelText('CAS No.'))
    await userEvent.type(screen.getByLabelText('CAS No.'), '7722-64-7')
    expect(screen.getByLabelText('유독물질')).toHaveValue('해당 없음')
    expect(screen.queryByText(/화학물질안전원 고시/)).not.toBeInTheDocument()
  })

  test('restricted and the like are ticked from the API and saved', async () => {
    fake.chem.items = [{ name: '포르말린', casNo: '50-00-0' }]
    fake.chem.info['50-00-0'] = FORMALDEHYDE
    renderAt('/reagents/new')
    await userEvent.type(await screen.findByLabelText('약품명'), '포르말린')
    await userEvent.type(screen.getByLabelText('농도(%)'), '37')
    await findAndPick('포르말린 · 50-00-0')
    expect(screen.getByLabelText('제한물질')).toBeChecked()
    expect(screen.getByText('제한물질: 폼알데하이드 및 이를 1% 이상 함유한 혼합물 (참고: 가구용 무늬목)')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('기초 재고량 (mL)'), '500')
    await userEvent.click(screen.getByRole('button', { name: '등록' }))
    expect(fake.called('reagents.create')[0]).toMatchObject({
      values: { casNo: '50-00-0', formula: 'CH2O', toxic: '해당', accidentPrep: '해당 없음', restricted: true, banned: false, hazardManual: true },
    })
  })

  test('typing the CAS No. by hand also clears the ticks the API set', async () => {
    fake.chem.items = [{ name: '포르말린', casNo: '50-00-0' }]
    fake.chem.info['50-00-0'] = FORMALDEHYDE
    renderAt('/reagents/new')
    await userEvent.type(await screen.findByLabelText('약품명'), '포르말린')
    await findAndPick('포르말린 · 50-00-0')
    expect(screen.getByLabelText('제한물질')).toBeChecked()
    await userEvent.clear(screen.getByLabelText('CAS No.'))
    expect(screen.getByLabelText('제한물질')).not.toBeChecked()
  })

  test('with no name it searches by the CAS No. and fills the name', async () => {
    fake.chem.items = [{ name: '포르말린', casNo: '50-00-0' }]
    fake.chem.info['50-00-0'] = FORMALDEHYDE
    renderAt('/reagents/new')
    await userEvent.type(await screen.findByLabelText('CAS No.'), '50-00-0')
    await findAndPick('포르말린 · 50-00-0')
    expect(fake.called('chem.search')).toEqual([{ query: '50-00-0' }])
    expect(screen.getByLabelText('약품명')).toHaveValue('포르말린')
  })

  test('nothing found says how to search again', async () => {
    renderAt('/reagents/new')
    await userEvent.type(await screen.findByLabelText('약품명'), '과망가니즈산 칼륨')
    await userEvent.click(screen.getByRole('button', { name: '찾기' }))
    expect(await screen.findByText('찾은 물질이 없습니다. 다른 이름(예: 옛 이름)이나 CAS No.로 찾아 보세요.')).toBeInTheDocument()
  })

  test('without a name or CAS No. there is nothing to search', async () => {
    renderAt('/reagents/new')
    await userEvent.click(await screen.findByRole('button', { name: '찾기' }))
    expect(screen.getByText('약품명이나 CAS No.를 먼저 입력해 주세요.')).toBeInTheDocument()
    expect(fake.called('chem.search')).toEqual([])
  })

  test('a server message (no key) is shown as it is', async () => {
    const { ApiError } = await import('../api/client')
    fake.chem.error = new ApiError('NO_API_KEY', '공공데이터 인증키가 없습니다. 운영 교사가 시트 메뉴 LabKeeper → 공공데이터 인증키 입력에서 넣어 주세요.')
    renderAt('/reagents/new')
    await userEvent.type(await screen.findByLabelText('약품명'), '황산')
    await userEvent.click(screen.getByRole('button', { name: '찾기' }))
    expect(await screen.findByText(/공공데이터 인증키 입력에서 넣어 주세요/)).toBeInTheDocument()
  })

  test('a substance KECO does not know keeps the table judgment and says so', async () => {
    fake.chem.items = [{ name: '염화 수소', casNo: '7647-01-0' }]
    renderAt('/reagents/new')
    await userEvent.type(await screen.findByLabelText('약품명'), '염화 수소')
    await userEvent.type(screen.getByLabelText('농도(%)'), '35')
    await findAndPick('염화 수소 · 7647-01-0')
    expect(screen.getByLabelText('CAS No.')).toHaveValue('7647-01-0')
    expect(screen.getByLabelText('유독물질')).toHaveValue('해당')
    expect(screen.getByText('환경공단 정보에 없는 물질이라 46종 표로 판정합니다.')).toBeInTheDocument()
  })

  test('the detail page has no 찾기', async () => {
    renderAt('/reagents/hcl')
    await screen.findByRole('heading', { name: /염화 수소/ })
    expect(screen.queryByRole('button', { name: '찾기' })).not.toBeInTheDocument()
  })
})

describe('reagent detail', () => {
  test('shows this school year\'s records with before and after amounts', async () => {
    renderAt('/reagents/hcl')
    expect(await screen.findByRole('heading', { name: '염화 수소(염산) 35%' })).toBeInTheDocument()
    expect(screen.getByLabelText('학년도')).toHaveValue('2026')
    const rows = within(await screen.findByRole('table', { name: '수불 기록' })).getAllByRole('row').slice(1)
    expect(rows.map((r) => [...r.querySelectorAll('td')].slice(0, 5).map((td) => td.textContent))).toEqual([
      ['2026-03-01', '이월', '', '', '300'],
      ['2026-03-16', '입고', '500', '300', '800'],
      ['2026-04-08', '출고', '50', '800', '750'],
      ['2026-05-13', '출고', '30', '750', '720'],
    ])
  })

  test('a record can be corrected in the dialog', async () => {
    renderAt('/reagents/hcl')
    const row = (await screen.findByRole('cell', { name: '2학년 중화 반응 실험' })).closest('tr')!
    await userEvent.click(within(row).getByRole('button', { name: '고치기' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByLabelText('사용량 (mL)')).toHaveValue(50)
    await userEvent.clear(within(dialog).getByLabelText('사용량 (mL)'))
    await userEvent.type(within(dialog).getByLabelText('사용량 (mL)'), '60')
    await userEvent.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(fake.called('reagentTx.update')[0]).toMatchObject({ id: 't2', changes: { amount: 60 } })
    expect(await screen.findByText('현재 보유량 710 mL')).toBeInTheDocument()
  })

  test('a record can be deleted after confirming; the initial stock has no delete button', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderAt('/reagents/hcl')
    const row = (await screen.findByRole('cell', { name: '3학년 산과 염기' })).closest('tr')!
    await userEvent.click(within(row).getByRole('button', { name: '삭제' }))
    expect(fake.called('reagentTx.delete')).toEqual([{ id: 't3' }])
    await userEvent.selectOptions(screen.getByLabelText('학년도'), '2025')
    const initial = (await screen.findByRole('cell', { name: '기초 재고' })).closest('tr')!
    expect(within(initial).queryByRole('button', { name: '삭제' })).not.toBeInTheDocument()
  })

  test('has history, ledger print and use/delivery buttons', async () => {
    renderAt('/reagents/hcl')
    await screen.findByRole('heading', { name: '염화 수소(염산) 35%' })
    expect(screen.getByRole('button', { name: '이력 보기' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '대장 출력' })).toHaveAttribute('href', '/reagents/ledger?ids=hcl')
    expect(screen.getByRole('button', { name: '사용 기록' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '입고' })).toBeInTheDocument()
  })

  test('saving the form sends only what changed', async () => {
    renderAt('/reagents/hcl')
    const note = await screen.findByLabelText('비고')
    await userEvent.type(note, '갈색병')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(fake.called('reagents.update')).toEqual([{ id: 'hcl', changes: { note: '갈색병' } }])
  })

  test('deleting the reagent goes back to the list', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderAt('/reagents/hcl')
    await userEvent.click(await screen.findByRole('button', { name: '시약 삭제' }))
    expect(fake.called('reagents.delete')).toEqual([{ id: 'hcl' }])
    expect(await screen.findByRole('heading', { name: '시약 목록' })).toBeInTheDocument()
  })
})
