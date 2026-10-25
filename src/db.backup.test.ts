import 'fake-indexeddb/auto'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { criarBackup, db, getSettings, precisaBackup, registrarBackupConcluido, restaurarBackup, saveSettings, validarBackup } from './db'
import { SETTINGS_PADRAO, type AtaRecord, type BackupAtas } from './types'

const meta: AtaRecord['meta'] = {
  escola: 'Escola Municipal', rede: 'Municipal', municipioUf: 'São Paulo/SP', tipo: 'pedagogica', ordinaria: true,
  numero: 1, ano: 2026, data: '2026-10-25', horaInicio: '14:00', local: 'Sala',
  presidente: { nome: 'Maria', cargo: 'diretora' }, secretario: { nome: 'Clara', cargo: 'professora' },
  participantes: [{ nome: 'Clara', cargo: 'professora', presente: false }], pauta: ['Planejamento'], anonimizarAlunos: true,
}
const ata = (id = 'ata-1', atualizadaEm = 100): AtaRecord => ({
  id, criadaEm: 50, atualizadaEm, status: 'ata', meta,
  transcript: [{ speaker: 'Clara', start: '00:00', end: '00:10', text: 'Reunião aberta.' }],
  extraida: { itens: [{ pauta: 1, relato: 'A reunião foi aberta.' }], deliberacoes: [], encaminhamentos: [], pendencias: [] },
  renderizada: { titulo: 'Ata', texto: 'Texto original.', cabecalho: ['Escola'], assinaturas: [meta.presidente], pendencias: [] },
  textoEditado: 'Texto revisado.', convocados: ['clara'],
  provedorTranscricao: 'groq', modeloTranscricao: 'whisper-large-v3', provedorRedacao: 'gemini', modeloRedacao: 'gemini-3.8-flash',
})
const backup = (atas = [ata()]): BackupAtas => ({
  formato: 'atas-escolares', versao: 1, criadoEm: '2026-10-25T12:00:00.000Z',
  configuracoes: { ...SETTINGS_PADRAO, escola: 'Escola do backup', apiKey: 'gemini-do-backup', groqApiKey: 'groq-do-backup' }, atas,
})
const juntar = { modo: 'juntar' as const, substituirConfiguracoes: false, incluirChaves: false }
beforeEach(async () => {
  await Promise.all([db.settings.clear(), db.atas.clear(), db.audios.clear(), db.sessoesGravacao.clear(), db.pedacosGravacao.clear()])
})
afterEach(() => { vi.restoreAllMocks() })

describe('backup completo sem áudios', () => {
  it('exporta todas as atas e configurações, sem chaves por padrão nem áudios ou pedaços', async () => {
    await saveSettings({ ...SETTINGS_PADRAO, escola: 'Escola teste', apiKey: 'segredo-gemini', groqApiKey: 'segredo-groq',
      pessoas: [meta.presidente], assuntosExtras: { pedagogica: ['Projeto próprio'] }, ultimoBackupEm: 123 })
    await db.atas.bulkPut([ata(), ata('ata-2')])
    await db.audios.put({ id: 'ata-1', blob: new Blob(['audio secreto']), nome: 'audio.mp3', mimeType: 'audio/mp3' })
    await db.sessoesGravacao.put({ id: 's', mimeType: 'audio/webm', ext: 'webm', iniciadaEm: 1, duracaoMs: 10 })
    await db.pedacosGravacao.put({ sessaoId: 's', seq: 1, blob: new Blob(['pedaço secreto']) })
    const b = await criarBackup()
    expect(b).toMatchObject({ formato: 'atas-escolares', versao: 1, atas: [ata(), ata('ata-2')], configuracoes: {
      escola: 'Escola teste', pessoas: [meta.presidente], assuntosExtras: { pedagogica: ['Projeto próprio'] },
    } })
    expect(b.configuracoes).not.toHaveProperty('apiKey')
    expect(b.configuracoes).not.toHaveProperty('groqApiKey')
    expect(b.configuracoes).not.toHaveProperty('ultimoBackupEm')
    expect(Object.keys(b).sort()).toEqual(['atas', 'configuracoes', 'criadoEm', 'formato', 'versao'])
    expect(JSON.stringify(b)).not.toMatch(/segredo|audio secreto|pedaço secreto/)
    expect(validarBackup(JSON.stringify(b))).toEqual(b)
    expect(await getSettings()).toHaveProperty('ultimoBackupEm', 123)
  })
  it('inclui as duas chaves apenas quando solicitado', async () => {
    await saveSettings({ ...SETTINGS_PADRAO, apiKey: 'a', groqApiKey: 'b' })
    expect((await criarBackup(true)).configuracoes).toMatchObject({ apiKey: 'a', groqApiKey: 'b' })
  })
})

