import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FileState, type GoogleGenAI, type GenerateContentParameters, type GenerateContentResponse } from '@google/genai'
import { MODELOS, MODELO_PADRAO, SETTINGS_PADRAO } from './types'
import type { MeetingMetadata } from './ata-api'
import { faixasDeTempo, GeminiError, mimeDoAudio, parseJsonResposta, traduzirErro, gerarAta, transcreverAudio, parseTranscricaoDedicada } from './gemini'

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
const cadeiaConfigurada = ['gemini-3.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.6-flash', 'gemini-3.8-flash']
const cota = () => Object.assign(new Error('RESOURCE_EXHAUSTED'), { status: 429 })
const sobrecarga = () => Object.assign(new Error('UNAVAILABLE: overloaded'), { status: 503 })

// Exercita os dois consumidores com SDK simulado, sem chamadas externas nem espera real.
describe.each(['transcricao', 'ata'] as const)('fallback na %s', fluxo => {
  const modelos = fluxo === 'transcricao' ? ['gemini-3.5-transcribe', ...cadeiaConfigurada] : cadeiaConfigurada
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
    const generateContent = vi.fn(async ({ model }: GenerateContentParameters) => {
      const resposta = responder(model)
      if (fluxo === 'transcricao' && model === 'gemini-3.5-transcribe' && resposta.text === '[]') {
        return { candidates: [{ content: { parts: [{ audioTranscription: { text: 'Reunião iniciada.' } }] } }] }
      }
      return resposta
    })
    const upload = vi.fn(async () => ({ name: 'files/teste', uri: 'uri:teste', state: FileState.ACTIVE }))
    const apagar = vi.fn(async () => ({}))
    const ai = { models: { generateContent }, files: { upload, delete: apagar } } as unknown as GoogleGenAI
    const progresso = vi.fn()
    const executar = (modelo = cadeiaConfigurada[0]) => fluxo === 'ata'
      ? gerarAta({ apiKey: 'teste', modelo, meta, transcript: [], ai, onProgress: progresso })
      : transcreverAudio({ apiKey: 'teste', modelo, meta, file: new File(['audio'], 'teste.mp3'), ai, onProgress: progresso })
    return { generateContent, upload, apagar, progresso, executar }
  }

  it.each(modelos.map((_, indice) => indice))('sucesso no modelo de índice %i, após esgotar os anteriores', async indice => {
    const caso = preparar(modelo => {
      if (modelo !== modelos[indice]) throw sobrecarga()
      return { text: '[]' }
    })
    const resultado = caso.executar()
    const verificar = expect(resultado).resolves.toEqual(fluxo === 'transcricao' && indice === 0
      ? [{ speaker: expect.stringContaining('texto não segmentado'), start: '00:00', end: '00:00', text: 'Reunião iniciada.' }]
      : [])
    await vi.runAllTimersAsync()
    await verificar
    const esperados = [...modelos.slice(0, indice).flatMap(m => [m, m]), modelos[indice]]
    expect(caso.generateContent.mock.calls.map(([arg]) => arg.model)).toEqual(esperados)
    for (const [pedido] of caso.generateContent.mock.calls) {
      if (fluxo === 'transcricao' && pedido.model === 'gemini-3.5-transcribe') {
        expect(pedido).not.toHaveProperty('config')
        expect(pedido.contents).toEqual({ role: 'user', parts: [{ fileData: { fileUri: 'uri:teste', mimeType: 'audio/mp3' } }] })
      } else {
        expect(pedido.config).toMatchObject({ responseMimeType: 'application/json', responseSchema: expect.any(Object) })
      }
    }
    const mensagens = caso.progresso.mock.calls.map(([mensagem]) => mensagem as string)
    for (const modelo of modelos.slice(0, indice + 1)) {
      expect(mensagens.some(m => m.includes(modelo) && m.includes('tentativa 1/2'))).toBe(true)
    }
    for (const modelo of modelos.slice(0, indice)) {
      expect(mensagens.some(m => m.includes(modelo) && m.includes('tentativa 2/2'))).toBe(true)
    }
    if (indice > 0) expect(mensagens.some(m => m.includes('modelo alternativo'))).toBe(true)
    if (fluxo === 'transcricao') {
      expect(caso.upload).toHaveBeenCalledTimes(1)
      expect(caso.apagar).toHaveBeenCalledWith({ name: 'files/teste' })
    }
  })

  it('respeita a espera curta e faz somente uma nova tentativa por modelo', async () => {
    const caso = preparar(() => { throw sobrecarga() })
    const verificar = expect(caso.executar()).rejects.toMatchObject({ kind: 'sobrecarga' })
    // Libera upload e leitura de duração sem avançar a espera do retry.
    await vi.advanceTimersByTimeAsync(0)
    expect(caso.generateContent.mock.calls.map(([arg]) => arg.model)).toEqual([modelos[0]])
    await vi.advanceTimersByTimeAsync(999)
    expect(caso.generateContent).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(caso.generateContent.mock.calls.map(([arg]) => arg.model)).toEqual([
      modelos[0], modelos[0], modelos[1],
    ])
    await vi.runAllTimersAsync()
    await verificar
    expect(caso.generateContent).toHaveBeenCalledTimes(modelos.length * 2)
  })

  it('preserva sobrecarga e informa todos os modelos quando todos falham', async () => {
    const caso = preparar(() => { throw sobrecarga() })
    const verificar = expect(caso.executar()).rejects.toMatchObject({
      kind: 'sobrecarga', message: expect.stringContaining(modelos.join(', ')),
    })
    await vi.runAllTimersAsync()
    await verificar
    expect(caso.generateContent.mock.calls.map(([arg]) => arg.model)).toEqual(modelos.flatMap(m => [m, m]))
  })

  it.each([
    ['rede', new TypeError('Failed to fetch'), 2],
    ['chave', Object.assign(new Error('API key inválida'), { status: 403 }), 1],
    ['conteudo', new GeminiError('conteudo', 'Conteúdo bloqueado'), 1],
  ])('%s não troca de modelo', async (kind, erro, chamadas) => {
    const caso = preparar(() => { throw erro })
    const verificar = expect(caso.executar()).rejects.toMatchObject({ kind })
    await vi.runAllTimersAsync()
    await verificar
    expect(caso.generateContent.mock.calls.map(([arg]) => arg.model)).toEqual(Array(chamadas).fill(modelos[0]))
  })

  it.each(modelos.slice(1).map((_, indice) => indice + 1))('cota avança até o modelo funcional de índice %i', async indice => {
    const caso = preparar(modelo => {
      if (modelo !== modelos[indice]) throw cota()
      return { text: '[]' }
    })
    const verificar = expect(caso.executar()).resolves.toEqual([])
    await vi.runAllTimersAsync()
    await verificar
    expect(caso.generateContent.mock.calls.map(([arg]) => arg.model)).toEqual(modelos.slice(0, indice + 1))
    const mensagens = caso.progresso.mock.calls.map(([mensagem]) => mensagem as string)
    for (const modelo of modelos.slice(0, indice + 1)) {
      expect(mensagens.some(m => m.includes(modelo) && m.includes('tentativa 1/2'))).toBe(true)
      expect(mensagens.some(m => m.includes(modelo) && m.includes('tentativa 2/2'))).toBe(false)
    }
    expect(mensagens.some(m => m.includes(modelos[indice]) && m.includes('modelo alternativo'))).toBe(true)
  })

  it('só exibe erro de cota depois que toda a cadeia retorna cota', async () => {
    const caso = preparar(() => { throw cota() })
    const verificar = expect(caso.executar()).rejects.toMatchObject({
      kind: 'cota', message: expect.stringContaining(modelos.join(', ')),
    })
    await vi.runAllTimersAsync()
    await verificar
    expect(caso.generateContent.mock.calls.map(([arg]) => arg.model)).toEqual(modelos)
  })

  it('combina retries de sobrecarga com avanço imediato por cota no alternativo', async () => {
    const caso = preparar(modelo => {
      if (modelo === modelos[0]) throw sobrecarga()
      if (modelo === modelos[1]) throw cota()
      return { text: '[]' }
    })
    const verificar = expect(caso.executar()).resolves.toEqual([])
    await vi.runAllTimersAsync()
    await verificar
    expect(caso.generateContent.mock.calls.map(([arg]) => arg.model)).toEqual([
      modelos[0], modelos[0], modelos[1], modelos[2],
    ])
  })

  it('resposta inválida não dispara fallback', async () => {
    const caso = preparar(() => ({ text: 'resposta inválida' }))
    const verificar = expect(caso.executar()).rejects.toMatchObject({ kind: 'conteudo' })
    await vi.runAllTimersAsync()
    await verificar
    expect(caso.generateContent).toHaveBeenCalledTimes(1)
  })

  if (fluxo === 'transcricao') {
    it.each([true, false])('áudio longo com dedicado disponível: %s', async disponivel => {
      vi.stubGlobal('Audio', class {
        duration = 65 * 60
        onloadedmetadata?: () => void
        set src(_valor: string) { queueMicrotask(() => this.onloadedmetadata?.()) }
      })
      const caso = preparar(modelo => {
        if (!disponivel && modelo === 'gemini-3.5-transcribe') throw cota()
        return { text: '[]' }
      })
      const resultado = caso.executar('gemini-3.5-transcribe')
      await vi.runAllTimersAsync()
      const segmentos = await resultado
      if (disponivel) {
        expect(caso.generateContent.mock.calls.map(([arg]) => arg.model)).toEqual(['gemini-3.5-transcribe'])
        expect(segmentos).toHaveLength(1)
        expect(segmentos).toMatchObject([{ text: 'Reunião iniciada.' }])
      } else {
        expect(caso.generateContent.mock.calls.map(([arg]) => arg.model)).toEqual([
          'gemini-3.5-transcribe', ...Array(4).fill('gemini-3.5-flash-lite'),
        ])
      }
    })
  }

  it.each([...cadeiaConfigurada, 'gemini-3.5-transcribe', 'modelo-personalizado'])(
    'deduplica a cadeia com modelo configurado %s', async configurado => {
      const caso = preparar(() => { throw sobrecarga() })
      const verificar = expect(caso.executar(configurado)).rejects.toMatchObject({ kind: 'sobrecarga' })
      await vi.runAllTimersAsync()
      await verificar
      const esperados = [...new Set([
        ...(fluxo === 'transcricao' ? ['gemini-3.5-transcribe'] : []),
        configurado, ...cadeiaConfigurada,
      ])]
      expect(caso.generateContent.mock.calls.map(([arg]) => arg.model)).toEqual(
        esperados.flatMap(m => [m, m]),
      )
    },
  )
})


