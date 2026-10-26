import { anonimizarAtaExtraida, anotacoesValidas, extrairResumo, renderAta, renderAtaTextoLivre, type Anotacao, type MeetingMetadata } from './ata-api'
import { deleteAudio, getAudio, getAta, getSettings, patchAta } from './db'
import type { Progresso } from './gemini'
import { identificarFalantes, redigirComProvedores, transcreverComProvedores } from './provedores'
import type { AtaRecord } from './types'

/** Campos do registro por anotações (modos Digitar e Gravar e digitar); opcionais em atas antigas. */
type ComAnotacoes = AtaRecord & { anotacoes?: Anotacao[] }

/** áudio -> transcrição; guarda o resultado e apaga o áudio local ao terminar */
export async function rodarTranscricao(id: string, onProgress: Progresso) {
  const ata = await getAta(id)
  const audio = await getAudio(id)
  if (!ata) throw new Error('Ata não encontrada.')
  if (!audio) throw new Error('O arquivo de áudio não está mais no aparelho. Crie a ata de novo e envie o áudio.')
  try {
    const settings = await getSettings()
    await patchAta(id, { status: 'processando', erro: undefined })
    const file = new File([audio.blob], audio.nome, { type: audio.mimeType })
    const resultado = await transcreverComProvedores({ settings, meta: ata.meta, file, onProgress })
    let transcript = resultado.dados
    // Whisper não separa falantes: passada de LLM com a lista de participantes. Falha aqui não derruba a transcrição.
    try {
      onProgress('Identificando quem falou…', 0.95, undefined, undefined)
      const falantes = await identificarFalantes(transcript, ata.meta.participantes, { settings, meta: ata.meta, onProgress })
      transcript = falantes.dados
    } catch {
      onProgress('Não foi possível identificar os falantes; confira na revisão.', 0.95, undefined, undefined)
    }
    await patchAta(id, { status: 'transcricao', transcript, provedorTranscricao: resultado.provedor, modeloTranscricao: resultado.modelo })
    onProgress('Transcrição pronta', 1, resultado.modelo, resultado.provedor)
    await deleteAudio(id)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await patchAta(id, { status: 'erro', erro: msg })
    throw new Error(msg)
  }
}

/**
 * transcrição revisada e/ou anotações -> ata extraída -> texto renderizado (+ resumo para o painel).
 * Só transcrição = modo Gravar; só anotações = modo Digitar + "Organizar com IA"; as duas = Gravar e digitar.
 */
export async function rodarGeracaoAta(id: string, onProgress: Progresso) {
  const ata = await getAta(id) as ComAnotacoes | undefined
  const anotacoes = anotacoesValidas(ata?.anotacoes)
  if (!ata || (!ata.transcript && !anotacoes.length)) throw new Error('A transcrição não foi encontrada.')
  const transcript = ata.transcript ?? []
  try {
    const settings = await getSettings()
    await patchAta(id, { status: 'processando', erro: undefined })
    const resultado = await redigirComProvedores({ settings, meta: ata.meta, transcript, anotacoes, onProgress })
    const extraida = anonimizarAtaExtraida(ata.meta, transcript, resultado.dados)
    const renderizada = renderAta(ata.meta as MeetingMetadata, extraida, transcript)
    await patchAta(id, { status: 'ata', extraida, renderizada, modeloRedacao: resultado.modelo, provedorRedacao: resultado.provedor, textoEditado: undefined,
      resumo: extrairResumo(extraida, ata.meta) } as Partial<AtaRecord>)
    onProgress('Ata pronta', 1, resultado.modelo, resultado.provedor)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await patchAta(id, { status: 'erro', erro: msg })
    throw new Error(msg)
  }
}

/**
 * Modo Digitar + "Usar como está": o texto da usuária vai para a revisão sem IA, só com abertura e encerramento por código.
 * Não chama provedor nenhum (funciona offline).
 */
export async function usarTextoComoEsta(id: string, texto: string) {
  const ata = await getAta(id)
  if (!ata) throw new Error('Ata não encontrada.')
  if (!texto.trim()) throw new Error('Escreva o texto da ata antes de continuar.')
  const renderizada = renderAtaTextoLivre(ata.meta as MeetingMetadata, texto)
  await patchAta(id, { status: 'ata', extraida: undefined, renderizada, textoEditado: undefined, erro: undefined,
    resumo: extrairResumo(renderizada.texto) } as Partial<AtaRecord>)
}

export function proximaRota(status: string, id: string): string {
  switch (status) {
    case 'transcricao': return `/ata/${id}/transcricao`
    case 'ata': return `/ata/${id}/revisar`
    case 'processando':
    case 'erro':
    default: return `/ata/${id}/processando/transcricao`
  }
}
