import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getAta, getSettings, patchAta, getAudio, deleteAudio } from './db'
import { gerarAta, GeminiError } from './gemini'
import { rodarGeracaoAta, rodarTranscricao } from './pipeline'
import { SETTINGS_PADRAO, type AtaRecord } from './types'
import type { AtaExtraida } from './ata-api'

vi.mock('./db', () => ({
  getAta: vi.fn(), getSettings: vi.fn(), patchAta: vi.fn(),
  getAudio: vi.fn(), deleteAudio: vi.fn(),
}))
vi.mock('./gemini', async importOriginal => ({
  ...await importOriginal<typeof import('./gemini')>(), gerarAta: vi.fn(),
}))
const ata: AtaRecord = {
  id: 'teste', criadaEm: 0, atualizadaEm: 0, status: 'transcricao', transcript: [],
  modeloRedacao: 'modelo-anterior',
  meta: {
    escola: 'Escola de teste', rede: 'Municipal', municipioUf: 'Exemplo/SP',
    tipo: 'pedagogica', ordinaria: true, numero: 1, ano: 2026, data: '2026-10-20',
    horaInicio: '14:00', horaFim: '15:00', local: 'sala dos professores',
    presidente: { nome: 'Maria Souza', cargo: 'Diretora' },
    secretario: { nome: 'Paulo Reis', cargo: 'Secretário' },
    participantes: [], pauta: ['Calendário'], anonimizarAlunos: true,
  },
}
const extraida: AtaExtraida = { itens: [], deliberacoes: [], encaminhamentos: [], pendencias: [] }

beforeEach(() => {
  localStorage.clear()
  vi.resetAllMocks()
  vi.mocked(getAta).mockResolvedValue(ata)
  vi.mocked(getSettings).mockResolvedValue({ ...SETTINGS_PADRAO, apiKey: 'teste' })
  vi.mocked(patchAta).mockResolvedValue()
})

it.each(['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-flash-lite-latest'])(
  'salva o modelo efetivo %s junto ao resultado da redação e informa no progresso', async modeloUsado => {
    vi.mocked(gerarAta).mockResolvedValue({ extraida, modeloUsado })
    const progresso = vi.fn()
    await rodarGeracaoAta('teste', progresso)
    expect(gerarAta).toHaveBeenCalledWith(expect.objectContaining({ modelo: 'gemini-3.8-flash' }))
    expect(patchAta).toHaveBeenLastCalledWith('teste', expect.objectContaining({
      status: 'ata', extraida, renderizada: expect.any(Object), modeloRedacao: modeloUsado,
    }))
    expect(progresso).toHaveBeenLastCalledWith('Ata pronta', 1, modeloUsado, 'gemini')
  },
)

it('não substitui o modelo salvo se a nova geração falha', async () => {
  vi.mocked(gerarAta).mockRejectedValue(new GeminiError('cota', 'Cota esgotada'))
  await expect(rodarGeracaoAta('teste', vi.fn())).rejects.toThrow('Cota esgotada')
  expect(patchAta).toHaveBeenLastCalledWith('teste', { status: 'erro', erro: expect.stringContaining('Cota esgotada') })
  expect(vi.mocked(patchAta).mock.calls).not.toContainEqual([
    'teste', expect.objectContaining({ modeloRedacao: expect.anything() }),
  ])
})


afterEach(() => vi.unstubAllGlobals())

it('transcreve e redige apenas com Groq, salvando origem/modelo de cada etapa', async () => {
  vi.mocked(getSettings).mockResolvedValue({ ...SETTINGS_PADRAO, groqApiKey: 'groq-chave-ficticia', apiKey: '' })
  vi.mocked(getAudio).mockResolvedValue({ id: 'teste', blob: new Blob(['audio fictício']), nome: 'teste.wav', mimeType: 'audio/wav' })
  const fetchMock = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify({ segments: [{ start: 0, end: 2, text: 'Boa tarde.' }] }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(extraida) } }] }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  const progresso = vi.fn()
  await rodarTranscricao('teste', progresso)
  const transcript = [{ speaker: 'Falante', start: '00:00', end: '00:02', text: 'Boa tarde.' }]
  expect(patchAta).toHaveBeenLastCalledWith('teste', { status: 'transcricao', transcript, provedorTranscricao: 'groq', modeloTranscricao: 'whisper-large-v3' })
  expect(deleteAudio).toHaveBeenCalledWith('teste')
  vi.mocked(getAta).mockResolvedValue({ ...ata, transcript })
  await rodarGeracaoAta('teste', progresso)
  expect(patchAta).toHaveBeenLastCalledWith('teste', expect.objectContaining({
    status: 'ata', provedorRedacao: 'groq', modeloRedacao: 'openai/gpt-oss-120b', extraida,
  }))
  expect(gerarAta).not.toHaveBeenCalled()
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

it('salva a redação sanitizada mesmo quando o modelo revela um aluno da transcrição', async () => {
  const fonte = [{ speaker: 'Falante', start: '00:00', end: '00:10', text: 'O aluno Pedro Henrique teve mais de 15 faltas.' }]
  vi.mocked(getAta).mockResolvedValue({ ...ata, transcript: fonte })
  vi.mocked(gerarAta).mockResolvedValue({ modeloUsado: 'gemini-3.8-flash', extraida: {
    ...extraida, itens: [{ pauta: 1, relato: 'Pedro Henrique acumulou mais de quinze faltas.' }],
  } })
  await rodarGeracaoAta('teste', vi.fn())
  const salvo = vi.mocked(patchAta).mock.lastCall?.[1]
  expect(salvo?.extraida?.itens[0].relato).toBe('P.H. acumulou mais de quinze faltas.')
  expect(salvo?.renderizada?.texto).not.toContain('Pedro Henrique')
  expect(salvo?.renderizada?.texto).toContain('P.H.')
})
