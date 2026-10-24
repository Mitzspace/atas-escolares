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
