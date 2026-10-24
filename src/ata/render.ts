import { TIPOS_ATA, type AtaExtraida, type AtaRenderizada, type Categoria, type MeetingMetadata, type Participante, type Pessoa, type TipoAta } from './types';
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
  if (!/^[A-ZÀ-Ý][a-zà-ÿ]*$/.test(primeira)) return t;
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

/** quem presidiu também lavrou a ata */
const mesmaPessoa = (meta: MeetingMetadata) => normalizar(meta.presidente.nome) === normalizar(meta.secretario.nome);

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


type Genero3 = 'm' | 'f' | 'n';

const tipoDe = (meta: MeetingMetadata): TipoAta => meta.tipo ?? 'pedagogica';
const categoriaDe = (p: Participante): Categoria => p.categoria ?? 'funcionario';

/** Gênero gramatical pelo cargo ("Aluna", "Mãe", "Professor"); 'n' quando não dá para saber. */
function generoDoCargo(cargo: string): Genero3 {
  const w = (cargo.trim().split(/\s+/)[0] ?? '').toLocaleLowerCase('pt-BR');
  if (/\(a\)/.test(w) || !w) return 'n';
  if (w === 'mãe') return 'f';
  if (w === 'pai') return 'm';
  if (/a$/.test(w)) return 'f';
  if (/(o|or)$/.test(w)) return 'm';
  return 'n';
}
const flexao = (g: Genero3, m: string, f: string, n: string) => (g === 'm' ? m : g === 'f' ? f : n);

const PREPOSICOES_NOME = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
/** "Pedro Henrique Lima" -> "P.H.L."; nomes que já são iniciais ficam como estão. */
export function iniciais(nome: string): string {
  const t = limpar(nome);
  if (/^(?:\p{Lu}\.\s*)+$/u.test(t)) return t.replace(/\s+/g, '');
  return t
    .split(' ')
    .filter((w) => w && !PREPOSICOES_NOME.has(w.toLocaleLowerCase('pt-BR')))
    .map((w) => `${w.charAt(0).toLocaleUpperCase('pt-BR')}.`)
    .join('');
}

/** "5º ano B" -> "do 5º ano B"; "3ª série" -> "da 3ª série"; "Maternal II" -> "da turma Maternal II". */
function turmaTxt(turma: string): string {
  const t = limpar(turma);
  if (!t) return '';
  if (/\b(ano|per[ií]odo|ciclo|n[ií]vel|grupo|maternal|jardim)\b/i.test(t)) return `do ${t}`;
  if (/\b(s[ée]rie|turma|classe|etapa|fase|sala|creche)\b/i.test(t)) return `da ${t}`;
  return `da turma ${t}`;
}

/** Vínculo do responsável: "aluno Pedro Henrique, 5º ano B" -> { rotulo: 'aluno', nome: 'Pedro Henrique', turma: '5º ano B' }. */
export function parseVinculo(v: string) {
  const m = /^\s*(?:(aluno\(a\)|aluno|aluna|estudante)\s+)?([^,]+?)\s*(?:,\s*(.+?))?\s*$/i.exec(v);
  if (!m) return null;
  return { rotulo: (m[1] ?? 'aluno(a)').toLocaleLowerCase('pt-BR'), nome: m[2], turma: m[3] ?? '' };
}

/** "do aluno P.H., do 5º ano B" / "pela aluna Ana, da 3ª série" (nome em iniciais se a anonimização estiver ativa). */
function vinculoTxt(p: Participante, meta: MeetingMetadata, preposicao: 'de' | 'por'): string {
  const v = parseVinculo(p.vinculo ?? '');
  if (!v) return '';
  const g: Genero3 = v.rotulo === 'aluno' ? 'm' : v.rotulo === 'aluna' ? 'f' : 'n';
  const prep =
    preposicao === 'de' ? flexao(g, 'do', 'da', 'do(a)') : flexao(g, 'pelo', 'pela', 'pelo(a)');
  // o aluno orientado é o assunto da ata: não se anonimiza
  const anonimizar = meta.anonimizarAlunos && !(meta.orientado && normalizar(meta.orientado.nome) === normalizar(v.nome));
  const nome = anonimizar ? iniciais(v.nome) : limpar(v.nome);
  return `${prep} ${v.rotulo} ${nome}${v.turma ? `, ${turmaTxt(v.turma)}` : ''}`;
}

