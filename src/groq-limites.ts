import { textoLivreParaPadrao, type AtaExtraida, type TranscriptSegment } from './ata-api'
import { ErroProvedor } from './types'

export const LIMITE_ENTRADA_GROQ = 5000
export const JANELA_GROQ_MS = 60_000
export const LIMITE_DIARIO_ESTIMADO = 180_000 // margem antes dos 200 mil TPD
export const estimarTokens = (valor: unknown) => Math.ceil((typeof valor === 'string' ? valor : JSON.stringify(valor)).length / 4)
const segundos = (tempo: string) => tempo.split(':').map(Number).reduce((s, n) => s * 60 + n, 0)

/** Mantém a ordem, os speakers e os tempos; divide também um trecho isolado muito longo. */
export function blocosTranscricao(transcript: TranscriptSegment[], limite = 4000): TranscriptSegment[][] {
  if (limite < 64) throw new ErroProvedor('cota', 'O cadastro e as instruções excedem o orçamento do Groq. Use o Gemini ou reduza os dados da reunião.')
  const blocos: TranscriptSegment[][] = []
  let atual: TranscriptSegment[] = [], tokens = 0
  for (const s of transcript) {
    const tamanhoTexto = Math.max(1, limite * 4 - JSON.stringify({ ...s, text: '' }).length - 80)
    for (let inicio = 0; inicio < Math.max(s.text.length, 1);) {
      let fim = Math.min(s.text.length, inicio + tamanhoTexto)
      if (fim < s.text.length) {
        const espaco = s.text.lastIndexOf(' ', fim - 1)
        if (espaco > inicio) fim = espaco + 1
      }
      const parte = { ...s, text: s.text.slice(inicio, fim) }
      inicio = fim || 1
      const custo = estimarTokens(parte) + 16
      if (atual.length && (tokens + custo > limite || segundos(parte.start) - segundos(atual[0].start) >= 1200)) {
        blocos.push(atual); atual = []; tokens = 0
      }
      atual.push(parte); tokens += custo
    }
  }
  if (atual.length) blocos.push(atual)
  return blocos.length ? blocos : [[]]
}

const normalizar = (s: string) => textoLivreParaPadrao(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const unicos = (valores: string[]) => [...new Map(valores.filter(Boolean).map(s => [normalizar(s), s])).values()]
/** Reduce local: não faz um novo resumo que possa perder votos, argumentos ou números. */
export function consolidarParciais(parciais: AtaExtraida[]): AtaExtraida {
  const pendencias = parciais.flatMap(p => p.pendencias)
  const itens = new Map<number, string[]>()
  for (const p of parciais) for (const i of p.itens) itens.set(i.pauta, [...(itens.get(i.pauta) ?? []), i.relato])
  const juntar = <T extends object>(lista: T[], chave: keyof T): T[] => {
    const mapa = new Map<string, T>()
    for (const item of lista) {
      const id = normalizar(String(item[chave]))
      const anterior = mapa.get(id)
      if (!anterior) { mapa.set(id, { ...item }); continue }
      for (const campo of Object.keys(item) as (keyof T)[]) {
        if (campo === chave || !item[campo]) continue
        if (!anterior[campo]) anterior[campo] = item[campo]
        else if (normalizar(String(anterior[campo])) !== normalizar(String(item[campo]))) {
          const descricao = `confirmar ${String(campo)}: ${String(anterior[campo])} / ${String(item[campo])}`
          pendencias.push(descricao)
          anterior[campo] = `[confirmar: ${descricao.replace(/^confirmar /, '')}]` as T[keyof T]
        }
      }
    }
    return [...mapa.values()]
  }
  const resultado: AtaExtraida = {
    itens: [...itens].map(([pauta, relatos]) => ({ pauta, relato: unicos(relatos).map(t => /[.!?]$/.test(t.trim()) ? t.trim() : `${t.trim()}.`).join(' ') })),
    deliberacoes: juntar(parciais.flatMap(p => p.deliberacoes), 'texto'),
    encaminhamentos: juntar(parciais.flatMap(p => p.encaminhamentos), 'acao'),
    pendencias: [],
  }
  for (const campo of ['manifestacoes', 'orientacoes'] as const) {
    const valores = parciais.flatMap(p => p[campo] ?? [])
    if (valores.length) resultado[campo] = unicos(valores)
  }
  const ciencias = parciais.map(p => p.cienciaOrientado).filter(v => v !== undefined)
  if (ciencias.length) resultado.cienciaOrientado = ciencias.every(Boolean)
  resultado.pendencias = unicos(pendencias)
  return resultado
}

type Consumo = { dia: string; tokens: number; ultima?: number }
const memoria = new Map<string, Consumo>()
const filas = new Map<string, Promise<void>>()
// Identificador só para a estimativa local: a chave da API não é gravada no registro de cota.
function idCota(chave: string, modelo: string) {
  let hash = 2166136261
  for (const c of chave) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619)
  return `groq-cota-${(hash >>> 0).toString(16)}-${modelo}`
}
function ler(id: string): Consumo {
  let valor: Consumo | undefined
  try { const raw = localStorage.getItem(id); valor = raw ? JSON.parse(raw) : undefined } catch { valor = memoria.get(id) }
  const dia = new Date().toISOString().slice(0, 10)
  return valor?.dia === dia ? valor : { dia, tokens: 0 }
}
function gravar(id: string, valor: Consumo) {
  memoria.set(id, valor)
  try { localStorage.setItem(id, JSON.stringify(valor)) } catch { /* modo privado: mantém controle nesta sessão */ }
}
export function conferirCotaDiaria(chave: string, modelo: string, estimativa: number) {
  if (ler(idCota(chave, modelo)).tokens + estimativa >= LIMITE_DIARIO_ESTIMADO) throw new ErroProvedor('cota', 'A estimativa local da cota diária do Groq está perto do limite. Tentando a reserva Gemini; sem ela, aguarde a renovação da cota.')
}
export async function executarNaJanela<T>(chave: string, modelo: string, estimativa: number, executar: () => Promise<T>, naEspera: (ms: number) => void): Promise<T> {
  const id = idCota(chave, modelo)
  const anterior = filas.get(id) ?? Promise.resolve()
  let liberar!: () => void
  const vez = new Promise<void>(resolve => { liberar = resolve })
  filas.set(id, anterior.then(() => vez))
  await anterior
  try {
    conferirCotaDiaria(chave, modelo, estimativa)
    const estado = ler(id)
    const espera = estado.ultima === undefined ? 0 : Math.max(0, estado.ultima + JANELA_GROQ_MS - Date.now())
    if (espera) { naEspera(espera); await new Promise(resolve => setTimeout(resolve, espera)) }
    const atual = ler(id)
    const reservado = { ...atual, tokens: atual.tokens + estimativa, ultima: Date.now() }
    gravar(id, reservado)
    try {
      const resultado = await executar()
      const uso = (resultado as { usage?: { total_tokens?: number } })?.usage?.total_tokens
      if (typeof uso === 'number' && Number.isFinite(uso) && uso >= 0) gravar(id, { ...reservado, tokens: Math.max(0, reservado.tokens - estimativa + uso) })
      return resultado
    } catch (e) {
      if (e instanceof ErroProvedor && e.kind === 'chave') gravar(id, atual)
      throw e
    }
  } finally { liberar() }
}
