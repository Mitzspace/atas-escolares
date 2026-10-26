import {
  aplicarFalantes, buildFalantesPrompt, ehFalanteGenerico, falantesResponseSchema, incorporarAnotacoes, nomesParaFalantes,
  type Anotacao, type AtaExtraida, type AtribuicaoFalante, type MeetingMetadata, type Participante, type TranscriptSegment,
} from './ata-api'
import { estimarTokens } from './groq-limites'
import { gerarAta, gerarJsonGemini, transcreverAudio, traduzirErro, type Progresso } from './gemini'
import { gerarJsonGroq, LIMITE_AUDIO_GROQ_BYTES, redigirGroq, transcreverGroq } from './groq'
import { ErroProvedor, type ProvedorId, type Settings } from './types'

export type ResultadoProvedor<T> = { dados: T; provedor: ProvedorId; modelo: string }
export type OpcoesComuns = { settings: Settings; meta: MeetingMetadata; onProgress?: Progresso }
export type OpcoesTranscricao = OpcoesComuns & { file: File }
export type OpcoesRedacao = OpcoesComuns & { transcript: TranscriptSegment[]; anotacoes?: Anotacao[] }
export interface Provedor {
  id: ProvedorId
  transcrever(opts: OpcoesTranscricao): Promise<ResultadoProvedor<TranscriptSegment[]>>
  redigir(opts: OpcoesRedacao): Promise<ResultadoProvedor<AtaExtraida>>
}
const progressoGemini = (onProgress?: Progresso, grande = false): Progresso => (etapa, fracao, modelo) => onProgress?.(`${grande ? 'Áudio acima de 25 MB: usando Gemini' : 'Gemini'} · ${etapa}`, fracao, modelo, 'gemini')
export const provedores: Record<ProvedorId, Provedor> = {
  groq: {
    id: 'groq',
    async transcrever({ settings, file, onProgress }) {
      const resultado = await transcreverGroq({ apiKey: settings.groqApiKey, modelo: settings.modeloTranscricaoGroq, file, onProgress })
      return { dados: resultado.transcript, provedor: 'groq', modelo: resultado.modeloUsado }
    },
    async redigir({ settings, meta, transcript, anotacoes, onProgress }) {
      const resultado = await redigirGroq({ apiKey: settings.groqApiKey, modelo: settings.modeloGroq, meta, transcript, anotacoes, onProgress })
      return { dados: resultado.extraida, provedor: 'groq', modelo: resultado.modeloUsado }
    },
  },
  gemini: {
    id: 'gemini',
    async transcrever({ settings, meta, file, onProgress }) {
      const modelos = new Set<string>()
      const dados = await transcreverAudio({ apiKey: settings.apiKey, modelo: settings.modelo, meta, file,
        onProgress: progressoGemini(onProgress, file.size > LIMITE_AUDIO_GROQ_BYTES), onModeloUsado: modelo => modelos.add(modelo) })
      return { dados, provedor: 'gemini', modelo: [...modelos].join(', ') }
    },
    async redigir({ settings, meta, transcript, anotacoes, onProgress }) {
      const resultado = await gerarAta({ apiKey: settings.apiKey, modelo: settings.modelo, meta, transcript, anotacoes, onProgress: progressoGemini(onProgress) })
      return { dados: resultado.extraida, provedor: 'gemini', modelo: resultado.modeloUsado }
    },
  },
}