/** Trecho que vem depois do nome: "mãe do aluno P.H., do quinto ano B", "aluno do quinto ano B", "diretora". */
function descricao(p: Participante, meta: MeetingMetadata): string {
  const cargo = limpar(p.cargo);
  switch (categoriaDe(p)) {
    case 'responsavel': {
      const cab = cargo ? minuscula1(cargo) : 'responsável';
      const prep = cab.toLocaleLowerCase('pt-BR').startsWith('responsável') ? 'por' : 'de';
      const vinc = vinculoTxt(p, meta, prep);
      return vinc ? `${cab} ${vinc}` : cab;
    }
    case 'aluno': {
      const cab = cargo ? minuscula1(cargo) : 'aluno(a)';
      const turma = p.vinculo?.trim() ? ` ${turmaTxt(p.vinculo)}` : '';
      return `${cab}${turma}`;
    }
    default:
      return cargo ? minuscula1(cargo) : '';
  }
}

/** Nome como aparece no texto: aluno que não é o orientado vira iniciais quando a anonimização está ativa. */
function nomeNoTexto(p: Participante, meta: MeetingMetadata, orientado = false): string {
  const nome = limpar(p.nome);
  return categoriaDe(p) === 'aluno' && meta.anonimizarAlunos && !orientado ? iniciais(nome) : nome;
}

function pessoaNoTexto(p: Participante, meta: MeetingMetadata, orientado = false): string {
  const d = descricao(p, meta);
  return d ? `${nomeNoTexto(p, meta, orientado)}, ${d}` : nomeNoTexto(p, meta, orientado);
}

const maiuscula1 = (s: string) => s.charAt(0).toLocaleUpperCase('pt-BR') + s.slice(1);

/** Quem esteve presente, em ordem: presidente, secretário, orientado e demais presentes. */
function presentes(meta: MeetingMetadata): Participante[] {
  const lista: Participante[] = [];
  const vistos = new Set<string>();
  const add = (p: Participante) => {
    const k = normalizar(p.nome);
    if (!k || vistos.has(k)) return;
    vistos.add(k);
    lista.push({ ...p, presente: true });
  };
  add({ ...meta.presidente, presente: true });
  add({ ...meta.secretario, presente: true });
  if (meta.orientado) add(meta.orientado);
  meta.participantes.filter((p) => p.presente).forEach(add);
  return lista;
}

function ausentes(meta: MeetingMetadata, pres: Participante[]): Participante[] {
  const vistos = new Set(pres.map((p) => normalizar(p.nome)));
  return meta.participantes.filter((p) => !p.presente && !vistos.has(normalizar(p.nome)));
}

/** Acima disso, o texto não lista os responsáveis e remete à lista de presença anexa. */
export const LIMITE_RESPONSAVEIS_NO_TEXTO = 8;

/** A ata remete os responsáveis à lista de presença anexa? (só em 'pais', com mais de oito responsáveis presentes) Regra única: o PDF usa a mesma. */
export function usaListaAnexa(meta: MeetingMetadata): boolean {
  return (
    tipoDe(meta) === 'pais' &&
    presentes(meta).filter((p) => categoriaDe(p) === 'responsavel').length > LIMITE_RESPONSAVEIS_NO_TEXTO
  );
}

const ehOrientado = (meta: MeetingMetadata, p: Participante) =>
  !!meta.orientado && normalizar(p.nome) === normalizar(meta.orientado.nome);

function listaPauta(meta: MeetingMetadata): string {
  return meta.pauta.length
    ? meta.pauta.map((p, i) => `${numeroPorExtenso(i + 1)}, ${minuscula1(semPontoFinal(p))}`).join('; ')
    : meta.tipo === 'orientacao'
      ? '[PENDENTE: assunto da orientação]'
      : '[PENDENTE: pauta da reunião]';
}

function quemSecretaria(meta: MeetingMetadata): string {
  return mesmaPessoa(meta)
    ? 'que também secretariou a reunião, '
    : `comigo, ${limpar(meta.secretario.nome)}, ${tituloSecretario(meta.secretario)}, `;
}

/** "sua mãe, Clara Lima" / "seu pai, ..." / "seu(sua) responsável, ...". */
function acompanhante(p: Participante): string {
  const g = generoDoCargo(p.cargo);
  const cargo = limpar(p.cargo).toLocaleLowerCase('pt-BR');
  const nome = limpar(p.nome);
  if (g === 'f' && cargo === 'mãe') return `sua mãe, ${nome}`;
  if (g === 'm' && cargo === 'pai') return `seu pai, ${nome}`;
  return `seu(sua) ${cargo || 'responsável'}, ${nome}`;
}

