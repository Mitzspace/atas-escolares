import { describe, expect, it } from 'vitest';
import { renderAta } from './render';
import { validateAta } from './validate';
import { buildAtaPrompt, buildTranscriptionPrompt } from './prompts';
import { ataResponseSchema, transcriptResponseSchema } from './schemas';
import type { AtaExtraida, MeetingMetadata } from './types';

const meta: MeetingMetadata = {
  escola: 'Escola Municipal Professora Ana Lima',
  rede: 'Secretaria Municipal de Educação de Exemplo',
  municipioUf: 'Exemplo/SP',
  tipo: 'pedagogica',
  ordinaria: true,
  numero: 3,
  ano: 2026,
  data: '2026-03-12',
  horaInicio: '14:00',
  horaFim: '15:30',
  local: 'Sala dos professores',
  presidente: { nome: 'Maria Souza', cargo: 'Diretora' },
  secretario: { nome: 'Paulo Reis', cargo: 'Professor' },
  participantes: [
    { nome: 'Joana Alves', cargo: 'Coordenadora pedagógica', presente: true },
    { nome: 'Clara Dias', cargo: 'Professora', presente: true },
    { nome: 'Rui Lopes', cargo: 'Professor', presente: false },
  ],
  pauta: ['Avaliação diagnóstica do 1º bimestre', 'Projeto de leitura', 'Informes gerais'],
  anonimizarAlunos: true,
};

const extraida: AtaExtraida = {
  itens: [
    {
      pauta: 1,
      relato:
        'No primeiro item da pauta, a coordenadora pedagógica Joana Alves apresentou os resultados da avaliação diagnóstica e informou que o rendimento em Língua Portuguesa ficou abaixo do esperado nos quartos anos.',
    },
    { pauta: 2, relato: 'A professora Clara Dias, professora, propôs o projeto Hora da Leitura.' },
    { pauta: 3, relato: 'A diretora informou que o recesso escolar será no dia 23 de abril.' },
  ],
  deliberacoes: [
    { texto: 'Será realizado reforço semanal a partir de 19/03', votacao: 'aprovado por unanimidade' },
    { texto: 'Foi aprovado o projeto Hora da Leitura', votacao: 'aprovado por maioria, com dois votos contrários' },
  ],
  encaminhamentos: [{ acao: 'Organizar o reforço de Língua Portuguesa', responsavel: 'professores de Língua Portuguesa', prazo: 'dezenove de março' }],
  pendencias: [],
};

describe('renderAta', () => {
  const r = renderAta(meta, extraida);

  it('monta título e cabeçalho', () => {
    expect(r.titulo).toBe('ATA Nº 003/2026 – REUNIÃO PEDAGÓGICA ORDINÁRIA');
    expect(r.cabecalho).toEqual([
      'ESCOLA MUNICIPAL PROFESSORA ANA LIMA',
      'SECRETARIA MUNICIPAL DE EDUCAÇÃO DE EXEMPLO',
      'EXEMPLO/SP',
    ]);
  });

  it('abre no padrão', () => {
    expect(
      r.texto.startsWith(
        'Aos doze dias do mês de março do ano de dois mil e vinte e seis, às quatorze horas, na sala dos professores da Escola Municipal Professora Ana Lima, Secretaria Municipal de Educação de Exemplo, reuniram-se Maria Souza, diretora; Paulo Reis, professor; Joana Alves, coordenadora pedagógica; e Clara Dias, professora, totalizando quatro presentes, sob a presidência de Maria Souza, diretora, comigo, Paulo Reis, secretário, para tratar da seguinte pauta: um, Avaliação diagnóstica do primeiro bimestre; dois, Projeto de leitura; três, Informes gerais.',
      ),
    ).toBe(true);
  });

  it('registra ausentes', () => {
    expect(r.texto).toContain('Não compareceu o seguinte convocado: Rui Lopes, professor.');
  });

  it('encerra no padrão', () => {
    expect(r.texto.endsWith(
      'Nada mais havendo a tratar, foi encerrada a reunião às quinze horas e trinta minutos, e eu, Paulo Reis, secretário, lavrei a presente ata que, lida e aprovada, será assinada por mim e pelos demais presentes.',
    )).toBe(true);
  });

  it('é bloco único e sem dígitos', () => {
    expect(r.texto).not.toMatch(/[\n\r\t]/);
    expect(r.texto).not.toMatch(/ {2}/);
    expect(r.texto).not.toMatch(/\d/);
  });

  it('converte números que o modelo deixou em dígitos', () => {
    expect(r.texto).toContain('dia vinte e três de abril');
    expect(r.texto).toContain('a partir de dezenove de março');
  });

  it('prefixa itens sem menção ao item da pauta e mantém os que já têm', () => {
    expect(r.texto).toContain('No segundo item da pauta: A professora Clara Dias');
    expect(r.texto).toContain('No primeiro item da pauta, a coordenadora');
  });

  it('lista deliberações e encaminhamentos', () => {
    expect(r.texto).toContain('Ficaram registradas as seguintes deliberações: primeira, será realizado reforço semanal a partir de dezenove de março (aprovado por unanimidade); segunda,');
    expect(r.texto).toContain('Como encaminhamento, ficou definido: organizar o reforço de Língua Portuguesa, a cargo de professores de Língua Portuguesa, prazo: dezenove de março.');
  });

  it('assinaturas: presidente, secretário e presentes', () => {
    expect(r.assinaturas.map((p) => p.nome)).toEqual(['Maria Souza', 'Paulo Reis', 'Joana Alves', 'Clara Dias']);
  });

  it('gera ata sem problemas de validação', () => {
    expect(validateAta(r)).toEqual([]);
    expect(r.pendencias).toEqual([]);
  });
});

