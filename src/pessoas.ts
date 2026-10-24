import type { Participante } from './ata-api'

/** texto livre do vínculo do responsável: "aluno Fulano, 5º ano B" */
export function vinculoDoResponsavel(aluno: string, turma: string): string {
  const a = aluno.trim()
  const t = turma.trim()
  if (!a) return t
  return `aluno ${a}${t ? `, ${t}` : ''}`
}

/** "Mãe · aluno Fulano, 5º ano B" / "Aluno(a) · 5º ano B" / "Professor(a)" */
export function rotuloDoParticipante(p: Pick<Participante, 'cargo' | 'vinculo'>): string {
  return [p.cargo, p.vinculo].map(x => x?.trim()).filter(Boolean).join(' · ')
}

const PARTICULAS = new Set(['de', 'da', 'do', 'dos', 'das', 'e'])

/** "Pedro Henrique Souza" -> "P.H.S." */
export function iniciaisDoNome(nome: string): string {
  const letras = nome.trim().split(/\s+/).filter(w => w && !PARTICULAS.has(w.toLowerCase())).map(w => `${w[0].toLocaleUpperCase('pt-BR')}.`)
  return letras.join('')
}

/** troca o nome do aluno por iniciais num vínculo como "aluno Pedro Henrique, 5º ano B" */
export function vinculoAnonimo(vinculo: string): string {
  return vinculo.replace(/^aluno\s+([^,]+)/i, (_, nome: string) => `aluno ${iniciaisDoNome(nome)}`)
}