async function comReserva<T>(opts: OpcoesComuns, executar: (provedor: Provedor) => Promise<ResultadoProvedor<T>>, preferido: ProvedorId) {
  const { settings, onProgress } = opts
  const ordem: ProvedorId[] = preferido === 'groq' ? ['groq', 'gemini'] : ['gemini', 'groq']
  const disponiveis = ordem.filter(id => (id === 'groq' ? settings.groqApiKey : settings.apiKey)?.trim())
  if (!disponiveis.length) throw new ErroProvedor('chave', 'Cole uma chave do Groq ou do Gemini em Configurações antes de começar.')
  const falhas: string[] = []
  let ultimo: ErroProvedor | undefined
  for (const id of disponiveis) {
    const nome = id === 'groq' ? 'Groq' : 'Gemini'
    onProgress?.(`${falhas.length ? 'Tentando a reserva: ' : 'Conectando a '}${nome}…`, 0.05, undefined, id)
    try { return await executar(provedores[id]) }
    catch (e) {
      const erro = e instanceof ErroProvedor ? e : traduzirErro(e)
      if (!['cota', 'sobrecarga', 'rede'].includes(erro.kind)) throw new ErroProvedor(erro.kind, `${nome}: ${erro.message}`)
      ultimo = erro
      falhas.push(`${nome}: ${erro.message}`)
    }
  }
  throw new ErroProvedor(ultimo!.kind, `Não foi possível concluir com os provedores configurados. ${falhas.join(' ')}`)
}
export const transcreverComProvedores = (opts: OpcoesTranscricao) => {
  const configuracao = opts.file.size > LIMITE_AUDIO_GROQ_BYTES && opts.settings.apiKey.trim()
    ? { ...opts, settings: { ...opts.settings, provedorTranscricaoPreferido: 'gemini' as const } } : opts
  return comReserva(configuracao, provedor => provedor.transcrever(configuracao), configuracao.settings.provedorTranscricaoPreferido ?? 'groq')
}
/**
 * Redige com reserva entre provedores. Com anotações, confere por código que todas entraram no corpo
 * (`incorporarAnotacoes`): modelo menor pode ignorá-las, e nenhuma anotação pode se perder.
 */
export const redigirComProvedores = async (opts: OpcoesRedacao) => {
  const r = await comReserva(opts, provedor => provedor.redigir(opts), opts.settings.provedorRedacaoPreferido ?? 'gemini')
  return opts.anotacoes?.length ? { ...r, dados: incorporarAnotacoes(r.dados, opts.anotacoes, opts.meta).extraida } : r
}

// ------------------------------------------------------------------ registro com anotações

const temTexto = (anotacoes?: Anotacao[]) => !!anotacoes?.some(a => a.texto.trim())

/**
 * Modo Digitar + "Organizar com IA": as anotações viram a ata formal (ortografia corrigida, sem inventar).
 * Devolve o corpo (`AtaExtraida`); o chamador faz `anonimizarAtaExtraida` e `renderAta(meta, extraida)`.
 * `pipeline.rodarGeracaoAta` já faz tudo isso e grava no banco.
 */
export async function organizarAnotacoesComIA(opts: OpcoesComuns & { anotacoes: Anotacao[] }) {
  if (!temTexto(opts.anotacoes)) throw new ErroProvedor('conteudo', 'Escreva as anotações da reunião antes de organizar com IA.')
  return redigirComProvedores({ ...opts, transcript: [] })
}

/** Modo Gravar e digitar: transcrição + anotações (anotações têm prioridade; divergências viram [confirmar: ...]). */
export function gerarAtaComAnotacoes(opts: OpcoesComuns & { transcript: TranscriptSegment[]; anotacoes: Anotacao[] }) {
  return redigirComProvedores(opts)
}

// ------------------------------------------------------------------ identificação de falantes

export type ResultadoFalantes = {
  dados: TranscriptSegment[]
  /** ausentes quando a etapa foi dispensada (nada a identificar) */
  provedor?: ProvedorId
  modelo?: string
  /** trechos que ganharam um nome */
  identificados: number
  /** trechos que seguem como "Falante não identificado" */
  naoIdentificados: number
}

const TEXTO_MAX_NO_PROMPT = 500
/** orçamento de tokens de trechos por chamada (o Groq limita a entrada a ~5 mil tokens no total) */
const ORCAMENTO_TRECHOS: Record<ProvedorId, number> = { gemini: 12000, groq: 2400 }

