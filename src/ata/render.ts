import type { AtaExtraida, AtaRenderizada, MeetingMetadata, Pessoa } from './types';
import { dataPorExtenso, horaPorExtenso, numeroPorExtenso, ordinalPorExtenso } from './extenso';
import { textoLivreParaPadrao } from './numeros';
import { extrairMarcadores } from './validate';

const limpar = (s: string) => s.replace(/\s+/g, ' ').trim();
const semPontoFinal = (s: string) => limpar(s).replace(/[.;:,\s]+$/, '');
const comPontoFinal = (s: string) => {
  const t = limpar(s);
  return /[.!?]$/.test(t) ? t : `${t}.`;
};
const normalizar = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** Minúscula na primeira letra, exceto siglas e nomes com maiúscula interna. */
function minuscula1(s: string): string {
  const t = limpar(s);
  const primeira = t.split(' ')[0] ?? '';
  if (!/^[A-ZÀ-Ý][a-zà-ÿ]+$/.test(primeira)) return t;
  return t.charAt(0).toLocaleLowerCase('pt-BR') + t.slice(1);
}

function juntarComE(itens: string[]): string {
  if (itens.length <= 1) return itens[0] ?? '';
  if (itens.length === 2) return `${itens[0]} e ${itens[1]}`;
  return `${itens.slice(0, -1).join('; ')}; e ${itens[itens.length - 1]}`;
}

function pessoaTxt(p: Pessoa): string {
  const nome = limpar(p.nome);
  return p.cargo.trim() ? `${nome}, ${minuscula1(p.cargo)}` : nome;
}

function tituloSecretario(p: Pessoa): string {
  const w = (p.cargo.trim().split(/\s+/)[0] ?? '').toLocaleLowerCase('pt-BR');
  if (/a$/.test(w)) return 'secretária';
  if (/(o|or)$/.test(w)) return 'secretário';
  return 'secretário(a)';
}

const SUBSTANTIVOS_LOCAL = new Set([
  'sala',
  'salas',
  'biblioteca',
  'auditório',
  'pátio',
  'quadra',
  'refeitório',
  'laboratório',
  'secretaria',
  'diretoria',
  'cozinha',
  'ginásio',
  'anfiteatro',
  'brinquedoteca',
  'videoconferência',
  'plataforma',
]);

/** "Sala dos professores" -> "na sala dos professores". */
function locativo(local: string): string {
  const t = limpar(local);
  if (/^(no|na|nos|nas|em)\s/i.test(t)) return t;
  const [primeira, ...resto] = t.split(' ');
  const baixa = primeira.toLocaleLowerCase('pt-BR');
  const palavra = SUBSTANTIVOS_LOCAL.has(baixa) ? baixa : primeira;
  const nome = [palavra, ...resto].join(' ');
  if (/as$/.test(baixa)) return `nas ${nome}`;
  if (/os$/.test(baixa)) return `nos ${nome}`;
  if (/[aã]$/.test(baixa)) return `na ${nome}`;
  if (/o$/.test(baixa)) return `no ${nome}`;
  return `em ${nome}`;
}

const ESCOLA_MASCULINA = /^(col[eé]gio|centro|instituto|grupo|gin[aá]sio|n[uú]cleo|liceu|cei|cemei|cmei|ceu|cieja|ceeja)\b/i;
const artigoEscola = (escola: string) => (ESCOLA_MASCULINA.test(escola.trim()) ? 'do' : 'da');

function presentes(meta: MeetingMetadata): Pessoa[] {
  const lista: Pessoa[] = [];
  const vistos = new Set<string>();
  const add = (p: Pessoa) => {
    const k = normalizar(p.nome);
    if (!k || vistos.has(k)) return;
    vistos.add(k);
    lista.push({ nome: p.nome, cargo: p.cargo });
  };
  add(meta.presidente);
  add(meta.secretario);
  meta.participantes.filter((p) => p.presente).forEach(add);
  return lista;
}

function ausentes(meta: MeetingMetadata, pres: Pessoa[]): Pessoa[] {
  const vistos = new Set(pres.map((p) => normalizar(p.nome)));
  return meta.participantes.filter((p) => !p.presente && !vistos.has(normalizar(p.nome)));
}

function abertura(meta: MeetingMetadata, pres: Pessoa[]): string {
  const escola = `${artigoEscola(meta.escola)} ${limpar(meta.escola)}`;
  const onde = meta.local.trim()
    ? `${locativo(meta.local)} ${escola}`
    : `no local [PENDENTE: local da reunião] ${escola}`;
  const pauta = meta.pauta.length
    ? meta.pauta.map((p, i) => `${numeroPorExtenso(i + 1)}, ${minuscula1(semPontoFinal(p))}`).join('; ')
    : '[PENDENTE: pauta da reunião]';
  const total = `${numeroPorExtenso(pres.length)} ${pres.length === 1 ? 'presente' : 'presentes'}`;
  return (
    `${dataPorExtenso(meta.data)}, ${horaPorExtenso(meta.horaInicio)}, ${onde}, ${limpar(meta.rede)}, ` +
    `reuniram-se ${juntarComE(pres.map(pessoaTxt))}, totalizando ${total}, ` +
    `sob a presidência de ${pessoaTxt(meta.presidente)}, ` +
    `comigo, ${limpar(meta.secretario.nome)}, ${tituloSecretario(meta.secretario)}, ` +
    `para tratar da seguinte pauta: ${pauta}.`
  );
}

