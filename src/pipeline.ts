import { renderAta, type MeetingMetadata } from './ata-api'
import { deleteAudio, getAudio, getAta, getSettings, patchAta } from './db'
import type { Progresso } from './gemini'
import { redigirComProvedores, transcreverComProvedores } from './provedores'

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
    await patchAta(id, { status: 'transcricao', transcript: resultado.dados, provedorTranscricao: resultado.provedor, modeloTranscricao: resultado.modelo })
    onProgress('Transcrição pronta', 1, resultado.modelo, resultado.provedor)
    await deleteAudio(id)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await patchAta(id, { status: 'erro', erro: msg })
    throw new Error(msg)
  }
}

/** transcrição revisada -> ata extraída -> texto renderizado */
export async function rodarGeracaoAta(id: string, onProgress: Progresso) {
  const ata = await getAta(id)
  if (!ata?.transcript) throw new Error('A transcrição não foi encontrada.')
  try {
    const settings = await getSettings()
    await patchAta(id, { status: 'processando', erro: undefined })
    const resultado = await redigirComProvedores({ settings, meta: ata.meta, transcript: ata.transcript, onProgress })
    const extraida = resultado.dados
    const renderizada = renderAta(ata.meta as MeetingMetadata, extraida)
    await patchAta(id, { status: 'ata', extraida, renderizada, modeloRedacao: resultado.modelo, provedorRedacao: resultado.provedor, textoEditado: undefined })
    onProgress('Ata pronta', 1, resultado.modelo, resultado.provedor)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await patchAta(id, { status: 'erro', erro: msg })
    throw new Error(msg)
  }
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
