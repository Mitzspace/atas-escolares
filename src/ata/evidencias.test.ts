import { describe, expect, it } from 'vitest';
import { vinculoDoResponsavel } from '../pessoas';
import { montarDocumento } from '../pdf';
import { buildAtaPrompt } from './prompts';
import { renderAta } from './render';
import type { AtaExtraida, MeetingMetadata, TranscriptSegment } from './types';

const meta: MeetingMetadata = {
  escola: 'Escola de teste', rede: 'Municipal', municipioUf: 'Exemplo/SP',
  tipo: 'pais', ordinaria: true, numero: 1, ano: 2026, data: '2026-10-20',
  horaInicio: '14:00', horaFim: '15:10', local: 'sala dos professores',
  presidente: { nome: 'Maria Souza', cargo: 'Diretora' },
  secretario: { nome: 'Paulo Reis', cargo: 'Secretário' },
  participantes: [
    { nome: 'Joana Alves', cargo: 'Coordenadora pedagógica', presente: true },
    { nome: 'Rui Dias', cargo: 'Pai', categoria: 'responsavel', presente: true,
      vinculo: vinculoDoResponsavel('Laura Dias', '3º ano A', 'aluna') },
  ],
  pauta: ['Calendário escolar e datas importantes', 'Dúvidas e sugestões das famílias'],
  anonimizarAlunos: true,
};
const vazia: AtaExtraida = { itens: [], deliberacoes: [], encaminhamentos: [], manifestacoes: [], pendencias: [] };
const saudacao: TranscriptSegment[] = [{
  speaker: 'Falante 1', start: '00:00', end: '00:40',
  text: 'Boa tarde a todos. Hoje é a nossa reunião pedagógica do mês de outubro.',
}];

describe('vínculo do responsável e conteúdo sustentado pela transcrição', () => {
  it('leva o vínculo explícito da aluna à abertura, à assinatura e ao documento PDF', () => {
    const ata = renderAta(meta, vazia);
    expect(ata.texto).toContain('Rui Dias, pai da aluna L.D., do terceiro ano A');
    expect(ata.assinaturas.find(p => p.nome === 'Rui Dias')?.cargo).toBe('Pai da aluna L.D., do terceiro ano A');
    const pdf = JSON.stringify(montarDocumento(ata, ata.texto, meta).content);
    expect(pdf).toContain('Rui Dias, pai da aluna L.D., do terceiro ano A');
    expect(pdf).toContain('Pai da aluna L.D., do terceiro ano A');
    expect(pdf).not.toContain('pai do aluno L.D.');
    expect(pdf).not.toContain('Laura Dias');
    const { userPrompt, systemInstruction } = buildAtaPrompt(meta, saudacao);
    expect(userPrompt).toContain('Rui Dias — Pai; vínculo: aluna L.D., 3º ano A');
    expect(userPrompt).not.toContain('Laura Dias');
    expect(systemInstruction).toContain('nunca infira o gênero pelo nome');
  });

  it('não deduz gênero pelo nome nem pelo parentesco quando não informado', () => {
    const dados: MeetingMetadata = {
      ...meta, participantes: [{ ...meta.participantes[1], vinculo: vinculoDoResponsavel('Laura Dias', '3º ano A') }],
    };
    const ata = renderAta(dados, vazia);
    expect(ata.texto).toContain('Rui Dias, pai do(a) aluno(a) L.D.');
    expect(ata.assinaturas.find(p => p.nome === 'Rui Dias')?.cargo).toContain('Pai do(a) aluno(a) L.D.');
    expect(dados.participantes[0].vinculo).toBe('aluno(a) Laura Dias, 3º ano A');
  });

  it.each(['pedagogica', 'pais', 'orientacao'] as const)('prompt de %s não usa pauta ou cadastro como evidência de falas', tipo => {
    const { systemInstruction, userPrompt } = buildAtaPrompt({ ...meta, tipo }, saudacao);
    expect(systemInstruction).not.toContain('de duas a seis frases por item');
    expect(systemInstruction).toContain('sem quantidade mínima de frases por item');
    expect(systemInstruction).toContain('Esses dados NÃO são evidência de falas');
    expect(systemInstruction).toContain('Só a TRANSCRIÇÃO pode sustentar esses fatos');
    expect(systemInstruction).toContain('não atribua a ela resultados, propostas, esclarecimentos ou opiniões');
    expect(systemInstruction).toContain('Não confunda presença na lista com participação oral');
    expect(systemInstruction).toContain('devolva "itens": [], "deliberacoes": [], "encaminhamentos": []');
    expect(systemInstruction).toContain('não comprova apresentação de calendário, passagem de palavra à coordenadora, exposição de resultados nem manifestações dos responsáveis');
    expect(userPrompt).toContain('cadastro e pauta prevista; não comprovam falas ou acontecimentos');
    expect(userPrompt).toContain(`[00:00] Falante 1: ${saudacao[0].text}`);
  });

  it('deixa pendências para pautas sem relato e não cria exposições ou manifestações', () => {
    const ata = renderAta(meta, vazia);
    expect(ata.texto).toContain('No primeiro item da pauta, [PENDENTE: item não registrado na transcrição]');
    expect(ata.texto).toContain('No segundo item da pauta, [PENDENTE: item não registrado na transcrição]');
    expect(ata.pendencias).toContain('item não registrado na transcrição');
    expect(ata.texto).not.toMatch(/Maria Souza informou|passando a palavra|Joana Alves expôs|iniciou a exposição|Os responsáveis apresentaram|Ficou registrada|Como encaminhamento/);
  });
});
