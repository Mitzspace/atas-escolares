import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { getSettings, saveSettings, saveAta, listAtas, proximoNumero, deleteAta } from './db'
import { SETTINGS_PADRAO, type AtaRecord } from './types'

const meta = {
  escola: 'E', rede: 'R', municipioUf: 'X/SP', tipo: 'pedagogica' as const, ordinaria: true, numero: 3, ano: 2026,
  data: '2026-03-10', horaInicio: '14:00', local: 'sala', presidente: { nome: 'A', cargo: 'Diretora' },
  secretario: { nome: 'B', cargo: 'Secretária' }, participantes: [], pauta: [], anonimizarAlunos: false,
}
const ata = (id: string): AtaRecord => ({ id, criadaEm: 1, atualizadaEm: 1, status: 'rascunho', meta })

describe('db', () => {
  it('configurações têm padrão e persistem', async () => {
    expect((await getSettings()).modelo).toBe(SETTINGS_PADRAO.modelo)
    await saveSettings({ ...SETTINGS_PADRAO, apiKey: 'k' })
    expect((await getSettings()).apiKey).toBe('k')
  })
  it('salva, lista, numera e apaga atas', async () => {
    await saveAta(ata('a1'))
    expect((await listAtas()).length).toBe(1)
    expect(await proximoNumero(2026)).toBe(4)
    expect(await proximoNumero(2027)).toBe(1)
    await deleteAta('a1')
    expect((await listAtas()).length).toBe(0)
  })
})

it('carrega configurações antigas com os padrões novos sem apagar a chave Gemini', async () => {
  const { db } = await import('./db')
  const antigo = { ...SETTINGS_PADRAO, apiKey: 'chave-gemini-ficticia' } as Partial<typeof SETTINGS_PADRAO>
  delete antigo.groqApiKey; delete antigo.modeloGroq; delete antigo.modeloTranscricaoGroq; delete antigo.provedorPreferido
  await db.settings.put({ id: 'main', value: antigo as typeof SETTINGS_PADRAO })
  expect(await getSettings()).toMatchObject({
    apiKey: 'chave-gemini-ficticia', groqApiKey: '', provedorPreferido: 'groq',
    modeloGroq: 'openai/gpt-oss-120b', modeloTranscricaoGroq: 'whisper-large-v3',
  })
})

it('persiste provedor e modelo de cada etapa sem mudar o índice do banco', async () => {
  const { getAta } = await import('./db')
  const registro = { ...ata('origens'), modeloTranscricao: 'whisper-large-v3', provedorTranscricao: 'groq' as const,
    modeloRedacao: 'gemini-3.8-flash', provedorRedacao: 'gemini' as const }
  await saveAta(registro)
  expect(await getAta('origens')).toMatchObject({ ...registro, atualizadaEm: expect.any(Number) })
  await deleteAta('origens')
})

it('usa o nome da escola em instalações novas e cadastros antigos vazios, preservando nomes personalizados', async () => {
  const { db } = await import('./db')
  await db.settings.clear()
  expect((await getSettings()).escola).toBe('Escola Municipal Professora Luiza Maria de Souza')
  await db.settings.put({ id: 'main', value: { ...SETTINGS_PADRAO, escola: '   ' } })
  expect((await getSettings()).escola).toBe(SETTINGS_PADRAO.escola)
  await db.settings.put({ id: 'main', value: { ...SETTINGS_PADRAO, escola: 'Escola Municipal Professora Luiza Maria' } })
  expect((await getSettings()).escola).toBe(SETTINGS_PADRAO.escola)
  await saveSettings({ ...SETTINGS_PADRAO, escola: 'Escola escolhida pela diretora' })
  expect((await getSettings()).escola).toBe('Escola escolhida pela diretora')
  await saveSettings({ ...SETTINGS_PADRAO, escola: '' })
  expect((await getSettings()).escola).toBe(SETTINGS_PADRAO.escola)
})
