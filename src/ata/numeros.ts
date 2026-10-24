import {
  MESES,
  dataCurtaPorExtenso,
  horaPorExtenso,
  numeroPorExtenso,
  ordinalPorExtenso,
  type Genero,
} from './extenso';

const MES_RE = MESES.join('|');

const MASCULINAS_EM_A = new Set([
  'dia',
  'dias',
  'problema',
  'problemas',
  'tema',
  'temas',
  'sistema',
  'sistemas',
  'programa',
  'programas',
  'cinema',
  'esquema',
  'esquemas',
  'diploma',
  'diplomas',
  'mapa',
  'mapas',
  'clima',
  'drama',
  'idioma',
  'idiomas',
  'poema',
  'poemas',
  'lema',
  'plasma',
  'trauma',
]);
const FEMININAS_EXTRAS = new Set(['vezes', 'mães', 'mulheres', 'tardes', 'noites', 'classes', 'séries', 'aulas']);
const MASCULINAS_EM_OES = new Set(['milhões', 'bilhões', 'botões', 'corações', 'sermões', 'leões']);

/** Heurística para concordar "um/uma", "dois/duas" com o substantivo que vem depois. */
function ehFeminino(palavra: string): boolean {
  const w = palavra.toLocaleLowerCase('pt-BR');
  if (FEMININAS_EXTRAS.has(w)) return true;
  if (MASCULINAS_EM_A.has(w) || MASCULINAS_EM_OES.has(w)) return false;
  return /(a|as|ões|ade|ades|ção|são|nião|stão)$/.test(w);
}

function moeda(reais: number, centavos: number): string {
  const partes: string[] = [];
  if (reais > 0 || centavos === 0) {
    const de = reais > 0 && reais % 1_000_000 === 0 ? ' de' : '';
    partes.push(`${numeroPorExtenso(reais)}${de} ${reais === 1 ? 'real' : 'reais'}`);
  }
  if (centavos > 0) partes.push(`${numeroPorExtenso(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}`);
  return partes.join(' e ');
}

function inteiroSeguro(digitos: string): number | null {
  const limpo = digitos.replace(/\./g, '');
  if (limpo.length > 12) return null;
  if (limpo.length > 1 && limpo.startsWith('0')) return null;
  return Number(limpo);
}

/** "2,5" -> "dois vírgula cinco"; "2,05" -> "dois vírgula zero cinco"; mais de duas casas, dígito a dígito. */
function decimal(m: string): string | null {
  const [parteInteira, frac] = m.split(',');
  const inteiro = inteiroSeguro(parteInteira);
  if (inteiro === null) return null;
  const fracao =
    frac.length <= 2 && !frac.startsWith('0')
      ? numeroPorExtenso(Number(frac))
      : [...frac].map((d) => numeroPorExtenso(Number(d))).join(' ');
  return `${numeroPorExtenso(inteiro)} vírgula ${fracao}`;
}

const ABREVIACOES: Record<string, string> = {
  prof: 'professor',
  profa: 'professora',
  sr: 'senhor',
  sra: 'senhora',
  dr: 'doutor',
  dra: 'doutora',
  pág: 'página',
};

/** "Prof. Carlos" -> "professor Carlos"; só as abreviações sem ambiguidade de sentido. */
export function abreviacoesPorExtenso(texto: string, capitalizarInicio = true): string {
  return texto.replace(
    /(?<![\p{L}])(Profa|Prof|Sra|Sr|Dra|Dr|Pág)\.(?:\s+|(?=\p{L}))/giu,
    (_m, abrev: string, offset: number, inteiro: string) => {
      const palavra = ABREVIACOES[abrev.toLocaleLowerCase('pt-BR')];
      const inicioDeFrase = /(?:^|[.!?]\s+)$/.test(inteiro.slice(0, offset)) && (offset > 0 || capitalizarInicio);
      const saida = inicioDeFrase ? palavra.charAt(0).toLocaleUpperCase('pt-BR') + palavra.slice(1) : palavra;
      return `${saida} `;
    },
  );
}