/** "reuniram-se ..., totalizando N presentes, sob a presidência de ..." conforme o tipo. */
function quemSeReuniu(meta: MeetingMetadata, pres: Participante[]): string {
  const total = `${numeroPorExtenso(pres.length)} ${pres.length === 1 ? 'presente' : 'presentes'}`;
  const tipo = tipoDe(meta);

  if (tipo === 'orientacao') {
    const orientador = pessoaNoTexto({ ...meta.presidente, presente: true }, meta);
    const o = meta.orientado;
    const g = o ? generoDoCargo(o.cargo) : 'n';
    const artigo = flexao(g, 'o', 'a', 'o(a)');
    const quem = o
      ? categoriaDe(o) === 'aluno'
        ? `${artigo} ${flexao(g, 'aluno', 'aluna', 'aluno(a)')} ${flexao(g, 'orientado', 'orientada', 'orientado(a)')} ${limpar(o.nome)}${o.vinculo?.trim() ? `, ${turmaTxt(o.vinculo)}` : ''}`
        : `${artigo} ${flexao(g, 'orientado', 'orientada', 'orientado(a)')} ${pessoaNoTexto(o, meta, true)}`
      : '[PENDENTE: pessoa orientada]';
    const acomp = pres.filter((p) => categoriaDe(p) === 'responsavel');
    const acompTxt = acomp.length
      ? `, ${flexao(g, 'acompanhado', 'acompanhada', 'acompanhado(a)')} de ${juntarComE(acomp.map((p) => acompanhante(p)))}`
      : '';
    const outros = pres.filter(
      (p) =>
        categoriaDe(p) !== 'responsavel' &&
        !ehOrientado(meta, p) &&
        normalizar(p.nome) !== normalizar(meta.presidente.nome) &&
        !(normalizar(p.nome) === normalizar(meta.secretario.nome)),
    );
    const outrosTxt = outros.length ? `, e ainda ${juntarComE(outros.map((p) => pessoaNoTexto(p, meta)))}` : '';
    const sec = mesmaPessoa(meta) ? '' : `, ${quemSecretaria(meta).replace(/, $/, '')}`;
    return `reuniram-se ${orientador}, e ${quem}${acompTxt}${outrosTxt}${sec}, totalizando ${total}, para tratar de orientação sobre: ${listaPauta(meta)}.`;
  }

  const sob = `sob a presidência de ${pessoaTxt(meta.presidente)}, `;
  if (tipo === 'pais') {
    const funcs = pres.filter((p) => categoriaDe(p) === 'funcionario');
    const resps = pres.filter((p) => categoriaDe(p) === 'responsavel');
    const alunos = pres.filter((p) => categoriaDe(p) === 'aluno');
    const partes: string[] = [];
    if (funcs.length) partes.push(`os funcionários ${juntarComE(funcs.map((p) => pessoaNoTexto(p, meta)))}`);
    if (usaListaAnexa(meta)) {
      partes.push(
        `${numeroPorExtenso(resps.length)} responsáveis por alunos, cujos nomes constam da lista de presença anexa, que é parte integrante desta ata`,
      );
    } else if (resps.length) {
      partes.push(`os responsáveis ${juntarComE(resps.map((p) => pessoaNoTexto(p, meta)))}`);
    }
    if (alunos.length) partes.push(`os alunos ${juntarComE(alunos.map((p) => pessoaNoTexto(p, meta)))}`);
    return `reuniram-se ${partes.join(', e ')}, totalizando ${total}, ${sob}${quemSecretaria(meta)}para tratar da seguinte pauta: ${listaPauta(meta)}.`;
  }

  return `reuniram-se ${juntarComE(pres.map((p) => pessoaNoTexto(p, meta)))}, totalizando ${total}, ${sob}${quemSecretaria(meta)}para tratar da seguinte pauta: ${listaPauta(meta)}.`;
}

function abertura(meta: MeetingMetadata, pres: Participante[]): string {
  const escola = `${artigoEscola(meta.escola)} ${limpar(meta.escola)}`;
  const onde = meta.local.trim()
    ? `${locativo(meta.local)} ${escola}`
    : `no local [PENDENTE: local da reunião] ${escola}`;
  return `${dataPorExtenso(meta.data)}, ${horaPorExtenso(meta.horaInicio)}, ${onde}, ${limpar(meta.rede)}, ${quemSeReuniu(meta, pres)}`;
}

