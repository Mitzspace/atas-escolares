import { describe, expect, it } from 'vitest';
import { buildAtaPrompt } from './prompts';
import { renderAta } from './render';
import type { AtaExtraida, MeetingMetadata, TranscriptSegment } from './types';

const meta: MeetingMetadata = {
  escola: 'Escola de teste', rede: 'Municipal', municipioUf: 'Exemplo/SP',
  tipo: 'pais', ordinaria: true, numero: 1, ano: 2026, data: '2026-10-20',
  horaInicio: '19:00', horaFim: '19:50', local: 'Escola',
  presidente: { nome: 'Maria Souza', cargo: 'Diretora' },
  secretario: { nome: 'Joana Alves', cargo: 'Coordenadora pedagógica' },
  participantes: [
    { nome: 'Clara Dias', cargo: 'Professora de Ciências', presente: true },
    { nome: 'Ana Costa', cargo: 'Mãe', categoria: 'responsavel', presente: true },
    { nome: 'Beatriz Lima', cargo: 'Mãe', categoria: 'responsavel', presente: true },
  ],
  pauta: ['Calendário', 'Feira de Ciências'], anonimizarAlunos: true,
};
const segmento = (speaker: string, text: string, start = '00:00', end = '00:05'): TranscriptSegment => ({ speaker, text, start, end });
const vazia: AtaExtraida = { itens: [], deliberacoes: [], encaminhamentos: [], pendencias: [] };
const corpoTranscricao = (prompt: string) => prompt.split('TRANSCRIÇÃO (formato [MM:SS] falante: fala)')[1];

