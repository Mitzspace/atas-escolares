import { describe, expect, it } from 'vitest';
import { renderAta, usaListaAnexa } from './render';
import { validateAta } from './validate';
import { buildAtaPrompt, buildTranscriptionPrompt } from './prompts';
import { TIPOS_ATA, listarOrientados, type AtaExtraida, type MeetingMetadata, type Participante } from './types';

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
  it('descreve os quatro tipos', () => {
    expect(Object.keys(TIPOS_ATA)).toEqual(['pedagogica', 'pais', 'orientacao', 'outra']);
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
  it('anonimiza o aluno no texto e na assinatura', () => {
    const r = renderAta({ ...meta, anonimizarAlunos: true }, vazia);
    expect(r.texto).toContain('P.L., aluno do quinto ano B');
    expect(r.texto).not.toContain('Pedro Lima');
    expect(r.assinaturas.at(-1)?.nome).toBe('P.L.');
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
      'reuniram-se Maria Souza, diretora, e a aluna orientada Ana Lima, do quinto ano B, acompanhada de sua mãe, Clara Lima, totalizando três presentes, para tratar de orientação sobre: um, Faltas frequentes; dois, Conflito com colegas.',
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
    expect(systemInstruction).toContain('NÃO use iniciais para nenhum deles');
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
    expect(systemInstruction).not.toContain('NÃO use iniciais para nenhum deles');
  });
});

