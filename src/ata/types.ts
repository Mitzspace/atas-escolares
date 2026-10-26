/**
 * CONTRATO DO CADASTRO v2 (retrocompatível: atas antigas renderizam exatamente como antes).
 *
 * - Tipo de reunião: a usuária escolhe um rótulo de `OPCOES_TIPO_REUNIAO` (ou digita um: "Outro") e a UI grava
 *   `meta.tipo` (regras internas) + `meta.tipoReuniao` (o rótulo). Pedagógica, pais e orientação têm regras próprias;
 *   o resto é 'outra' (regras da pedagógica) e o título do documento é `tipoReuniao` em maiúsculas
 *   ("ATA Nº 005/2026 – CONSELHO DE CLASSE"). 'outra' sem `tipoReuniao` vira só "REUNIÃO".
 * - Quem fez a ata: `meta.responsavel` { nome, cargo } é quem lavra (e, em 'orientacao', quem orienta). Com `responsavel`
 *   a ata não tem presidência: abertura sem "sob a presidência de" nem "comigo, secretário"; encerramento
 *   "e eu, [nome], [cargo], lavrei a presente ata...". `presidente`, `secretario` e `ordinaria` ficam OPCIONAIS e
 *   só existem em atas antigas (sem `responsavel`, valem as regras antigas, inclusive "ordinária/extraordinária" no título).
 *   Use sempre `quemLavra(meta)` / `quemOrienta(meta)`; nunca leia presidente/secretario direto.
 * - Cargo é opcional em qualquer pessoa: string vazia = sem cargo (texto e assinatura saem só com o nome, sem vírgula sobrando).
 * - Participantes: lista única (`participantes`), sem seção de funcionários/alunos. `categoria`/`vinculo` seguem opcionais
 *   (responsável: vinculo = 'aluno Fulano, 5º ano B'; aluno: vinculo = turma). Em 'orientacao', `recebeOrientacao: true`
 *   marca quem recebe a orientação; `listarOrientados(meta)` junta esses participantes a `orientados`/`orientado` legados,
 *   sem repetir nomes. Quem orienta é o `responsavel`.
 * - `CARGOS_SUGERIDOS` e `OPCOES_TIPO_REUNIAO` alimentam os seletores; `tipoDaOpcao(rotulo)` devolve o TipoAta.
 */
/** `cargo` vazio = sem cargo. */
export type Pessoa = { nome: string; cargo: string };

export type TipoAta = 'pedagogica' | 'pais' | 'orientacao' | 'outra';

/** Quem é a pessoa na reunião. Ausente = 'funcionario' (atas antigas não têm o campo). */
export type Categoria = 'funcionario' | 'responsavel' | 'aluno';

/**
 * - funcionario: cargo = cargo na escola.
 * - responsavel: cargo = 'Mãe' | 'Pai' | 'Responsável'; vinculo = 'aluno Fulano, 5º ano B' (aluno + turma).
 * - aluno: cargo = 'Aluno' | 'Aluna' | 'Aluno(a)'; vinculo = turma ('5º ano B').
 */
export type Participante = Pessoa & { presente: boolean; categoria?: Categoria; vinculo?: string; recebeOrientacao?: boolean };

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
  outra: {
    titulo: 'REUNIÃO',
    nome: 'Outra reunião',
    descricao: 'Conselho de classe, planejamento, HTPC/ATPC, conselho escolar/APM, administrativa ou outra, com as regras da reunião pedagógica.',
  },
};

