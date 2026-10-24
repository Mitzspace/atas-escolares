// @vitest-environment node
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  arquivoDosPedacos, erroDeMicrofone, escolherFormato, formatarTempo, gravacoesRecuperaveis, nivelDoMicrofone,
  nomeDaGravacao, problemaDeSuporte, recuperarGravacao,
} from './gravacao'
import { db, iniciarSessaoGravacao, salvarPedacoGravacao, apagarSessaoGravacao, pedacosDaSessao } from './db'
import { mimeDoAudio } from './gemini'

describe('escolherFormato', () => {
  it('Chrome/Android: webm opus', () => {
    expect(escolherFormato(t => t.startsWith('audio/webm'))).toEqual({ mimeType: 'audio/webm;codecs=opus', ext: 'webm' })
  })
  it('Safari/iPhone: só mp4', () => {
    expect(escolherFormato(t => t.startsWith('audio/mp4'))).toEqual({ mimeType: 'audio/mp4;codecs=mp4a.40.2', ext: 'm4a' })
    expect(escolherFormato(t => t === 'audio/mp4')).toEqual({ mimeType: 'audio/mp4', ext: 'm4a' })
  })
  it('prefere webm sem codec se só ele existir; null se nada', () => {
    expect(escolherFormato(t => t === 'audio/webm')?.mimeType).toBe('audio/webm')
    expect(escolherFormato(() => false)).toBeNull()
  })
  it('o arquivo gerado é aceito por mimeDoAudio', () => {
    for (const f of [{ mimeType: 'audio/webm;codecs=opus', ext: 'webm' }, { mimeType: 'audio/mp4', ext: 'm4a' }, { mimeType: 'audio/ogg;codecs=opus', ext: 'ogg' }]) {
      const file = arquivoDosPedacos([new Blob(['x'])], f)
      expect(() => mimeDoAudio(file)).not.toThrow()
    }
  })
})

describe('arquivoDosPedacos', () => {
  it('junta os pedaços na ordem', async () => {
    const f = arquivoDosPedacos([new Blob(['ab']), new Blob(['cd']), new Blob(['e'])], { mimeType: 'audio/webm;codecs=opus', ext: 'webm' }, new Date(2026, 2, 10, 14, 5))
    expect(await f.text()).toBe('abcde')
    expect(f.type).toBe('audio/webm')
    expect(f.name).toBe('gravacao-20260310-1405.webm')
  })
})

describe('formatarTempo / nomeDaGravacao', () => {
  it('mm:ss e h:mm:ss', () => {
    expect(formatarTempo(0)).toBe('00:00')
    expect(formatarTempo(65_900)).toBe('01:05')
    expect(formatarTempo(3_725_000)).toBe('1:02:05')
    expect(formatarTempo(-5)).toBe('00:00')
  })
  it('nome com data e hora', () => expect(nomeDaGravacao('m4a', new Date(2026, 11, 1, 9, 7))).toBe('gravacao-20261201-0907.m4a'))
})

describe('nivelDoMicrofone', () => {
  it('silêncio = 0, sinal forte sobe e satura em 1', () => {
    expect(nivelDoMicrofone(new Uint8Array(100).fill(128))).toBe(0)
    expect(nivelDoMicrofone(Uint8Array.from({ length: 100 }, (_, i) => (i % 2 ? 255 : 0)))).toBe(1)
    expect(nivelDoMicrofone(new Uint8Array())).toBe(0)
  })
})

describe('erros em pt-BR', () => {
  it('permissão negada explica como liberar', () => {
    const e = erroDeMicrofone({ name: 'NotAllowedError' })
    expect(e.codigo).toBe('permissao')
    expect(e.mensagem).toMatch(/permita o Microfone/)
  })
  it('sem microfone, em uso, outro', () => {
    expect(erroDeMicrofone({ name: 'NotFoundError' }).codigo).toBe('sem-microfone')
    expect(erroDeMicrofone({ name: 'NotReadableError' }).codigo).toBe('em-uso')
    expect(erroDeMicrofone(new Error('x')).codigo).toBe('outro')
  })
  it('falta de https e navegador sem suporte', () => {
    const base = { isSecureContext: true, temGetUserMedia: true, temMediaRecorder: true, formato: { mimeType: 'audio/webm', ext: 'webm' as const } }
    expect(problemaDeSuporte(base)).toBeNull()
    expect(problemaDeSuporte({ ...base, isSecureContext: false })?.mensagem).toMatch(/https/)
    expect(problemaDeSuporte({ ...base, temMediaRecorder: false })?.codigo).toBe('sem-suporte')
    expect(problemaDeSuporte({ ...base, formato: null })?.codigo).toBe('sem-suporte')
  })
})

describe('recuperação de gravação interrompida', () => {
  beforeEach(async () => {
    await db.sessoesGravacao.clear()
    await db.pedacosGravacao.clear()
  })
  it('remonta a sessão na ordem de seq e apaga depois', async () => {
    await iniciarSessaoGravacao({ id: 's1', mimeType: 'audio/webm;codecs=opus', ext: 'webm', iniciadaEm: Date.UTC(2026, 2, 10, 17, 0), duracaoMs: 0 })
    await salvarPedacoGravacao('s1', 1, new Blob(['B']), 10_000)
    await salvarPedacoGravacao('s1', 0, new Blob(['A']), 5_000)
    await salvarPedacoGravacao('s1', 2, new Blob(['C']), 15_000)
    const lista = await gravacoesRecuperaveis()
    expect(lista).toHaveLength(1)
    expect(lista[0].duracaoMs).toBe(15_000)
    const textos = await Promise.all((await pedacosDaSessao('s1')).map(b => b.text()))
    expect(textos.join('')).toBe('ABC')
    const arq = await recuperarGravacao(lista[0])
    expect(await arq.text()).toBe('ABC')
    expect(arq.name).toMatch(/^gravacao-\d{8}-\d{4}\.webm$/)
    expect(arq.type).toBe('audio/webm')
    expect(await gravacoesRecuperaveis('s1')).toHaveLength(0) // a sessão atual é ignorada
    await apagarSessaoGravacao('s1')
    expect(await gravacoesRecuperaveis()).toHaveLength(0)
    expect(await db.pedacosGravacao.count()).toBe(0)
  })
  it('sessão sem pedaços é descartada', async () => {
    await iniciarSessaoGravacao({ id: 's2', mimeType: 'audio/webm', ext: 'webm', iniciadaEm: 1, duracaoMs: 0 })
    expect(await gravacoesRecuperaveis()).toHaveLength(0)
    expect(await db.sessoesGravacao.count()).toBe(0)
  })
})
