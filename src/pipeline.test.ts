import { beforeEach, expect, it, vi } from 'vitest'
import { getAta, getSettings, patchAta } from './db'
import { gerarAta, GeminiError } from './gemini'
import { rodarGeracaoAta } from './pipeline'
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
    expect(progresso).toHaveBeenLastCalledWith('Ata pronta', 1, modeloUsado)
  },
)

it('não substitui o modelo salvo se a nova geração falha', async () => {
  vi.mocked(gerarAta).mockRejectedValue(new GeminiError('cota', 'Cota esgotada'))
  await expect(rodarGeracaoAta('teste', vi.fn())).rejects.toThrow('Cota esgotada')
  expect(patchAta).toHaveBeenLastCalledWith('teste', { status: 'erro', erro: 'Cota esgotada' })
  expect(vi.mocked(patchAta).mock.calls).not.toContainEqual([
    'teste', expect.objectContaining({ modeloRedacao: expect.anything() }),
  ])
})
