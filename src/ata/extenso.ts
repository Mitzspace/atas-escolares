export type Genero = 'm' | 'f';

const MAX = 999_999_999_999;

export const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

const UNIDADES = [
  'zero',
  'um',
  'dois',
  'três',
  'quatro',
  'cinco',
  'seis',
  'sete',
  'oito',
  'nove',
  'dez',
  'onze',
  'doze',
  'treze',
  'quatorze',
  'quinze',
  'dezesseis',
  'dezessete',
  'dezoito',
  'dezenove',
];
const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CENTENAS = [
  '',
  'cento',
  'duzentos',
  'trezentos',
  'quatrocentos',
  'quinhentos',
  'seiscentos',
  'setecentos',
  'oitocentos',
  'novecentos',
];

const ORD_UNIDADES = ['', 'primeiro', 'segundo', 'terceiro', 'quarto', 'quinto', 'sexto', 'sétimo', 'oitavo', 'nono'];
const ORD_DEZENAS = [
  '',
  'décimo',
  'vigésimo',
  'trigésimo',
  'quadragésimo',
  'quinquagésimo',
  'sexagésimo',
  'septuagésimo',
  'octogésimo',
  'nonagésimo',
];

function unidade(n: number, g: Genero): string {
  if (g === 'f') {
    if (n === 1) return 'uma';
    if (n === 2) return 'duas';
  }
  return UNIDADES[n];
}

/** n entre 1 e 999. */
function ate999(n: number, g: Genero): string {
  if (n === 100) return 'cem';
  const partes: string[] = [];
  const c = Math.floor(n / 100);
  const r = n % 100;
  if (c) partes.push(g === 'f' && c >= 2 ? CENTENAS[c].replace(/os$/, 'as') : CENTENAS[c]);
  if (r) {
    if (r < 20) partes.push(unidade(r, g));
    else {
      const d = Math.floor(r / 10);
      const u = r % 10;
      partes.push(u ? `${DEZENAS[d]} e ${unidade(u, g)}` : DEZENAS[d]);
    }
  }
  return partes.join(' e ');
}

/** Cardinal em pt-BR. `genero` vale para unidades, centenas e milhares ("duas mil"); milhões e bilhões são masculinos. */
export function numeroPorExtenso(n: number, genero: Genero = 'm'): string {
  if (!Number.isInteger(n)) throw new RangeError(`Número inteiro esperado: ${n}`);
  if (n < 0) return `menos ${numeroPorExtenso(-n, genero)}`;
  if (n > MAX) throw new RangeError(`Número grande demais: ${n}`);
  if (n === 0) return 'zero';

  const bilhoes = Math.floor(n / 1e9);
  const milhoes = Math.floor(n / 1e6) % 1000;
  const milhares = Math.floor(n / 1e3) % 1000;
  const resto = n % 1000;

  const partes: { texto: string; valor: number }[] = [];
  if (bilhoes) partes.push({ texto: `${ate999(bilhoes, 'm')} ${bilhoes === 1 ? 'bilhão' : 'bilhões'}`, valor: bilhoes });
  if (milhoes) partes.push({ texto: `${ate999(milhoes, 'm')} ${milhoes === 1 ? 'milhão' : 'milhões'}`, valor: milhoes });
  if (milhares) partes.push({ texto: milhares === 1 ? 'mil' : `${ate999(milhares, genero)} mil`, valor: milhares });
  if (resto) partes.push({ texto: ate999(resto, genero), valor: resto });

  const ultimo = partes[partes.length - 1];
  if (partes.length === 1) return ultimo.texto;
  const inicio = partes
    .slice(0, -1)
    .map((p) => p.texto)
    .join(' ');
  // "e" antes da última parte quando ela é menor que cem ou centena exata
  const liga = ultimo.valor < 100 || ultimo.valor % 100 === 0 ? ' e ' : ' ';
  return inicio + liga + ultimo.texto;
}

/** Ordinal de 1 a 100 ("décimo segundo"); fora disso devolve o cardinal. */
export function ordinalPorExtenso(n: number, genero: Genero = 'm'): string {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`Ordinal inválido: ${n}`);
  let txt: string;
  if (n === 100) txt = 'centésimo';
  else if (n > 100) return numeroPorExtenso(n, genero);
  else {
    const d = Math.floor(n / 10);
    const u = n % 10;
    txt = [ORD_DEZENAS[d], ORD_UNIDADES[u]].filter(Boolean).join(' ');
  }
  return genero === 'f' ? txt.replace(/o\b/g, 'a') : txt;
}

function parseIso(iso: string): { ano: number; mes: number; dia: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) throw new RangeError(`Data inválida (esperado AAAA-MM-DD): ${iso}`);
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) {
    throw new RangeError(`Data inexistente: ${iso}`);
  }
  return { ano, mes, dia };
}

/** "Aos doze dias do mês de março do ano de dois mil e vinte e seis" / "Ao primeiro dia do mês de ...". */
export function dataPorExtenso(iso: string): string {
  const { ano, mes, dia } = parseIso(iso);
  const abertura = dia === 1 ? 'Ao primeiro dia' : `Aos ${numeroPorExtenso(dia)} dias`;
  return `${abertura} do mês de ${MESES[mes - 1]} do ano de ${numeroPorExtenso(ano)}`;
}

/** "doze de março de dois mil e vinte e seis" (ano opcional); dia 1 vira "primeiro". */
export function dataCurtaPorExtenso(dia: number, mes: number, ano?: number): string {
  const d = new Date(Date.UTC(ano ?? 2024, mes - 1, dia));
  if (mes < 1 || mes > 12 || d.getUTCDate() !== dia) throw new RangeError(`Data inexistente: ${dia}/${mes}`);
  const base = `${dia === 1 ? 'primeiro' : numeroPorExtenso(dia)} de ${MESES[mes - 1]}`;
  return ano === undefined ? base : `${base} de ${numeroPorExtenso(ano)}`;
}

/** "às quatorze horas e trinta minutos", "às treze horas", "à uma hora", "ao meio-dia". */
export function horaPorExtenso(hhmm: string, comArtigo = true): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) throw new RangeError(`Hora inválida (esperado HH:MM): ${hhmm}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new RangeError(`Hora inexistente: ${hhmm}`);

  if (min === 0 && h === 12) return comArtigo ? 'ao meio-dia' : 'meio-dia';
  if (min === 0 && h === 0) return comArtigo ? 'à meia-noite' : 'meia-noite';

  const artigo = h <= 1 ? 'à' : 'às';
  let txt = `${numeroPorExtenso(h, 'f')} ${h === 1 ? 'hora' : 'horas'}`;
  if (min) txt += ` e ${numeroPorExtenso(min)} ${min === 1 ? 'minuto' : 'minutos'}`;
  return comArtigo ? `${artigo} ${txt}` : txt;
}