function blocosDeTrechos(segmentos: TranscriptSegment[], orcamento: number) {
  const blocos: { n: number; speaker: string; start: string; text: string }[][] = []
  let atual: (typeof blocos)[number] = []
  let tokens = 0
  segmentos.forEach((s, i) => {
    const t = { n: i + 1, speaker: s.speaker, start: s.start, text: s.text.slice(0, TEXTO_MAX_NO_PROMPT) }
    const custo = estimarTokens(t) + 4
    if (atual.length && tokens + custo > orcamento) { blocos.push(atual); atual = []; tokens = 0 }
    atual.push(t); tokens += custo
  })
  if (atual.length) blocos.push(atual)
  return blocos
}

async function atribuirComProvedor(id: ProvedorId, opts: { settings: Settings; segmentos: TranscriptSegment[]; nomes: string[]; onProgress?: Progresso }) {
  const { settings, segmentos, nomes, onProgress } = opts
  const blocos = blocosDeTrechos(segmentos, ORCAMENTO_TRECHOS[id])
  const atribuicoes: AtribuicaoFalante[] = []
  const modelos = new Set<string>()
  for (let i = 0; i < blocos.length; i++) {
    const { systemInstruction, userPrompt } = buildFalantesPrompt(nomes, blocos[i])
    const etapa = `Identificando falantes${blocos.length > 1 ? ` (parte ${i + 1} de ${blocos.length})` : ''}`
    const progresso: Progresso = (e, f, m) => onProgress?.(e, 0.2 + 0.7 * ((i + f) / blocos.length), m, id)
    const r = id === 'groq'
      ? await gerarJsonGroq<{ atribuicoes: AtribuicaoFalante[] }>({ apiKey: settings.groqApiKey, modelo: settings.modeloGroq, systemInstruction, userPrompt, schema: falantesResponseSchema, nome: 'falantes', etapa, onProgress: progresso })
      : await gerarJsonGemini<{ atribuicoes: AtribuicaoFalante[] }>({ apiKey: settings.apiKey, modelo: settings.modelo, systemInstruction, userPrompt, schema: falantesResponseSchema, etapa, onProgress: progresso })
    atribuicoes.push(...(Array.isArray(r.dados?.atribuicoes) ? r.dados.atribuicoes : []))
    modelos.add(r.modeloUsado)
  }
  return { dados: aplicarFalantes(segmentos, atribuicoes, nomes, 1), provedor: id, modelo: [...modelos].join(', ') }
}

/**
 * Etapa de identificação de falantes, depois da transcrição (o Groq Whisper não separa falantes; o
 * `gemini-3.5-transcribe` só diariza quando recebe o áudio, o que não ocorre aqui).
 * Passada de LLM sobre os trechos (Gemini se houver chave; senão Groq; um serve de reserva do outro).
 * Só atribui nome da lista de participantes (presentes, presidente, secretário, orientados) com citação que comprove;
 * trechos que já têm nome são mantidos; todo o resto vira `FALANTE_NAO_IDENTIFICADO`.
 * Lança `ErroProvedor` se os provedores falharem: o pipeline trata como não fatal e mantém a transcrição.
 */
export async function identificarFalantes(
  segmentos: TranscriptSegment[],
  participantes: Participante[],
  opts: OpcoesComuns,
): Promise<ResultadoFalantes> {
  const pendentes = segmentos.filter(s => ehFalanteGenerico(s.speaker)).length
  // um trecho só (texto não segmentado) não tem o que separar
  if (segmentos.length < 2 || !pendentes) return { dados: segmentos, identificados: 0, naoIdentificados: 0 }
  const nomes = nomesParaFalantes(opts.meta, participantes)
  const r = await comReserva(opts, async provedor => {
    const { dados, modelo } = await atribuirComProvedor(provedor.id, { settings: opts.settings, segmentos, nomes, onProgress: opts.onProgress })
    return { dados, provedor: provedor.id, modelo }
  }, 'gemini')
  const naoIdentificados = r.dados.filter(s => ehFalanteGenerico(s.speaker)).length
  return { dados: r.dados, provedor: r.provedor, modelo: r.modelo, identificados: pendentes - naoIdentificados, naoIdentificados }
}
