import Dexie, { type EntityTable } from 'dexie'
import { SETTINGS_PADRAO, type AtaRecord, type Settings, type BackupAtas, type OpcoesRestauracao } from './types'

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
  const s = { ...SETTINGS_PADRAO, ...row?.value }
  if (typeof s.escola !== 'string' || !s.escola.trim()) s.escola = SETTINGS_PADRAO.escola
  return s
}
const avisarConfiguracoes = () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event('configuracoes-alteradas')) }
export async function saveSettings(value: Settings) {
  await db.transaction('rw', db.settings, async () => {
    const atual = await getSettings()
    const ultimoBackupEm = Math.max(atual.ultimoBackupEm ?? 0, value.ultimoBackupEm ?? 0) || undefined
    await db.settings.put({ id: 'main', value: { ...value, escola: value.escola.trim() ? value.escola : SETTINGS_PADRAO.escola, ultimoBackupEm } })
  })
  avisarConfiguracoes()
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

// O formato do backup é independente da versão dos índices do IndexedDB.
// A leitura reconstrói apenas campos conhecidos: nunca importa blobs ou tabelas de áudio.
type Regra = 'texto' | 'numero' | 'booleano' | { lista: Regra } | { valores: readonly string[] }
  | { campos: Record<string, Regra>; opcionais?: readonly string[] }
const lista = (regra: Regra): Regra => ({ lista: regra })
const objeto = (campos: Record<string, Regra>, opcionais: readonly string[] = []): Regra => ({ campos, opcionais })
const pessoa = objeto({ nome: 'texto', cargo: 'texto' })
const participante = objeto({ nome: 'texto', cargo: 'texto', presente: 'booleano',
  categoria: { valores: ['funcionario', 'responsavel', 'aluno'] }, vinculo: 'texto' }, ['categoria', 'vinculo'])
const metadados = objeto({
  escola: 'texto', rede: 'texto', municipioUf: 'texto', tipo: { valores: ['pedagogica', 'pais', 'orientacao'] },
  ordinaria: 'booleano', numero: 'numero', ano: 'numero', data: 'texto', horaInicio: 'texto', horaFim: 'texto',
  local: 'texto', presidente: pessoa, secretario: pessoa, participantes: lista(participante),
  orientados: lista(participante), orientado: participante, pauta: lista('texto'), anonimizarAlunos: 'booleano', glossario: lista('texto'),
}, ['tipo', 'ordinaria', 'horaFim', 'orientados', 'orientado', 'glossario'])
const extraida = objeto({
  itens: lista(objeto({ pauta: 'numero', relato: 'texto' })),
  deliberacoes: lista(objeto({ texto: 'texto', votacao: 'texto' }, ['votacao'])),
  encaminhamentos: lista(objeto({ acao: 'texto', responsavel: 'texto', prazo: 'texto' }, ['responsavel', 'prazo'])),
  pendencias: lista('texto'), manifestacoes: lista('texto'), orientacoes: lista('texto'), cienciaOrientado: 'booleano',
}, ['manifestacoes', 'orientacoes', 'cienciaOrientado'])
const regraAta = objeto({
  id: 'texto', criadaEm: 'numero', atualizadaEm: 'numero',
  status: { valores: ['rascunho', 'processando', 'transcricao', 'ata', 'erro'] }, erro: 'texto', meta: metadados,
  audioNome: 'texto', transcript: lista(objeto({ speaker: 'texto', start: 'texto', end: 'texto', text: 'texto' })),
  provedorTranscricao: { valores: ['gemini', 'groq'] }, modeloTranscricao: 'texto',
  provedorRedacao: { valores: ['gemini', 'groq'] }, modeloRedacao: 'texto', extraida,
  renderizada: objeto({ titulo: 'texto', cabecalho: lista('texto'), texto: 'texto', assinaturas: lista(pessoa), pendencias: lista('texto') }),
  textoEditado: 'texto', convocados: lista('texto'),
}, ['erro', 'audioNome', 'transcript', 'provedorTranscricao', 'modeloTranscricao', 'provedorRedacao', 'modeloRedacao',
  'extraida', 'renderizada', 'textoEditado', 'convocados'])
const camposSettings: Record<string, Regra> = {
  escola: 'texto', logoEscola: 'texto', rede: 'texto', municipioUf: 'texto', local: 'texto', pessoas: lista(pessoa), glossario: 'texto',
  assuntosExtras: objeto({ pedagogica: lista('texto'), pais: lista('texto'),
    orientacao_aluno: lista('texto'), orientacao_funcionario: lista('texto') },
  ['pedagogica', 'pais', 'orientacao_aluno', 'orientacao_funcionario']),
  modelo: 'texto', apiKey: 'texto', groqApiKey: 'texto', modeloGroq: 'texto', modeloTranscricaoGroq: 'texto',
  provedorPreferido: { valores: ['groq', 'gemini'] }, provedorTranscricaoPreferido: { valores: ['groq', 'gemini'] },
  provedorRedacaoPreferido: { valores: ['groq', 'gemini'] },
}

function lerCampo(valor: unknown, regra: Regra, caminho: string): unknown {
  const invalido = () => { throw new Error(`Backup inválido: confira o campo ${caminho}. Nenhum dado foi alterado.`) }
  if (typeof regra === 'string') {
    if (regra === 'texto' && typeof valor === 'string') return valor
    if (regra === 'booleano' && typeof valor === 'boolean') return valor
    if (regra === 'numero' && typeof valor === 'number' && Number.isFinite(valor) && valor >= 0) return valor
    return invalido()
  }
  if ('lista' in regra) {
    if (!Array.isArray(valor)) return invalido()
    return valor.map((v, i) => lerCampo(v, regra.lista, `${caminho}[${i + 1}]`))
  }
  if ('valores' in regra) return typeof valor === 'string' && regra.valores.includes(valor) ? valor : invalido()
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return invalido()
  const origem = valor as Record<string, unknown>
  const saida: Record<string, unknown> = {}
  for (const [campo, r] of Object.entries(regra.campos)) {
    const dado = Object.hasOwn(origem, campo) ? origem[campo] : undefined
    if (dado === undefined && regra.opcionais?.includes(campo)) continue
    saida[campo] = lerCampo(dado, r, `${caminho}.${campo}`)
  }
  return saida
}

/** Valida tudo antes de abrir a transação de escrita. Não usa dados do arquivo em mensagens. */
export function validarBackup(entrada: unknown): BackupAtas {
  let valor: unknown = entrada
  if (typeof entrada === 'string') {
    try { valor = JSON.parse(entrada) } catch { throw new Error('O arquivo não é um JSON de backup válido. Nenhum dado foi alterado.') }
  }
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) throw new Error('Arquivo de backup inválido.')
  const b = valor as Record<string, unknown>
  if (b.formato !== 'atas-escolares') throw new Error('Este arquivo não é um backup do Atas Escolares.')
  if (typeof b.versao === 'number' && b.versao > 1) throw new Error('Este backup foi criado em uma versão mais nova. Atualize o aplicativo antes de restaurar.')
  if (b.versao !== 1) throw new Error('Versão de backup não suportada.')
  if (typeof b.criadoEm !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(b.criadoEm) || !Number.isFinite(Date.parse(b.criadoEm))) {
    throw new Error('Backup inválido: data de criação ausente ou inválida.')
  }
  const configuracoes = lerCampo(b.configuracoes, objeto(camposSettings, Object.keys(camposSettings)), 'configurações') as BackupAtas['configuracoes']
  if (configuracoes.logoEscola && (configuracoes.logoEscola.length > 1_500_000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(configuracoes.logoEscola))) {
    throw new Error('Backup inválido: a logo da escola deve ser uma imagem PNG incorporada. Nenhum dado foi alterado.')
  }
  const atas = lerCampo(b.atas, lista(regraAta), 'atas') as AtaRecord[]
  const ids = new Set<string>()
  for (const ata of atas) {
    if (!ata.id.trim() || ids.has(ata.id)) throw new Error('Backup inválido: identificadores de atas vazios ou repetidos.')
    ids.add(ata.id)
    // Antes da inclusão de outros tipos, todas as atas eram pedagógicas.
    ata.meta.tipo ??= 'pedagogica'
    ata.meta.ordinaria ??= true
  }
  return { formato: 'atas-escolares', versao: 1, criadoEm: b.criadoEm, configuracoes, atas }
}

