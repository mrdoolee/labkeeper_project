// 학교에서 사용하는 화학물질의 유해화학물질 기준농도 (46종)
// 출처: 경기도교육청 「2025 과학실 안전관리 계획」 부록9 (20쪽).
// 농도(%)가 기준농도 이상이면 해당. null은 원문의 "해당없음".
// 원문 오류 두 곳을 고쳐서 넣었다:
//   14 시안화 칼륨 CAS 97-1-90 → 151-50-8 (원문 번호는 CAS 형식·검사 숫자도 맞지 않음)
//   18 에탄올 화학식 C2H2O → C2H5OH
// 44·45 황산 구리의 CAS는 원문 그대로 둔다(둘 다 기준 1%라 판정은 같다).

export interface HazardRow {
  no: number
  name: string
  formula: string
  cas: string
  /** 유독물질 기준농도(%). null = 해당없음 */
  toxic: number | null
  /** 사고대비물질 기준농도(%). null = 해당없음 */
  accident: number | null
}

export const HAZARD_THRESHOLDS: HazardRow[] = [
  { no: 1, name: '과망가니즈산 칼륨', formula: 'KMnO4', cas: '7722-64-7', toxic: 5, accident: 98 },
  { no: 2, name: '과산화 수소', formula: 'H2O2', cas: '7722-84-1', toxic: 6, accident: 35 },
  { no: 3, name: '구리', formula: 'Cu', cas: '7440-50-8', toxic: null, accident: null },
  { no: 4, name: '나트륨', formula: 'Na', cas: '7440-23-5', toxic: 25, accident: 25 },
  { no: 5, name: '다이크로뮴산 칼륨', formula: 'K2Cr2O7', cas: '7778-50-9', toxic: 0.1, accident: null },
  { no: 6, name: '메탄올', formula: 'CH3OH', cas: '67-56-1', toxic: 10, accident: 85 },
  { no: 7, name: '벤젠', formula: 'C6H6', cas: '71-43-2', toxic: 85, accident: 85 },
  { no: 8, name: '붕산', formula: 'H3BO3', cas: '10043-35-3', toxic: 0.3, accident: null },
  { no: 9, name: '붕소', formula: 'B', cas: '7440-42-8', toxic: null, accident: null },
  { no: 10, name: '수산화 나트륨', formula: 'NaOH', cas: '1310-73-2', toxic: 5, accident: null },
  { no: 11, name: '수산화 암모늄', formula: 'NH4OH', cas: '1336-21-6', toxic: 10, accident: 10 },
  { no: 12, name: '수산화 칼슘', formula: 'Ca(OH)2', cas: '1305-62-0', toxic: null, accident: null },
  { no: 13, name: '수산화 칼륨', formula: 'KOH', cas: '1310-58-3', toxic: 5, accident: null },
  { no: 14, name: '시안화 칼륨', formula: 'KCN', cas: '151-50-8', toxic: 1, accident: null },
  { no: 15, name: '아세톤', formula: 'C3H6O', cas: '67-64-1', toxic: null, accident: null },
  { no: 16, name: '아세트산', formula: 'C2H4O2', cas: '64-19-7', toxic: 25, accident: null },
  { no: 17, name: '암모니아', formula: 'NH3', cas: '7664-41-7', toxic: 10, accident: 10 },
  { no: 18, name: '에탄올', formula: 'C2H5OH', cas: '64-17-5', toxic: null, accident: null },
  { no: 19, name: '염소산 나트륨', formula: 'NaClO3', cas: '7775-09-9', toxic: 25, accident: 98 },
  { no: 20, name: '염화 구리(Ⅰ)', formula: 'CuCl', cas: '7758-89-6', toxic: 1, accident: null },
  { no: 21, name: '염화 구리(Ⅱ)', formula: 'CuCl2', cas: '7447-39-4', toxic: null, accident: null },
  { no: 22, name: '염화 나트륨', formula: 'NaCl', cas: '7647-14-5', toxic: null, accident: null },
  { no: 23, name: '염화 바륨', formula: 'BaCl2', cas: '10361-37-2', toxic: null, accident: null },
  { no: 24, name: '염화 수소(염산)', formula: 'HCl', cas: '7647-01-0', toxic: 10, accident: 10 },
  { no: 25, name: '염화 아연', formula: 'ZnCl2', cas: '7646-85-7', toxic: 25, accident: null },
  { no: 26, name: '아이오딘', formula: 'I2', cas: '7553-56-2', toxic: null, accident: null },
  { no: 27, name: '이산화 망간', formula: 'MnO2', cas: '1313-13-9', toxic: null, accident: null },
  { no: 28, name: '질산', formula: 'HNO3', cas: '7697-37-2', toxic: 10, accident: 10 },
  { no: 29, name: '질산 나트륨', formula: 'NaNO3', cas: '7631-99-4', toxic: null, accident: 98 },
  { no: 30, name: '질산 납', formula: 'Pb(NO3)2', cas: '10099-74-8', toxic: 0.3, accident: null },
  { no: 31, name: '질산 암모늄', formula: 'NH4NO3', cas: '6484-52-2', toxic: null, accident: 33 },
  { no: 32, name: '질산 은', formula: 'AgNO3', cas: '7761-88-8', toxic: 1, accident: null },
  { no: 33, name: '질산 칼륨', formula: 'KNO3', cas: '7757-79-1', toxic: null, accident: 98 },
  { no: 34, name: '탄산 나트륨', formula: 'Na2CO3', cas: '497-19-8', toxic: null, accident: null },
  { no: 35, name: '탄산 바륨', formula: 'BaCO3', cas: '513-77-9', toxic: null, accident: null },
  { no: 36, name: '탄산 칼륨', formula: 'K2CO3', cas: '584-08-7', toxic: null, accident: null },
  { no: 37, name: '탄산 칼슘', formula: 'CaCO3', cas: '471-34-1', toxic: null, accident: null },
  { no: 38, name: '황산', formula: 'H2SO4', cas: '7664-93-9', toxic: 10, accident: 10 },
  { no: 39, name: '황산 바륨', formula: 'BaSO4', cas: '7727-43-7', toxic: null, accident: null },
  { no: 40, name: '황산 아연', formula: 'ZnSO4', cas: '7733-02-0', toxic: 25, accident: null },
  { no: 41, name: '나프탈렌', formula: 'C10H8', cas: '91-20-3', toxic: 25, accident: null },
  { no: 42, name: '산화 구리(Ⅰ)', formula: 'Cu2O', cas: '1317-39-1', toxic: 1, accident: null },
  { no: 43, name: '산화 구리(Ⅱ)', formula: 'CuO', cas: '1317-38-0', toxic: 1, accident: null },
  { no: 44, name: '황산 구리(Ⅰ)', formula: 'Cu2SO4', cas: '7758-98-7', toxic: 1, accident: null },
  { no: 45, name: '황산 구리(Ⅱ)', formula: 'CuSO4', cas: '7758-99-8', toxic: 1, accident: null },
  { no: 46, name: '염화 은', formula: 'AgCl', cas: '7783-90-6', toxic: 1, accident: null },
]
