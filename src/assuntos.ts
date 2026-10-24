import type { TipoAta } from './ata-api'

/**
 * Assuntos sugeridos na pauta de cada tipo de ata (a usuária toca para adicionar).
 * Levantados a partir de pautas publicadas por escolas e secretarias e de materiais sobre
 * registro de ocorrências e orientação; a escola pode acrescentar os seus em Configurações.
 */
export const ASSUNTOS_PADRAO = {
  pedagogica: [
    'Análise dos resultados das avaliações',
    'Planejamento do bimestre',
    'Acompanhamento da aprendizagem dos alunos com dificuldade',
    'Estratégias de recuperação e reforço',
    'Frequência e evasão escolar',
    'Projeto Político-Pedagógico (PPP)',
    'Projetos e eventos da escola',
    'Calendário escolar',
    'Preparação do conselho de classe',
    'Diários de classe e planos de aula',
    'Inclusão e Atendimento Educacional Especializado (AEE)',
    'Formação continuada dos professores',
    'Informes gerais',
  ],
  pais: [
    'Apresentação da equipe e acolhida das famílias',
    'Calendário escolar e datas importantes',
    'Horários de entrada e saída',
    'Frequência, faltas e atrasos',
    'Sistema de avaliação',
    'Resultados e desempenho da turma no bimestre',
    'Rotina de estudos e tarefas de casa',
    'Projetos pedagógicos e eventos',
    'Uniforme e materiais escolares',
    'Normas de convivência e regimento escolar',
    'Comunicação entre escola e família',
    'Dúvidas e sugestões das famílias',
  ],
  orientacao_aluno: [
    'Comportamento em sala de aula',
    'Conflito com colegas',
    'Faltas e atrasos frequentes',
    'Baixo rendimento escolar',
    'Atividades e tarefas não entregues',
    'Uso de celular em sala de aula',
    'Descumprimento das normas do regimento escolar',
    'Encaminhamento para reforço ou apoio pedagógico',
    'Acompanhamento da família na vida escolar',
  ],
  orientacao_funcionario: [
    'Pontualidade e assiduidade',
    'Cumprimento das atribuições do cargo',
    'Planejamento e registro das aulas',
    'Preenchimento do diário de classe',
    'Relacionamento com alunos e famílias',
    'Relacionamento com a equipe',
    'Cumprimento de normas e prazos da escola',
    'Procedimentos pedagógicos e administrativos',
  ],
} as const

export type ChaveAssuntos = keyof typeof ASSUNTOS_PADRAO

/** Chave da lista de sugestões; em orientação depende de quem recebe (alunos, funcionários ou ambos). */
export function chavesDeAssuntos(tipo: TipoAta, categoriasOrientados: string[] = []): ChaveAssuntos[] {
  if (tipo !== 'orientacao') return [tipo]
  const temAluno = categoriasOrientados.includes('aluno')
  const temFuncionario = categoriasOrientados.some(c => c !== 'aluno')
  if (temAluno && !temFuncionario) return ['orientacao_aluno']
  if (temFuncionario && !temAluno) return ['orientacao_funcionario']
  return ['orientacao_aluno', 'orientacao_funcionario']
}

/** Sugestões padrão + as cadastradas pela escola, sem repetir (ignora caixa). */
export function assuntosSugeridos(chaves: ChaveAssuntos[], extras: Partial<Record<ChaveAssuntos, string[]>> = {}): string[] {
  const vistos = new Set<string>()
  const out: string[] = []
  for (const k of chaves) {
    for (const a of [...ASSUNTOS_PADRAO[k], ...(extras[k] ?? [])]) {
      const c = a.trim().toLocaleLowerCase('pt-BR')
      if (!c || vistos.has(c)) continue
      vistos.add(c)
      out.push(a.trim())
    }
  }
  return out
}