describe('restauração atômica', () => {
  it('junta por id mantendo a mais recente, inclusive empate, sem reescrever datas', async () => {
    await db.atas.bulkPut([ata('existente', 200), ata('antiga', 100), ata('igual', 100), ata('somente-local', 500)])
    const atualizado = { ...ata('antiga', 300), textoEditado: 'Atualização do backup' }
    expect(await restaurarBackup(backup([ata('existente', 50), atualizado, { ...ata('igual'), textoEditado: 'Não usar' }, ata('nova')]), juntar)).toBe(2)
    expect(await db.atas.get('existente')).toEqual(ata('existente', 200))
    expect(await db.atas.get('antiga')).toEqual(atualizado)
    expect(await db.atas.get('igual')).toEqual(ata('igual'))
    expect(await db.atas.count()).toBe(5)
  })
  it('substitui todos os registros e limpa áudios e gravações sem alterar configurações/chaves por padrão', async () => {
    await db.atas.put(ata('local'))
    await saveSettings({ ...SETTINGS_PADRAO, escola: 'Local', apiKey: 'minha-chave' })
    await db.audios.put({ id: 'local', blob: new Blob(['audio']), nome: 'a.mp3', mimeType: 'audio/mp3' })
    await db.sessoesGravacao.put({ id: 's', iniciadaEm: 1, duracaoMs: 1, mimeType: 'audio/webm', ext: 'webm' })
    await db.pedacosGravacao.put({ sessaoId: 's', seq: 0, blob: new Blob(['x']) })
    await restaurarBackup(backup(), { ...juntar, modo: 'substituir' })
    expect(await db.atas.toArray()).toEqual([ata()])
    expect(await Promise.all([db.audios.count(), db.sessoesGravacao.count(), db.pedacosGravacao.count()])).toEqual([0, 0, 0])
    expect(await getSettings()).toMatchObject({ escola: 'Local', apiKey: 'minha-chave', groqApiKey: '' })
  })
  it('substitui configurações somente com opção e mantém chaves e último backup locais', async () => {
    await saveSettings({ ...SETTINGS_PADRAO, apiKey: 'local-gemini', groqApiKey: 'local-groq', ultimoBackupEm: 123 })
    await restaurarBackup(backup(), { ...juntar, substituirConfiguracoes: true })
    expect(await getSettings()).toMatchObject({ escola: 'Escola do backup', apiKey: 'local-gemini', groqApiKey: 'local-groq', ultimoBackupEm: 123 })
  })
  it('importa chaves independentemente das configurações apenas com confirmação; ausentes mantêm as atuais', async () => {
    await saveSettings({ ...SETTINGS_PADRAO, escola: 'Local', apiKey: 'local-gemini', groqApiKey: 'local-groq' })
    const b = backup(); delete b.configuracoes.groqApiKey
    await restaurarBackup(b, { ...juntar, incluirChaves: true })
    expect(await getSettings()).toMatchObject({ escola: 'Local', apiKey: 'gemini-do-backup', groqApiKey: 'local-groq' })
    delete b.configuracoes.apiKey
    await restaurarBackup(b, { ...juntar, incluirChaves: true, substituirConfiguracoes: true })
    expect(await getSettings()).toMatchObject({ escola: 'Escola do backup', apiKey: 'gemini-do-backup', groqApiKey: 'local-groq' })
  })
  it('erro em uma escrita reverte limpeza, atas importadas e configurações', async () => {
    await db.atas.put(ata('local'))
    const put = db.atas.put.bind(db.atas)
    vi.spyOn(db.atas, 'put').mockImplementation((registro, chave) => {
      if (registro.id === 'falha') return Promise.reject(new Error('Falha de disco')) as ReturnType<typeof db.atas.put>
      return put(registro, chave)
    })
    await expect(restaurarBackup(backup([ata('nova'), ata('falha')]), { ...juntar, modo: 'substituir' })).rejects.toThrow('Falha de disco')
    expect(await db.atas.toArray()).toEqual([ata('local')])
  })
})