export async function criarBackup(incluirChaves = false): Promise<BackupAtas> {
  return db.transaction('r', db.settings, db.atas, async () => {
    const configuracoes: BackupAtas['configuracoes'] = { ...await getSettings() }
    delete (configuracoes as Partial<Settings>).ultimoBackupEm
    if (!incluirChaves) { delete configuracoes.apiKey; delete configuracoes.groqApiKey }
    return validarBackup({ formato: 'atas-escolares', versao: 1, criadoEm: new Date().toISOString(), configuracoes, atas: await db.atas.toArray() })
  })
}

export async function registrarBackupConcluido() {
  await db.transaction('rw', db.settings, async () => {
    await db.settings.put({ id: 'main', value: { ...await getSettings(), ultimoBackupEm: Date.now() } })
  })
}

export function precisaBackup(quantidadeAtas: number, ultimoBackupEm?: number, agora = Date.now()) {
  return quantidadeAtas > 0 && (!ultimoBackupEm || agora - ultimoBackupEm > 7 * 24 * 60 * 60 * 1000)
}

export async function restaurarBackup(entrada: unknown, opcoes: OpcoesRestauracao): Promise<number> {
  const backup = validarBackup(entrada)
  if (!['juntar', 'substituir'].includes(opcoes.modo)) throw new Error('Escolha como restaurar as atas.')
  const importadas = await db.transaction('rw', db.settings, db.atas, db.audios, db.sessoesGravacao, db.pedacosGravacao, async () => {
    const atuais = await getSettings()
    if (opcoes.modo === 'substituir') {
      await db.atas.clear()
      await db.audios.clear()
      await db.sessoesGravacao.clear()
      await db.pedacosGravacao.clear()
    }
    let importadas = 0
    for (const ata of backup.atas) {
      const atual = await db.atas.get(ata.id)
      if (atual && atual.atualizadaEm >= ata.atualizadaEm) continue
      await db.atas.put(ata)
      // Um áudio antigo não pode ficar associado a um registro importado diferente.
      await db.audios.delete(ata.id)
      importadas++
    }
    let configuracoes = atuais
    if (opcoes.substituirConfiguracoes) {
      const { apiKey: _gemini, groqApiKey: _groq, ...preferencias } = backup.configuracoes
      configuracoes = { ...SETTINGS_PADRAO, ...preferencias, apiKey: atuais.apiKey,
        groqApiKey: atuais.groqApiKey, ultimoBackupEm: atuais.ultimoBackupEm }
    }
    if (opcoes.incluirChaves) {
      if (backup.configuracoes.apiKey !== undefined) configuracoes.apiKey = backup.configuracoes.apiKey
      if (backup.configuracoes.groqApiKey !== undefined) configuracoes.groqApiKey = backup.configuracoes.groqApiKey
    }
    await db.settings.put({ id: 'main', value: configuracoes })
    return importadas
  })
  avisarConfiguracoes()
  return importadas
}
