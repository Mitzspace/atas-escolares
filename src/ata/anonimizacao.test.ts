import { expect, it } from 'vitest';
import { anonimizarAtaExtraida } from './anonimizacao';
import { renderAta } from './render';
import type { AtaExtraida, MeetingMetadata, TranscriptSegment } from './types';
const meta: MeetingMetadata = {
  escola: 'Escola Teste', rede: 'Municipal', municipioUf: 'Exemplo/SP', tipo: 'pedagogica', ordinaria: true, numero: 1, ano: 2026,
  data: '2026-10-25', horaInicio: '14:00', local: 'Escola', presidente: { nome: 'Maria Souza', cargo: 'Diretora' },
  secretario: { nome: 'Joana Alves', cargo: 'Coordenadora' }, pauta: ['Frequência'], anonimizarAlunos: true,
  participantes: [
    { nome: 'Pedro Henrique', cargo: 'Aluno', categoria: 'aluno', presente: true },
    { nome: 'Rui Dias', cargo: 'Pai', categoria: 'responsavel', presente: true, vinculo: 'aluna Laura Dias, 5º ano B' },
    { nome: 'Carlos Mendes', cargo: 'Professor', presente: true },
  ],
};
const transcript: TranscriptSegment[] = [{ speaker: 'Falante', start: '00:00', end: '00:10', text: 'O aluno João de Souza teve mais de 15 faltas.' }];
const extraida: AtaExtraida = {
  itens: [{ pauta: 1, relato: 'Pedro Henrique teve mais de quinze faltas. Laura Dias recebeu orientação. João de Souza pediu apoio. Carlos Mendes informou o caso de PEDRO HENRIQUE.' }],
  deliberacoes: [{ texto: 'Foi aprovado apoio a João de Souza' }],
  encaminhamentos: [{ acao: 'Chamar a família de Pedro Henrique', responsavel: 'Joana Alves' }],
  pendencias: ['confirmar atendimento de Laura Dias'],
};
it('mascara nomes conhecidos e ligados a aluno na transcrição em todos os campos da redação', () => {
  const original = structuredClone(extraida);
  const segura = anonimizarAtaExtraida(meta, transcript, extraida);
  const json = JSON.stringify(segura);
  for (const nome of ['Pedro Henrique', 'PEDRO HENRIQUE', 'Laura Dias', 'João de Souza']) expect(json).not.toContain(nome);
  expect(json).toContain('P.H.'); expect(json).toContain('L.D.'); expect(json).toContain('J.S.');
  expect(json).toContain('Carlos Mendes'); expect(json).toContain('Joana Alves');
  expect(extraida).toEqual(original);
  expect(anonimizarAtaExtraida(meta, transcript, segura)).toEqual(segura);
});
it('protege texto final e assinaturas mesmo se o modelo desobedecer ao prompt', () => {
  const ata = renderAta(meta, extraida, transcript);
  expect(ata.texto).not.toContain('Pedro Henrique'); expect(ata.texto).not.toContain('Laura Dias'); expect(ata.texto).not.toContain('João de Souza');
  expect(ata.assinaturas.find(p => p.nome === 'P.H.')).toBeDefined();
  expect(ata.texto).toContain('mais de quinze faltas');
});
it('mantém orientados nomeados e protege colegas citados', () => {
  const orientacao: MeetingMetadata = { ...meta, tipo: 'orientacao', orientados: [{ nome: 'Ana Lima', cargo: 'Aluna', categoria: 'aluno', presente: true }] };
  const r = renderAta(orientacao, { ...extraida, itens: [{ pauta: 1, relato: 'A aluna orientada Ana Lima relatou o caso do aluno Pedro Henrique.' }] });
  expect(r.texto).toContain('aluna orientada Ana Lima');
  expect(r.texto).toContain('aluno P.H.');
  expect(r.assinaturas.some(p => p.nome === 'Ana Lima')).toBe(true);
});
it('respeita anonimização desligada', () => {
  const semAnon = { ...meta, anonimizarAlunos: false };
  expect(anonimizarAtaExtraida(semAnon, transcript, extraida)).toBe(extraida);
  expect(renderAta(semAnon, extraida, transcript).texto).toContain('Pedro Henrique');
});
it('trata grafia sem acento, caixa e espaços sem alterar a identidade de funcionários', () => {
  const r = anonimizarAtaExtraida(meta, transcript, { ...extraida, itens: [{ pauta: 1, relato: 'JOAO   DE SOUZA conversou com Carlos Mendes sobre Pedro Henrique.' }] });
  expect(r.itens[0].relato).toBe('J.S. conversou com Carlos Mendes sobre P.H.');
});
it('marca nome parcialmente corrompido para conferir anonimização', () => {
  const r = anonimizarAtaExtraida(meta, [], { ...extraida, itens: [{ pauta: 1, relato: 'O aluno Bruno*Silva relatou o problema.' }] });
  expect(r.pendencias).toContain('confirmar anonimização');
});
it('não mascara nomes de adultos por coincidência do primeiro nome', () => {
  const dados = { ...meta, participantes: [...meta.participantes, { nome: 'Pedro Dias', cargo: 'Professor', presente: true }] };
  const r = renderAta(dados, { ...extraida, itens: [{ pauta: 1, relato: 'O professor Pedro Dias conversou com o aluno Pedro Henrique.' }] });
  expect(r.texto).toContain('professor Pedro Dias'); expect(r.texto).toContain('aluno P.H.');
});
it('não considera rótulos gramaticais como nomes de alunos', () => {
  const r = anonimizarAtaExtraida(meta, [], { ...extraida, itens: [{ pauta: 1, relato: 'A aluna teve faltas e o aluno do quinto ano recebeu apoio.' }] });
  expect(r.itens[0].relato).toBe('A aluna teve faltas e o aluno do quinto ano recebeu apoio.');
});