describe('validação e compatibilidade', () => {
  it.each([
    ['JSON quebrado', '{', /JSON/], ['formato errado', { ...backup(), formato: 'outro' }, /não é um backup/],
    ['versão futura', { ...backup(), versao: 2 }, /mais nova/], ['versão antiga inválida', { ...backup(), versao: 0 }, /não suportada/],
    ['data inválida', { ...backup(), criadoEm: 'ontem' }, /data/], ['atas inválidas', { ...backup(), atas: {} }, /atas/],
    ['ids repetidos', backup([ata(), ata()]), /repetidos/], ['id vazio', backup([ata('')]), /vazios/],
    ['configurações inválidas', { ...backup(), configuracoes: { pessoas: 'texto' } }, /pessoas/],
    ['transcrição malformada', { ...backup(), atas: [{ ...ata(), transcript: [{ text: 3 }] }] }, /transcript/],
    ['presença malformada', { ...backup(), atas: [{ ...ata(), meta: { ...meta, participantes: [{ nome: 'A', cargo: 'B', presente: 'sim' }] } }] }, /presente/],
  ])('rejeita %s antes de mudar o banco', async (_nome, entrada, mensagem) => {
    await db.atas.put(ata('local'))
    await expect(restaurarBackup(entrada, { ...juntar, modo: 'substituir' })).rejects.toThrow(mensagem)
    expect(await db.atas.toArray()).toEqual([ata('local')])
  })
  it('aceita atas antigas sem tipo/categoria/modelos nem campos opcionais novos', async () => {
    const antigo = { id: 'antiga', criadaEm: 1, atualizadaEm: 2, status: 'ata', meta: { ...meta },
      extraida: { itens: [], deliberacoes: [], encaminhamentos: [], pendencias: [] } }
    delete (antigo.meta as Partial<typeof meta>).tipo
    delete (antigo.meta as Partial<typeof meta>).ordinaria
    const b = validarBackup({ ...backup(), configuracoes: { escola: 'Legada', apiKey: 'k' }, atas: [antigo] })
    await restaurarBackup(b, { ...juntar, substituirConfiguracoes: true })
    expect(await db.atas.get('antiga')).toMatchObject({ meta: { tipo: 'pedagogica', ordinaria: true, participantes: meta.participantes } })
    expect(await getSettings()).toMatchObject({ escola: 'Legada', modelo: SETTINGS_PADRAO.modelo, provedorRedacaoPreferido: 'gemini', apiKey: '' })
  })
  it('descarta campos desconhecidos, inclusive áudio e protótipos no arquivo', () => {
    const configuracoes = JSON.parse('{"escola":"E","__proto__":{"apiKey":"injetada"}}')
    const b = validarBackup(JSON.stringify({ ...backup(), audios: ['blob'], atas: [{ ...ata(), audioBlob: 'blob' }], configuracoes }))
    expect(b).not.toHaveProperty('audios')
    expect(b.atas[0]).not.toHaveProperty('audioBlob')
    expect(b.configuracoes).not.toHaveProperty('apiKey')
    expect({}).not.toHaveProperty('apiKey')
  })
})

it('lembra backup após sete dias ou nunca; só registra a data após exportação concluída e preserva contra edição desatualizada', async () => {
  const agora = Date.now()
  expect(precisaBackup(0)).toBe(false)
  expect(precisaBackup(1)).toBe(true)
  expect(precisaBackup(1, agora - 7 * 86400000, agora)).toBe(false)
  expect(precisaBackup(1, agora - 7 * 86400000 - 1, agora)).toBe(true)
  await registrarBackupConcluido()
  const data = (await getSettings()).ultimoBackupEm!
  expect(data).toBeGreaterThanOrEqual(agora)
  await saveSettings({ ...SETTINGS_PADRAO, escola: 'Edição já aberta' })
  expect((await getSettings()).ultimoBackupEm).toBe(data)
  expect(precisaBackup(1, data)).toBe(false)
})
