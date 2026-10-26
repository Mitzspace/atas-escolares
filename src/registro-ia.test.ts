import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getAta, getSettings, patchAta } from './db'
import { gerarAta, gerarJsonGemini } from './gemini'
import { identificarFalantes, organizarAnotacoesComIA } from './provedores'
import { rodarGeracaoAta, usarTextoComoEsta } from './pipeline'
import { SETTINGS_PADRAO, type AtaRecord } from './types'
import { FALANTE_NAO_IDENTIFICADO, type AtaExtraida, type MeetingMetadata, type TranscriptSegment } from './ata-api'

vi.mock('./db', () => ({ getAta: vi.fn(), getSettings: vi.fn(), patchAta: vi.fn(), getAudio: vi.fn(), deleteAudio: vi.fn() }))
vi.mock('./gemini', async importOriginal => ({
  ...await importOriginal<typeof import('./gemini')>(), gerarAta: vi.fn(), gerarJsonGemini: vi.fn(),
}))

const meta: MeetingMetadata = {
  escola: 'Escola de teste', rede: 'Municipal', municipioUf: 'Exemplo/SP', tipo: 'pedagogica', ordinaria: true, numero: 1, ano: 2026,
  data: '2026-10-20', horaInicio: '14:00', horaFim: '15:00', local: 'sala dos professores',
  presidente: { nome: 'Maria Souza', cargo: 'Diretora' }, secretario: { nome: 'Paulo Reis', cargo: 'Professor' },
  participantes: [{ nome: 'Joana Alves', cargo: 'Coordenadora pedagógica', presente: true }], pauta: ['Calendário'], anonimizarAlunos: false,
}
const seg = (speaker: string, text: string, i: number): TranscriptSegment => ({ speaker, start: `0${i}:00`, end: `0${i}:30`, text })
const segs = [seg('Falante 1', 'Boa tarde, sou a Joana Alves.', 0), seg('Falante 1', 'Vamos começar.', 1)]
const ata = (extra: Partial<AtaRecord> = {}): AtaRecord => ({ id: 'a', criadaEm: 0, atualizadaEm: 0, status: 'transcricao', meta, ...extra })
const extraida: AtaExtraida = {
  itens: [{ pauta: 1, relato: 'Tratou-se do calendário.' }], deliberacoes: [{ texto: 'Aprovado o calendário.' }],
  encaminhamentos: [{ acao: 'Enviar aviso.' }], pendencias: [],
}
const respostaGroq = (conteudo: unknown) => ({ ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(conteudo) } }], usage: { total_tokens: 100 } }) })

beforeEach(() => {
  localStorage.clear()
  vi.resetAllMocks()
  vi.mocked(getSettings).mockResolvedValue({ ...SETTINGS_PADRAO, apiKey: 'g' })
  vi.mocked(patchAta).mockResolvedValue()
})
afterEach(() => vi.unstubAllGlobals())

it('identificarFalantes (Gemini): só aceita atribuição com evidência; o resto fica não identificado', async () => {
  vi.mocked(gerarJsonGemini).mockResolvedValue({ modeloUsado: 'm', dados: { atribuicoes: [{ trecho: 1, falante: 'Joana Alves', evidencia: 'sou a Joana Alves' }, { trecho: 2, falante: 'Joana Alves', evidencia: 'palpite' }] } })
  const r = await identificarFalantes(segs, meta.participantes, { settings: { ...SETTINGS_PADRAO, apiKey: 'g' }, meta })
  expect(r.dados.map(s => s.speaker)).toEqual(['Joana Alves', FALANTE_NAO_IDENTIFICADO])
  expect(r).toMatchObject({ provedor: 'gemini', identificados: 1, naoIdentificados: 1 })
  expect(vi.mocked(gerarJsonGemini).mock.calls[0][0].userPrompt).toContain('Joana Alves')
})

it('identificarFalantes (só Groq): usa fetch simulado e valida o schema', async () => {
  const fetchMock = vi.fn().mockResolvedValue(respostaGroq({ atribuicoes: [{ trecho: 1, falante: 'Joana Alves', evidencia: 'sou a Joana Alves' }] }))
  vi.stubGlobal('fetch', fetchMock)
  const r = await identificarFalantes(segs, meta.participantes, { settings: { ...SETTINGS_PADRAO, apiKey: '', groqApiKey: 'k' }, meta })
  expect(r.provedor).toBe('groq')
  expect(r.dados[0].speaker).toBe('Joana Alves')
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).response_format.json_schema.name).toBe('falantes')
})

