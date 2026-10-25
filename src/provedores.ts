import type { AtaExtraida, MeetingMetadata, TranscriptSegment } from './ata-api'
import { gerarAta, transcreverAudio, traduzirErro, type Progresso } from './gemini'
import { redigirGroq, transcreverGroq } from './groq'
import { ErroProvedor, type ProvedorId, type Settings } from './types'

export type ResultadoProvedor<T> = { dados: T; provedor: ProvedorId; modelo: string }
export type OpcoesComuns = { settings: Settings; meta: MeetingMetadata; onProgress?: Progresso }
export type OpcoesTranscricao = OpcoesComuns & { file: File }
export type OpcoesRedacao = OpcoesComuns & { transcript: TranscriptSegment[] }
export interface Provedor {
  id: ProvedorId
  transcrever(opts: OpcoesTranscricao): Promise<ResultadoProvedor<TranscriptSegment[]>>
  redigir(opts: OpcoesRedacao): Promise<ResultadoProvedor<AtaExtraida>>
}
const progressoGemini = (onProgress?: Progresso): Progresso => (etapa, fracao, modelo) => onProgress?.(`Gemini · ${etapa}`, fracao, modelo, 'gemini')
export const provedores: Record<ProvedorId, Provedor> = {
  groq: {
    id: 'groq',
    async transcrever({ settings, file, onProgress }) {
      const resultado = await transcreverGroq({ apiKey: settings.groqApiKey, modelo: settings.modeloTranscricaoGroq, file, onProgress })
      return { dados: resultado.transcript, provedor: 'groq', modelo: resultado.modeloUsado }
    },
    async redigir({ settings, meta, transcript, onProgress }) {
      const resultado = await redigirGroq({ apiKey: settings.groqApiKey, modelo: settings.modeloGroq, meta, transcript, onProgress })
      return { dados: resultado.extraida, provedor: 'groq', modelo: resultado.modeloUsado }
    },
  },
  gemini: {
    id: 'gemini',
    async transcrever({ settings, meta, file, onProgress }) {
      const modelos = new Set<string>()
      const dados = await transcreverAudio({ apiKey: settings.apiKey, modelo: settings.modelo, meta, file,
        onProgress: progressoGemini(onProgress), onModeloUsado: modelo => modelos.add(modelo) })
      return { dados, provedor: 'gemini', modelo: [...modelos].join(', ') }
    },
    async redigir({ settings, meta, transcript, onProgress }) {
      const resultado = await gerarAta({ apiKey: settings.apiKey, modelo: settings.modelo, meta, transcript, onProgress: progressoGemini(onProgress) })
      return { dados: resultado.extraida, provedor: 'gemini', modelo: resultado.modeloUsado }
    },
  },
}

async function comReserva<T>(opts: OpcoesComuns, executar: (provedor: Provedor) => Promise<ResultadoProvedor<T>>) {
  const { settings, onProgress } = opts
  const preferido = settings.provedorPreferido === 'gemini' ? 'gemini' : 'groq'
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
export const transcreverComProvedores = (opts: OpcoesTranscricao) => comReserva(opts, provedor => provedor.transcrever(opts))
export const redigirComProvedores = (opts: OpcoesRedacao) => comReserva(opts, provedor => provedor.redigir(opts))
