import { describe, expect, it } from 'vitest';
import { renderAta, usaListaAnexa } from './render';
import { validateAta } from './validate';
import { buildAtaPrompt, buildTranscriptionPrompt } from './prompts';
import { TIPOS_ATA, type AtaExtraida, type MeetingMetadata, type Participante } from './types';

const base: MeetingMetadata = {
  escola: 'Escola Municipal Professora Ana Lima',
  rede: 'Secretaria Municipal de Educação',
  municipioUf: 'Exemplo/SP',
  tipo: 'pedagogica',
  ordinaria: true,
  numero: 4,
  ano: 2026,
  data: '2026-03-12',
  horaInicio: '14:00',
  horaFim: '15:30',
  local: 'Sala dos professores',
  presidente: { nome: 'Maria Souza', cargo: 'Diretora' },
  secretario: { nome: 'Paulo Reis', cargo: 'Professor' },
  participantes: [{ nome: 'Joana Alves', cargo: 'Coordenadora pedagógica', presente: true }],
  pauta: ['Avaliação do 1º bimestre'],
  anonimizarAlunos: false,
};
const vazia: AtaExtraida = { itens: [], deliberacoes: [], encaminhamentos: [], pendencias: [] };

const resp = (nome: string, cargo: string, vinculo: string, presente = true): Participante => ({
  nome,
  cargo,
  categoria: 'responsavel',
  vinculo,
  presente,
});

describe('TIPOS_ATA', () => {
  it('descreve os três tipos', () => {
    expect(Object.keys(TIPOS_ATA)).toEqual(['pedagogica', 'pais', 'orientacao']);
    expect(TIPOS_ATA.pais.titulo).toBe('REUNIÃO DE PAIS E RESPONSÁVEIS');
    for (const t of Object.values(TIPOS_ATA)) expect(t.nome && t.descricao).toBeTruthy();
  });
});

describe('ata antiga (sem tipo/categoria)', () => {
  it('continua igual à pedagógica', () => {
    const antiga = { ...base } as Partial<MeetingMetadata>;
    delete antiga.tipo;
    const r = renderAta(antiga as MeetingMetadata, vazia);
    expect(r.titulo).toBe('ATA Nº 004/2026 – REUNIÃO PEDAGÓGICA ORDINÁRIA');
    expect(r.texto).toContain('reuniram-se Maria Souza, diretora; Paulo Reis, professor; e Joana Alves, coordenadora pedagógica, totalizando três presentes, sob a presidência de');
    expect(r.assinaturas).toEqual([
      { nome: 'Maria Souza', cargo: 'Diretora' },
      { nome: 'Paulo Reis', cargo: 'Professor' },
      { nome: 'Joana Alves', cargo: 'Coordenadora pedagógica' },
    ]);
  });
});

describe('pedagógica com alunos', () => {
  const aluno: Participante = { nome: 'Pedro Lima', cargo: 'Aluno', categoria: 'aluno', vinculo: '5º ano B', presente: true };
  const meta = { ...base, participantes: [...base.participantes, aluno] };

  it('inclui o aluno com a turma', () => {
    const r = renderAta(meta, vazia);
    expect(r.texto).toContain('Pedro Lima, aluno do quinto ano B');
    expect(r.assinaturas.at(-1)).toEqual({ nome: 'Pedro Lima', cargo: 'Aluno do quinto ano B' });
  });
  it('anonimiza o aluno no texto e mantém o nome na assinatura', () => {
    const r = renderAta({ ...meta, anonimizarAlunos: true }, vazia);
    expect(r.texto).toContain('P.L., aluno do quinto ano B');
    expect(r.texto).not.toContain('Pedro Lima');
    expect(r.assinaturas.at(-1)?.nome).toBe('Pedro Lima');
  });
});