/** Opções do seletor "Tipo de reunião"; `rotulo` vai para `meta.tipoReuniao`. "Outro (digitar)" = OUTRO_TIPO_REUNIAO. */
export const OPCOES_TIPO_REUNIAO: { rotulo: string; tipo: TipoAta }[] = [
  { rotulo: 'Reunião pedagógica', tipo: 'pedagogica' },
  { rotulo: 'Reunião de pais e responsáveis', tipo: 'pais' },
  { rotulo: 'Orientação a aluno(s)', tipo: 'orientacao' },
  { rotulo: 'Orientação a funcionário(s)', tipo: 'orientacao' },
  { rotulo: 'Conselho de classe', tipo: 'outra' },
  { rotulo: 'Reunião de planejamento', tipo: 'outra' },
  { rotulo: 'HTPC/ATPC', tipo: 'outra' },
  { rotulo: 'Conselho escolar/APM', tipo: 'outra' },
  { rotulo: 'Reunião administrativa', tipo: 'outra' },
];
export const OUTRO_TIPO_REUNIAO = 'Outro (digitar)';

/** TipoAta de um rótulo (digitado ou da lista; comparação sem acento/caixa). Rótulo desconhecido = 'outra'. */
export function tipoDaOpcao(rotulo: string): TipoAta {
  const k = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
  return OPCOES_TIPO_REUNIAO.find((o) => k(o.rotulo) === k(rotulo))?.tipo ?? 'outra';
}

/** Cargos e funções sugeridos nos seletores (a usuária também digita e cadastra os seus). */
export const CARGOS_SUGERIDOS: string[] = [
  'Diretora', 'Diretor', 'Vice-diretora', 'Vice-diretor', 'Coordenadora pedagógica', 'Coordenador pedagógico', 'Orientadora educacional',
  'Orientador educacional', 'Secretária escolar', 'Secretário escolar', 'Professora', 'Professor', 'Auxiliar administrativo',
  'Merendeira', 'Inspetor de alunos', 'Mãe', 'Pai', 'Responsável', 'Aluno(a)',
];

export type MeetingMetadata = {
  escola: string;
  rede: string;
  municipioUf: string;
  tipo: TipoAta;
  /** Rótulo do tipo de reunião escolhido ou digitado (título de 'outra'). */
  tipoReuniao?: string;
  /** Só atas antigas. */
  ordinaria?: boolean;
  numero: number;
  ano: number;
  data: string; // YYYY-MM-DD
  horaInicio: string; // HH:MM
  horaFim?: string;
  local: string;
  /** Quem fez a ata: lavra e, em 'orientacao', orienta. Atas novas têm; antigas não. */
  responsavel?: Pessoa;
  /** Só atas antigas (sem `responsavel`). Em 'orientacao' antiga, presidente = quem orienta. */
  presidente?: Pessoa;
  /** Só atas antigas (sem `responsavel`). */
  secretario?: Pessoa;
  /** Em 'orientacao', a pauta = assuntos/motivo da orientação. */
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
export function listarOrientados(meta: Pick<MeetingMetadata, 'orientados' | 'orientado'> & { participantes?: Participante[] }): Participante[] {
  const base = meta.orientados ?? (meta.orientado ? [meta.orientado] : []);
  const marcados = (meta.participantes ?? []).filter((p) => p.recebeOrientacao);
  if (!marcados.length) return base;
  const chave = (p: Participante) => p.nome.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const vistos = new Set(base.map(chave));
  return [...base, ...marcados.filter((p) => !vistos.has(chave(p)) && vistos.add(chave(p)))];
}

const SEM_PESSOA: Pessoa = { nome: '', cargo: '' };
type Responsaveis = Pick<MeetingMetadata, 'responsavel' | 'presidente' | 'secretario'>;
/** Quem lavra a ata: `responsavel`, ou o secretário (atas antigas; sem secretário, o presidente). */
export const quemLavra = (meta: Responsaveis): Pessoa => meta.responsavel ?? meta.secretario ?? meta.presidente ?? SEM_PESSOA;
/** Quem orienta (tipo 'orientacao'): `responsavel`, ou o presidente das atas antigas. */
export const quemOrienta = (meta: Responsaveis): Pessoa => meta.responsavel ?? meta.presidente ?? meta.secretario ?? SEM_PESSOA;
/** Atas antigas têm presidência na abertura ("sob a presidência de"); as novas, não. */
export const temPresidencia = (meta: Responsaveis): boolean => !meta.responsavel && !!meta.presidente?.nome.trim();

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
