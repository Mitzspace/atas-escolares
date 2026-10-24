import { describe, expect, it } from 'vitest';
import { extrairMarcadores, validateAta } from './validate';
import type { AtaRenderizada } from './types';

const ABERTURA =
  'Aos doze dias do mês de março do ano de dois mil e vinte e seis, às quatorze horas, na sala dos professores da Escola X, Rede Y, reuniram-se Maria, diretora, para tratar da seguinte pauta: um, informes.';
const CORPO = 'No primeiro item da pauta, a diretora deu os informes.';
const FIM =
  'Nada mais havendo a tratar, foi encerrada a reunião às quinze horas, e eu, Paulo, secretário, lavrei a presente ata que, lida e aprovada, será assinada por mim e pelos demais presentes.';

const ata = (texto: string): AtaRenderizada => ({
  titulo: 'ATA Nº 001/2026',
  cabecalho: [],
  texto,
  assinaturas: [{ nome: 'Maria', cargo: 'Diretora' }],
  pendencias: [],
});

const ok = `${ABERTURA} ${CORPO} ${FIM}`;

describe('validateAta', () => {
  it('aceita ata no padrão', () => {
    expect(validateAta(ata(ok))).toEqual([]);
  });

  it('aponta texto vazio', () => {
    expect(validateAta(ata('  '))).toEqual(['Texto da ata vazio.']);
  });

  it('aponta parágrafos e quebras de linha', () => {
    const p = validateAta(ata(`${ABERTURA}\n\n${CORPO} ${FIM}`));
    expect(p.some((x) => x.includes('bloco único'))).toBe(true);
    expect(validateAta(ata(ok.replace('Rede Y', 'Rede  Y'))).some((x) => x.includes('bloco único'))).toBe(true);
  });

  it('aponta abertura e encerramento fora do padrão', () => {
    expect(validateAta(ata(`${CORPO} ${FIM}`)).some((x) => x.startsWith('Abertura'))).toBe(true);
    expect(validateAta(ata(`${ABERTURA} ${CORPO}`)).some((x) => x.startsWith('Encerramento'))).toBe(true);
  });

  it('aponta dígitos soltos', () => {
    const p = validateAta(ata(ok.replace('deu os informes', 'deu 12 informes em 2026')));
    expect(p.some((x) => x.startsWith('Dígitos') && x.includes('12') && x.includes('2026'))).toBe(true);
  });

  it('aponta [PENDENTE] e trechos inaudíveis', () => {
    const p = validateAta(ata(ok.replace('deu os informes', 'deu informes [PENDENTE: nome do palestrante] e [trecho inaudível]')));
    expect(p.some((x) => x.includes('[PENDENTE]') && x.includes('nome do palestrante'))).toBe(true);
    expect(p.some((x) => x.includes('inaudível'))).toBe(true);
  });

  it('aponta abreviações, formatação e linguagem fora do padrão', () => {
    expect(validateAta(ata(ok.replace('a diretora', 'a Prof. Maria'))).some((x) => x.startsWith('Abreviações'))).toBe(true);
    expect(validateAta(ata(ok.replace('os informes', '**os informes**'))).some((x) => x.includes('formatação'))).toBe(true);
    expect(validateAta(ata(ok.replace('deu os informes', 'vamos fazer os informes'))).some((x) => x.startsWith('Linguagem'))).toBe(true);
    expect(validateAta(ata(ok.replace('a diretora', 'eu'))).some((x) => x.includes('Primeira pessoa'))).toBe(true);
  });

  it('aponta ausência de assinaturas', () => {
    expect(validateAta({ ...ata(ok), assinaturas: [] })).toContain('Nenhuma assinatura prevista.');
  });
});

describe('extrairMarcadores', () => {
  it('lista as descrições', () => {
    expect(
      extrairMarcadores('a [PENDENTE: prazo] b [trecho inaudível] c [confirmar: nome] d [PENDENTE]'),
    ).toEqual(['prazo', 'trecho inaudível', 'confirmar: nome', 'informação pendente']);
  });
});