describe('reunião de pais e responsáveis', () => {
  const pais: MeetingMetadata = {
    ...base,
    tipo: 'pais',
    pauta: ['Calendário escolar'],
    anonimizarAlunos: true,
    participantes: [
      ...base.participantes,
      resp('Ana Costa', 'Mãe', 'aluno Pedro Henrique Lima, 5º ano B'),
      resp('Rui Dias', 'Pai', 'aluna Lia Dias, 2º ano A'),
      resp('Marta Gomes', 'Responsável', 'aluno João Neto, 5º ano B'),
    ],
  };
  const extraida: AtaExtraida = {
    ...vazia,
    itens: [{ pauta: 1, relato: 'A diretora apresentou o calendário escolar.' }],
    manifestacoes: ['Os responsáveis questionaram o horário de saída.'],
    encaminhamentos: [{ acao: 'Enviar bilhete sobre o horário', responsavel: 'secretaria', prazo: 'próxima semana' }],
  };
  const r = renderAta(pais, extraida);

  it('título e abertura nomeiam funcionários e responsáveis com vínculo (aluno em iniciais)', () => {
    expect(r.titulo).toBe('ATA Nº 004/2026 – REUNIÃO DE PAIS E RESPONSÁVEIS');
    expect(r.texto).toContain(
      'reuniram-se os funcionários Maria Souza, diretora; Paulo Reis, professor; e Joana Alves, coordenadora pedagógica, e os responsáveis Ana Costa, mãe do aluno P.H.L., do quinto ano B; Rui Dias, pai da aluna L.D., do segundo ano A; e Marta Gomes, responsável pelo aluno J.N., do quinto ano B, totalizando seis presentes',
    );
    expect(r.texto).not.toContain('Pedro');
  });

  it('sem anonimização, usa o nome do aluno', () => {
    expect(renderAta({ ...pais, anonimizarAlunos: false }, extraida).texto).toContain('mãe do aluno Pedro Henrique Lima, do quinto ano B');
  });

  it('registra comunicados, demandas e encaminhamentos', () => {
    expect(r.texto).toContain('No primeiro item da pauta: A diretora apresentou o calendário escolar.');
    expect(r.texto).toContain('Os responsáveis apresentaram as seguintes dúvidas e demandas: os responsáveis questionaram o horário de saída.');
    expect(r.texto).toContain('Como encaminhamento, ficou definido: enviar bilhete sobre o horário, a cargo de secretaria, prazo: próxima semana.');
  });

  it('assina todos, com o vínculo do responsável', () => {
    expect(r.assinaturas.map((p) => p.nome)).toEqual(['Maria Souza', 'Paulo Reis', 'Joana Alves', 'Ana Costa', 'Rui Dias', 'Marta Gomes']);
    expect(r.assinaturas[3].cargo).toBe('Mãe do aluno P.H.L., do quinto ano B');
  });

  it('passa na validação', () => {
    expect(validateAta(r)).toEqual([]);
  });

  it('mais de oito responsáveis: conta e remete à lista de presença anexa', () => {
    const muitos = Array.from({ length: 9 }, (_, i) => resp(`Responsável ${String.fromCharCode(65 + i)}`, 'Mãe', `aluno Aluno ${String.fromCharCode(65 + i)}, 5º ano B`));
    const meta = { ...pais, participantes: [...base.participantes, ...muitos] };
    expect(usaListaAnexa(meta)).toBe(true);
    const t = renderAta(meta, extraida).texto;
    expect(t).toContain('e nove responsáveis por alunos, cujos nomes constam da lista de presença anexa, que é parte integrante desta ata, totalizando doze presentes');
    expect(t).not.toContain('Responsável A');
    expect(validateAta(renderAta(meta, extraida))).toEqual([]);
  });

  it('usaListaAnexa: oito não, nove sim; só presentes contam; só em atas de pais', () => {
    const fazer = (n: number, ausentes = 0) => ({
      ...pais,
      participantes: Array.from({ length: n + ausentes }, (_, i) => resp(`R${String.fromCharCode(65 + i)}`, 'Pai', 'aluno X, 5º ano B', i < n)),
    });
    expect(usaListaAnexa(fazer(8))).toBe(false);
    expect(usaListaAnexa(fazer(9))).toBe(true);
    expect(usaListaAnexa(fazer(8, 3))).toBe(false);
    expect(usaListaAnexa({ ...fazer(9), tipo: 'pedagogica' })).toBe(false);
  });

  it('valida: pais sem responsáveis é apontado', () => {
    const sem = renderAta({ ...pais, participantes: base.participantes }, vazia);
    expect(validateAta(sem).some((x) => x.includes('responsáveis'))).toBe(true);
  });
});