/** Texto digitado pela usuária ou devolvido pelo modelo: abreviações e números por extenso. */
export function textoLivreParaPadrao(texto: string, capitalizarInicio = true): string {
  return numerosParaExtenso(abreviacoesPorExtenso(texto, capitalizarInicio));
}

/**
 * Converte números soltos do texto (datas, horas, valores, ordinais, porcentagens, inteiros) para extenso.
 * O que não tem conversão segura (códigos como "3A", números enormes) fica como está, para o validador apontar.
 */
export function numerosParaExtenso(texto: string): string {
  let t = texto;

  // "dia 1" -> "dia primeiro"
  t = t.replace(/\b([Dd]ia)\s+1(?![\d.,/ºª°%])/g, '$1 primeiro');

  // R$ 1.500,50
  t = t.replace(/R\$\s?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{2}))?(?![\d])/g, (m, r: string, c?: string) => {
    const reais = inteiroSeguro(r);
    return reais === null ? m : moeda(reais, c ? Number(c) : 0);
  });

  // 12/03/2026 e 12/03
  t = t.replace(/(?<![\d/])(\d{1,2})\/(\d{1,2})\/(\d{4})(?![\d/])/g, (m, d: string, mes: string, a: string) => {
    try {
      return dataCurtaPorExtenso(Number(d), Number(mes), Number(a));
    } catch {
      return m;
    }
  });
  t = t.replace(/(?<![\d/.,])(\d{1,2})\/(\d{1,2})(?![\d/])/g, (m, d: string, mes: string) => {
    try {
      return dataCurtaPorExtenso(Number(d), Number(mes));
    } catch {
      return m;
    }
  });

  // 14h30, 14 h, 14:30
  const hora = (m: string, h: string, mm?: string) => {
    if (Number(h) > 23 || (mm !== undefined && Number(mm) > 59)) return m;
    return horaPorExtenso(`${h}:${mm ?? '00'}`, false);
  };
  t = t.replace(/(?<![\p{L}\d])(\d{1,2})\s?h(?:\s?(\d{2}))?(?:\s?min)?(?![\p{L}\d])/gu, hora);
  t = t.replace(/(?<![\d:])(\d{1,2}):(\d{2})(?![\d:])/g, hora);

  // 30%, 2,5%
  t = t.replace(/(?<![\p{L}\d,.])(\d+(?:\.\d{3})*,\d+|\d{1,3}(?:\.\d{3})+|\d+)\s?%/gu, (m, n: string) => {
    if (n.includes(',')) {
      const d = decimal(n);
      return d === null ? m : `${d} por cento`;
    }
    const v = inteiroSeguro(n);
    return v === null ? m : `${numeroPorExtenso(v)} por cento`;
  });

  // 1º, 2ª
  t = t.replace(/(?<![\p{L}\d])(\d{1,3})\s?([ºª°])/gu, (m, n: string, marca: string) => {
    const v = Number(n);
    if (v < 1) return m;
    return ordinalPorExtenso(v, marca === 'ª' ? 'f' : 'm');
  });

  // inteiros e decimais soltos ("2,5" -> "dois vírgula cinco"; "1,2,3" é lista, não decimal)
  t = t.replace(
    /(?<![\p{L}\d])(\d+(?:\.\d{3})*,\d+(?!,\d)|\d{1,3}(?:\.\d{3})+|\d+)(?![\p{L}\d])/gu,
    (m, _n: string, offset: number, inteiro: string) => {
      if (m.includes(',')) {
        // "1,2,3" é lista de números, não decimal
        if (/\d,$/.test(inteiro.slice(0, offset)) && !m.includes('.')) {
          return m.split(',').map((x) => numeroPorExtenso(Number(x))).join(',');
        }
        return decimal(m) ?? m;
      }
      const v = inteiroSeguro(m);
      if (v === null) return m;
      const depois = inteiro.slice(offset + m.length);
      if (v === 1 && new RegExp(`^\\s+de\\s+(${MES_RE})(?![\\p{L}])`, 'iu').test(depois)) return 'primeiro';
      const prox = /^\s+(\p{L}+)/u.exec(depois)?.[1];
      const g: Genero = prox && ehFeminino(prox) ? 'f' : 'm';
      return numeroPorExtenso(v, g);
    },
  );

  return t;
}
