import { GoogleGenAI, createPartFromUri, createUserContent, FileState } from '@google/genai'
import {
  ataResponseSchema, buildAtaPrompt, buildTranscriptionPrompt, transcriptResponseSchema,
  type AtaExtraida, type MeetingMetadata, type TranscriptSegment,
} from './ata-api'

export type GeminiErrorKind = 'cota' | 'chave' | 'sobrecarga' | 'rede' | 'conteudo' | 'outro'

export class GeminiError extends Error {
  kind: GeminiErrorKind
  constructor(kind: GeminiErrorKind, message: string) {
    super(message)
    this.kind = kind
  }
}

export const FAIXA_MINUTOS = 20
/** acima disso a transcrição é pedida por faixas de tempo */
export const LIMITE_SEM_FAIXAS_MIN = 60

const MIME_POR_EXT: Record<string, string> = {
  mp3: 'audio/mp3', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', webm: 'audio/webm', aac: 'audio/aac',
}
export const EXTENSOES_AUDIO = Object.keys(MIME_POR_EXT)

export function mimeDoAudio(file: { name: string; type: string }): string {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (MIME_POR_EXT[ext]) return MIME_POR_EXT[ext]
  if (file.type.startsWith('audio/') || file.type === 'video/webm') return file.type
  throw new GeminiError('conteudo', `Formato de áudio não aceito (${ext || file.type}). Use mp3, m4a, wav, ogg, webm ou aac.`)
}

export function traduzirErro(e: unknown): GeminiError {
  if (e instanceof GeminiError) return e
  const msg = e instanceof Error ? e.message : String(e)
  const status = (e as { status?: number })?.status
  if (status === 429 || /RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(msg)) {
    return new GeminiError('cota',
      'Limite do plano gratuito do Gemini atingido (muitas requisições ou o limite do dia). ' +
      'Aguarde alguns minutos e tente de novo; se persistir, tente amanhã (a cota diária zera à meia-noite do horário do Pacífico) ou troque o modelo em Configurações.')
  }
  if (status === 401 || status === 403 || /API key|API_KEY_INVALID|PERMISSION_DENIED/i.test(msg)) {
    return new GeminiError('chave', 'A chave da API foi recusada. Confira se ela foi copiada inteira em Configurações.')
  }
  if (status === 503 || status === 500 || /overloaded|UNAVAILABLE/i.test(msg)) {
    return new GeminiError('sobrecarga', 'O Gemini está sobrecarregado no momento. Tente novamente em alguns minutos.')
  }
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
    return new GeminiError('rede', 'Sem conexão com o Gemini. Verifique a internet e tente de novo.')
  }
  return new GeminiError('outro', `Erro do Gemini: ${msg.slice(0, 300)}`)
}

const dormir = (ms: number) => new Promise(r => setTimeout(r, ms))

/** repete em caso de sobrecarga/rede; cota e chave falham de imediato */
async function comRetry<T>(fn: () => Promise<T>, tentativas = 3): Promise<T> {
  let ultimo: GeminiError | undefined
  for (let i = 0; i < tentativas; i++) {
    try {
      return await fn()
    } catch (e) {
      ultimo = traduzirErro(e)
      if (ultimo.kind !== 'sobrecarga' && ultimo.kind !== 'rede') throw ultimo
      await dormir(2000 * 2 ** i)
    }
  }
  throw ultimo!
}

export function parseJsonResposta<T>(text: string | undefined, finishReason?: string): T {
  if (!text) {
    throw new GeminiError('conteudo', 'O Gemini não devolveu texto (o conteúdo pode ter sido bloqueado). Tente novamente.')
  }
  try {
    return JSON.parse(text) as T
  } catch {
    const cortado = finishReason === 'MAX_TOKENS'
    throw new GeminiError('conteudo', cortado
      ? 'A resposta do Gemini foi cortada por ser longa demais. Para áudios longos, tente de novo (a transcrição é feita por faixas).'
      : 'O Gemini devolveu uma resposta fora do formato esperado. Tente novamente.')
  }
}

export function mmssParaSegundos(t: string): number {
  const p = t.split(':').map(Number)
  if (p.some(Number.isNaN)) return 0
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : (p[0] ?? 0) * 60 + (p[1] ?? 0)
}
export const minutosParaMmss = (min: number) => `${String(min).padStart(2, '0')}:00`