describe('renderAta com lacunas', () => {
  it('marca pendências: fim da reunião, item não tratado, responsável e prazo', () => {
    const r = renderAta(
      { ...meta, horaFim: undefined },
      {
        itens: [{ pauta: 1, relato: 'No primeiro item da pauta, a diretora relatou os resultados [trecho inaudível].' }],
        deliberacoes: [],
        encaminhamentos: [{ acao: 'Agendar reunião com as famílias' }],
        pendencias: ['[PENDENTE: nome do aluno citado]'],
      },
    );
    expect(r.texto).toContain('[PENDENTE: horário de término da reunião]');
    expect(r.texto).toContain('No segundo item da pauta, [PENDENTE: item não registrado na transcrição].');
    expect(r.pendencias).toEqual(
      expect.arrayContaining([
        'nome do aluno citado',
        'horário de término da reunião',
        'item não registrado na transcrição',
        'responsável pelo primeiro encaminhamento',
        'prazo do primeiro encaminhamento',
        'trecho inaudível',
      ]),
    );
    expect(validateAta(r).some((p) => p.includes('[PENDENTE]'))).toBe(true);
  });

  it('usa "secretário(a)" quando o cargo não indica gênero e "secretária" quando feminino', () => {
    expect(renderAta({ ...meta, secretario: { nome: 'Lia Mota', cargo: 'Assistente' } }, extraida).texto).toContain('comigo, Lia Mota, secretário(a),');
    expect(renderAta({ ...meta, secretario: { nome: 'Lia Mota', cargo: 'Professora' } }, extraida).texto).toContain('comigo, Lia Mota, secretária,');
  });

  it('dia primeiro e escola masculina', () => {
    const r = renderAta({ ...meta, data: '2026-04-01', escola: 'Colégio Estadual Rui Barbosa', local: 'Biblioteca' }, extraida);
    expect(r.texto.startsWith('Ao primeiro dia do mês de abril do ano de dois mil e vinte e seis, às quatorze horas, na biblioteca do Colégio Estadual Rui Barbosa,')).toBe(true);
  });
});

describe('prompts e schemas', () => {
  it('prompt de transcrição inclui participantes, glossário e faixa', () => {
    const p = buildTranscriptionPrompt({ ...meta, glossario: ['BNCC'] }, { inicio: '20:00', fim: '40:00' });
    expect(p).toContain('Joana Alves');
    expect(p).toContain('BNCC');
    expect(p).toContain('[inaudível]');
    expect(p).toContain('de 20:00 até 40:00');
  });

  it('prompt da ata traz regras e a transcrição', () => {
    const { systemInstruction, userPrompt } = buildAtaPrompt(meta, [
      { speaker: 'Maria Souza', start: '00:05', end: '00:20', text: 'Bom dia a todos.' },
    ]);
    expect(systemInstruction).toContain('[PENDENTE');
    expect(systemInstruction).toContain('anonimização ATIVA');
    expect(userPrompt).toContain('[00:05] Maria Souza: Bom dia a todos.');
    expect(buildAtaPrompt({ ...meta, anonimizarAlunos: false }, []).systemInstruction).not.toContain('anonimização ATIVA');
  });

  it('schemas usam só o subconjunto OpenAPI do Gemini', () => {
    const tipos = (o: unknown): string[] =>
      o && typeof o === 'object'
        ? Object.entries(o).flatMap(([k, v]) => (k === 'type' && typeof v === 'string' ? [v] : tipos(v)))
        : [];
    for (const s of [transcriptResponseSchema, ataResponseSchema]) {
      for (const t of tipos(s)) expect(['OBJECT', 'ARRAY', 'STRING', 'INTEGER', 'BOOLEAN']).toContain(t);
    }
    expect((ataResponseSchema as { required: string[] }).required).toEqual(['itens', 'deliberacoes', 'encaminhamentos', 'pendencias']);
  });
});