/** Lista numerada em texto corrido: "primeira, ...; segunda, ..." (uma só: sem numeração). */
function enumerar(itens: string[], genero: 'm' | 'f' = 'f'): string {
  return itens.map((t, i) => (itens.length === 1 ? t : `${ordinalPorExtenso(i + 1, genero)}, ${t}`)).join('; ');
}

/** "de a coordenadora" -> "da coordenadora"; "de Clara Dias" -> "de Clara Dias". */
function aCargoDe(quem: string): string {
  const m = /^(a|o|as|os)\s+(.*)$/i.exec(quem);
  if (!m) return `de ${quem}`;
  return `d${m[1].toLocaleLowerCase('pt-BR')} ${m[2]}`;
}

function desenvolvimento(meta: MeetingMetadata, extraida: AtaExtraida): string[] {
  const tipo = tipoDe(meta);
  const orient = tipo === 'orientacao';
  const partes: string[] = [];
  const itens = extraida.itens.filter((i) => limpar(i.relato));
  const total = meta.pauta.length;
  const unidade = orient ? 'assunto' : 'item da pauta';

  for (let n = 1; n <= total; n++) {
    const relatos = itens.filter((i) => i.pauta === n).map((i) => limpar(i.relato));
    const ord = ordinalPorExtenso(n);
    if (!relatos.length) {
      partes.push(`No ${ord} ${unidade}, [PENDENTE: ${orient ? 'assunto não registrado' : 'item não registrado'} na transcrição]`);
      continue;
    }
    const txt = relatos.map(comPontoFinal).join(' ');
    partes.push(
      /^(?:No|Quanto ao|Sobre o|Em relação ao)\b[^.]{0,60}\b(?:item|assunto)\b/i.test(txt) ? txt : `No ${ord} ${unidade}: ${txt}`,
    );
  }

  const extras = itens.filter((i) => i.pauta < 1 || i.pauta > total).map((i) => limpar(i.relato));
  if (extras.length) {
    const txt = extras.map(comPontoFinal).join(' ');
    partes.push(/^Em (?:assuntos gerais|outros assuntos)\b/i.test(txt) ? txt : `${orient ? 'Em outros assuntos' : 'Em assuntos gerais'}: ${txt}`);
  }
  if (!total && !extras.length) partes.push('[PENDENTE: desenvolvimento da reunião]');

  const manifest = (extraida.manifestacoes ?? []).filter((m) => limpar(m)).map((m) => minuscula1(semPontoFinal(m)));
  if (manifest.length && tipo !== 'pedagogica') {
    const quem = tipo === 'pais' ? 'dos responsáveis' : 'do orientado e de quem o acompanhou';
    partes.push(
      tipo === 'pais'
        ? `Os responsáveis apresentaram as seguintes dúvidas e demandas: ${enumerar(manifest)}`
        : `Foram registradas as seguintes manifestações ${quem}: ${enumerar(manifest)}`,
    );
  }

  if (orient) {
    const ors = (extraida.orientacoes ?? []).filter((o) => limpar(o)).map((o) => minuscula1(semPontoFinal(o)));
    partes.push(
      ors.length
        ? `Foram dadas as seguintes orientações: ${enumerar(ors)}`
        : 'Foram dadas as seguintes orientações: [PENDENTE: orientações dadas]',
    );
  }

  const delibs = extraida.deliberacoes.filter((d) => limpar(d.texto));
  if (delibs.length) {
    const lista = delibs.map((d) => {
      const base = minuscula1(semPontoFinal(d.texto));
      const voto = d.votacao && limpar(d.votacao) ? ` (${semPontoFinal(d.votacao)})` : '';
      return `${base}${voto}`;
    });
    partes.push(
      delibs.length === 1
        ? `Ficou registrada a seguinte deliberação: ${lista[0]}`
        : `Ficaram registradas as seguintes deliberações: ${enumerar(lista)}`,
    );
  }

  const encs = extraida.encaminhamentos.filter((e) => limpar(e.acao));
  if (encs.length) {
    const lista = encs.map((e, i) => {
      const ord = ordinalPorExtenso(i + 1);
      const quem = e.responsavel && limpar(e.responsavel) ? semPontoFinal(e.responsavel) : `[PENDENTE: responsável pelo ${ord} ${orient ? 'combinado' : 'encaminhamento'}]`;
      const prazo = e.prazo && limpar(e.prazo) ? semPontoFinal(e.prazo) : `[PENDENTE: prazo do ${ord} ${orient ? 'combinado' : 'encaminhamento'}]`;
      const base = `${minuscula1(semPontoFinal(e.acao))}, a cargo ${aCargoDe(quem)}, prazo: ${prazo}`;
      return encs.length === 1 ? base : `${ord}, ${base}`;
    });
    const um = orient ? 'Como combinado, ficou definido' : 'Como encaminhamento, ficou definido';
    const varios = orient ? 'Como combinados, ficou definido o seguinte' : 'Como encaminhamentos, ficou definido o seguinte';
    partes.push(encs.length === 1 ? `${um}: ${lista[0]}` : `${varios}: ${lista.join('; ')}`);
  }
  return partes;
}