describe('parseTranscricaoDedicada', () => {
  it('reúne as partes do primeiro candidato sem inventar falantes ou tempos', () => {
    const resposta = { candidates: [
      { content: { parts: [
        { text: 'Não é a transcrição' },
        { audioTranscription: { text: 'Primeira fala.' } },
        { audioTranscription: { text: 'Segunda fala.' } },
      ] } },
      { content: { parts: [{ audioTranscription: { text: 'Alternativa ignorada.' } }] } },
    ] } as GenerateContentResponse
    expect(parseTranscricaoDedicada(resposta)).toEqual([{
      speaker: 'Falante 1 (texto não segmentado; falantes e tempos não identificados)',
      start: '00:00', end: '00:00', text: 'Primeira fala.\nSegunda fala.',
    }])
  })

  it.each([
    {}, { text: 'Texto fora do campo esperado' },
    { candidates: [{ content: { parts: [{ audioTranscription: { text: '   ' } }] } }] },
  ])('recusa resposta sem transcrição útil: %j', resposta => {
    expect(() => parseTranscricaoDedicada(resposta as GenerateContentResponse)).toThrow(GeminiError)
    expect(() => parseTranscricaoDedicada(resposta as GenerateContentResponse)).toThrow(/audioTranscription.text/)
  })
})


it('usa Flash-Lite como padrão econômico nas configurações', () => {
  expect(MODELO_PADRAO).toBe('gemini-3.5-flash-lite')
  expect(SETTINGS_PADRAO.modelo).toBe(MODELO_PADRAO)
  expect(MODELOS[0].nome).toContain('mais econômico')
  expect(MODELOS.map(m => m.id)).toEqual(cadeiaConfigurada)
})
