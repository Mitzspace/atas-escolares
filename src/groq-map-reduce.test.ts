import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { redigirGroq } from './groq'
import { estimarTokens } from './groq-limites'
import type { MeetingMetadata } from './ata-api'
const meta: MeetingMetadata = {
  escola: 'Teste', rede: 'Municipal', municipioUf: 'Teste/SP', tipo: 'pedagogica', ordinaria: true, numero: 1, ano: 2026,
  data: '2026-10-25', horaInicio: '14:00', local: 'Escola', presidente: { nome: 'Maria', cargo: 'Diretora' },
  secretario: { nome: 'Joana', cargo: 'Coordenadora' }, participantes: [], pauta: ['Frequência'], anonimizarAlunos: true,
}
const extraida = { itens: [{ pauta: 1, relato: 'Mais de quinze faltas; Carlos lembrou que os pais trabalhavam sábado.' }],
  deliberacoes: [{ texto: 'Foi aprovada a feira' }], encaminhamentos: [{ acao: 'Enviar regulamento', responsavel: 'Clara' }], pendencias: [] }
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>
beforeEach(() => {
  localStorage.clear(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-25T12:00:00Z'))
  fetchMock = vi.fn<typeof fetch>(); vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
it('faz map-reduce com pedidos de até 5 mil tokens e progresso durante a espera', async () => {
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ usage: { total_tokens: 100 }, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(extraida) } }] }), { status: 200 }))
  const onProgress = vi.fn()
  const tarefa = redigirGroq({ apiKey: 'teste', modelo: 'openai/gpt-oss-120b', meta,
    transcript: [{ speaker: 'Carlos', start: '00:00', end: '40:00', text: 'Argumentos e fatos importantes. '.repeat(1600) }], onProgress })
  await vi.advanceTimersByTimeAsync(0)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(onProgress).toHaveBeenCalledWith(expect.stringMatching(/parte 2 de \d+, aguardando limite do Groq/), expect.any(Number), 'openai/gpt-oss-120b', 'groq')
  await vi.advanceTimersByTimeAsync(59999); expect(fetchMock).toHaveBeenCalledTimes(1)
  await vi.runAllTimersAsync()
  const resultado = await tarefa
  expect(fetchMock.mock.calls.length).toBeGreaterThan(1)
  expect(resultado.extraida.deliberacoes).toHaveLength(1)
  expect(resultado.extraida.encaminhamentos).toHaveLength(1)
  expect(resultado.extraida.itens[0].relato).toContain('pais trabalhavam sábado')
  for (const [, init] of fetchMock.mock.calls) expect(estimarTokens(JSON.parse(init?.body as string))).toBeLessThanOrEqual(5000)
})
it('429 temporário é repetido só uma vez após um minuto; persistência permite reserva', async () => {
  fetchMock.mockImplementation(async () => new Response('{"error":"TPM rate limit"}', { status: 429 }))
  const verificar = expect(redigirGroq({ apiKey: 'teste', modelo: 'openai/gpt-oss-120b', meta, transcript: [] })).rejects.toMatchObject({ kind: 'cota' })
  await vi.advanceTimersByTimeAsync(0); expect(fetchMock).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(60000); await verificar
  expect(fetchMock).toHaveBeenCalledTimes(2)
})
it('429 diário não desperdiça outra janela tentando a mesma cota', async () => {
  fetchMock.mockResolvedValue(new Response('{"error":"TPD per day"}', { status: 429 }))
  await expect(redigirGroq({ apiKey: 'teste', modelo: 'openai/gpt-oss-120b', meta, transcript: [] })).rejects.toMatchObject({ kind: 'cota' })
  expect(fetchMock).toHaveBeenCalledTimes(1)
})
