import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LIMITE_AUDIO_GROQ_BYTES, parseTranscricaoGroq, redigirGroq, schemaAtaGroq, testarChaveGroq, transcreverGroq, validarAtaGroq } from './groq'
import type { MeetingMetadata } from './ata-api'

const meta: MeetingMetadata = {
  escola: 'Escola teste', rede: 'Municipal', municipioUf: 'Exemplo/SP', tipo: 'pais', ordinaria: true,
  numero: 1, ano: 2026, data: '2026-10-25', horaInicio: '19:00', local: 'Escola',
  presidente: { nome: 'Maria', cargo: 'Diretora' }, secretario: { nome: 'Joana', cargo: 'Coordenadora' },
  participantes: [], pauta: ['Frequência'], anonimizarAlunos: true,
}
const ata = { itens: [{ pauta: 1, relato: 'O portão fechava às sete horas e dez minutos.' }], deliberacoes: [], encaminhamentos: [], pendencias: [] }
const file = new File(['áudio fictício'], 'reuniao.wav', { type: 'audio/wav' })
const apiKey = 'chave-ficticia-testes'
const resposta = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>
beforeEach(() => { fetchMock = vi.fn<typeof fetch>(); vi.stubGlobal('fetch', fetchMock) })
afterEach(() => vi.unstubAllGlobals())

it('envia Whisper em português com verbose_json e segmentos, sem forjar falantes', async () => {
  fetchMock.mockResolvedValue(resposta({ segments: [
    { start: 0, end: 3.9, text: ' Sou Maria, diretora. ' },
    { start: 3661.5, end: 3665.9, text: 'Sou Rui.' },
  ] }))
  const progresso = vi.fn()
  const resultado = await transcreverGroq({ apiKey, modelo: 'whisper-large-v3', file, onProgress: progresso })
  expect(resultado).toEqual({ modeloUsado: 'whisper-large-v3', transcript: [
    { speaker: 'Falante', start: '00:00', end: '00:03', text: 'Sou Maria, diretora.' },
    { speaker: 'Falante', start: '61:01', end: '61:05', text: 'Sou Rui.' },
  ] })
  const [url, init] = fetchMock.mock.calls[0]
  expect(url).toBe('https://api.groq.com/openai/v1/audio/transcriptions')
  expect(init?.headers).toEqual({ Authorization: `Bearer ${apiKey}` }) // navegador gera o boundary multipart
  const form = init?.body as FormData
  expect(form.get('file')).toBeInstanceOf(File)
  expect(form.get('model')).toBe('whisper-large-v3')
  expect(form.get('language')).toBe('pt')
  expect(form.get('response_format')).toBe('verbose_json')
  expect(form.get('timestamp_granularities[]')).toBe('segment')
  expect(form.get('temperature')).toBe('0')
  expect(progresso).toHaveBeenCalledWith(expect.any(String), 0.2, 'whisper-large-v3', 'groq')
})

it('aceita o modelo Turbo configurado e o limite exato de 25 MB', async () => {
  const grande = new File(['x'], 'audio.mp3')
  Object.defineProperty(grande, 'size', { value: LIMITE_AUDIO_GROQ_BYTES })
  fetchMock.mockResolvedValue(resposta({ segments: [{ start: 0, end: 1, text: 'Olá.' }] }))
  await transcreverGroq({ apiKey, modelo: 'whisper-large-v3-turbo', file: grande })
  expect((fetchMock.mock.calls[0][1]?.body as FormData).get('model')).toBe('whisper-large-v3-turbo')
})

it('recusa áudio acima do limite antes do upload, sem cortar bytes de mídia', async () => {
  const grande = new File(['x'], 'audio.mp3')
  Object.defineProperty(grande, 'size', { value: LIMITE_AUDIO_GROQ_BYTES + 1 })
  await expect(transcreverGroq({ apiKey, modelo: 'whisper-large-v3', file: grande })).rejects.toThrow(/25 MB.*partes menores/)
  expect(fetchMock).not.toHaveBeenCalled()
})

it.each([{}, { text: 'sem segmentos' }, { segments: [] }, { segments: [{ start: -1, end: 2, text: 'x' }] },
  { segments: [{ start: 4, end: 2, text: 'x' }] }, { segments: [{ start: 0, end: 2, text: ' ' }] }])(
  'não aceita segmentos ausentes, vazios ou tempos inválidos: %j', body => expect(() => parseTranscricaoGroq(body)).toThrow(),
)