describe('orientação', () => {
  const aluna: Participante = { nome: 'Ana Lima', cargo: 'Aluna', categoria: 'aluno', vinculo: '5º ano B', presente: true };
  const orient: MeetingMetadata = {
    ...base,
    tipo: 'orientacao',
    secretario: { nome: 'Maria Souza', cargo: 'Diretora' },
    pauta: ['Faltas frequentes', 'Conflito com colegas'],
    anonimizarAlunos: true,
    orientado: aluna,
    participantes: [resp('Clara Lima', 'Mãe', 'aluna Ana Lima, 5º ano B')],
  };
  const extraida: AtaExtraida = {
    itens: [
      { pauta: 1, relato: 'A diretora relatou que a aluna teve oito faltas no bimestre.' },
      { pauta: 2, relato: 'Segundo a diretora, houve conflito com o aluno J.P.S.' },
    ],
    deliberacoes: [],
    encaminhamentos: [{ acao: 'Acompanhar a frequência', responsavel: 'a coordenadora', prazo: 'trinta de abril' }],
    pendencias: [],
    manifestacoes: ['A aluna disse que faltou por doença.'],
    orientacoes: ['A diretora orientou que as faltas sejam justificadas.'],
    cienciaOrientado: true,
  };

  it('título por categoria do orientado', () => {
    expect(renderAta(orient, extraida).titulo).toBe('ATA Nº 004/2026 – ORIENTAÇÃO A ALUNO');
    const func = { ...orient, orientado: { nome: 'Carlos Mendes', cargo: 'Professor', presente: true } };
    expect(renderAta(func, extraida).titulo).toBe('ATA Nº 004/2026 – ORIENTAÇÃO A FUNCIONÁRIO');
  });

  it('abertura: orientador, orientado (nome NÃO anonimizado) e responsável acompanhante', () => {
    const r = renderAta(orient, extraida);
    expect(r.texto).toContain(
      'reuniram-se Maria Souza, diretora, e a aluna orientada Ana Lima, do quinto ano B, acompanhada de sua mãe, Clara Lima, totalizando três presentes, para tratar de orientação sobre: um, faltas frequentes; dois, conflito com colegas.',
    );
  });

  it('funcionário orientado e secretário diferente do orientador', () => {
    const func = {
      ...orient,
      secretario: { nome: 'Paulo Reis', cargo: 'Professor' },
      participantes: [],
      orientado: { nome: 'Carlos Mendes', cargo: 'Professor', presente: true } as Participante,
    };
    expect(renderAta(func, extraida).texto).toContain(
      'reuniram-se Maria Souza, diretora, e o orientado Carlos Mendes, professor, comigo, Paulo Reis, secretário, totalizando três presentes, para tratar de orientação sobre:',
    );
  });

  it('relata assuntos, manifestações, orientações e combinados', () => {
    const t = renderAta(orient, extraida).texto;
    expect(t).toContain('No primeiro assunto: A diretora relatou');
    expect(t).toContain('Foram registradas as seguintes manifestações do orientado e de quem o acompanhou: a aluna disse que faltou por doença.');
    expect(t).toContain('Foram dadas as seguintes orientações: a diretora orientou que as faltas sejam justificadas.');
    expect(t).toContain('Como combinado, ficou definido: acompanhar a frequência, a cargo da coordenadora, prazo: trinta de abril.');
  });

  it('encerra com a ciência do orientado quando consta; senão deixa pendente', () => {
    const com = renderAta(orient, extraida);
    expect(com.texto).toContain('foi encerrada a orientação às quinze horas e trinta minutos, tendo a orientada tomado ciência das orientações, e eu, Maria Souza, diretora, que presidi a reunião, lavrei');
    expect(validateAta(com)).toEqual([]);
    const sem = renderAta(orient, { ...extraida, cienciaOrientado: false });
    expect(sem.texto).toContain('[PENDENTE: ciência do orientado]');
    expect(sem.pendencias).toContain('ciência do orientado');
    expect(validateAta(sem).some((x) => x.includes('[PENDENTE]'))).toBe(true);
  });

  it('sem orientações dadas fica pendente', () => {
    const r = renderAta(orient, { ...extraida, orientacoes: undefined });
    expect(r.pendencias).toContain('orientações dadas');
  });

  it('assinaturas: orientador, orientado e responsável', () => {
    const r = renderAta(orient, extraida);
    expect(r.assinaturas).toEqual([
      { nome: 'Maria Souza', cargo: 'Diretora' },
      { nome: 'Ana Lima', cargo: 'Aluna do quinto ano B (orientada)' },
      { nome: 'Clara Lima', cargo: 'Mãe da aluna Ana Lima, do quinto ano B' },
    ]);
  });

  it('valida por tipo', () => {
    const r = renderAta(orient, extraida);
    const ruim = { ...r, texto: r.texto.replace('para tratar de orientação sobre', 'para tratar de'), assinaturas: [r.assinaturas[0]] };
    const problemas = validateAta(ruim);
    expect(problemas.some((x) => x.startsWith('Abertura da orientação'))).toBe(true);
    expect(problemas.some((x) => x.includes('duas assinaturas'))).toBe(true);
  });
});

