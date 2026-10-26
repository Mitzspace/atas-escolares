import type { AssuntosExtras } from './assuntos'
import type { AtaExtraida, AtaRenderizada, MeetingMetadata, Pessoa, TranscriptSegment, Anotacao, ModoRegistro, ResumoAta } from './ata-api'

export const MODELOS = [
  { id: 'gemini-3.8-flash', nome: 'Gemini 3.8 Flash (padrão, melhor qualidade)' },
  { id: 'gemini-3.6-flash', nome: 'Gemini 3.6 Flash' },
  { id: 'gemini-3.5-flash', nome: 'Gemini 3.5 Flash' },
  { id: 'gemini-3.5-flash-lite', nome: 'Gemini 3.5 Flash-Lite — mais econômico (usado automaticamente se a cota acabar)' },
  { id: 'gemini-flash-lite-latest', nome: 'Gemini Flash-Lite Latest — mais econômico (usado automaticamente se a cota acabar)' },
] as const
export const MODELO_PADRAO = MODELOS[0].id

export type ProvedorId = 'groq' | 'gemini'
export const MODELOS_GROQ = [
  { id: 'openai/gpt-oss-120b', nome: 'GPT-OSS 120B (padrão, maior capacidade)' },
  { id: 'qwen/qwen3.8-27b', nome: 'Qwen 3.8 27B' },
  { id: 'openai/gpt-oss-20b', nome: 'GPT-OSS 20B (mais rápido)' },
] as const
export const MODELO_GROQ_PADRAO = MODELOS_GROQ[0].id
export const MODELOS_TRANSCRICAO_GROQ = [
  { id: 'whisper-large-v3', nome: 'Whisper Large V3 (padrão, maior precisão)' },
  { id: 'whisper-large-v3-turbo', nome: 'Whisper Large V3 Turbo (mais rápido)' },
] as const
export type TipoErroProvedor = 'cota' | 'chave' | 'sobrecarga' | 'rede' | 'conteudo' | 'outro'
export class ErroProvedor extends Error {
  constructor(public kind: TipoErroProvedor, message: string) { super(message) }
}

export type Settings = {
  /** Última exportação concluída neste aparelho, em milissegundos. */
  ultimoBackupEm?: number
  /** Legado: preferências atuais são independentes por etapa. */
  provedorPreferido: ProvedorId
  provedorTranscricaoPreferido: ProvedorId
  provedorRedacaoPreferido: ProvedorId
  groqApiKey: string
  modeloGroq: string
  modeloTranscricaoGroq: string
  /** Chave Gemini legada, mantida para compatibilidade. */
  apiKey: string
  modelo: string
  escola: string
  /** PNG normalizado (até 512 px) como dataURL; vazio usa a identidade padrão. */
  logoEscola?: string
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
  provedorPreferido: 'groq',
  provedorTranscricaoPreferido: 'groq',
  provedorRedacaoPreferido: 'gemini',
  groqApiKey: '',
  modeloGroq: MODELO_GROQ_PADRAO,
  modeloTranscricaoGroq: MODELOS_TRANSCRICAO_GROQ[0].id,
  apiKey: '',
  modelo: MODELO_PADRAO,
  escola: 'Escola Municipal Professora Luiza Maria de Souza',
  logoEscola: '',
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
  modoRegistro?: ModoRegistro
  anotacoes?: Anotacao[]
  resumo?: ResumoAta
  /** Estado editorial independente do processamento: sem data, é Rascunho; com data, Finalizada. */
  finalizadaEm?: number
  /** Datas em que uma ata finalizada foi reaberta para correção. */
  reabertaEm?: number[]
  erro?: string
  meta: MeetingMetadata
  audioNome?: string
  transcript?: TranscriptSegment[]
  provedorTranscricao?: ProvedorId
  modeloTranscricao?: string
  provedorRedacao?: ProvedorId
  /** Modelo que efetivamente redigiu o corpo da ata, após os fallbacks. */
  modeloRedacao?: string
  extraida?: AtaExtraida
  renderizada?: AtaRenderizada
  /** texto final editado pela usuária (substitui renderizada.texto) */
  textoEditado?: string
  /** nomes (normalizados) de quem foi convocado na Nova ata; só eles aparecem como ausentes */
  convocados?: string[]
}

export type BackupAtas = {
  formato: 'atas-escolares'
  versao: 1
  criadoEm: string
  configuracoes: Partial<Omit<Settings, 'ultimoBackupEm'>>
  atas: AtaRecord[]
}

export type OpcoesRestauracao = {
  modo: 'juntar' | 'substituir'
  substituirConfiguracoes: boolean
  incluirChaves: boolean
}
