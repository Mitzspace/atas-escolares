import { iniciais, parseVinculo } from './identificacao';
import { listarOrientados, type AtaExtraida, type AtaRenderizada, type MeetingMetadata, type TranscriptSegment } from './types';

const normalizar = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const grupos: Record<string, string> = { a: '[aáàâãä]', e: '[eéèêë]', i: '[iíìîï]', o: '[oóòôõö]', u: '[uúùûü]', c: '[cç]', n: '[nñ]' };
function regexNome(nome: string) {
  const padrao = normalizar(nome).split(' ').map(p => [...p].map(c => grupos[c] ?? escapar(c)).join('')).join('\\s+');
  return new RegExp(`(?<![\\p{L}\\p{N}])${padrao}(?![\\p{L}\\p{N}])`, 'giu');
}
const prefixoAluno = /\b(?:aluno(?:\(a\))?|aluna|estudante)\s+/giu;
const iniciaisRe = /^(?:\p{L}\.\s*)+/u;
const particulas = new Set(['de', 'da', 'do', 'das', 'dos']);
const fimNome = new Set(('esta está com tem teve tinha foi ficou faltou faltas acumulou precisa apresentou disse pediu chegou e não nao doente ' +
  'quinto quarto terceiro segundo primeiro sexto sétimo oitavo nono ano turma série serie que no na nos nas para por recebeu estávamos estava esteve ' +
  'orientado orientada orientados orientadas presente presentes ausente ausentes chamado chamada identificado identificada mais menos sofreu relatou faltaram será sera estava estava').split(' ').map(normalizar));