it.each(['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b'])(
  'redige com %s e JSON Schema estrito compatível com ataResponseSchema', async modelo => {
    fetchMock.mockResolvedValue(resposta({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
      ...ata, manifestacoes: null, orientacoes: null, cienciaOrientado: null,
    }) } }] }))
    const resultado = await redigirGroq({ apiKey, modelo, meta, transcript: [] })
    expect(resultado).toEqual({ extraida: ata, modeloUsado: modelo })
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string)
    expect(body.model).toBe(modelo)
    expect(body.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'ata_escolar', strict: true, schema: schemaAtaGroq } })
    expect(body.messages[0].content).toContain('nunca adivinhe quem falou')
    expect(body.messages[0].content).toContain('Rótulos genéricos como "Falante"')
    expect(body.messages[0].content).toContain('campos opcionais sem informação')
    expect(body.max_completion_tokens).toBe(4096)
    if (modelo.startsWith('openai/')) expect(body.reasoning_effort).toBe('low')
    else expect(body).not.toHaveProperty('reasoning_effort')
  },
)

it('fecha todos os objetos e representa opcionais como null no schema estrito', () => {
  expect(schemaAtaGroq).toMatchObject({
    type: 'object', additionalProperties: false,
    required: ['itens', 'deliberacoes', 'encaminhamentos', 'manifestacoes', 'orientacoes', 'cienciaOrientado', 'pendencias'],
    properties: {
      manifestacoes: { type: ['array', 'null'], items: { type: 'string' } },
      deliberacoes: { items: { additionalProperties: false, required: ['texto', 'votacao'], properties: { votacao: { type: ['string', 'null'] } } } },
    },
  })
  expect(JSON.stringify(schemaAtaGroq)).not.toContain('propertyOrdering')
})

it('remove null dos opcionais de decisões e encaminhamentos antes de renderizar', () => {
  expect(validarAtaGroq({ ...ata, deliberacoes: [{ texto: 'Foi aprovado.', votacao: null }], encaminhamentos: [{ acao: 'Enviar comunicado.', responsavel: null, prazo: null }] })).toMatchObject({
    deliberacoes: [{ texto: 'Foi aprovado.' }], encaminhamentos: [{ acao: 'Enviar comunicado.' }],
  })
})
it.each([
  { ...ata, itens: null }, { ...ata, itens: [{ pauta: 'um', relato: 'x' }] }, { ...ata, encaminhamentos: [{}] },
  { ...ata, manifestacoes: [7] }, { ...ata, deliberacoes: [{ texto: 'x', votacao: 3 }] }, { ...ata, cienciaOrientado: 'sim' }, { ...ata, estranho: 'x' },
])('valida o contrato local mesmo com saída estruturada: %j', body => expect(() => validarAtaGroq(body)).toThrow(/formato da ata/))

it.each([
  { choices: [{ finish_reason: 'length', message: { content: JSON.stringify(ata) } }] },
  { choices: [{ finish_reason: 'stop', message: { content: '{inválido' } }] },
  { choices: [{ finish_reason: 'stop', message: { content: null, refusal: 'recusado' } }] },
])('não aceita resposta truncada, malformada ou recusada: %j', async body => {
  fetchMock.mockResolvedValue(resposta(body))
  await expect(redigirGroq({ apiKey, modelo: 'openai/gpt-oss-120b', meta, transcript: [] })).rejects.toMatchObject({ kind: 'conteudo' })
})

it.each([[401, 'chave'], [403, 'chave'], [429, 'cota'], [503, 'sobrecarga'], [400, 'conteudo'], [413, 'conteudo']])(
  'traduz HTTP %i em %s sem repetir a chamada', async (status, kind) => {
    fetchMock.mockResolvedValue(resposta({ error: 'erro fictício' }, status as number))
    await expect(testarChaveGroq(apiKey)).rejects.toMatchObject({ kind })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  },
)
it('traduz falha de fetch em rede e consulta catálogo para testar chave sem gerar texto', async () => {
  fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  await expect(testarChaveGroq(apiKey)).rejects.toMatchObject({ kind: 'rede' })
  fetchMock.mockResolvedValueOnce(resposta({ data: [{ id: 'openai/gpt-oss-120b' }] }))
  await testarChaveGroq(apiKey)
  expect(fetchMock.mock.lastCall?.[0]).toBe('https://api.groq.com/openai/v1/models')
  expect(fetchMock.mock.lastCall?.[1]).not.toHaveProperty('body')
})
it('chave ausente e modelo desconhecido não disparam chamadas', async () => {
  await expect(testarChaveGroq(' ')).rejects.toMatchObject({ kind: 'chave' })
  await expect(redigirGroq({ apiKey, modelo: 'modelo-inventado', meta, transcript: [] })).rejects.toMatchObject({ kind: 'conteudo' })
  expect(fetchMock).not.toHaveBeenCalled()
})


it('distingue JSON HTTP inválido de conexão interrompida durante a leitura', async () => {
  fetchMock.mockResolvedValueOnce(new Response('{inválido', { status: 200 }))
  await expect(testarChaveGroq(apiKey)).rejects.toMatchObject({ kind: 'conteudo' })
  fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({ start(controle) { controle.error(new TypeError('Connection reset')) } }), { status: 200 }))
  await expect(testarChaveGroq(apiKey)).rejects.toMatchObject({ kind: 'rede' })
})
