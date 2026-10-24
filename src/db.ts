import Dexie, { type EntityTable } from 'dexie'
import { SETTINGS_PADRAO, type AtaRecord, type Settings } from './types'

type SettingsRow = { id: 'main'; value: Settings }
type AudioRow = { id: string; blob: Blob; nome: string; mimeType: string }
/** gravação em andamento (ou interrompida) feita pelo próprio site */
export type SessaoGravacao = { id: string; mimeType: string; ext: string; iniciadaEm: number; duracaoMs: number }
export type PedacoGravacao = { id?: number; sessaoId: string; seq: number; blob: Blob }

class AtasDB extends Dexie {
  settings!: EntityTable<SettingsRow, 'id'>
  atas!: EntityTable<AtaRecord, 'id'>
  audios!: EntityTable<AudioRow, 'id'>
  sessoesGravacao!: EntityTable<SessaoGravacao, 'id'>
  pedacosGravacao!: EntityTable<PedacoGravacao, 'id'>
  constructor(name = 'atas-escolares') {
    super(name)
    this.version(1).stores({ settings: 'id', atas: 'id, atualizadaEm', audios: 'id' })
    this.version(2).stores({
      settings: 'id', atas: 'id, atualizadaEm', audios: 'id',
      sessoesGravacao: 'id, iniciadaEm', pedacosGravacao: '++id, sessaoId',
    })
  }
}

export const db = new AtasDB()

export async function getSettings(): Promise<Settings> {
  const row = await db.settings.get('main')
  return { ...SETTINGS_PADRAO, ...row?.value }
}
export async function saveSettings(value: Settings) {
  await db.settings.put({ id: 'main', value })
}

export async function listAtas(): Promise<AtaRecord[]> {
  return db.atas.orderBy('atualizadaEm').reverse().toArray()
}
export const getAta = (id: string) => db.atas.get(id)
export async function saveAta(ata: AtaRecord) {
  await db.atas.put({ ...ata, atualizadaEm: Date.now() })
}
export async function patchAta(id: string, patch: Partial<AtaRecord>) {
  await db.atas.update(id, { ...patch, atualizadaEm: Date.now() })
}
export const deleteAta = async (id: string) => {
  await db.transaction('rw', db.atas, db.audios, async () => {
    await db.atas.delete(id)
    await db.audios.delete(id)
  })
}

export const saveAudio = (id: string, file: File) =>
  db.audios.put({ id, blob: file, nome: file.name, mimeType: file.type })
export const getAudio = (id: string) => db.audios.get(id)
export const deleteAudio = (id: string) => db.audios.delete(id)

export const iniciarSessaoGravacao = (s: SessaoGravacao) => db.sessoesGravacao.put(s)
export async function salvarPedacoGravacao(sessaoId: string, seq: number, blob: Blob, duracaoMs: number) {
  await db.transaction('rw', db.pedacosGravacao, db.sessoesGravacao, async () => {
    await db.pedacosGravacao.add({ sessaoId, seq, blob })
    await db.sessoesGravacao.update(sessaoId, { duracaoMs })
  })
}
export async function atualizarDuracaoSessao(sessaoId: string, duracaoMs: number) {
  await db.sessoesGravacao.update(sessaoId, { duracaoMs })
}
export const listarSessoesGravacao = () => db.sessoesGravacao.orderBy('iniciadaEm').toArray()
export async function pedacosDaSessao(sessaoId: string): Promise<Blob[]> {
  const ps = await db.pedacosGravacao.where('sessaoId').equals(sessaoId).toArray()
  return ps.sort((a, b) => a.seq - b.seq).map(p => p.blob)
}
export async function apagarSessaoGravacao(sessaoId: string) {
  await db.transaction('rw', db.pedacosGravacao, db.sessoesGravacao, async () => {
    await db.pedacosGravacao.where('sessaoId').equals(sessaoId).delete()
    await db.sessoesGravacao.delete(sessaoId)
  })
}

export async function proximoNumero(ano: number): Promise<number> {
  const todas = await db.atas.toArray()
  const nums = todas.filter(a => a.meta.ano === ano).map(a => a.meta.numero)
  return (nums.length ? Math.max(...nums) : 0) + 1
}

export function novoId(): string {
  return crypto.randomUUID()
}
