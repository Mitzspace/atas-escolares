import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GeminiError, gerarAta, transcreverAudio } from './gemini'
import { redigirComProvedores, transcreverComProvedores } from './provedores'
import { SETTINGS_PADRAO, type Settings } from './types'
import type { MeetingMetadata } from './ata-api'

vi.mock('./gemini', async importOriginal => ({ ...await importOriginal<typeof import('./gemini')>(), gerarAta: vi.fn(), transcreverAudio: vi.fn() }))
const meta: MeetingMetadata = {
  escola: 'Teste', rede: 'Municipal', municipioUf: 'Exemplo/SP', tipo: 'pedagogica', ordinaria: true,
  numero: 1, ano: 2026, data: '2026-10-25', horaInicio: '14:00', local: 'Escola',
  presidente: { nome: 'Maria', cargo: 'Diretora' }, secretario: { nome: 'Joana', cargo: 'Coordenadora' },
  participantes: [], pauta: ['Calendário'], anonimizarAlunos: true,
}
const settings: Settings = { ...SETTINGS_PADRAO, apiKey: 'gemini-chave-ficticia', groqApiKey: 'groq-chave-ficticia' }
const extraida = { itens: [], deliberacoes: [], encaminhamentos: [], pendencias: [] }
const transcript = [{ speaker: 'Falante', start: '00:00', end: '00:01', text: 'Boa tarde.' }]
const file = new File(['audio fictício'], 'teste.wav')
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>
beforeEach(() => {
  vi.resetAllMocks()
  fetchMock = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetchMock)
  vi.mocked(gerarAta).mockResolvedValue({ extraida, modeloUsado: 'gemini-3.6-flash' })
  vi.mocked(transcreverAudio).mockImplementation(async opts => { opts.onModeloUsado?.('gemini-3.5-transcribe'); return transcript })
})
afterEach(() => vi.unstubAllGlobals())

describe.each(['transcrever', 'redigir'] as const)('provedores para %s', operacao => {
  const executar = (s = settings, onProgress = vi.fn()) => operacao === 'redigir'
    ? redigirComProvedores({ settings: s, meta, transcript, onProgress })
    : transcreverComProvedores({ settings: s, meta, file, onProgress })
  const respostaGroq = () => new Response(JSON.stringify(operacao === 'redigir'
    ? { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(extraida) } }] }
    : { segments: [{ start: 0, end: 1, text: 'Boa tarde.' }] }), { status: 200 })
  const gemini = () => operacao === 'redigir' ? vi.mocked(gerarAta) : vi.mocked(transcreverAudio)

  it('prefere Groq sem usar Gemini e identifica origem/modelo', async () => {
    fetchMock.mockResolvedValue(respostaGroq())
    expect(await executar()).toMatchObject({ provedor: 'groq', modelo: operacao === 'redigir' ? 'openai/gpt-oss-120b' : 'whisper-large-v3' })
    expect(gemini()).not.toHaveBeenCalled()
  })
  it.each([429, 503, 'rede'])('usa Gemini como reserva para Groq com %s', async erro => {
    if (erro === 'rede') fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    else fetchMock.mockResolvedValue(new Response('{}', { status: Number(erro) }))
    const progresso = vi.fn()
    const resultado = await executar(settings, progresso)
    expect(resultado).toMatchObject({ provedor: 'gemini', modelo: operacao === 'redigir' ? 'gemini-3.6-flash' : 'gemini-3.5-transcribe' })
    expect(gemini()).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(progresso).toHaveBeenCalledWith('Tentando a reserva: Gemini…', 0.05, undefined, 'gemini')
    expect(gemini()).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'gemini-chave-ficticia' }))
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer groq-chave-ficticia' })
  })
  it('funciona só com a chave Groq', async () => {
    fetchMock.mockResolvedValue(respostaGroq())
    expect(await executar({ ...settings, apiKey: '' })).toMatchObject({ provedor: 'groq' })
    expect(gemini()).not.toHaveBeenCalled()
  })
  it('funciona só com a chave Gemini mesmo se o preferido é Groq', async () => {
    expect(await executar({ ...settings, groqApiKey: '' })).toMatchObject({ provedor: 'gemini' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('respeita a preferência Gemini e reserva Groq', async () => {
    gemini().mockRejectedValue(new GeminiError('cota', 'Cota Gemini esgotada.'))
    fetchMock.mockResolvedValue(respostaGroq())
    expect(await executar({ ...settings, provedorPreferido: 'gemini' })).toMatchObject({ provedor: 'groq' })
    expect(gemini()).toHaveBeenCalledTimes(1)
  })
  it('não usa a reserva com chave inválida ou erro de conteúdo', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 401 }))
    await expect(executar()).rejects.toThrow(/chave do Groq foi recusada/)
    expect(gemini()).not.toHaveBeenCalled()
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }))
    await expect(executar()).rejects.toMatchObject({ kind: 'conteudo' })
    expect(gemini()).not.toHaveBeenCalled()
  })
  it('mostra erro útil quando os dois fornecedores falham', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 429 }))
    gemini().mockRejectedValue(new GeminiError('sobrecarga', 'Gemini sobrecarregado.'))
    await expect(executar()).rejects.toThrow(/Groq:.*Gemini:/)
  })
  it('orienta configurar ao menos uma chave sem fazer chamadas', async () => {
    await expect(executar({ ...settings, apiKey: '', groqApiKey: '' })).rejects.toThrow(/chave do Groq ou do Gemini/)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(gemini()).not.toHaveBeenCalled()
  })
})

it('registra todos os modelos Gemini efetivos em uma transcrição por faixas', async () => {
  vi.mocked(transcreverAudio).mockImplementation(async opts => {
    opts.onModeloUsado?.('gemini-3.6-flash'); opts.onModeloUsado?.('gemini-3.8-flash'); opts.onModeloUsado?.('gemini-3.6-flash')
    return transcript
  })
  expect(await transcreverComProvedores({ settings: { ...settings, groqApiKey: '' }, meta, file })).toMatchObject({ modelo: 'gemini-3.6-flash, gemini-3.8-flash' })
})
