import type { TranscriptSegment } from './ata-api'
import { ErroProvedor } from './types'

export const TAXA_AUDIO = 16_000
export const SEGUNDOS_PARTE = 600
export const LIMITE_MEMORIA_AUDIO = 300_000_000
export const estimarMemoriaAudio = (duracao: number) => Math.ceil(duracao * TAXA_AUDIO * 4)
const erroMemoria = () => new ErroProvedor('conteudo', 'Este áudio exigiria mais de aproximadamente 300 MB para decodificar. Para proteger a memória do aparelho, grave e envie em partes menores ou configure a chave do Gemini.')

export function conferirMemoriaAudio(duracao: number) {
  if (!Number.isFinite(duracao) || duracao <= 0) throw new ErroProvedor('conteudo', 'Não foi possível estimar a duração do áudio com segurança. Envie MP3/WAV ou grave em partes menores.')
  if (estimarMemoriaAudio(duracao) > LIMITE_MEMORIA_AUDIO) throw erroMemoria()
}

export function duracaoAudio(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio()
    const url = URL.createObjectURL(file)
    const terminar = (duracao?: number) => {
      clearTimeout(timer)
      audio.onloadedmetadata = null; audio.onerror = null
      audio.removeAttribute('src'); URL.revokeObjectURL(url)
      if (duracao && Number.isFinite(duracao)) resolve(duracao)
      else reject(new ErroProvedor('conteudo', 'Não foi possível ler a duração do áudio. Envie MP3/WAV ou grave em partes menores.'))
    }
    const timer = setTimeout(() => terminar(), 8000)
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => terminar(audio.duration)
    audio.onerror = () => terminar()
    audio.src = url
  })
}

/** PCM 16-bit mono: mistura canais durante a escrita, sem uma segunda cópia Float32 do áudio inteiro. */
export function wavMono(canais: readonly Float32Array[], taxa = TAXA_AUDIO): ArrayBuffer {
  if (!canais.length || canais.some(c => c.length !== canais[0].length)) throw new Error('Canais de áudio incompatíveis.')
  const tamanho = canais[0].length
  const buffer = new ArrayBuffer(44 + tamanho * 2)
  const v = new DataView(buffer)
  const texto = (offset: number, s: string) => [...s].forEach((c, i) => v.setUint8(offset + i, c.charCodeAt(0)))
  texto(0, 'RIFF'); v.setUint32(4, 36 + tamanho * 2, true); texto(8, 'WAVE'); texto(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, taxa, true); v.setUint32(28, taxa * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  texto(36, 'data'); v.setUint32(40, tamanho * 2, true)
  for (let i = 0; i < tamanho; i++) {
    let soma = 0
    for (const canal of canais) soma += canal[i]
    const amostra = Math.max(-1, Math.min(1, soma / canais.length))
    v.setInt16(44 + i * 2, Math.round(amostra * (amostra < 0 ? 32768 : 32767)), true)
  }
  return buffer
}

type AudioDecodificado = Pick<AudioBuffer, 'length' | 'sampleRate' | 'numberOfChannels' | 'getChannelData'>
export function* partesWav(audio: AudioDecodificado, segundosParte = SEGUNDOS_PARTE) {
  if (!(segundosParte > 0) || audio.sampleRate <= 0) throw new Error('Duração da parte inválida.')
  const amostrasParte = Math.max(1, Math.floor(segundosParte * audio.sampleRate))
  const canais = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i))
  for (let inicio = 0; inicio < audio.length; inicio += amostrasParte) {
    const fim = Math.min(inicio + amostrasParte, audio.length)
    yield { arquivo: new File([wavMono(canais.map(c => c.subarray(inicio, fim)), audio.sampleRate)], `parte-${inicio}.wav`, { type: 'audio/wav' }), inicio: inicio / audio.sampleRate, total: Math.ceil(audio.length / amostrasParte) }
  }
}

export async function* dividirAudio(file: File) {
  const duracao = await duracaoAudio(file)
  conferirMemoriaAudio(duracao) // antes de ler o arquivo inteiro ou chamar o decodificador
  if (typeof OfflineAudioContext === 'undefined') throw new ErroProvedor('conteudo', 'Este navegador não consegue dividir o áudio. Envie em partes menores ou configure o Gemini.')
  let audio: AudioBuffer
  try {
    // decodeAudioData reamostra para a taxa do contexto; o codificador acima faz a mistura mono por parte.
    const contexto = new OfflineAudioContext(1, 1, TAXA_AUDIO)
    audio = await contexto.decodeAudioData(await file.arrayBuffer())
  } catch { throw new ErroProvedor('conteudo', 'Não foi possível decodificar este áudio. Envie MP3/WAV em partes menores ou configure o Gemini.') }
  if (audio.length * audio.numberOfChannels * 4 > LIMITE_MEMORIA_AUDIO) throw erroMemoria()
  for (const parte of partesWav(audio)) {
    yield parte // só uma parte WAV de ~19,2 MB é produzida por vez
  }
}

export function deslocarTempos(segmentos: TranscriptSegment[], inicio: number): TranscriptSegment[] {
  const deslocar = (t: string) => {
    const p = t.split(':').map(Number)
    const total = Math.floor(p.reduce((s, n) => s * 60 + n, 0) + inicio)
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
  }
  return segmentos.map(s => ({ ...s, start: deslocar(s.start), end: deslocar(s.end) }))
}
