export type Pessoa = { nome: string; cargo: string };

export type MeetingMetadata = {
  escola: string;
  rede: string;
  municipioUf: string;
  tipo: 'pedagogica';
  ordinaria: boolean;
  numero: number;
  ano: number;
  data: string; // YYYY-MM-DD
  horaInicio: string; // HH:MM
  horaFim?: string;
  local: string;
  presidente: Pessoa;
  secretario: Pessoa;
  participantes: (Pessoa & { presente: boolean })[];
  pauta: string[];
  anonimizarAlunos: boolean;
  glossario?: string[];
};

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
};

export type AtaRenderizada = {
  titulo: string;
  cabecalho: string[];
  texto: string; // bloco único corrido
  assinaturas: Pessoa[];
  pendencias: string[];
};