function encerramento(meta: MeetingMetadata, extraida: AtaExtraida): string {
  const orient = tipoDe(meta) === 'orientacao';
  const fim = meta.horaFim?.trim() ? horaPorExtenso(meta.horaFim) : '[PENDENTE: horário de término da reunião]';
  const quemLavrou = mesmaPessoa(meta)
    ? `${meta.presidente.cargo.trim() ? `${minuscula1(meta.presidente.cargo)}, ` : ''}que presidi a reunião`
    : tituloSecretario(meta.secretario);
  let ciencia = '';
  if (orient) {
    const g = meta.orientado ? generoDoCargo(meta.orientado.cargo) : 'n';
    ciencia = extraida.cienciaOrientado === true
      ? `, tendo ${flexao(g, 'o orientado', 'a orientada', 'o(a) orientado(a)')} tomado ciência das orientações`
      : ', [PENDENTE: ciência do orientado]';
  }
  return (
    `Nada mais havendo a tratar, foi encerrada a ${orient ? 'orientação' : 'reunião'} ${fim}${ciencia}, e eu, ${limpar(meta.secretario.nome)}, ` +
    `${quemLavrou}, lavrei a presente ata que, lida e aprovada, será assinada por mim e pelos demais presentes.`
  );
}

function tituloDoc(meta: MeetingMetadata): string {
  const tipo = tipoDe(meta);
  const base = TIPOS_ATA[tipo].titulo;
  let nome: string;
  if (tipo === 'pedagogica') nome = `${base} ${meta.ordinaria ? 'ORDINÁRIA' : 'EXTRAORDINÁRIA'}`;
  else if (tipo === 'orientacao') nome = `${base} A ${meta.orientado ? (categoriaDe(meta.orientado) === 'aluno' ? 'ALUNO' : 'FUNCIONÁRIO') : ''}`.trim();
  else nome = base;
  return `ATA Nº ${String(meta.numero).padStart(3, '0')}/${meta.ano} – ${nome}`;
}

/** Linha de assinatura: nome + o que o identifica ("Mãe do aluno P.H., do quinto ano B"). */
function assinatura(p: Participante, meta: MeetingMetadata): Pessoa {
  if (categoriaDe(p) === 'funcionario' && !ehOrientado(meta, p)) return { nome: p.nome, cargo: p.cargo };
  const d = textoLivreParaPadrao(descricao(p, meta));
  const orient = ehOrientado(meta, p);
  const g = generoDoCargo(p.cargo);
  const marca = orient ? ` (${flexao(g, 'orientado', 'orientada', 'orientado(a)')})` : '';
  const cargo = d ? `${maiuscula1(d)}${marca}` : marca.trim().replace(/^\(|\)$/g, '');
  return { nome: limpar(p.nome), cargo };
}

/** Monta a ata final: abertura e encerramento por código, corpo do LLM, números por extenso. */
export function renderAta(meta: MeetingMetadata, extraida: AtaExtraida): AtaRenderizada {
  const pres = presentes(meta);
  const aus = ausentes(meta, pres);

  const partes = [abertura(meta, pres)];
  if (aus.length) {
    const lista = juntarComE(aus.map((p) => pessoaNoTexto(p, meta)));
    partes.push(
      aus.length === 1 ? `Não compareceu o seguinte convocado: ${lista}.` : `Não compareceram os seguintes convocados: ${lista}.`,
    );
  }
  partes.push(...desenvolvimento(meta, extraida).map(comPontoFinal), encerramento(meta, extraida));

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
    titulo: tituloDoc(meta),
    cabecalho: [meta.escola, meta.rede, meta.municipioUf].map((s) => limpar(s).toLocaleUpperCase('pt-BR')).filter(Boolean),
    texto,
    assinaturas: pres.map((p) => assinatura(p, meta)),
    pendencias,
  };
}