it('identificarFalantes: dispensa a chamada com um único trecho ou sem trechos genéricos', async () => {
  const cfg = { settings: { ...SETTINGS_PADRAO, apiKey: 'g' }, meta }
  expect((await identificarFalantes([segs[0]], [], cfg)).dados).toEqual([segs[0]])
  expect((await identificarFalantes([seg('Joana Alves', 'a', 0), seg('Maria Souza', 'b', 1)], [], cfg)).identificados).toBe(0)
  expect(gerarJsonGemini).not.toHaveBeenCalled()
})

it('organizarAnotacoesComIA: sem texto não chama provedor; com texto manda as anotações e transcript vazio', async () => {
  vi.mocked(gerarAta).mockResolvedValue({ extraida, modeloUsado: 'm' })
  const settings = { ...SETTINGS_PADRAO, apiKey: 'g' }
  await expect(organizarAnotacoesComIA({ settings, meta, anotacoes: [{ texto: ' ' }] })).rejects.toThrow(/anotações/)
  await organizarAnotacoesComIA({ settings, meta, anotacoes: [{ texto: 'calendario aprovado', tempo: '01:00' }] })
  expect(gerarAta).toHaveBeenCalledWith(expect.objectContaining({ transcript: [], anotacoes: [{ texto: 'calendario aprovado', tempo: '01:00' }] }))
})

it('rodarGeracaoAta (Digitar): sem transcrição, usa anotações e grava o resumo', async () => {
  vi.mocked(getAta).mockResolvedValue(ata({ anotacoes: [{ texto: 'calendario aprovado' }] } as Partial<AtaRecord>))
  vi.mocked(gerarAta).mockResolvedValue({ extraida, modeloUsado: 'm' })
  await rodarGeracaoAta('a', vi.fn())
  expect(patchAta).toHaveBeenLastCalledWith('a', expect.objectContaining({
    status: 'ata', resumo: { assuntos: ['Calendário'], decisoes: ['Aprovado o calendário'], encaminhamentos: ['Enviar aviso'] },
  }))
})

it('rodarGeracaoAta (Gravar e digitar): manda transcrição e anotações juntas', async () => {
  vi.mocked(getAta).mockResolvedValue(ata({ transcript: segs, anotacoes: [{ texto: 'prova dia 10', tempo: '00:30' }] } as Partial<AtaRecord>))
  vi.mocked(gerarAta).mockResolvedValue({ extraida, modeloUsado: 'm' })
  await rodarGeracaoAta('a', vi.fn())
  expect(gerarAta).toHaveBeenCalledWith(expect.objectContaining({ transcript: segs, anotacoes: [{ texto: 'prova dia 10', tempo: '00:30' }] }))
})

it('rodarGeracaoAta: sem transcrição nem anotações continua falhando', async () => {
  vi.mocked(getAta).mockResolvedValue(ata())
  await expect(rodarGeracaoAta('a', vi.fn())).rejects.toThrow(/transcrição/)
})

it('usarTextoComoEsta: renderiza sem IA e grava resumo', async () => {
  vi.mocked(getAta).mockResolvedValue(ata({ status: 'rascunho' }))
  await usarTextoComoEsta('a', 'Tratou-se do calendário.\nFicou decidido que as provas serão em novembro.')
  const patch = vi.mocked(patchAta).mock.calls[0][1] as Record<string, any>
  expect(patch.status).toBe('ata')
  expect(patch.renderizada.texto).toMatch(/^Aos vinte dias do mês de outubro.*Nada mais havendo a tratar/)
  expect(patch.resumo.decisoes).toHaveLength(1)
  expect(gerarAta).not.toHaveBeenCalled()
  await expect(usarTextoComoEsta('a', '  ')).rejects.toThrow()
})

it('Gravar e digitar: modelo que ignora as anotações não as perde (incorporadas por código)', async () => {
  const ignorou: AtaExtraida = { itens: [{ pauta: 1, relato: 'No primeiro item da pauta, [PENDENTE: item não registrado na transcrição].' }], deliberacoes: [], encaminhamentos: [], pendencias: [] }
  const notas = [{ texto: 'Prova de Matemática dia 10', tempo: '00:01' }, { texto: 'Carlos Mendes ficou responsável pelo cartaz', tempo: '00:03' }]
  vi.mocked(getAta).mockResolvedValue(ata({ transcript: segs, anotacoes: notas } as Partial<AtaRecord>))
  vi.mocked(gerarAta).mockResolvedValue({ extraida: ignorou, modeloUsado: 'gemini-3.5-flash-lite' })
  await rodarGeracaoAta('a', vi.fn())
  const patch = vi.mocked(patchAta).mock.calls.at(-1)![1] as Record<string, any>
  expect(patch.renderizada.texto).toContain('Carlos Mendes ficou responsável pelo cartaz')
  expect(patch.renderizada.texto).toMatch(/matemática dia dez/i)
  expect(patch.extraida.pendencias.filter((p: string) => p.startsWith('conferir anotação incorporada'))).toHaveLength(2)
})
