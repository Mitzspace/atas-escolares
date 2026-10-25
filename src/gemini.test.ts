import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FileState, type GoogleGenAI } from '@google/genai'
import type { MeetingMetadata } from './ata-api'
import { faixasDeTempo, GeminiError, mimeDoAudio, parseJsonResposta, traduzirErro, gerarAta, transcreverAudio } from './gemini'

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


const meta: MeetingMetadata = {
  escola: 'Escola de teste', rede: 'Municipal', municipioUf: 'Exemplo/SP',
  tipo: 'pedagogica', ordinaria: true, numero: 1, ano: 2026, data: '2026-10-25',
  horaInicio: '10:00', horaFim: '11:00', local: 'Escola',
  presidente: { nome: 'Ana', cargo: 'Diretora' }, secretario: { nome: 'Bia', cargo: 'Professora' },
  participantes: [], pauta: ['Planejamento'], anonimizarAlunos: true,
}
const modelos = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-flash-latest']
const sobrecarga = () => Object.assign(new Error('UNAVAILABLE: overloaded'), { status: 503 })

// Exercita os dois consumidores com SDK simulado, sem chamadas externas nem espera real.
describe.each(['transcricao', 'ata'] as const)('fallback na %s', fluxo => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('Audio', class {
      onerror?: () => void
      set src(_valor: string) { queueMicrotask(() => this.onerror?.()) }
    })
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:teste'), revokeObjectURL: vi.fn() })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function preparar(responder: (modelo: string) => { text: string }) {
    const generateContent = vi.fn(async ({ model }: { model: string }) => responder(model))
    const upload = vi.fn(async () => ({ name: 'files/teste', uri: 'uri:teste', state: FileState.ACTIVE }))
    const apagar = vi.fn(async () => ({}))
    const ai = { models: { generateContent }, files: { upload, delete: apagar } } as unknown as GoogleGenAI
    const progresso = vi.fn()
    const executar = (modelo = modelos[0]) => fluxo === 'ata'
      ? gerarAta({ apiKey: 'teste', modelo, meta, transcript: [], ai, onProgress: progresso })
      : transcreverAudio({ apiKey: 'teste', modelo, meta, file: new File(['audio'], 'teste.mp3'), ai, onProgress: progresso })
    return { generateContent, upload, apagar, progresso, executar }
  }

  it.each([0, 1, 2])('sucesso no modelo de índice %i, após esgotar os anteriores', async indice => {
    const caso = preparar(modelo => {
      if (modelo !== modelos[indice]) throw sobrecarga()
      return { text: '[]' }
    })
    const resultado = caso.executar()
    const verificar = expect(resultado).resolves.toEqual([])
    await vi.runAllTimersAsync()
    await verificar
    const esperados = [...modelos.slice(0, indice).flatMap(m => [m, m, m]), modelos[indice]]
    expect(caso.generateContent.mock.calls.map(([arg]) => arg.model)).toEqual(esperados)
    const mensagens = caso.progresso.mock.calls.map(([mensagem]) => mensagem as string)
    for (const modelo of modelos.slice(0, indice + 1)) {
      expect(mensagens.some(m => m.includes(modelo) && m.includes('tentativa 1/3'))).toBe(true)
    }
    for (const modelo of modelos.slice(0, indice)) {
      expect(mensagens.some(m => m.includes(modelo) && m.includes('tentativa 3/3'))).toBe(true)
    }
    if (indice > 0) expect(mensagens.some(m => m.includes('modelo alternativo'))).toBe(true)
    if (fluxo === 'transcricao') {
      expect(caso.upload).toHaveBeenCalledTimes(1)
      expect(caso.apagar).toHaveBeenCalledWith({ name: 'files/teste' })
    }
  })

  it('preserva sobrecarga e informa todos os modelos quando todos falham', async () => {
    const caso = preparar(() => { throw sobrecarga() })
    const verificar = expect(caso.executar()).rejects.toMatchObject({
      kind: 'sobrecarga', message: expect.stringContaining(modelos.join(', ')),
    })
    await vi.runAllTimersAsync()
    await verificar
    expect(caso.generateContent.mock.calls.map(([arg]) => arg.model)).toEqual(modelos.flatMap(m => [m, m, m]))
  })

  it.each([
    ['cota', Object.assign(new Error('RESOURCE_EXHAUSTED'), { status: 429 }), 1],
    ['rede', new TypeError('Failed to fetch'), 3],
    ['chave', Object.assign(new Error('API key inválida'), { status: 403 }), 1],
    ['conteudo', new GeminiError('conteudo', 'Conteúdo bloqueado'), 1],
  ])('%s não troca de modelo', async (kind, erro, chamadas) => {
    const caso = preparar(() => { throw erro })
    const verificar = expect(caso.executar()).rejects.toMatchObject({ kind })
    await vi.runAllTimersAsync()
    await verificar
    expect(caso.generateContent.mock.calls.map(([arg]) => arg.model)).toEqual(Array(chamadas).fill(modelos[0]))
  })

  it('interrompe se o alternativo retorna cota', async () => {
    const caso = preparar(modelo => {
      if (modelo === modelos[0]) throw sobrecarga()
      throw Object.assign(new Error('quota'), { status: 429 })
    })
    const verificar = expect(caso.executar()).rejects.toMatchObject({ kind: 'cota' })
    await vi.runAllTimersAsync()
    await verificar
    expect(caso.generateContent.mock.calls.map(([arg]) => arg.model)).toEqual([
      modelos[0], modelos[0], modelos[0], modelos[1],
    ])
  })

  it('resposta inválida não dispara fallback', async () => {
    const caso = preparar(() => ({ text: 'resposta inválida' }))
    const verificar = expect(caso.executar()).rejects.toMatchObject({ kind: 'conteudo' })
    await vi.runAllTimersAsync()
    await verificar
    expect(caso.generateContent).toHaveBeenCalledTimes(1)
  })

  it('não repete modelo configurado já presente nos alternativos', async () => {
    const caso = preparar(() => { throw sobrecarga() })
    const verificar = expect(caso.executar(modelos[1])).rejects.toMatchObject({ kind: 'sobrecarga' })
    await vi.runAllTimersAsync()
    await verificar
    expect(caso.generateContent.mock.calls.map(([arg]) => arg.model)).toEqual([
      modelos[1], modelos[1], modelos[1], modelos[2], modelos[2], modelos[2],
    ])
  })
})
