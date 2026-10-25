const limpar = (s: string) => s.replace(/\s+/g, ' ').trim();

const PREPOSICOES_NOME = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
/** "Pedro Henrique Lima" -> "P.H.L."; nomes que já são iniciais ficam como estão. */
export function iniciais(nome: string): string {
  const t = limpar(nome);
  if (/^(?:\p{Lu}\.\s*)+$/u.test(t)) return t.replace(/\s+/g, '');
  return t
    .split(' ')
    .filter((w) => w && !PREPOSICOES_NOME.has(w.toLocaleLowerCase('pt-BR')))
    .map((w) => `${w.charAt(0).toLocaleUpperCase('pt-BR')}.`)
    .join('');
}

/** Vínculo do responsável: "aluno Pedro Henrique, 5º ano B" -> { rotulo: 'aluno', nome: 'Pedro Henrique', turma: '5º ano B' }. */
export function parseVinculo(v: string) {
  const m = /^\s*(?:(aluno\(a\)|aluno|aluna|estudante)\s+)?([^,]+?)\s*(?:,\s*(.+?))?\s*$/i.exec(v);
  if (!m) return null;
  return { rotulo: (m[1] ?? 'aluno(a)').toLocaleLowerCase('pt-BR'), nome: m[2], turma: m[3] ?? '' };
}