describe('prompts por tipo', () => {
  const aluna: Participante = { nome: 'Ana Lima', cargo: 'Aluna', categoria: 'aluno', vinculo: '5º ano B', presente: true };
  const colega: Participante = { nome: 'Pedro Lima', cargo: 'Aluno', categoria: 'aluno', vinculo: '5º ano B', presente: true };

  it('pais: pede demandas sem casos individuais e anonimiza o aluno do vínculo', () => {
    const meta: MeetingMetadata = {
      ...base,
      tipo: 'pais',
      anonimizarAlunos: true,
      participantes: [resp('Ana Costa', 'Mãe', 'aluno Pedro Henrique Lima, 5º ano B')],
    };
    const { systemInstruction, userPrompt } = buildAtaPrompt(meta, []);
    expect(systemInstruction).toContain('reunião de pais e responsáveis');
    expect(systemInstruction).toContain('NÃO registre casos individuais');
    expect(userPrompt).toContain('vínculo: aluno P.H.L., 5º ano B');
    expect(userPrompt).not.toContain('Pedro Henrique');
    // a transcrição usa os nomes reais para reconhecer quem fala
    expect(buildTranscriptionPrompt(meta)).toContain('vínculo: aluno Pedro Henrique Lima');
  });

  it('orientação: não anonimiza o orientado, mas anonimiza outros alunos', () => {
    const meta: MeetingMetadata = { ...base, tipo: 'orientacao', anonimizarAlunos: true, orientado: aluna, participantes: [colega] };
    const { systemInstruction, userPrompt } = buildAtaPrompt(meta, []);
    expect(systemInstruction).toContain('NÃO use iniciais para ele(a)');
    expect(systemInstruction).toContain('cienciaOrientado');
    expect(userPrompt).toContain('Ana Lima — Aluna; turma: 5º ano B (orientado(a))');
    expect(userPrompt).toContain('P.L. — Aluno');
    expect(userPrompt).not.toContain('Pedro Lima');
    expect(userPrompt).toContain('Assuntos da orientação');
  });

  it('pedagógica: como antes, com anonimização geral', () => {
    const { systemInstruction } = buildAtaPrompt({ ...base, anonimizarAlunos: true }, []);
    expect(systemInstruction).toContain('reunião pedagógica');
    expect(systemInstruction).toContain('anonimização ATIVA');
    expect(systemInstruction).not.toContain('NÃO use iniciais para ele(a)');
  });
});
