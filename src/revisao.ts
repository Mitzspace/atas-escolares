import { horaPorExtenso, novoMarcadorRegex, renderAta, textoLivreParaPadrao, type MeetingMetadata, type Pessoa } from './ata-api'
import type { AtaRecord } from './types'

export type Marcador = {
  /** posição no texto */
  inicio: number
  fim: number
  tipo: 'pendente' | 'confirmar' | 'inaudivel'
  descricao: string
  /** trecho anterior ao marcador, para a usuária saber onde ele está */
  contexto: string
  /** pede um horário (campo de hora) em vez de texto livre */
  hora: boolean
}

const CONTEXTO = 70

export function listarMarcadores(texto: string): Marcador[] {
  return [...texto.matchAll(novoMarcadorRegex())].map(m => {
    const t = m[1].toLowerCase()
    const tipo = t === 'pendente' ? 'pendente' : t === 'confirmar' ? 'confirmar' : 'inaudivel'
    const descricao = m[2].trim() || (tipo === 'inaudivel' ? 'trecho inaudível' : 'informação pendente')
    const inicio = m.index!
    const cortado = inicio > CONTEXTO
    const antes = texto.slice(Math.max(0, inicio - CONTEXTO), inicio)
    return {
      inicio,
      fim: inicio + m[0].length,
      tipo,
      descricao,
      // só descarta a palavra cortada quando o trecho começa no meio do texto
      contexto: cortado ? '…' + antes.replace(/^\S*\s/, '') : antes,
      hora: /hor[aá]rio|hora de/i.test(descricao),
    }
  })
}

/** "14:30", "14h30", "14h" -> "14:30"; null se não for um horário válido. */
function normalizarHora(v: string): string | null {
  const m = /^(\d{1,2})\s*(?:h\s*(\d{2})?(?:\s*min)?|:(\d{2}))$/i.exec(v)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2] ?? m[3] ?? 0)
  return h > 23 || min > 59 ? null : `${h}:${String(min).padStart(2, '0')}`
}

/**
 * Substitui o marcador pelo valor preenchido. Horários (HH:MM, 14h30) viram "às ... horas";
 * números, datas e abreviações no texto livre vão por extenso. Valor vazio remove o marcador.
 * Ajusta pontuação e maiúscula na emenda (não repete "." nem "," e capitaliza início de frase).
 */
export function preencherMarcador(texto: string, m: Marcador, valor: string): string {
  let antes = texto.slice(0, m.inicio)
  let depois = texto.slice(m.fim)
  let v = valor.trim().replace(/\s+/g, ' ')

  if (!v) {
    antes = antes.replace(/[ \t]+$/, '')
    if (/^\s*[,.;:!?]/.test(depois)) {
      depois = depois.replace(/^\s+/, '')
      // "item, [x]." -> "item."  e  "a, [x], b" -> "a, b"
      if (/[,;:]$/.test(antes)) antes = antes.slice(0, -1)
    } else if (antes && depois) {
      depois = ' ' + depois.replace(/^\s+/, '')
    }
    return (antes + depois).replace(/ {2,}/g, ' ').trim()
  }

  const hora = m.hora ? normalizarHora(v) : null
  if (hora) {
    // se o texto já traz "às"/"à"/"ao" antes do marcador, não repete o artigo
    v = horaPorExtenso(hora, !/(?:^|\s)(?:às|à|ao)\s*$/i.test(antes))
  } else {
    v = textoLivreParaPadrao(v, false)
  }
  if (/^\s*[.,;:!?]/.test(depois)) v = v.replace(/[.,;:!?]+$/, '')
  if (/(?:^|[.!?]\s+)$/.test(antes)) v = v.charAt(0).toLocaleUpperCase('pt-BR') + v.slice(1)
  if (antes && !/[\s(]$/.test(antes)) antes += ' '
  if (depois && !/^[\s,.;:!?)\]]/.test(depois)) depois = ' ' + depois

  return (antes + v + depois).replace(/ {2,}/g, ' ').trim()
}

/** Preenche de uma vez todos os marcadores com o mesmo tipo e descrição de `m` (ex.: o mesmo nome citado várias vezes). */
export function preencherIguais(texto: string, m: Marcador, valor: string): string {
  const chave = (x: Marcador) => `${x.tipo}|${x.descricao.toLocaleLowerCase('pt-BR')}`
  const alvo = chave(m)
  let t = preencherMarcador(texto, m, valor)
  // o limite evita laço infinito se o valor digitado tiver um marcador igual
  for (let i = listarMarcadores(texto).filter(x => chave(x) === alvo).length; i > 0; i--) {
    const outro = listarMarcadores(t).find(x => chave(x) === alvo)
    if (!outro) break
    t = preencherMarcador(t, outro, valor)
  }
  return t
}

/**
 * Resultado de mudar quem estava presente: nova ata renderizada e o texto que a usuária vê.
 * `textoPreservado` = false quando a abertura foi editada à mão: o texto fica como está e a usuária decide.
 * Só quem foi convocado (participantes da Nova ata) aparece como ausente; cadastrados desmarcados ficam fora da ata.
 */
export function aplicarPresenca(ata: AtaRecord, lista: MeetingMetadata['participantes']) {
  const convocados = ata.convocados ?? ata.meta.participantes.map(chaveNome)
  const participantes = lista.filter(p => p.presente || convocados.includes(chaveNome(p)))
  const r = recalcular(ata, participantes)
  return { ...r, convocados }
}

function recalcular(ata: AtaRecord, participantes: MeetingMetadata['participantes']) {
  const meta = { ...ata.meta, participantes }
  const antigo = ata.renderizada!.texto
  const renderizada = renderAta(meta, ata.extraida!)
  const novo = renderizada.texto
  const editado = ata.textoEditado
  if (editado === undefined || editado === antigo) return { meta, renderizada, texto: novo, textoPreservado: true }

  // presença só muda a abertura e a frase dos ausentes; o resto do texto é igual nas duas versões
  let s = 0
  while (s < antigo.length && s < novo.length && antigo[antigo.length - 1 - s] === novo[novo.length - 1 - s]) s++
  const prefixoAntigo = antigo.slice(0, antigo.length - s)
  const prefixoNovo = novo.slice(0, novo.length - s)
  if (editado.startsWith(prefixoAntigo)) {
    return { meta, renderizada, texto: prefixoNovo + editado.slice(prefixoAntigo.length), textoPreservado: true }
  }
  return { meta, renderizada, texto: editado, textoPreservado: false }
}

const chaveNome = (p: Pessoa) => p.nome.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ').trim()

/** Junta pessoas cadastradas com os participantes da ata, sem repetir nomes (ignora caixa, acentos e espaços). */
export function listaDePresenca(participantes: MeetingMetadata['participantes'], cadastro: Pessoa[], excluir: Pessoa[] = []) {
  const fora = new Set(excluir.map(chaveNome))
  const lista = participantes.filter(p => !fora.has(chaveNome(p)))
  const vistos = new Set(lista.map(chaveNome))
  for (const p of cadastro) {
    const k = chaveNome(p)
    if (!k || vistos.has(k) || fora.has(k)) continue
    vistos.add(k)
    lista.push({ ...p, presente: false })
  }
  return lista
}

/** Presidente e secretário(a) são a mesma pessoa? */
export const mesmaPessoa = (a: Pessoa, b: Pessoa) => chaveNome(a) === chaveNome(b)