function desenvolvimento(meta: MeetingMetadata, extraida: AtaExtraida): string[] {
  const partes: string[] = [];
  const itens = extraida.itens.filter((i) => limpar(i.relato));
  const total = meta.pauta.length;

  for (let n = 1; n <= total; n++) {
    const relatos = itens.filter((i) => i.pauta === n).map((i) => limpar(i.relato));
    const ord = ordinalPorExtenso(n);
    if (!relatos.length) {
      partes.push(`No ${ord} item da pauta, [PENDENTE: item não registrado na transcrição]`);
      continue;
    }
    const txt = relatos.map(comPontoFinal).join(' ');
    partes.push(/^(?:No|Quanto ao|Sobre o|Em relação ao)\b[^.]{0,60}\bitem\b/i.test(txt) ? txt : `No ${ord} item da pauta: ${txt}`);
  }

  const extras = itens.filter((i) => i.pauta < 1 || i.pauta > total).map((i) => limpar(i.relato));
  if (extras.length) {
    const txt = extras.map(comPontoFinal).join(' ');
    partes.push(/^Em assuntos gerais\b/i.test(txt) ? txt : `Em assuntos gerais: ${txt}`);
  }
  if (!total && !extras.length) partes.push('[PENDENTE: desenvolvimento da reunião]');

  const delibs = extraida.deliberacoes.filter((d) => limpar(d.texto));
  if (delibs.length) {
    const lista = delibs.map((d, i) => {
      const base = minuscula1(semPontoFinal(d.texto));
      const voto = d.votacao && limpar(d.votacao) ? ` (${semPontoFinal(d.votacao)})` : '';
      return delibs.length === 1 ? `${base}${voto}` : `${ordinalPorExtenso(i + 1, 'f')}, ${base}${voto}`;
    });
    partes.push(
      delibs.length === 1
        ? `Ficou registrada a seguinte deliberação: ${lista[0]}`
        : `Ficaram registradas as seguintes deliberações: ${lista.join('; ')}`,
    );
  }

  const encs = extraida.encaminhamentos.filter((e) => limpar(e.acao));
  if (encs.length) {
    const lista = encs.map((e, i) => {
      const ord = ordinalPorExtenso(i + 1);
      const quem = e.responsavel && limpar(e.responsavel) ? semPontoFinal(e.responsavel) : `[PENDENTE: responsável pelo ${ord} encaminhamento]`;
      const prazo = e.prazo && limpar(e.prazo) ? semPontoFinal(e.prazo) : `[PENDENTE: prazo do ${ord} encaminhamento]`;
      const base = `${minuscula1(semPontoFinal(e.acao))}, a cargo de ${quem}, prazo: ${prazo}`;
      return encs.length === 1 ? base : `${ord}, ${base}`;
    });
    partes.push(
      encs.length === 1
        ? `Como encaminhamento, ficou definido: ${lista[0]}`
        : `Como encaminhamentos, ficou definido o seguinte: ${lista.join('; ')}`,
    );
  }
  return partes;
}

function encerramento(meta: MeetingMetadata): string {
  const fim = meta.horaFim?.trim() ? horaPorExtenso(meta.horaFim) : '[PENDENTE: horário de término da reunião]';
  return (
    `Nada mais havendo a tratar, foi encerrada a reunião ${fim}, e eu, ${limpar(meta.secretario.nome)}, ` +
    `${tituloSecretario(meta.secretario)}, lavrei a presente ata que, lida e aprovada, será assinada por mim e pelos demais presentes.`
  );
}

/** Monta a ata final: abertura e encerramento por código, corpo do LLM, números por extenso. */
export function renderAta(meta: MeetingMetadata, extraida: AtaExtraida): AtaRenderizada {
  const pres = presentes(meta);
  const aus = ausentes(meta, pres);

  const partes = [abertura(meta, pres)];
  if (aus.length) {
    const lista = juntarComE(aus.map(pessoaTxt));
    partes.push(
      aus.length === 1 ? `Não compareceu o seguinte convocado: ${lista}.` : `Não compareceram os seguintes convocados: ${lista}.`,
    );
  }
  partes.push(...desenvolvimento(meta, extraida).map(comPontoFinal), encerramento(meta));

  const texto = textoLivreParaPadrao(limpar(partes.join(' '))).replace(/\s+([,;:.])/g, '$1');

  const vistas = new Set<string>();
  const pendencias: string[] = [];
  for (const p of [...extraida.pendencias.map((x) => limpar(x).replace(/^\[?\s*PENDENTE\s*:?\s*/i, '').replace(/\]$/, '')), ...extrairMarcadores(texto)]) {
    const k = normalizar(p);
    if (k && !vistas.has(k)) {
      vistas.add(k);
      pendencias.push(p);
    }
  }

  return {
    titulo: `ATA Nº ${String(meta.numero).padStart(3, '0')}/${meta.ano} – REUNIÃO PEDAGÓGICA ${meta.ordinaria ? 'ORDINÁRIA' : 'EXTRAORDINÁRIA'}`,
    cabecalho: [meta.escola, meta.rede, meta.municipioUf].map((s) => limpar(s).toLocaleUpperCase('pt-BR')).filter(Boolean),
    texto,
    assinaturas: pres,
    pendencias,
  };
}