export function faixasDeTempo(duracaoMin: number): { inicio: string; fim: string }[] {
  const faixas: { inicio: string; fim: string }[] = []
  for (let ini = 0; ini < duracaoMin; ini += FAIXA_MINUTOS) {
    faixas.push({ inicio: minutosParaMmss(ini), fim: minutosParaMmss(Math.min(ini + FAIXA_MINUTOS, Math.ceil(duracaoMin))) })
  }
  return faixas
}

/** duração em minutos lida do próprio navegador; null se não der para ler */
export function duracaoDoAudioMin(file: File): Promise<number | null> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file)
    const a = new Audio()
    const fim = (v: number | null) => { URL.revokeObjectURL(url); resolve(v) }
    a.preload = 'metadata'
    a.onloadedmetadata = () => fim(Number.isFinite(a.duration) ? a.duration / 60 : null)
    a.onerror = () => fim(null)
    setTimeout(() => fim(null), 8000)
    a.src = url
  })
}

export type Progresso = (etapa: string, fracao: number) => void

export async function transcreverAudio(opts: {
  apiKey: string
  modelo: string
  meta: MeetingMetadata
  file: File
  onProgress?: Progresso
  ai?: GoogleGenAI
}): Promise<TranscriptSegment[]> {
  const { apiKey, modelo, meta, file, onProgress = () => {} } = opts
  const ai = opts.ai ?? new GoogleGenAI({ apiKey })
  const mimeType = mimeDoAudio(file)
  let nomeArquivo: string | undefined
  try {
    onProgress('Enviando o áudio ao Gemini…', 0.05)
    const up = await comRetry(() => ai.files.upload({ file, config: { mimeType, displayName: 'ata-reuniao' } }))
    nomeArquivo = up.name
    let f = up
    for (let i = 0; f.state === FileState.PROCESSING && i < 90; i++) {
      onProgress('Preparando o áudio…', 0.15)
      await dormir(2000)
      f = await ai.files.get({ name: nomeArquivo! })
    }
    if (f.state === FileState.FAILED) throw new GeminiError('conteudo', 'O Gemini não conseguiu processar este arquivo de áudio.')
    if (f.state !== FileState.ACTIVE || !f.uri) throw new GeminiError('outro', 'O áudio demorou demais para ficar pronto. Tente de novo.')

    const dur = await duracaoDoAudioMin(file)
    const faixas = dur && dur > LIMITE_SEM_FAIXAS_MIN ? faixasDeTempo(dur) : [undefined]
    const todos: TranscriptSegment[] = []
    for (let i = 0; i < faixas.length; i++) {
      onProgress(faixas.length > 1 ? `Transcrevendo (parte ${i + 1} de ${faixas.length})…` : 'Transcrevendo…', 0.2 + 0.75 * (i / faixas.length))
      const resp = await comRetry(() => ai.models.generateContent({
        model: modelo,
        contents: createUserContent([createPartFromUri(f.uri!, f.mimeType ?? mimeType), buildTranscriptionPrompt(meta, faixas[i])]),
        config: { responseMimeType: 'application/json', responseSchema: transcriptResponseSchema as never, temperature: 0.1 },
      }))
      todos.push(...parseJsonResposta<TranscriptSegment[]>(resp.text, resp.candidates?.[0]?.finishReason))
    }
    onProgress('Transcrição pronta', 1)
    return todos
  } catch (e) {
    throw traduzirErro(e)
  } finally {
    if (nomeArquivo) ai.files.delete({ name: nomeArquivo }).catch(() => {})
  }
}

export async function gerarAta(opts: {
  apiKey: string
  modelo: string
  meta: MeetingMetadata
  transcript: TranscriptSegment[]
  ai?: GoogleGenAI
}): Promise<AtaExtraida> {
  const ai = opts.ai ?? new GoogleGenAI({ apiKey: opts.apiKey })
  const { systemInstruction, userPrompt } = buildAtaPrompt(opts.meta, opts.transcript)
  try {
    const resp = await comRetry(() => ai.models.generateContent({
      model: opts.modelo,
      contents: userPrompt,
      config: { systemInstruction, responseMimeType: 'application/json', responseSchema: ataResponseSchema as never, temperature: 0.2 },
    }))
    return parseJsonResposta<AtaExtraida>(resp.text, resp.candidates?.[0]?.finishReason)
  } catch (e) {
    throw traduzirErro(e)
  }
}

export async function testarChave(apiKey: string, modelo: string): Promise<void> {
  const ai = new GoogleGenAI({ apiKey })
  try {
    await ai.models.generateContent({ model: modelo, contents: 'Responda apenas: ok' })
  } catch (e) {
    throw traduzirErro(e)
  }
}
