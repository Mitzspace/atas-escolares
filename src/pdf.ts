import type { AtaRenderizada, Pessoa } from './ata-api'
// larguras (AFM Times-Roman, 1/1000 em) embutidas no próprio pdfmake
import timesContainer from 'pdfmake/build/standard-fonts/Times'

export const PAGE_W = 595.28
export const MARGENS = { esq: 85, dir: 57, topo: 62, base: 62 } // ABNT-like
export const LARGURA_TEXTO = PAGE_W - MARGENS.esq - MARGENS.dir
export const TAMANHO = 12

const times = (timesContainer as unknown as { standardFonts: { name: string; glyphNames: string; glyphWidths: number[] }[] })
  .standardFonts.find(f => f.name === 'Times-Roman')!
const glyphIdx = new Map(times.glyphNames.split(' ').map((n, i) => [n, i]))
const EXTRAS: Record<string, string> = {
  '–': 'endash', '—': 'emdash', '“': 'quotedblleft', '”': 'quotedblright', '‘': 'quoteleft', '’': 'quoteright',
  'º': 'ordmasculine', 'ª': 'ordfeminine', 'ç': 'ccedilla', 'Ç': 'Ccedilla', '…': 'ellipsis', '°': 'degree',
}

function larguraChar(ch: string): number {
  const code = ch.charCodeAt(0)
  let i: number | undefined
  if (code >= 32 && code <= 126) i = code - 32
  else if (EXTRAS[ch]) i = glyphIdx.get(EXTRAS[ch])
  else {
    const base = ch.normalize('NFD')[0]
    const c = base.charCodeAt(0)
    if (c >= 32 && c <= 126) i = c - 32
  }
  return (times.glyphWidths[i ?? glyphIdx.get('space')!] / 1000)
}

/** largura em pt de um trecho, em Times-Roman */
export function larguraTexto(s: string, tamanho = TAMANHO): number {
  let w = 0
  for (const ch of s) w += larguraChar(ch)
  return w * tamanho
}

/** segmentos entre oportunidades de quebra: espaço, ou depois de hífen/barra entre letras */
function segmentos(texto: string): { palavra: string; espaco: boolean }[] {
  const out: { palavra: string; espaco: boolean }[] = []
  for (const tok of texto.split(/( +)/)) {
    if (!tok) continue
    if (tok.startsWith(' ')) { if (out.length) out[out.length - 1].espaco = true; continue }
    for (const p of tok.match(/[^-/]*[-/](?=[\p{L}\p{N}])|[^]+/gu) ?? [tok]) out.push({ palavra: p, espaco: false })
  }
  return out
}

/** simula a quebra de linhas e devolve a largura usada pela última linha */
export function larguraUltimaLinha(texto: string, largura = LARGURA_TEXTO, tamanho = TAMANHO): number {
  const esp = larguraTexto(' ', tamanho)
  let atual = 0 // largura da linha incluindo espaço pendente
  let pendente = 0
  for (const seg of segmentos(texto)) {
    const w = larguraTexto(seg.palavra, tamanho)
    if (atual > 0 && atual + pendente + w > largura) { atual = w; pendente = 0 } else { atual += pendente + w; pendente = 0 }
    if (seg.espaco) pendente = esp
  }
  return atual
}

/** acrescenta traços até o fim da última linha (margem de segurança de 2 traços) */
export function preencherComTracos(texto: string, largura = LARGURA_TEXTO, tamanho = TAMANHO): string {
  const t = texto.trimEnd()
  const usada = larguraUltimaLinha(t, largura, tamanho) + larguraTexto(' ', tamanho)
  const n = Math.floor((largura - usada) / larguraTexto('-', tamanho)) - 2
  return n >= 3 ? `${t} ${'-'.repeat(n)}` : t
}

function assinatura(p: Pessoa) {
  return {
    unbreakable: true,
    margin: [0, 22, 0, 0] as [number, number, number, number],
    stack: [
      { canvas: [{ type: 'line' as const, x1: 0, y1: 0, x2: 250, y2: 0, lineWidth: 0.6 }] },
      { text: p.nome || ' ', fontSize: 11, margin: [0, 2, 0, 0] },
      { text: p.cargo, fontSize: 10, italics: true },
    ],
  }
}

export function montarDocumento(ata: AtaRenderizada, textoFinal: string) {
  return {
    pageSize: 'A4' as const,
    pageMargins: [MARGENS.esq, MARGENS.topo, MARGENS.dir, MARGENS.base] as [number, number, number, number],
    defaultStyle: { font: 'Times', fontSize: TAMANHO, lineHeight: 1.4 },
    info: { title: ata.titulo },
    footer: (atual: number, total: number) => ({
      text: `Folha ${atual} de ${total}`, alignment: 'right' as const, fontSize: 10,
      margin: [MARGENS.esq, 24, MARGENS.dir, 0] as [number, number, number, number],
    }),
    content: [
      ...ata.cabecalho.filter(Boolean).map((l, i) => ({ text: l, alignment: 'center' as const, bold: i === 0, lineHeight: 1.2 })),
      { text: ata.titulo, alignment: 'center' as const, bold: true, margin: [0, 18, 0, 14] as [number, number, number, number] },
      { text: preencherComTracos(textoFinal), alignment: 'justify' as const },
      ...ata.assinaturas.map(assinatura),
    ],
  }
}

async function carregarPdfMake() {
  const mod = (await import('pdfmake/build/pdfmake')) as unknown as { default?: typeof import('pdfmake/build/pdfmake') }
  const pdfMake = (mod.default ?? mod) as typeof import('pdfmake/build/pdfmake')
  pdfMake.addFontContainer(timesContainer)
  return pdfMake
}

export async function gerarPdfBytes(ata: AtaRenderizada, textoFinal: string): Promise<Uint8Array> {
  const pdfMake = await carregarPdfMake()
  const buf = await pdfMake.createPdf(montarDocumento(ata, textoFinal) as never).getBuffer()
  return new Uint8Array(buf)
}

export async function gerarPdfBlob(ata: AtaRenderizada, textoFinal: string): Promise<Blob> {
  return new Blob([(await gerarPdfBytes(ata, textoFinal)) as BlobPart], { type: 'application/pdf' })
}

export function nomeArquivo(ata: AtaRenderizada): string {
  return ata.titulo.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '_').replace(/^_|_$/g, '') + '.pdf'
}

export function baixar(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Web Share com arquivo quando o aparelho suporta; devolve false se não der */
export async function compartilhar(blob: Blob, nome: string, titulo: string): Promise<boolean> {
  const file = new File([blob], nome, { type: 'application/pdf' })
  if (!navigator.canShare?.({ files: [file] })) return false
  try {
    await navigator.share({ files: [file], title: titulo })
    return true
  } catch (e) {
    if ((e as DOMException).name === 'AbortError') return true
    return false
  }
}