describe('concordância de número e gênero', () => {
  const sozinha: MeetingMetadata = {
    ...base,
    tipo: 'pais',
    secretario: { nome: 'Maria Souza', cargo: 'Diretora' },
    participantes: [],
    anonimizarAlunos: true,
  };
  const abertura = (m: MeetingMetadata) => /reuniram-se (.*?), totalizando/.exec(renderAta(m, vazia).texto)![1];
  const mae = resp('Ana Costa', 'Mãe', 'aluno Pedro Henrique Lima, 5º ano B');

  it('pais: uma funcionária e uma responsável', () => {
    expect(abertura({ ...sozinha, participantes: [mae] })).toBe(
      'a funcionária Maria Souza, diretora, e a responsável Ana Costa, mãe do aluno P.H.L., do quinto ano B',
    );
  });

  it('pais: um funcionário e um pai', () => {
    const m = { ...sozinha, presidente: { nome: 'Paulo Reis', cargo: 'Diretor' }, secretario: { nome: 'Paulo Reis', cargo: 'Diretor' } };
    expect(abertura({ ...m, participantes: [resp('Rui Dias', 'Pai', 'aluna Lia Dias, 2º ano A')] })).toBe(
      'o funcionário Paulo Reis, diretor, e o responsável Rui Dias, pai da aluna L.D., do segundo ano A',
    );
  });

  it('pais: plural feminino só quando todas são mulheres; misto vai para o masculino', () => {
    const duas = { ...sozinha, participantes: [{ nome: 'Joana Alves', cargo: 'Coordenadora', presente: true }, mae, resp('Lia Reis', 'Mãe', 'aluno Caio Reis, 1º ano A')] };
    expect(abertura(duas)).toBe(
      'as funcionárias Maria Souza, diretora e Joana Alves, coordenadora, e as responsáveis Ana Costa, mãe do aluno P.H.L., do quinto ano B e Lia Reis, mãe do aluno C.R., do primeiro ano A',
    );
    const misto = { ...sozinha, participantes: [mae, resp('Rui Dias', 'Pai', 'aluna Lia Dias, 2º ano A')] };
    expect(abertura(misto)).toContain('e os responsáveis Ana Costa');
    const homem = { ...sozinha, participantes: [{ nome: 'Carlos Mendes', cargo: 'Professor', presente: true }, mae] };
    expect(abertura(homem)).toMatch(/^os funcionários Maria Souza, diretora e Carlos Mendes, professor, e a responsável Ana Costa/);
  });

  it('pais: gênero indefinido usa a forma "o(a)"', () => {
    const m = { ...sozinha, presidente: { nome: 'Lia Mota', cargo: 'Assistente' }, secretario: { nome: 'Lia Mota', cargo: 'Assistente' } };
    expect(abertura({ ...m, participantes: [resp('Marta Gomes', 'Responsável', 'aluno João Neto, 5º ano B')] })).toBe(
      'o(a) funcionário(a) Lia Mota, assistente, e o(a) responsável Marta Gomes, responsável pelo aluno J.N., do quinto ano B',
    );
  });

  it('pais: aluno presente entra pelo cargo, sem repetir "o aluno"', () => {
    const aluna: Participante = { nome: 'Lia Dias', cargo: 'Aluna', categoria: 'aluno', vinculo: '2º ano A', presente: true };
    expect(abertura({ ...sozinha, participantes: [mae, aluna] })).toBe(
      'a funcionária Maria Souza, diretora, e a responsável Ana Costa, mãe do aluno P.H.L., do quinto ano B, e L.D., aluna do segundo ano A',
    );
  });

  it('ausentes: singular e plural, feminino e masculino', () => {
    const aus = (...ps: Participante[]) => renderAta({ ...base, participantes: ps }, vazia).texto;
    const f = (n: string): Participante => ({ nome: n, cargo: 'Professora', presente: false });
    const m = (n: string): Participante => ({ nome: n, cargo: 'Professor', presente: false });
    expect(aus(f('Ana'))).toContain('Não compareceu a seguinte convocada: Ana, professora.');
    expect(aus(m('Rui'))).toContain('Não compareceu o seguinte convocado: Rui, professor.');
    expect(aus(f('Ana'), f('Bia'))).toContain('Não compareceram as seguintes convocadas: Ana, professora e Bia, professora.');
    expect(aus(f('Ana'), m('Rui'))).toContain('Não compareceram os seguintes convocados: Ana, professora e Rui, professor.');
  });

  it('orientação: orientada/orientado, acompanhante e ciência concordam com o orientado', () => {
    const o = (orientado: Participante, acomp: Participante[] = []): MeetingMetadata => ({
      ...base,
      tipo: 'orientacao',
      secretario: base.presidente,
      participantes: acomp,
      orientado,
      pauta: ['Assunto'],
    });
    const f = renderAta(o({ nome: 'Carla Dias', cargo: 'Professora', presente: true }), { ...vazia, cienciaOrientado: true }).texto;
    expect(f).toContain('e a orientada Carla Dias, professora, totalizando');
    expect(f).toContain('tendo a orientada tomado ciência');
    const m = renderAta(o({ nome: 'Caio Reis', cargo: 'Aluno', categoria: 'aluno', vinculo: '1º ano A', presente: true }, [resp('Rui Reis', 'Pai', 'aluno Caio Reis, 1º ano A')]), vazia).texto;
    expect(m).toContain('e o aluno orientado Caio Reis, do primeiro ano A, acompanhado de seu pai, Rui Reis, totalizando');
    const n = renderAta(o({ nome: 'Lia Mota', cargo: 'Aluno(a)', categoria: 'aluno', vinculo: '1º ano A', presente: true }, [resp('Marta Gomes', 'Responsável', 'aluno Lia Mota, 1º ano A')]), { ...vazia, cienciaOrientado: true }).texto;
    expect(n).toContain('e o(a) aluno(a) orientado(a) Lia Mota, do primeiro ano A, acompanhado(a) de seu(sua) responsável, Marta Gomes');
    expect(n).toContain('tendo o(a) orientado(a) tomado ciência');
    const duplo = renderAta(o({ nome: 'Ana Lima', cargo: 'Aluna', categoria: 'aluno', vinculo: '1º ano A', presente: true }, [resp('Clara Lima', 'Mãe', 'aluna Ana Lima'), resp('Rui Lima', 'Pai', 'aluna Ana Lima')]), vazia).texto;
    expect(duplo).toContain('acompanhada de sua mãe, Clara Lima e seu pai, Rui Lima');
  });
});

