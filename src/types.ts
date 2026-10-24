import type { AssuntosExtras } from './assuntos'
import type { AtaExtraida, AtaRenderizada, MeetingMetadata, Pessoa, TranscriptSegment } from './ata-api'

export const MODELOS = [
  { id: 'gemini-3.8-flash', nome: 'Gemini 3.8 Flash (padrão)' },
  { id: 'gemini-3.6-flash', nome: 'Gemini 3.6 Flash' },
  { id: 'gemini-3.5-flash-lite', nome: 'Gemini 3.5 Flash-Lite (mais leve)' },
] as const
export const MODELO_PADRAO = MODELOS[0].id

export type Settings = {
  apiKey: string
  modelo: string
  escola: string
  rede: string
  municipioUf: string
  local: string
  /** professores e funcionários cadastrados (cargo incluso) */
  pessoas: Pessoa[]
  glossario: string
  /** assuntos próprios da escola, somados às sugestões padrão de cada tipo de ata */
  assuntosExtras: AssuntosExtras
}

export const SETTINGS_PADRAO: Settings = {
  apiKey: '',
  modelo: MODELO_PADRAO,
  escola: '',
  rede: '',
  municipioUf: '',
  local: 'sala dos professores',
  pessoas: [],
  glossario: '',
  assuntosExtras: {},
}

export type AtaStatus = 'rascunho' | 'processando' | 'transcricao' | 'ata' | 'erro'

export type AtaRecord = {
  id: string
  criadaEm: number
  atualizadaEm: number
  status: AtaStatus
  erro?: string
  meta: MeetingMetadata
  audioNome?: string
  transcript?: TranscriptSegment[]
  extraida?: AtaExtraida
  renderizada?: AtaRenderizada
  /** texto final editado pela usuária (substitui renderizada.texto) */
  textoEditado?: string
  /** nomes (normalizados) de quem foi convocado na Nova ata; só eles aparecem como ausentes */
  convocados?: string[]
}
