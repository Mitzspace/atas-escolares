import { horaPorExtenso, numerosParaExtenso, renderAta, type MeetingMetadata, type Pessoa } from './ata-api'
import type { AtaRecord } from './types'

const MARCADOR = /\[\s*(PENDENTE|confirmar|trecho inaud[ií]vel|inaud[ií]vel)\s*:?([^\]]*)\]/gi

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

export function listarMarcadores(texto: string): Marcador[] {
  return [...texto.matchAll(MARCADOR)].map(m => {
    const t = m[1].toLowerCase()
    const tipo = t === 'pendente' ? 'pendente' : t === 'confirmar' ? 'confirmar' : 'inaudivel'
    const descricao = m[2].trim() || (tipo === 'inaudivel' ? 'trecho inaudível' : 'informação pendente')
    const antes = texto.slice(Math.max(0, m.index! - 70), m.index!)
    return {
      inicio: m.index!,
      fim: m.index! + m[0].length,
      tipo,
      descricao,
      contexto: (m.index! > 70 ? '…' : '') + antes.replace(/^\S*\s/, ''),
      hora: /hor[aá]rio|hora de/i.test(descricao),
    }
  })
}

/**
 * Substitui o marcador pelo valor preenchido. Horários (HH:MM) viram "às ... horas";
 * números no texto livre vão por extenso. Valor vazio remove o marcador.
 */
export function preencherMarcador(texto: string, m: Marcador, valor: string): string {
  let v = valor.trim()
  if (m.hora && /^\d{1,2}:\d{2}$/.test(v)) v = horaPorExtenso(v)
  else if (v) v = numerosParaExtenso(v)
  const antes = texto.slice(0, m.inicio)
  const depois = texto.slice(m.fim)
  const junto = v ? antes + v + depois : antes.replace(/\s+$/, '') + (/^[\s,.;:]/.test(depois) ? '' : ' ') + depois
  return junto.replace(/ {2,}/g, ' ').replace(/\s+([,;:.])/g, '$1').trim()
}

/** Resultado de mudar quem estava presente: nova ata renderizada e o texto que a usuária vê. */
export function aplicarPresenca(ata: AtaRecord, participantes: MeetingMetadata['participantes']) {
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

/** Junta pessoas cadastradas com os participantes da ata, sem repetir nomes. */
export function listaDePresenca(participantes: MeetingMetadata['participantes'], cadastro: Pessoa[], excluir: Pessoa[] = []) {
  const chave = (p: Pessoa) => p.nome.trim().toLocaleLowerCase('pt-BR')
  const fora = new Set(excluir.map(chave))
  const lista = participantes.filter(p => !fora.has(chave(p)))
  const vistos = new Set(lista.map(chave))
  for (const p of cadastro) {
    if (!p.nome.trim() || vistos.has(chave(p)) || fora.has(chave(p))) continue
    vistos.add(chave(p))
    lista.push({ ...p, presente: false })
  }
  return lista
}
