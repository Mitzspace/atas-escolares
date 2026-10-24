import { describe, expect, it } from 'vitest';
import { dataPorExtenso, horaPorExtenso, numeroPorExtenso, ordinalPorExtenso } from './extenso';
import { numerosParaExtenso } from './numeros';

describe('numeroPorExtenso', () => {
  it.each([
    [0, 'zero'],
    [1, 'um'],
    [2, 'dois'],
    [13, 'treze'],
    [16, 'dezesseis'],
    [21, 'vinte e um'],
    [99, 'noventa e nove'],
    [100, 'cem'],
    [101, 'cento e um'],
    [110, 'cento e dez'],
    [200, 'duzentos'],
    [999, 'novecentos e noventa e nove'],
    [1000, 'mil'],
    [1001, 'mil e um'],
    [1100, 'mil e cem'],
    [1101, 'mil cento e um'],
    [2000, 'dois mil'],
    [2026, 'dois mil e vinte e seis'],
    [21000, 'vinte e um mil'],
    [100000, 'cem mil'],
    [1000000, 'um milhão'],
    [2000000, 'dois milhões'],
    [1500000, 'um milhão e quinhentos mil'],
    [1000001, 'um milhão e um'],
    [1234567, 'um milhão duzentos e trinta e quatro mil quinhentos e sessenta e sete'],
    [1000000000, 'um bilhão'],
    [-3, 'menos três'],
  ])('%i -> %s', (n, esperado) => {
    expect(numeroPorExtenso(n)).toBe(esperado);
  });

  it('flexiona no feminino', () => {
    expect(numeroPorExtenso(1, 'f')).toBe('uma');
    expect(numeroPorExtenso(2, 'f')).toBe('duas');
    expect(numeroPorExtenso(21, 'f')).toBe('vinte e uma');
    expect(numeroPorExtenso(201, 'f')).toBe('duzentas e uma');
    expect(numeroPorExtenso(2000, 'f')).toBe('duas mil');
    expect(numeroPorExtenso(1000000, 'f')).toBe('um milhão');
  });

  it('rejeita não inteiros e valores enormes', () => {
    expect(() => numeroPorExtenso(1.5)).toThrow(RangeError);
    expect(() => numeroPorExtenso(1e15)).toThrow(RangeError);
  });
});

describe('ordinalPorExtenso', () => {
  it('gera ordinais', () => {
    expect(ordinalPorExtenso(1)).toBe('primeiro');
    expect(ordinalPorExtenso(3, 'f')).toBe('terceira');
    expect(ordinalPorExtenso(10)).toBe('décimo');
    expect(ordinalPorExtenso(12)).toBe('décimo segundo');
    expect(ordinalPorExtenso(20, 'f')).toBe('vigésima');
    expect(ordinalPorExtenso(100)).toBe('centésimo');
  });
});

describe('dataPorExtenso', () => {
  it('escreve a data da abertura', () => {
    expect(dataPorExtenso('2026-03-12')).toBe('Aos doze dias do mês de março do ano de dois mil e vinte e seis');
    expect(dataPorExtenso('2025-12-31')).toBe('Aos trinta e um dias do mês de dezembro do ano de dois mil e vinte e cinco');
  });
  it('usa "primeiro" no dia 1', () => {
    expect(dataPorExtenso('2026-03-01')).toBe('Ao primeiro dia do mês de março do ano de dois mil e vinte e seis');
  });
  it('rejeita datas inválidas', () => {
    expect(() => dataPorExtenso('2026-02-30')).toThrow(RangeError);
    expect(() => dataPorExtenso('12/03/2026')).toThrow(RangeError);
  });
});

describe('horaPorExtenso', () => {
  it.each([
    ['14:30', 'às quatorze horas e trinta minutos'],
    ['13:00', 'às treze horas'],
    ['01:00', 'à uma hora'],
    ['02:15', 'às duas horas e quinze minutos'],
    ['08:01', 'às oito horas e um minuto'],
    ['9:05', 'às nove horas e cinco minutos'],
    ['12:00', 'ao meio-dia'],
    ['00:00', 'à meia-noite'],
    ['12:30', 'às doze horas e trinta minutos'],
  ])('%s -> %s', (hhmm, esperado) => {
    expect(horaPorExtenso(hhmm)).toBe(esperado);
  });
  it('permite omitir o artigo', () => {
    expect(horaPorExtenso('14:30', false)).toBe('quatorze horas e trinta minutos');
  });
  it('rejeita horas inválidas', () => {
    expect(() => horaPorExtenso('25:00')).toThrow(RangeError);
    expect(() => horaPorExtenso('10:75')).toThrow(RangeError);
    expect(() => horaPorExtenso('abc')).toThrow(RangeError);
  });
});

describe('numerosParaExtenso', () => {
  it.each([
    ['19/03/2026', 'dezenove de março de dois mil e vinte e seis'],
    ['1/3', 'primeiro de março'],
    ['1º bimestre', 'primeiro bimestre'],
    ['3ª série', 'terceira série'],
    ['às 14h30', 'às quatorze horas e trinta minutos'],
    ['às 9h', 'às nove horas'],
    ['30% dos alunos', 'trinta por cento dos alunos'],
    ['R$ 1.500,50', 'mil e quinhentos reais e cinquenta centavos'],
    ['R$ 1,00', 'um real'],
    ['dia 1', 'dia primeiro'],
    ['1 de março', 'primeiro de março'],
    ['dia 19 de março', 'dia dezenove de março'],
    ['em 2026.', 'em dois mil e vinte e seis.'],
    ['2 professoras', 'duas professoras'],
    ['2 professores', 'dois professores'],
    ['1 reunião', 'uma reunião'],
    ['2 dias', 'dois dias'],
    ['12.345 pessoas', 'doze mil trezentas e quarenta e cinco pessoas'],
  ])('%s -> %s', (entrada, esperado) => {
    expect(numerosParaExtenso(entrada)).toBe(esperado);
  });

  it('deixa intactos decimais e códigos', () => {
    expect(numerosParaExtenso('média de 2,5')).toBe('média de 2,5');
    expect(numerosParaExtenso('turma 3A')).toBe('turma 3A');
  });

  it('é idempotente sobre texto sem dígitos', () => {
    const t = 'Aos doze dias do mês de março.';
    expect(numerosParaExtenso(t)).toBe(t);
  });
});
