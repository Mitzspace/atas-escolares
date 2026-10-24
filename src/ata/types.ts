export type Pessoa = { nome: string; cargo: string };

export type TipoAta = 'pedagogica' | 'pais' | 'orientacao';

/** Quem é a pessoa na reunião. Ausente = 'funcionario' (atas antigas não têm o campo). */
export type Categoria = 'funcionario' | 'responsavel' | 'aluno';

/**
 * - funcionario: cargo = cargo na escola.
 * - responsavel: cargo = 'Mãe' | 'Pai' | 'Responsável'; vinculo = 'aluno Fulano, 5º ano B' (aluno + turma).
 * - aluno: cargo = 'Aluno' | 'Aluna' | 'Aluno(a)'; vinculo = turma ('5º ano B').
 */
export type Participante = Pessoa & { presente: boolean; categoria?: Categoria; vinculo?: string };

export const TIPOS_ATA: Record<TipoAta, { titulo: string; nome: string; descricao: string }> = {
  pedagogica: {
    titulo: 'REUNIÃO PEDAGÓGICA',
    nome: 'Reunião pedagógica',
    descricao: 'As pedagogas conduzem a reunião com professores ou com alunos.',
  },
  pais: {
    titulo: 'REUNIÃO DE PAIS E RESPONSÁVEIS',
    nome: 'Pais e responsáveis',
    descricao: 'A escola reúne os funcionários e os pais ou responsáveis dos alunos.',
  },
  orientacao: {
    titulo: 'ORIENTAÇÃO',
    nome: 'Orientação',
    descricao: 'Um funcionário de cargo superior orienta um funcionário ou um aluno, e o orientado assina.',
  },
};

export type MeetingMetadata = {
  escola: string;
  rede: string;
  municipioUf: string;
  tipo: TipoAta;
  ordinaria: boolean;
  numero: number;
  ano: number;
  data: string; // YYYY-MM-DD
  horaInicio: string; // HH:MM
  horaFim?: string;
  local: string;
  presidente: Pessoa;
  secretario: Pessoa;
  /** Em 'orientacao', presidente = quem orienta e a pauta = assuntos/motivo da orientação. */
  participantes: Participante[];
  /** Só em 'orientacao': quem recebe a orientação (um ou vários, mistos): funcionário (categoria 'funcionario') ou aluno (categoria 'aluno', vinculo = turma). O responsável que acompanha um aluno vai em `participantes` com categoria 'responsavel' e vinculo 'aluno Fulano, 5º ano B'. Use sempre `listarOrientados(meta)`. */
  orientados?: Participante[];
  /** Só atas antigas (um único orientado). Novo código usa `orientados`. */
  orientado?: Participante;
  pauta: string[];
  anonimizarAlunos: boolean;
  glossario?: string[];
};

/** Quem recebe a orientação: `orientados`, ou o `orientado` das atas antigas. */
export const listarOrientados = (meta: Pick<MeetingMetadata, 'orientados' | 'orientado'>): Participante[] =>
  meta.orientados ?? (meta.orientado ? [meta.orientado] : []);

export type TranscriptSegment = {
  speaker: string;
  start: string; // MM:SS
  end: string;
  text: string;
};

/** Relato de um item da pauta. `pauta` é o número do item (base 1); 0 = assuntos fora da pauta. */
export type ItemRelato = { pauta: number; relato: string };
export type Deliberacao = { texto: string; votacao?: string };
export type Encaminhamento = { acao: string; responsavel?: string; prazo?: string };

/** Corpo da ata redigido pelo LLM; espelha `ataResponseSchema`. */
export type AtaExtraida = {
  itens: ItemRelato[];
  deliberacoes: Deliberacao[];
  encaminhamentos: Encaminhamento[];
  pendencias: string[];
  /**
   * OPCIONAIS (atas antigas não têm):
   * - manifestacoes: 'pais' = dúvidas e demandas das famílias; 'orientacao' = manifestações do orientado e de quem o acompanha.
   * - orientacoes: só 'orientacao' = orientações dadas.
   * - cienciaOrientado: só 'orientacao' = true somente se a transcrição mostra que o orientado tomou ciência; senão fica pendente.
   *   Com vários orientados vale para todos: só é true se TODOS tomaram ciência.
   */
  manifestacoes?: string[];
  orientacoes?: string[];
  cienciaOrientado?: boolean;
};

export type AtaRenderizada = {
  titulo: string;
  cabecalho: string[];
  texto: string; // bloco único corrido
  assinaturas: Pessoa[];
  pendencias: string[];
};
