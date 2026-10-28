// 화학물질 정보 찾기 (gas/src/Chem.js): data.go.kr through the school's GAS.
import { callApi } from './client'

export interface ChemCandidate {
  name: string
  casNo: string
}

export interface ChemClass {
  type: string
  content: string
  exception: string
}

export type ChemInfo = { found: false } | { found: true; casNo: string; name: string; formula: string; classes: ChemClass[] }

export const chemApi = {
  search: (query: string) => callApi<{ items: ChemCandidate[] }>('chem.search', { query }),
  info: (casNo: string) => callApi<ChemInfo>('chem.info', { casNo }),
}
