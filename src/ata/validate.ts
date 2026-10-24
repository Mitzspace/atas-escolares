import type { AtaRenderizada } from './types';

const MARCADOR = /\[\s*(PENDENTE|confirmar|trecho inaud[ií]vel|inaud[ií]vel)\s*:?([^\]]*)\]/gi;

const ABERTURA = /^Aos? [^,]+ dias? do mês de [^,]+ do ano de [^,]+, (?:às|à|ao) [^,]+, .*reuniram-se /;
const ENCERRAMENTO = /Nada mais havendo a tratar, .*será assinada por mim e pelos demais presentes\.$/;
const ABREVIACAO = /\b(?:Prof|Profa|Sr|Sra|Dr|Dra|Coord|Dir|Resp|Obs|Pág|Nr)\.(?=\s|$)/g;
const FORMATACAO = /(\*\*|__|`|•|^#|\s#\s)/;
const FORA_DO_PADRAO = /\b(?:nós|vamos|iremos|faremos|a gente)\b/gi;

/** Descrições das marcações [PENDENTE: ...], [trecho inaudível] e [confirmar: ...] presentes no texto. */
export function extrairMarcadores(texto: string): string[] {
  const out: string[] = [];
  for (const m of texto.matchAll(MARCADOR)) {
    const tipo = m[1].toLowerCase();
    const det = m[2].trim();
    if (tipo === 'pendente') out.push(det || 'informação pendente');
    else if (tipo === 'confirmar') out.push(`confirmar: ${det}`);
    else out.push(det ? `${tipo}: ${det}` : tipo);
  }
  return out;
}

const unicos = (xs: string[]) => [...new Set(xs)];
const resumo = (xs: string[], max = 4) =>
  unicos(xs).slice(0, max).join('; ') + (unicos(xs).length > max ? '; ...' : '');

/** Problemas de formato/conteúdo encontrados no texto da ata; lista vazia = nada a apontar. */
export function validateAta(r: AtaRenderizada): string[] {
  const problemas: string[] = [];
  const texto = r.texto;

  if (!texto.trim()) return ['Texto da ata vazio.'];

  if (/[\r\n\t  ]/.test(texto) || / {2}/.test(texto) || texto !== texto.trim()) {
    problemas.push('Texto não é um bloco único corrido: há parágrafos, quebras de linha, espaços duplicados ou espaços nas pontas.');
  }
  if (FORMATACAO.test(texto)) {
    problemas.push('Há marcas de formatação (negrito, título, marcadores) no texto; a ata deve ser texto corrido simples.');
  }
  if (!ABERTURA.test(texto)) {
    problemas.push('Abertura fora do padrão: esperado "Aos ... dias do mês de ... do ano de ..., às ..., ... reuniram-se ...".');
  }
  if (!ENCERRAMENTO.test(texto)) {
    problemas.push(
      'Encerramento fora do padrão: o texto deve terminar com "Nada mais havendo a tratar, ... será assinada por mim e pelos demais presentes."',
    );
  }

  const digitos = texto.match(/\S*\d\S*/g);
  if (digitos) problemas.push(`Dígitos no texto (use números por extenso): ${resumo(digitos)}.`);

  const abreviacoes = texto.match(ABREVIACAO);
  if (abreviacoes) problemas.push(`Abreviações no texto (escreva por extenso): ${resumo(abreviacoes)}.`);

  const foraPadrao = texto.match(FORA_DO_PADRAO);
  if (foraPadrao) problemas.push(`Linguagem fora do padrão (primeira pessoa ou futuro): ${resumo(foraPadrao)}.`);

  if ((texto.match(/\beu\b/gi) ?? []).length > 1) {
    problemas.push('Primeira pessoa ("eu") usada fora do encerramento; a ata deve ser redigida em terceira pessoa.');
  }

  const marcadores = extrairMarcadores(texto);
  const pendentes = [...texto.matchAll(/\[\s*PENDENTE/gi)].length;
  if (pendentes) {
    problemas.push(`Há ${pendentes} marcação(ões) [PENDENTE] a resolver no texto: ${resumo(marcadores.filter((_, i) => i < pendentes))}.`);
  }
  const outros = marcadores.length - pendentes;
  if (outros > 0) problemas.push(`Há ${outros} trecho(s) inaudível(is) ou a confirmar no texto.`);

  if (r.assinaturas.length === 0) problemas.push('Nenhuma assinatura prevista.');

  return problemas;
}