/** Só extrai nomes ligados a aluno/aluna; não tenta adivinhar estudantes por qualquer nome próprio. */
function nomeDepoisDoPrefixo(resto: string): string | undefined {
  resto = resto.replace(/^["“”']+/, '');
  if (iniciaisRe.test(resto)) return undefined;
  const palavras = [...resto.matchAll(/[\p{L}][\p{L}'’-]*/gu)];
  if (!palavras.length || palavras[0].index !== 0 || particulas.has(normalizar(palavras[0][0]))) return undefined;
  const nomes: string[] = [];
  const primeiroMinusculo = palavras[0][0] === palavras[0][0].toLowerCase();
  let fim = 0;
  for (let i = 0; i < Math.min(palavras.length, 6); i++) {
    const m = palavras[i], palavra = m[0], baixa = normalizar(palavra);
    if (resto.slice(fim, m.index).trim() || fimNome.has(baixa)) break;
    if (particulas.has(baixa)) {
      const proxima = palavras[i + 1]?.[0];
      if (!proxima || fimNome.has(normalizar(proxima)) || (!primeiroMinusculo && !/^\p{Lu}/u.test(proxima))) break;
    } else if (i > 0 && !primeiroMinusculo && !/^\p{Lu}/u.test(palavra)) break;
    nomes.push(palavra); fim = m.index + palavra.length;
  }
  while (nomes.length && particulas.has(normalizar(nomes.at(-1)!))) nomes.pop();
  return nomes.length ? nomes.join(' ') : undefined;
}

function criarAnonimizador(meta: MeetingMetadata, transcript: TranscriptSegment[], fontes: string[]) {
  const orientados = listarOrientados(meta).map(p => p.nome).filter(Boolean);
  const adultos = [meta.presidente, meta.secretario, ...meta.participantes.filter(p => p.categoria !== 'aluno')].map(p => p.nome).filter(Boolean);
  const contexto = [...adultos, meta.escola, meta.rede, ...meta.pauta].filter(Boolean);
  const nomes = [
    ...meta.participantes.filter(p => p.categoria === 'aluno').map(p => p.nome),
    ...meta.participantes.filter(p => p.categoria === 'responsavel').flatMap(p => {
      const vinculo = parseVinculo(p.vinculo ?? ''); return vinculo ? [vinculo.nome] : [];
    }),
  ];
  for (const fonte of [...transcript.map(s => s.text), ...fontes]) {
    const normalizada = fonte.normalize('NFC');
    for (const match of normalizada.matchAll(prefixoAluno)) {
      const nome = nomeDepoisDoPrefixo(normalizada.slice(match.index + match[0].length));
      if (nome) nomes.push(nome);
    }
  }
  const ehOrientado = (nome: string) => orientados.some(o => normalizar(o) === normalizar(nome) || normalizar(o).startsWith(normalizar(nome) + ' '));
  const estudantes = [...new Map(nomes.filter(n => n.trim() && !ehOrientado(n) && !iniciaisRe.test(n)).map(n => [normalizar(n), n])).values()].sort((a, b) => b.length - a.length);
  const substituicoes = new Map<string, { nome: string; iniciais: string }>();
  for (const nome of estudantes) {
    const palavras = nome.trim().split(/\s+/);
    for (let tamanho = palavras.length; tamanho >= 1; tamanho--) {
      const alias = palavras.slice(0, tamanho).join(' ');
      if (!particulas.has(normalizar(palavras[tamanho - 1])) && !ehOrientado(alias) && !substituicoes.has(normalizar(alias))) substituicoes.set(normalizar(alias), { nome: alias, iniciais: iniciais(nome) });
    }
  }
  const primeiroAdulto = new Set(adultos.map(n => normalizar(n).split(' ')[0]));
  return (entrada: string): { texto: string; suspeito: boolean } => {
    let texto = entrada.normalize('NFC'), suspeito = false;
    for (const { nome, iniciais: sigla } of substituicoes.values()) {
      const protegidos = [...orientados, ...contexto].flatMap(n => [...texto.matchAll(regexNome(n))].map(m => ({ inicio: m.index, fim: m.index + m[0].length, orientado: orientados.includes(n) })));
      texto = texto.replace(regexNome(nome), (match, offset: number) => {
        const qualificado = /(?:aluno(?:\(a\))?|aluna|estudante)\s+$/iu.test(texto.slice(Math.max(0, offset - 25), offset));
        if (protegidos.some(p => offset >= p.inicio && offset < p.fim && (p.orientado || !qualificado))) return match;
        if (!nome.includes(' ') && primeiroAdulto.has(normalizar(nome)) && !qualificado) {
          if (!/(?:professor[a]?|diretor[a]?|coordenador[a]?)\s+$/iu.test(texto.slice(Math.max(0, offset - 25), offset))) suspeito = true;
          return match;
        }
        if (/^\s+\p{Lu}[\p{L}'’-]+/u.test(texto.slice(offset + match.length))) suspeito = true;
        return sigla.endsWith('.') && texto[offset + match.length] === '.' ? sigla.slice(0, -1) : sigla;
      });
    }
    // Associação a aluno com grafia quebrada/ambígua que não pôde ser removida com segurança.
    for (const match of texto.matchAll(prefixoAluno)) {
      const resto = texto.slice(match.index + match[0].length);
      const sigla = iniciaisRe.exec(resto);
      if (sigla) {
        if (/^[*_][\p{L}]/u.test(resto.slice(sigla[0].length))) suspeito = true;
        continue;
      }
      const nome = nomeDepoisDoPrefixo(resto);
      if (nome && !ehOrientado(nome)) suspeito = true;
      else if (/^[\p{Lu}][\p{L}]*[*_]/u.test(resto)) suspeito = true;
    }
    return { texto, suspeito };
  };
}

export function anonimizarAtaExtraida(meta: MeetingMetadata, transcript: TranscriptSegment[], extraida: AtaExtraida): AtaExtraida {
  if (!meta.anonimizarAlunos) return extraida;
  const anonimizar = criarAnonimizador(meta, transcript, [JSON.stringify(extraida)]);
  let suspeito = false;
  const visitar = (valor: unknown): unknown => {
    if (typeof valor === 'string') { const r = anonimizar(valor); suspeito ||= r.suspeito; return r.texto; }
    if (Array.isArray(valor)) return valor.map(visitar);
    if (valor && typeof valor === 'object') return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, visitar(v)]));
    return valor;
  };
  const resultado = visitar(extraida) as AtaExtraida;
  if (suspeito && !resultado.pendencias.includes('confirmar anonimização')) resultado.pendencias.push('confirmar anonimização');
  return resultado;
}

export function anonimizarRenderizada(meta: MeetingMetadata, transcript: TranscriptSegment[], ata: AtaRenderizada): AtaRenderizada {
  if (!meta.anonimizarAlunos) return ata;
  const anonimizar = criarAnonimizador(meta, transcript, [ata.texto]);
  let suspeito = false;
  const aplicar = (s: string) => { const r = anonimizar(s); suspeito ||= r.suspeito; return r.texto; };
  const texto = aplicar(ata.texto);
  const assinaturas = ata.assinaturas.map(p => ({ nome: aplicar(p.nome), cargo: aplicar(p.cargo) }));
  const pendencias = ata.pendencias.map(aplicar);
  if (suspeito && !pendencias.includes('confirmar anonimização')) pendencias.push('confirmar anonimização');
  return { ...ata, texto, assinaturas, pendencias };
}
