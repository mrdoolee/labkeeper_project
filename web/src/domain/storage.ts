// Storage classes and cabinet types (design 7-4). The ids must match
// gas/src/Schema.js (CABINET_TYPE_IDS, STORAGE_CLASS_IDS).

export type StorageClassId =
  | 'inorganic_acid'
  | 'organic_acid'
  | 'base'
  | 'reactive_inorganic'
  | 'metal'
  | 'flammable'
  | 'general_inorganic'
  | 'general_organic'

export const STORAGE_CLASSES: { id: StorageClassId; label: string; examples: string }[] = [
  { id: 'inorganic_acid', label: '무기산', examples: '염산, 황산, 질산, 인산' },
  { id: 'organic_acid', label: '유기산', examples: '아세트산(빙초산), 로르산' },
  { id: 'base', label: '염기', examples: '수산화 나트륨·칼륨·칼슘·바륨, 암모니아수' },
  {
    id: 'reactive_inorganic',
    label: '위험이 높은 무기화합물(산화제 포함)',
    examples: '과망가니즈산칼륨, 질산칼륨, 질산은, 과산화수소, 아이오딘, 아이오딘화칼륨, 아질산나트륨, 브로민, 염소산칼륨, 다이크로뮴산칼륨',
  },
  { id: 'metal', label: '금속·물반응성', examples: '나트륨·칼륨·리튬(석유 속 보관), 마그네슘, 철가루, 아연, 구리, 황린(물속 보관)' },
  { id: 'flammable', label: '인화성·휘발성', examples: '에탄올, 메탄올, 아세톤, 에테르, 헥산, 황가루' },
  { id: 'general_inorganic', label: '일반 무기화합물', examples: '탄산칼슘, 염화칼륨, 황산구리, 염화칼슘, 이산화망가니즈' },
  { id: 'general_organic', label: '일반 유기화합물·지시약', examples: '포도당, 녹말, 한천, 페놀프탈레인·BTB 등 지시약 용액' },
]

export type CabinetType = 'sealed' | 'flammable' | 'general' | 'waste' | 'equipment' | 'fridge'

export const CABINET_TYPES: { id: CabinetType; label: string; defaultClasses: StorageClassId[] }[] = [
  { id: 'sealed', label: '밀폐형 약품장', defaultClasses: ['inorganic_acid', 'organic_acid', 'base', 'reactive_inorganic', 'metal'] },
  { id: 'flammable', label: '가연성 물질 전용 보관장', defaultClasses: ['flammable'] },
  { id: 'general', label: '일반 약품 보관장', defaultClasses: ['general_inorganic', 'general_organic'] },
  { id: 'waste', label: '폐수·폐시약 보관장', defaultClasses: [] },
  { id: 'equipment', label: '교구장', defaultClasses: [] },
  { id: 'fridge', label: '냉장고', defaultClasses: [] },
]

export interface ZoneRow {
  id?: string
  cabinetId: string
  row: number
  col: number
  name: string
  allowedClasses: string
  deleted?: boolean
}

export function zoneName(row: number, col: number): string {
  return `${row}단 ${col}칸`
}

/** What to create and remove so a cabinet's zones match its rows × cols grid. */
export function planZones(
  cabinet: { id: string; type: CabinetType; rows: number; cols: number },
  existing: ZoneRow[],
): { create: ZoneRow[]; remove: string[] } {
  const live = existing.filter((z) => !z.deleted)
  const taken = new Set(live.map((z) => `${z.row}:${z.col}`))
  const defaults = (CABINET_TYPES.find((t) => t.id === cabinet.type)?.defaultClasses ?? []).join(',')
  const create: ZoneRow[] = []
  for (let row = 1; row <= cabinet.rows; row++)
    for (let col = 1; col <= cabinet.cols; col++)
      if (!taken.has(`${row}:${col}`))
        create.push({ cabinetId: cabinet.id, row, col, name: zoneName(row, col), allowedClasses: defaults })
  const remove = live.filter((z) => z.row > cabinet.rows || z.col > cabinet.cols).map((z) => z.id as string)
  return { create, remove }
}

/** Zones for a copied cabinet: same names, classes and positions. */
export function copyZones(source: ZoneRow[], newCabinetId: string): ZoneRow[] {
  return source
    .filter((z) => !z.deleted)
    .map((z) => ({ cabinetId: newCabinetId, row: z.row, col: z.col, name: z.name, allowedClasses: z.allowedClasses }))
}
