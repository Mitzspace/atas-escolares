import { GoogleGenAI, createPartFromUri, createUserContent, FileState, type GenerateContentResponse } from '@google/genai'
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

// tipos aceitos pelo Gemini (ai.google.dev/gemini-api/docs/audio): audio/mp4 NÃO está na lista, m4a vai como audio/m4a
const MIME_POR_EXT: Record<string, string> = {
  mp3: 'audio/mp3', m4a: 'audio/m4a', mp4: 'audio/m4a', wav: 'audio/wav', ogg: 'audio/ogg', webm: 'audio/webm',
  aac: 'audio/aac', flac: 'audio/flac', opus: 'audio/opus',
}
export const EXTENSOES_AUDIO = Object.keys(MIME_POR_EXT)

export function mimeDoAudio(file: { name: string; type: string }): string {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (MIME_POR_EXT[ext]) return MIME_POR_EXT[ext]
  const tipo = file.type.split(';')[0].trim().toLowerCase()
  if (tipo === 'audio/mp4') return 'audio/m4a'
  if (tipo === 'video/webm') return 'audio/webm'
  if (tipo.startsWith('audio/')) return tipo
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
async function comRetry<T>(fn: () => Promise<T>, tentativas = 3, onTentativa?: (tentativa: number) => void): Promise<T> {
  let ultimo: GeminiError | undefined
  for (let i = 0; i < tentativas; i++) {
    try {
      onTentativa?.(i + 1)
      return await fn()
    } catch (e) {
      ultimo = traduzirErro(e)
      if (ultimo.kind !== 'sobrecarga' && ultimo.kind !== 'rede') throw ultimo
      if (i < tentativas - 1) await dormir(2000 * 2 ** i)
    }
  }
  throw ultimo!
}

/** Cota ou sobrecarga esgotada permitem trocar o modelo; upload não usa fallback. */
async function comFallback<T>(
  modelo: string,
  fn: (modelo: string) => Promise<T>,
  onTentativa: (modelo: string, tentativa: number, fallback: boolean) => void,
  prioritarios: string[] = [],
): Promise<T> {
  const modelos = [...new Set([...prioritarios, modelo, 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-flash-latest'])]
  for (let i = 0; i < modelos.length; i++) {
    const atual = modelos[i]
    try {
      return await comRetry(() => fn(atual), 3, tentativa => onTentativa(atual, tentativa, i > 0))
    } catch (e) {
      const erro = traduzirErro(e)
      if (erro.kind !== 'sobrecarga' && erro.kind !== 'cota') throw erro
      if (i === modelos.length - 1) {
        throw new GeminiError(erro.kind, `${erro.message} Modelos tentados: ${modelos.join(', ')}.`)
      }
    }
  }
  throw new GeminiError('sobrecarga', 'Nenhum modelo disponível no momento.')
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

/** O modelo dedicado devolve texto corrido, sem diarização ou marcações de tempo. */
export function parseTranscricaoDedicada(resp: GenerateContentResponse): TranscriptSegment[] {
  const textos = resp.candidates?.[0]?.content?.parts
    ?.map(part => part.audioTranscription?.text)
    .filter((texto): texto is string => typeof texto === 'string' && !!texto.trim())
  if (!textos?.length) {
    throw new GeminiError('conteudo', 'O modelo de transcrição não devolveu texto em audioTranscription.text. Tente novamente.')
  }
  return [{
    speaker: 'Falante 1 (texto não segmentado; falantes e tempos não identificados)',
    start: '00:00', end: '00:00', text: textos.join('\n'),
  }]
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
      const etapa = faixas.length > 1 ? `Transcrevendo (parte ${i + 1} de ${faixas.length})` : 'Transcrevendo'
      // O dedicado transcreve o arquivo inteiro; só é tentado antes da primeira faixa.
      const modeloDaFaixa = i > 0 && modelo === 'gemini-3.5-transcribe' ? 'gemini-3.6-flash' : modelo
      const { resp, dedicado } = await comFallback(modeloDaFaixa, async atual => {
        const dedicado = atual === 'gemini-3.5-transcribe'
        const audio = createPartFromUri(f.uri!, f.mimeType ?? mimeType)
        const resp = await ai.models.generateContent({
          model: atual,
          contents: createUserContent(dedicado ? [audio] : [audio, buildTranscriptionPrompt(meta, faixas[i])]),
          ...(dedicado ? {} : {
            config: { responseMimeType: 'application/json', responseSchema: transcriptResponseSchema as never, temperature: 0.1 },
          }),
        })
        return { resp, dedicado }
      }, (atual, tentativa, fallback) => onProgress(
        `${etapa} — ${atual} · tentativa ${tentativa}/3${fallback ? ' (modelo alternativo)' : ''}…`,
        0.2 + 0.75 * (i / faixas.length),
      ), i === 0 ? ['gemini-3.5-transcribe'] : [])
      todos.push(...(dedicado
        ? parseTranscricaoDedicada(resp)
        : parseJsonResposta<TranscriptSegment[]>(resp.text, resp.candidates?.[0]?.finishReason)))
      if (dedicado) break
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
  onProgress?: Progresso
  ai?: GoogleGenAI
}): Promise<AtaExtraida> {
  const ai = opts.ai ?? new GoogleGenAI({ apiKey: opts.apiKey })
  const { systemInstruction, userPrompt } = buildAtaPrompt(opts.meta, opts.transcript)
  try {
    const resp = await comFallback(opts.modelo, atual => ai.models.generateContent({
      model: atual,
      contents: userPrompt,
      config: { systemInstruction, responseMimeType: 'application/json', responseSchema: ataResponseSchema as never, temperature: 0.2 },
    }), (atual, tentativa, fallback) => opts.onProgress?.(
      `Redigindo a ata — ${atual} · tentativa ${tentativa}/3${fallback ? ' (modelo alternativo)' : ''}…`, 0.3,
    ))
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
