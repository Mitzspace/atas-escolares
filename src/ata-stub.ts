// STUB temporário da interface de src/ata (dono: Claude Code #3).
// Trocar o import em src/ata-api.ts para './ata' quando src/ata/index.ts existir.
export type Pessoa = { nome: string; cargo: string }
export type MeetingMetadata = {
  escola: string; rede: string; municipioUf: string; tipo: 'pedagogica'; ordinaria: boolean
  numero: number; ano: number; data: string; horaInicio: string; horaFim?: string; local: string
  presidente: Pessoa; secretario: Pessoa
  participantes: (Pessoa & { presente: boolean })[]
  pauta: string[]; anonimizarAlunos: boolean; glossario?: string[]
}
export type TranscriptSegment = { speaker: string; start: string; end: string; text: string }
export type AtaExtraida = { itens: { titulo: string; texto: string }[]; pendencias: string[] }
export type AtaRenderizada = {
  titulo: string; cabecalho: string[]; texto: string; assinaturas: Pessoa[]; pendencias: string[]
}

export function buildTranscriptionPrompt(meta: MeetingMetadata, faixa?: { inicio: string; fim: string }): string {
  return `Transcreva em pt-BR, com falantes e tempo (MM:SS). Reunião da ${meta.escola}.` +
    (faixa ? ` Apenas de ${faixa.inicio} a ${faixa.fim}.` : '')
}
export const transcriptResponseSchema: object = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: { speaker: { type: 'STRING' }, start: { type: 'STRING' }, end: { type: 'STRING' }, text: { type: 'STRING' } },
    required: ['speaker', 'start', 'end', 'text'],
  },
}
export function buildAtaPrompt(meta: MeetingMetadata, transcript: TranscriptSegment[]) {
  return {
    systemInstruction: 'Redija os itens da ata a partir da transcrição. Não invente. Use [PENDENTE] quando faltar dado.',
    userPrompt: JSON.stringify({ meta, transcript }),
  }
}
export const ataResponseSchema: object = {
  type: 'OBJECT',
  properties: {
    itens: { type: 'ARRAY', items: { type: 'OBJECT', properties: { titulo: { type: 'STRING' }, texto: { type: 'STRING' } }, required: ['titulo', 'texto'] } },
    pendencias: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['itens', 'pendencias'],
}
export function dataPorExtenso(iso: string) { return iso }
export function horaPorExtenso(hhmm: string) { return hhmm }
export function numeroPorExtenso(n: number) { return String(n) }
export function renderAta(meta: MeetingMetadata, e: AtaExtraida): AtaRenderizada {
  return {
    titulo: `ATA Nº ${meta.numero}/${meta.ano} – REUNIÃO PEDAGÓGICA`,
    cabecalho: [meta.escola, meta.rede, meta.municipioUf],
    texto: e.itens.map(i => i.texto).join(' '),
    assinaturas: [meta.presidente, meta.secretario, ...meta.participantes.filter(p => p.presente)],
    pendencias: e.pendencias,
  }
}
export function validateAta(r: AtaRenderizada): string[] {
  const p: string[] = []
  if (/\n/.test(r.texto)) p.push('O texto tem quebras de linha.')
  if (/\[PENDENTE\]/.test(r.texto)) p.push('Há trechos [PENDENTE].')
  return p
}