describe('autoria revisada e fidelidade do relato', () => {
  it('transmite atribuições explícitas por trecho sem reescrever speaker, texto ou ordem', () => {
    const trechos = [
      segmento('Joana Alves', 'Foi aprovada a feira por maioria.', '03:00', '03:05'),
      segmento('Clara Dias', 'Ótimo! Eu vou mandar o regulamento para os professores até a semana que vem.', '03:06', '03:12'),
      segmento('Falante', 'Terceiro item, os informes.', '03:13', '03:15'),
    ];
    const original = structuredClone(trechos);
    const { userPrompt, systemInstruction } = buildAtaPrompt({ ...meta, tipo: 'pedagogica' }, trechos);
    const corpo = corpoTranscricao(userPrompt);
    expect(corpo).toContain('Autoria informada do trecho 1 (03:00–03:05): "Joana Alves"; vale somente para este trecho.');
    expect(corpo).toContain('Autoria informada do trecho 2 (03:06–03:12): "Clara Dias"; vale somente para este trecho.');
    expect(corpo).not.toContain('Autoria informada do trecho 3');
    const falas = trechos.map(s => `[${s.start}] ${s.speaker}: ${s.text}`);
    falas.forEach(fala => expect(corpo).toContain(fala));
    expect(corpo.indexOf(falas[0])).toBeLessThan(corpo.indexOf(falas[1]));
    expect(corpo.indexOf(falas[1])).toBeLessThan(corpo.indexOf(falas[2]));
    expect(trechos).toEqual(original);
    expect(systemInstruction).toContain('a atribuição da revisão tem precedência');
    expect(systemInstruction).toContain('o relato e o responsável pelo envio são Clara Dias, nunca Joana Alves');
  });

  it.each(['Falante', 'Falante 1', 'Falante 1 (texto não segmentado; falantes e tempos não identificados)', 'Speaker 2', ''])(
    'não promove o rótulo genérico %s a autoria confirmada', speaker => {
      const { userPrompt, systemInstruction } = buildAtaPrompt(meta, [segmento(speaker, 'Eu vou mandar o regulamento.')]);
      expect(corpoTranscricao(userPrompt)).not.toContain('Autoria informada');
      expect(corpoTranscricao(userPrompt)).toContain(`[00:00] ${speaker}: Eu vou mandar o regulamento.`);
      expect(systemInstruction).toContain('não herde automaticamente o nome anterior');
      expect(systemInstruction).toContain('omita "responsavel" e sinalize [confirmar: responsável pelo envio do regulamento]');
    },
  );

  it('mantém a pergunta concreta de Ana e a confirmação explícita de Joana na entrada', () => {
    const pergunta = 'A recuperação será mesmo de 8 a 12 de dezembro? A gente deve aguardar a orientação da escola sobre os horários?';
    const resposta = 'Isso mesmo, Ana. A recuperação será de 8 a 12 de dezembro.';
    const { userPrompt, systemInstruction } = buildAtaPrompt(meta, [segmento('Ana Costa', pergunta), segmento('Joana Alves', resposta)]);
    expect(corpoTranscricao(userPrompt)).toContain(`[00:00] Ana Costa: ${pergunta}`);
    expect(corpoTranscricao(userPrompt)).toContain(`[00:00] Joana Alves: ${resposta}`);
    expect(systemInstruction).not.toContain('NÃO identifique quem perguntou');
    expect(systemInstruction).toContain('preserve a pergunta concreta');
    expect(systemInstruction).toContain('a resposta explícita da escola no relato do mesmo item');
    expect(systemInstruction).toContain('Não conclua que horários específicos foram informados');
    expect(systemInstruction).toContain('nesses casos não identifique o responsável'); // casos individuais sensíveis continuam protegidos
  });

  it('não transforma erro de reconhecimento em sujeito ou nome reconstruído pelo cadastro', () => {
    const texto = 'Do quinto ano o bairro ofereço ajuda na feira de ciências.';
    const { userPrompt, systemInstruction } = buildAtaPrompt(meta, [segmento('Falante', texto)]);
    const corpo = corpoTranscricao(userPrompt);
    expect(corpo).toContain(`[00:00] Falante: ${texto}`);
    expect(corpo).not.toContain('Beatriz Lima');
    expect(systemInstruction).toContain('não sustenta "o bairro oferecia ajuda"');
    expect(systemInstruction).toContain('Não crie um sujeito nem recupere um nome apenas porque ele consta no cadastro');
    expect(systemInstruction).toContain('[confirmar: trecho da oferta de ajuda]');
  });

  it.each(['pais', 'pedagogica', 'orientacao'] as const)('distingue assunto fora da pauta de tarefa efetiva em %s', tipo => {
    const { systemInstruction } = buildAtaPrompt({ ...meta, tipo }, [segmento('Falante', 'A pergunta do estacionamento fica fora da pauta e será verificada.')]);
    expect(systemInstruction).toContain('Registre apenas esse fato em "itens", com "pauta": 0');
    expect(systemInstruction).toContain('Não crie um encaminhamento "verificar mudança nas vagas do estacionamento"');
    expect(systemInstruction).toContain('Marcadores [PENDENTE] não substituem a evidência de que a tarefa foi combinada');
    expect(systemInstruction).toContain('se uma fala distinta efetivamente assumir a tarefa');
  });

  it('renderiza relato fora da pauta sem produzir compromisso nem pendências artificiais', () => {
    const ata = renderAta(meta, { ...vazia, itens: [
      { pauta: 1, relato: 'Ana Costa perguntou se a recuperação seria de oito a doze de dezembro e se aguardaria orientação sobre horários. Joana Alves confirmou o período de oito a doze de dezembro.' },
      { pauta: 0, relato: 'A pergunta sobre o estacionamento foi considerada fora da pauta e seria verificada posteriormente.' },
    ] });
    expect(ata.texto).toContain('Ana Costa perguntou');
    expect(ata.texto).toContain('Joana Alves confirmou o período de oito a doze de dezembro');
    expect(ata.texto).toContain('Em assuntos gerais: A pergunta sobre o estacionamento foi considerada fora da pauta');
    expect(ata.texto).not.toContain('Como encaminhamento');
    expect(ata.pendencias).not.toEqual(expect.arrayContaining([expect.stringMatching(/responsável|prazo/)]));
  });

  it('preserva votos confirmados e a tarefa de Clara sem transferir autoria para Joana', () => {
    const ata = renderAta({ ...meta, tipo: 'pedagogica' }, { ...vazia,
      itens: [{ pauta: 2, relato: 'Clara Dias informou que enviaria o regulamento até a semana seguinte.' }],
      deliberacoes: [{ texto: 'Foi aprovada a feira no sábado', votacao: 'onze votos favoráveis e um contrário de Carlos Mendes' }],
      encaminhamentos: [{ acao: 'Enviar o regulamento aos professores', responsavel: 'Clara Dias', prazo: 'semana seguinte' }],
    });
    expect(ata.texto).toContain('Clara Dias informou que enviaria o regulamento');
    expect(ata.texto).toContain('onze votos favoráveis e um contrário de Carlos Mendes');
    expect(ata.texto).toContain('enviar o regulamento aos professores, a cargo de Clara Dias, prazo: semana seguinte');
    expect(ata.texto).not.toMatch(/Joana Alves[^.]*regulamento/);
  });

  it('mantém uma tarefa realmente assumida mesmo quando não foram informados responsável e prazo', () => {
    const ata = renderAta(meta, { ...vazia, encaminhamentos: [{ acao: 'Enviar o comunicado que ficou combinado' }] });
    expect(ata.texto).toContain('Como encaminhamento');
    expect(ata.pendencias).toEqual(expect.arrayContaining([
      'responsável pelo primeiro encaminhamento', 'prazo do primeiro encaminhamento',
    ]));
  });
});

it('exige preservar o limiar de faltas e o argumento contrário, além do resultado da votação', () => {
  const fonte = [
    segmento('Joana Alves', 'O aluno Pedro Henrique acumulou mais de 15 faltas no bimestre.'),
    segmento('Carlos Mendes', 'Muitos pais trabalham no sábado e nem todo professor pode vir.'),
  ];
  const { systemInstruction, userPrompt } = buildAtaPrompt({ ...meta, tipo: 'pedagogica' }, fonte);
  expect(systemInstruction).toContain('Registre todo fato relevante dito');
  expect(systemInstruction).toContain('preserve a quantidade e o "mais de"');
  expect(systemInstruction).toContain('relato de votação e relato dos argumentos são complementares');
  expect(userPrompt).toContain(fonte[0].text); expect(userPrompt).toContain(fonte[1].text);
  const resultado = renderAta({ ...meta, tipo: 'pedagogica' }, { ...vazia, itens: [{ pauta: 1,
    relato: 'Joana Alves informou que Pedro Henrique acumulou mais de 15 faltas. Carlos Mendes argumentou que muitos pais trabalhavam no sábado e nem todo professor poderia comparecer.' }],
  }, fonte);
  expect(resultado.texto).toContain('P.H. acumulou mais de quinze faltas');
  expect(resultado.texto).toContain('muitos pais trabalhavam no sábado e nem todo professor poderia comparecer');
  expect(resultado.texto).not.toContain('Pedro Henrique');
});