describe('renderAta: presidente também lavrou a ata', () => {
  const mesma = { ...meta, secretario: { nome: 'Maria Souza', cargo: 'Diretora' } };
  const r = renderAta(mesma, extraida);

  it('abertura e encerramento sem repetir a pessoa como "comigo"', () => {
    expect(r.texto).toContain('sob a presidência de Maria Souza, diretora, que também secretariou a reunião, para tratar');
    expect(r.texto).not.toContain('comigo');
    expect(r.texto).toContain('e eu, Maria Souza, diretora, que presidi a reunião, lavrei a presente ata');
  });

  it('assina uma vez só e passa na validação', () => {
    expect(r.assinaturas.filter((p) => p.nome === 'Maria Souza')).toHaveLength(1);
    expect(validateAta(r)).toEqual([]);
  });
});


describe('revisão editorial da ata pedagógica', () => {
  it.each([
    ['coordenadora Pedagógica', 'coordenadora pedagógica'],
    ['Coordenadora Pedagógica', 'coordenadora pedagógica'],
    ['COORDENADORA PEDAGÓGICA', 'coordenadora pedagógica'],
    ['Auxiliar Administrativo', 'auxiliar administrativo'],
    ['Professor de Matemática', 'professor de Matemática'],
    ['Professora de Língua Portuguesa', 'professora de Língua Portuguesa'],
    ['Professor de AEE', 'professor de AEE'],
    ['Técnico em Informática', 'técnico em Informática'],
  ])('normaliza o cargo %s na abertura sem mudar o cadastro', (cargo, esperado) => {
    const dados: MeetingMetadata = {
      ...meta, participantes: [{ nome: 'Joana Alves', cargo, presente: true }],
    };
    const antes = structuredClone(dados);
    expect(renderAta(dados, extraida).texto).toContain(`Joana Alves, ${esperado}, totalizando`);
    expect(dados).toEqual(antes);
  });

  it('normaliza cargos também na presidência e na relação de ausentes', () => {
    const dados: MeetingMetadata = {
      ...meta,
      presidente: { nome: 'Maria Souza', cargo: 'Diretora Escolar' },
      participantes: [{ nome: 'Joana Alves', cargo: 'coordenadora Pedagógica', presente: false }],
    };
    const texto = renderAta(dados, extraida).texto;
    expect(texto).toContain('sob a presidência de Maria Souza, diretora escolar,');
    expect(texto).toContain('Não compareceu a seguinte convocada: Joana Alves, coordenadora pedagógica.');
  });

  it.each(['pedagogica', 'pais', 'orientacao'] as const)('preserva a grafia da pauta na abertura de %s', tipo => {
    const dados: MeetingMetadata = {
      ...meta, tipo, pauta: ['feira de Ciências', 'Feira de Ciências', 'Projeto Hora da Leitura', 'BNCC e APM'],
    };
    expect(renderAta(dados, extraida).texto).toContain(
      'um, feira de Ciências; dois, Feira de Ciências; três, Projeto Hora da Leitura; quatro, BNCC e APM.',
    );
    expect(dados.pauta).toEqual(['feira de Ciências', 'Feira de Ciências', 'Projeto Hora da Leitura', 'BNCC e APM']);
  });

  it('instrui o modelo a atribuir a fala pelo cargo informado e preservar a pauta', () => {
    const dados: MeetingMetadata = {
      ...meta,
      participantes: [{ nome: 'Joana Alves', cargo: 'coordenadora pedagógica', presente: true }],
      pauta: ['feira de Ciências', 'Projeto Hora da Leitura'],
    };
    const { systemInstruction, userPrompt } = buildAtaPrompt(dados, []);
    expect(systemInstruction).toContain('use exatamente o cargo da lista de pessoas');
    expect(systemInstruction).toContain('sem acrescentar ou transformar o cargo em "professor" ou "professora"');
    expect(systemInstruction).toContain('a coordenadora pedagógica Joana Alves informou que...');
    expect(systemInstruction).not.toContain('a professora Maria Souza, coordenadora pedagógica');
    expect(systemInstruction).toContain('Preserve a grafia e as maiúsculas/minúsculas dos itens da pauta exatamente como informados');
    expect(userPrompt).toContain('- Joana Alves — coordenadora pedagógica');
    expect(userPrompt).toContain('1. feira de Ciências\n2. Projeto Hora da Leitura');
  });
});
