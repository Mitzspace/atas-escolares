import { describe, expect, it } from 'vitest'
import { faixasDeTempo, GeminiError, mimeDoAudio, parseJsonResposta, traduzirErro } from './gemini'

describe('traduzirErro', () => {
  it('429 vira erro de cota com mensagem clara', () => {
    const e = traduzirErro(Object.assign(new Error('{"error":{"status":"RESOURCE_EXHAUSTED"}}'), { status: 429 }))
    expect(e.kind).toBe('cota')
    expect(e.message).toMatch(/plano gratuito/)
  })
  it('chave inválida', () => {
    expect(traduzirErro(Object.assign(new Error('API key not valid'), { status: 400 })).kind).toBe('chave')
    expect(traduzirErro(Object.assign(new Error('x'), { status: 403 })).kind).toBe('chave')
  })
  it('sobrecarga e rede', () => {
    expect(traduzirErro(Object.assign(new Error('x'), { status: 503 })).kind).toBe('sobrecarga')
    expect(traduzirErro(new TypeError('Failed to fetch')).kind).toBe('rede')
  })
  it('mantém GeminiError', () => {
    const g = new GeminiError('conteudo', 'a')
    expect(traduzirErro(g)).toBe(g)
  })
})

describe('mimeDoAudio', () => {
  it('usa extensão', () => {
    expect(mimeDoAudio({ name: 'r.M4A', type: '' })).toBe('audio/m4a')
    expect(mimeDoAudio({ name: 'r.mp3', type: 'audio/mpeg' })).toBe('audio/mp3')
  })
  it('aceita o que o MediaRecorder produz (Chrome/Android e Safari/iPhone)', () => {
    expect(mimeDoAudio({ name: 'gravacao.webm', type: 'audio/webm;codecs=opus' })).toBe('audio/webm')
    expect(mimeDoAudio({ name: 'gravacao.m4a', type: 'audio/mp4' })).toBe('audio/m4a')
    expect(mimeDoAudio({ name: 'sem-extensao', type: 'audio/mp4;codecs=mp4a.40.2' })).toBe('audio/m4a')
    expect(mimeDoAudio({ name: 'sem-extensao', type: 'audio/webm;codecs=opus' })).toBe('audio/webm')
  })
  it('recusa formato desconhecido', () => {
    expect(() => mimeDoAudio({ name: 'r.pdf', type: 'application/pdf' })).toThrow(/não aceito/)
  })
})

describe('parseJsonResposta', () => {
  it('lê JSON', () => expect(parseJsonResposta<number[]>('[1]')).toEqual([1]))
  it('avisa resposta cortada', () => expect(() => parseJsonResposta('[{"a"', 'MAX_TOKENS')).toThrow(/cortada/))
  it('avisa resposta vazia', () => expect(() => parseJsonResposta(undefined)).toThrow(/não devolveu/))
})

describe('faixasDeTempo', () => {
  it('divide em blocos de 20 min', () => {
    expect(faixasDeTempo(65)).toEqual([
      { inicio: '00:00', fim: '20:00' }, { inicio: '20:00', fim: '40:00' },
      { inicio: '40:00', fim: '60:00' }, { inicio: '60:00', fim: '65:00' },
    ])
  })
})
