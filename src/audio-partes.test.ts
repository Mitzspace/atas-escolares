import { afterEach, expect, it, vi } from 'vitest'
import { conferirMemoriaAudio, dividirAudio, deslocarTempos, estimarMemoriaAudio, partesWav, wavMono } from './audio-partes'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('gera PCM WAV mono 16-bit com cabeçalho e mistura dos canais', () => {
  const buffer = wavMono([new Float32Array([-1, 1, 0.5]), new Float32Array([-1, 1, -0.5])])
  const v = new DataView(buffer)
  expect(buffer.byteLength).toBe(50)
  expect(String.fromCharCode(...new Uint8Array(buffer, 0, 4))).toBe('RIFF')
  expect(v.getUint16(22, true)).toBe(1)
  expect(v.getUint32(24, true)).toBe(16000)
  expect(v.getUint16(34, true)).toBe(16)
  expect([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true)]).toEqual([-32768, 32767, 0])
})
it('divide dados sintéticos sem perder amostras e respeita o limite de tamanho', () => {
  const samples = new Float32Array(10)
  const partes = [...partesWav({ length: 10, sampleRate: 4, numberOfChannels: 1, getChannelData: () => samples }, 1)]
  expect(partes.map(p => p.inicio)).toEqual([0, 1, 2])
  expect(partes.map(p => p.arquivo.size)).toEqual([52, 52, 48])
  expect(partes[0].total).toBe(3)
  expect(44 + 600 * 16000 * 2).toBeLessThan(25_000_000)
})
it('ajusta tempos absolutos, inclusive depois de uma hora, sem alterar os segmentos', () => {
  const original = [{ speaker: 'Falante', start: '00:02', end: '00:08', text: 'Fala.' }]
  expect(deslocarTempos(original, 3600)).toEqual([{ ...original[0], start: '60:02', end: '60:08' }])
  expect(original[0].start).toBe('00:02')
})
it('estima Float32 a 16 kHz e protege a memória antes da decodificação', async () => {
  expect(estimarMemoriaAudio(2400)).toBe(153_600_000)
  expect(() => conferirMemoriaAudio(5000)).toThrow(/300 MB/)
  expect(() => conferirMemoriaAudio(Infinity)).toThrow(/duração/)
  const ler = vi.fn()
  const decode = vi.fn()
  vi.stubGlobal('OfflineAudioContext', decode)
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:teste', revokeObjectURL: vi.fn() })
  vi.stubGlobal('Audio', class {
    duration = 5000
    onloadedmetadata: (() => void) | null = null
    onerror: (() => void) | null = null
    removeAttribute() {}
    set src(_valor: string) { queueMicrotask(() => this.onloadedmetadata?.()) }
  })
  const file = new File(['x'], 'longo.mp3')
  Object.defineProperty(file, 'arrayBuffer', { value: ler })
  await expect(dividirAudio(file).next()).rejects.toThrow(/300 MB/)
  expect(ler).not.toHaveBeenCalled(); expect(decode).not.toHaveBeenCalled()
})
it('decodifica com OfflineAudioContext a 16 kHz e entrega WAV mono', async () => {
  const construir = vi.fn()
  const decode = vi.fn().mockResolvedValue({ length: 4, sampleRate: 16000, numberOfChannels: 2, getChannelData: () => new Float32Array(4) })
  vi.stubGlobal('OfflineAudioContext', class { constructor(...args: unknown[]) { construir(...args) }; decodeAudioData = decode })
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:teste', revokeObjectURL: vi.fn() })
  vi.stubGlobal('Audio', class {
    duration = 1
    onloadedmetadata: (() => void) | null = null
    onerror: (() => void) | null = null
    removeAttribute() {}
    set src(_valor: string) { queueMicrotask(() => this.onloadedmetadata?.()) }
  })
  const file = new File(['x'], 'longo.mp3')
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(1) })
  const resultado = await dividirAudio(file).next()
  expect(construir).toHaveBeenCalledWith(1, 1, 16000)
  expect(resultado.value?.arquivo.type).toBe('audio/wav')
  expect(resultado.value?.arquivo.size).toBe(52)
})
