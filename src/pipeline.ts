import { renderAta, type MeetingMetadata } from './ata-api'
import { deleteAudio, getAudio, getAta, getSettings, patchAta } from './db'
import { gerarAta, transcreverAudio, traduzirErro, type Progresso } from './gemini'

async function chaveEModelo() {
  const s = await getSettings()
  if (!s.apiKey.trim()) throw new Error('Cole a chave da API do Gemini em Configurações antes de começar.')
  return { apiKey: s.apiKey.trim(), modelo: s.modelo }
}

/** áudio -> transcrição; guarda o resultado e apaga o áudio local ao terminar */
export async function rodarTranscricao(id: string, onProgress: Progresso) {
  const ata = await getAta(id)
  const audio = await getAudio(id)
  if (!ata) throw new Error('Ata não encontrada.')
  if (!audio) throw new Error('O arquivo de áudio não está mais no aparelho. Crie a ata de novo e envie o áudio.')
  try {
    const { apiKey, modelo } = await chaveEModelo()
    await patchAta(id, { status: 'processando', erro: undefined })
    const file = new File([audio.blob], audio.nome, { type: audio.mimeType })
    const transcript = await transcreverAudio({ apiKey, modelo, meta: ata.meta, file, onProgress })
    await patchAta(id, { status: 'transcricao', transcript })
    await deleteAudio(id)
  } catch (e) {
    const msg = e instanceof Error && !('kind' in e) ? e.message : traduzirErro(e).message
    await patchAta(id, { status: 'erro', erro: msg })
    throw new Error(msg)
  }
}

/** transcrição revisada -> ata extraída -> texto renderizado */
export async function rodarGeracaoAta(id: string, onProgress: Progresso) {
  const ata = await getAta(id)
  if (!ata?.transcript) throw new Error('A transcrição não foi encontrada.')
  try {
    const { apiKey, modelo } = await chaveEModelo()
    await patchAta(id, { status: 'processando', erro: undefined })
    onProgress('Redigindo a ata…', 0.3)
    const extraida = await gerarAta({ apiKey, modelo, meta: ata.meta, transcript: ata.transcript })
    const renderizada = renderAta(ata.meta as MeetingMetadata, extraida)
    await patchAta(id, { status: 'ata', extraida, renderizada, textoEditado: undefined })
    onProgress('Ata pronta', 1)
  } catch (e) {
    const msg = e instanceof Error && !('kind' in e) ? e.message : traduzirErro(e).message
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