describe('orientação com vários orientados', () => {
  const aluno = (nome: string, turma: string, cargo = 'Aluna'): Participante => ({ nome, cargo, categoria: 'aluno', vinculo: turma, presente: true });
  const prof = (nome: string, cargo: string): Participante => ({ nome, cargo, presente: true });
  const mae = (nome: string, filha: string, turma: string): Participante => resp(nome, 'Mãe', `aluna ${filha}, ${turma}`);
  const orient = (orientados: Participante[], participantes: Participante[] = []): MeetingMetadata => ({
    ...base,
    tipo: 'orientacao',
    secretario: base.presidente,
    pauta: ['Faltas'],
    anonimizarAlunos: true,
    orientados,
    participantes,
  });
  const ext: AtaExtraida = {
    ...vazia,
    itens: [{ pauta: 1, relato: 'No primeiro assunto, a diretora relatou as faltas.' }],
    orientacoes: ['A diretora orientou os presentes.'],
    cienciaOrientado: true,
  };
  const abre = (m: MeetingMetadata) => /reuniram-se (.*?), para tratar de orientação/.exec(renderAta(m, ext).texto)![1];

  it('um aluno (lista com um item) = comportamento anterior', () => {
    const m = orient([aluno('Ana Lima', '5º ano B')], [mae('Clara Lima', 'Ana Lima', '5º ano B')]);
    expect(renderAta(m, ext).titulo).toBe('ATA Nº 004/2026 – ORIENTAÇÃO A ALUNO');
    expect(abre(m)).toBe('Maria Souza, diretora, e a aluna orientada Ana Lima, do quinto ano B, acompanhada de sua mãe, Clara Lima, totalizando três presentes');
  });

  it('dois alunos, cada um com o seu responsável', () => {
    const m = orient(
      [aluno('Ana Lima', '5º ano B'), aluno('Pedro Souza', '5º ano C', 'Aluno')],
      [mae('Clara Lima', 'Ana Lima', '5º ano B'), resp('Rui Souza', 'Pai', 'aluno Pedro Souza, 5º ano C')],
    );
    const r = renderAta(m, ext);
    expect(r.titulo).toBe('ATA Nº 004/2026 – ORIENTAÇÃO A ALUNOS');
    expect(abre(m)).toBe(
      'Maria Souza, diretora, e os alunos orientados Ana Lima, do quinto ano B, acompanhada de sua mãe, Clara Lima; e Pedro Souza, do quinto ano C, acompanhado de seu pai, Rui Souza, totalizando cinco presentes',
    );
    expect(r.texto).toContain('tendo os orientados tomado ciência das orientações');
    expect(r.assinaturas.map((a) => a.nome)).toEqual(['Maria Souza', 'Ana Lima', 'Pedro Souza', 'Clara Lima', 'Rui Souza']);
    expect(r.assinaturas[1].cargo).toBe('Aluna do quinto ano B (orientada)');
    expect(r.assinaturas[2].cargo).toBe('Aluno do quinto ano C (orientado)');
    expect(validateAta(r)).toEqual([]);
  });

  it('nenhum orientado é anonimizado, nem no vínculo do responsável; outros alunos sim', () => {
    const m = orient(
      [aluno('Ana Lima', '5º ano B'), aluno('Pedro Souza', '5º ano C', 'Aluno')],
      [mae('Clara Lima', 'Ana Lima', '5º ano B'), resp('Zeca Dias', 'Pai', 'aluno Caio Dias, 5º ano A'), aluno('Beto Reis', '5º ano A', 'Aluno')],
    );
    const t = renderAta(m, ext).texto;
    expect(renderAta(m, ext).assinaturas.find((a) => a.nome === 'Clara Lima')?.cargo).toBe('Mãe da aluna Ana Lima, do quinto ano B');
    expect(t).toContain('pai do aluno C.D.');
    expect(t).toContain('B.R., aluno do quinto ano A');
    expect(t).not.toContain('Caio Dias');
  });

  it('responsável sem vínculo reconhecido aparece como presente, não como acompanhante de ninguém', () => {
    const m = orient([aluno('Ana Lima', '5º ano B'), aluno('Pedro Souza', '5º ano C', 'Aluno')], [resp('Zeca Dias', 'Pai', 'aluno Caio Dias, 5º ano A')]);
    expect(abre(m)).toContain('e ainda Zeca Dias, pai do aluno C.D., do quinto ano A');
  });

  it('nomes no começo de frase do modelo não são minusculizados', () => {
    const m = orient([aluno('Ana Lima', '5º ano B')]);
    const t = renderAta(m, { ...ext, manifestacoes: ['Maria Souza disse que sim.'], orientacoes: ['Enviar bilhete.', 'A diretora orientou x.'] }).texto;
    expect(t).toContain('manifestações do orientado e de quem o acompanhou: Maria Souza disse que sim.');
    expect(t).toContain('orientações: Enviar bilhete; a diretora orientou x'.replace('Enviar', 'enviar').replace('orientações: ', 'orientações: primeira, ').replace('; a', '; segunda, a'));
  });

  it('dois funcionários (e duas funcionárias)', () => {
    const m = orient([prof('Carlos Mendes', 'Professor'), prof('Rui Lopes', 'Professor')]);
    expect(renderAta(m, ext).titulo).toBe('ATA Nº 004/2026 – ORIENTAÇÃO A FUNCIONÁRIOS');
    expect(abre(m)).toBe('Maria Souza, diretora, e os orientados Carlos Mendes, professor; e Rui Lopes, professor, totalizando três presentes');
    const f = orient([prof('Carla Dias', 'Professora'), prof('Bia Reis', 'Auxiliar da sala')]);
    expect(abre(f)).toContain('e os orientados Carla Dias');
    const so = orient([prof('Carla Dias', 'Professora'), prof('Bia Souza', 'Professora')]);
    expect(abre(so)).toContain('e as orientadas Carla Dias, professora; e Bia Souza, professora');
    expect(renderAta(so, ext).texto).toContain('tendo as orientadas tomado ciência');
  });

  it('misto: alunos e funcionários', () => {
    const m = orient([prof('Carlos Mendes', 'Professor'), aluno('Ana Lima', '5º ano B')], [mae('Clara Lima', 'Ana Lima', '5º ano B')]);
    const r = renderAta(m, ext);
    expect(r.titulo).toBe('ATA Nº 004/2026 – ORIENTAÇÃO A ALUNOS E FUNCIONÁRIOS');
    expect(abre(m)).toBe(
      'Maria Souza, diretora, e a aluna orientada Ana Lima, do quinto ano B, acompanhada de sua mãe, Clara Lima, e o orientado Carlos Mendes, professor, totalizando quatro presentes',
    );
    expect(r.assinaturas.map((a) => a.nome)).toEqual(['Maria Souza', 'Carlos Mendes', 'Ana Lima', 'Clara Lima']);
    expect(validateAta(r)).toEqual([]);
  });

  it('ciência: pendência no plural, e horário pendente fala em orientação', () => {
    const m = { ...orient([aluno('Ana Lima', '5º ano B'), aluno('Bia Reis', '5º ano B')]), horaFim: undefined };
    const r = renderAta(m, { ...ext, cienciaOrientado: false });
    expect(r.texto).toContain('[PENDENTE: ciência dos orientados]');
    expect(r.texto).toContain('[PENDENTE: horário de término da orientação]');
    expect(r.pendencias).toEqual(expect.arrayContaining(['ciência dos orientados', 'horário de término da orientação']));
    expect(renderAta({ ...m, orientados: [aluno('Ana Lima', '5º ano B')] }, { ...ext, cienciaOrientado: false }).texto).toContain('[PENDENTE: ciência do orientado]');
  });

  it('manifestações no plural', () => {
    const m = orient([aluno('Ana Lima', '5º ano B'), aluno('Bia Reis', '5º ano B')]);
    expect(renderAta(m, { ...ext, manifestacoes: ['Ana Lima concordou.'] }).texto).toContain('manifestações dos orientados e de quem os acompanhou: Ana Lima concordou');
  });

  it('ata antiga com o campo orientado continua igual', () => {
    const antiga: MeetingMetadata = { ...base, tipo: 'orientacao', secretario: base.presidente, pauta: ['Faltas'], participantes: [], orientado: aluno('Ana Lima', '5º ano B') };
    const r = renderAta(antiga, ext);
    expect(r.titulo).toBe('ATA Nº 004/2026 – ORIENTAÇÃO A ALUNO');
    expect(r.texto).toContain('e a aluna orientada Ana Lima, do quinto ano B, totalizando');
    expect(listarOrientados(antiga)).toEqual([antiga.orientado]);
    expect(listarOrientados({ ...antiga, orientados: [prof('X', 'Professor')] })).toHaveLength(1);
    expect(listarOrientados(base)).toEqual([]);
  });

  it('validação exige assinatura de todos os orientados', () => {
    const r = renderAta(orient([aluno('Ana Lima', '5º ano B'), aluno('Bia Reis', '5º ano B')]), ext);
    expect(validateAta(r)).toEqual([]);
    const nenhum = { ...r, assinaturas: [r.assinaturas[0]] };
    expect(validateAta(nenhum).some((x) => x.includes('duas assinaturas'))).toBe(true);
  });

  it('prompts: nenhum orientado é anonimizado e a ciência é coletiva', () => {
    const m = orient([aluno('Ana Lima', '5º ano B'), aluno('Pedro Souza', '5º ano C', 'Aluno')], [aluno('Beto Reis', '5º ano A', 'Aluno')]);
    const { systemInstruction, userPrompt } = buildAtaPrompt(m, []);
    expect(systemInstruction).toContain('NÃO use iniciais para nenhum deles');
    expect(systemInstruction).toContain('TODOS demonstraram ciência');
    expect(systemInstruction).toContain('Nunca atribua a um orientado o que foi dito a outro');
    expect(userPrompt).toContain('Ana Lima — Aluna; turma: 5º ano B (orientado(a))');
    expect(userPrompt).toContain('Pedro Souza — Aluno; turma: 5º ano C (orientado(a))');
    expect(userPrompt).toContain('B.R. — Aluno');
    expect(userPrompt).not.toContain('Beto Reis');
    expect(buildTranscriptionPrompt(m)).toContain('aluno(a) Ana Lima; aluno(a) Pedro Souza');
  });
});
