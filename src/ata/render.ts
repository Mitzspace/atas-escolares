import { TIPOS_ATA, listarOrientados, type AtaExtraida, type AtaRenderizada, type Categoria, type MeetingMetadata, type Participante, type Pessoa, type TipoAta } from './types';
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

/** Cargo em minúsculas; preserva o complemento de disciplina, área ou instituição. */
function cargoNoTexto(s: string): string {
  const t = limpar(s);
  const partes = /^(.*?)(\s+(?:de|da|do|das|dos|em)\s+)(.*)$/i.exec(t);
  if (!partes) return t.toLocaleLowerCase('pt-BR');
  return (partes[1] + partes[2]).toLocaleLowerCase('pt-BR') + partes[3];
}

const ABERTURAS_DE_FRASE = new Set(
  ('a o as os um uma uns umas no na nos nas ao aos à às em para por pelo pela com sem sobre após durante segundo conforme quanto ' +
    'também ainda todos todas cada esse essa este esta foi ficou houve será serão foram ficaram nenhum nenhuma alguns algumas ' +
    'dois duas três quando como se que e mas porém então assim além depois antes nesse nessa neste nesta').split(' '),
);
const NOMES_EM_AR_ER_IR = new Set(['cesar', 'omar', 'samir', 'amir', 'pilar', 'aguiar', 'elcir']);

/** Minúscula na primeira palavra de uma frase do modelo, mas só se for artigo, preposição, verbo etc. — nunca um nome próprio. */
function minusculaFrase(s: string): string {
  const t = limpar(s);
  const w = t.split(' ')[0] ?? '';
  if (!/^[A-ZÀ-Ý][a-zà-ÿ]*$/.test(w)) return t;
  const lw = w.toLocaleLowerCase('pt-BR');
  const verbo = (/^[a-zà-ÿ]{3,}(ar|er|ir|or)$/.test(lw) && !NOMES_EM_AR_ER_IR.has(lw)) || /^[a-zà-ÿ]{2,}(ou|eu|iu|aram|eram|iram)$/.test(lw);
  return ABERTURAS_DE_FRASE.has(lw) || verbo ? lw + t.slice(w.length) : t;
}

/** Itens com vírgulas internas (nome, turma, responsável): separados por ponto e vírgula, com "e" antes do último. */
const juntarItens = (itens: string[]) =>
  itens.length <= 1 ? (itens[0] ?? '') : `${itens.slice(0, -1).join('; ')}; e ${itens[itens.length - 1]}`;

function juntarComE(itens: string[]): string {
  if (itens.length <= 1) return itens[0] ?? '';
  if (itens.length === 2) return `${itens[0]} e ${itens[1]}`;
  return `${itens.slice(0, -1).join('; ')}; e ${itens[itens.length - 1]}`;
}

function pessoaTxt(p: Pessoa): string {
  const nome = limpar(p.nome);
  return p.cargo.trim() ? `${nome}, ${cargoNoTexto(p.cargo)}` : nome;
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
  const anonimizar = meta.anonimizarAlunos && !listarOrientados(meta).some((o) => normalizar(o.nome) === normalizar(v.nome));
  const nome = anonimizar ? iniciais(v.nome) : limpar(v.nome);
  return `${prep} ${v.rotulo} ${nome}${v.turma ? `, ${turmaTxt(v.turma)}` : ''}`;
}

/** Trecho que vem depois do nome: "mãe do aluno P.H., do quinto ano B", "aluno do quinto ano B", "diretora". */
function descricao(p: Participante, meta: MeetingMetadata): string {
  const cargo = limpar(p.cargo);
  switch (categoriaDe(p)) {
    case 'responsavel': {
      const cab = cargo ? cargoNoTexto(cargo) : 'responsável';
      const prep = cab.toLocaleLowerCase('pt-BR').startsWith('responsável') ? 'por' : 'de';
      const vinc = vinculoTxt(p, meta, prep);
      return vinc ? `${cab} ${vinc}` : cab;
    }
    case 'aluno': {
      const cab = cargo ? cargoNoTexto(cargo) : 'aluno(a)';
      const turma = p.vinculo?.trim() ? ` ${turmaTxt(p.vinculo)}` : '';
      return `${cab}${turma}`;
    }
    default:
      return cargo ? cargoNoTexto(cargo) : '';
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

/** Gênero do grupo: feminino só se todos forem; misto ou indefinido segue a norma (masculino). */
const generoDoGrupo = (ps: Participante[]): Genero3 => {
  const gs = ps.map((p) => generoDoCargo(p.cargo));
  return gs.every((g) => g === 'f') ? 'f' : gs.length === 1 && gs[0] === 'n' ? 'n' : 'm';
};

/** "a funcionária" / "o responsável" / "os funcionários" / "as alunas", conforme quantidade e gênero. */
function chamada(ps: Participante[], n: { m: string; f: string; mp: string; fp: string; neutro: string }): string {
  const g = generoDoGrupo(ps);
  if (ps.length === 1) return g === 'f' ? `a ${n.f}` : g === 'n' ? `o(a) ${n.neutro}` : `o ${n.m}`;
  return g === 'f' ? `as ${n.fp}` : `os ${n.mp}`;
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
  listarOrientados(meta).forEach(add);
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
  listarOrientados(meta).some((o) => normalizar(o.nome) === normalizar(p.nome));

function listaPauta(meta: MeetingMetadata): string {
  return meta.pauta.length
    ? meta.pauta.map((p, i) => `${numeroPorExtenso(i + 1)}, ${semPontoFinal(p)}`).join('; ')
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
    const orientados = listarOrientados(meta);
    const responsaveis = pres.filter((p) => categoriaDe(p) === 'responsavel');
    // com um só orientado, todo responsável o acompanha; com vários, cada responsável acompanha o aluno do seu vínculo
    const acompanhantesDe = (o: Participante) =>
      orientados.length === 1
        ? responsaveis
        : responsaveis.filter((r) => {
            const v = parseVinculo(r.vinculo ?? '');
            return !!v && normalizar(v.nome) === normalizar(o.nome);
          });
    const acompanhados = new Set<string>();
    const itemOrientado = (o: Participante, g: Genero3) => {
      const acomp = acompanhantesDe(o);
      acomp.forEach((r) => acompanhados.add(normalizar(r.nome)));
      const acompTxt = acomp.length
        ? `, ${flexao(g, 'acompanhado', 'acompanhada', 'acompanhado(a)')} de ${juntarComE(acomp.map((r) => acompanhante(r)))}`
        : '';
      const base = categoriaDe(o) === 'aluno' ? `${limpar(o.nome)}${o.vinculo?.trim() ? `, ${turmaTxt(o.vinculo)}` : ''}` : pessoaNoTexto(o, meta, true);
      return `${base}${acompTxt}`;
    };
    const grupo = (os: Participante[], aluno: boolean): string => {
      const g = generoDoGrupo(os);
      const itens = os.map((o) => itemOrientado(o, generoDoCargo(o.cargo)));
      if (os.length === 1) {
        const art = flexao(g, 'o', 'a', 'o(a)');
        const orientado = flexao(g, 'orientado', 'orientada', 'orientado(a)');
        return aluno ? `${art} ${flexao(g, 'aluno', 'aluna', 'aluno(a)')} ${orientado} ${itens[0]}` : `${art} ${orientado} ${itens[0]}`;
      }
      const f = g === 'f';
      return `${f ? 'as' : 'os'} ${aluno ? (f ? 'alunas' : 'alunos') + ' ' : ''}${f ? 'orientadas' : 'orientados'} ${juntarItens(itens)}`;
    };
    const alunos = orientados.filter((o) => categoriaDe(o) === 'aluno');
    const funcs = orientados.filter((o) => categoriaDe(o) !== 'aluno');
    const quem = orientados.length
      ? [alunos.length ? grupo(alunos, true) : '', funcs.length ? grupo(funcs, false) : ''].filter(Boolean).join(', e ')
      : '[PENDENTE: pessoa orientada]';
    const outros = pres.filter(
      (p) =>
        !(categoriaDe(p) === 'responsavel' && acompanhados.has(normalizar(p.nome))) &&
        !ehOrientado(meta, p) &&
        normalizar(p.nome) !== normalizar(meta.presidente.nome) &&
        !(normalizar(p.nome) === normalizar(meta.secretario.nome)),
    );
    const outrosTxt = outros.length ? `, e ainda ${juntarComE(outros.map((p) => pessoaNoTexto(p, meta)))}` : '';
    const sec = mesmaPessoa(meta) ? '' : `, ${quemSecretaria(meta).replace(/, $/, '')}`;
    return `reuniram-se ${orientador}, e ${quem}${outrosTxt}${sec}, totalizando ${total}, para tratar de orientação sobre: ${listaPauta(meta)}.`;
  }

  const sob = `sob a presidência de ${pessoaTxt(meta.presidente)}, `;
  if (tipo === 'pais') {
    const funcs = pres.filter((p) => categoriaDe(p) === 'funcionario');
    const resps = pres.filter((p) => categoriaDe(p) === 'responsavel');
    const alunos = pres.filter((p) => categoriaDe(p) === 'aluno');
    const partes: string[] = [];
    if (funcs.length) {
      const nome = chamada(funcs, { m: 'funcionário', f: 'funcionária', mp: 'funcionários', fp: 'funcionárias', neutro: 'funcionário(a)' });
      partes.push(`${nome} ${juntarComE(funcs.map((p) => pessoaNoTexto(p, meta)))}`);
    }
    if (usaListaAnexa(meta)) {
      partes.push(
        `${numeroPorExtenso(resps.length)} responsáveis por alunos, cujos nomes constam da lista de presença anexa, que é parte integrante desta ata`,
      );
    } else if (resps.length) {
      const nome = chamada(resps, { m: 'responsável', f: 'responsável', mp: 'responsáveis', fp: 'responsáveis', neutro: 'responsável' });
      partes.push(`${nome} ${juntarComE(resps.map((p) => pessoaNoTexto(p, meta)))}`);
    }
    // o cargo já diz "aluno(a) do ...": sem substantivo de grupo para não repetir
    if (alunos.length) partes.push(juntarComE(alunos.map((p) => pessoaNoTexto(p, meta))));
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

  const manifest = (extraida.manifestacoes ?? []).filter((m) => limpar(m)).map((m) => minusculaFrase(semPontoFinal(m)));
  if (manifest.length && tipo !== 'pedagogica') {
    const varios = listarOrientados(meta).length > 1;
    const quem = tipo === 'pais' ? 'dos responsáveis' : varios ? 'dos orientados e de quem os acompanhou' : 'do orientado e de quem o acompanhou';
    partes.push(
      tipo === 'pais'
        ? `Os responsáveis apresentaram as seguintes dúvidas e demandas: ${enumerar(manifest)}`
        : `Foram registradas as seguintes manifestações ${quem}: ${enumerar(manifest)}`,
    );
  }

  if (orient) {
    const ors = (extraida.orientacoes ?? []).filter((o) => limpar(o)).map((o) => minusculaFrase(semPontoFinal(o)));
    partes.push(
      ors.length
        ? `Foram dadas as seguintes orientações: ${enumerar(ors)}`
        : 'Foram dadas as seguintes orientações: [PENDENTE: orientações dadas]',
    );
  }

  const delibs = extraida.deliberacoes.filter((d) => limpar(d.texto));
  if (delibs.length) {
    const lista = delibs.map((d) => {
      const base = minusculaFrase(semPontoFinal(d.texto));
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
      const base = `${minusculaFrase(semPontoFinal(e.acao))}, a cargo ${aCargoDe(quem)}, prazo: ${prazo}`;
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
  const fim = meta.horaFim?.trim()
    ? horaPorExtenso(meta.horaFim)
    : `[PENDENTE: horário de término da ${orient ? 'orientação' : 'reunião'}]`;
  const quemLavrou = mesmaPessoa(meta)
    ? `${meta.presidente.cargo.trim() ? `${cargoNoTexto(meta.presidente.cargo)}, ` : ''}que presidi a reunião`
    : tituloSecretario(meta.secretario);
  let ciencia = '';
  if (orient) {
    const os = listarOrientados(meta);
    const plural = os.length > 1;
    const g = os.length ? generoDoGrupo(os) : 'n';
    const quem = plural
      ? g === 'f' ? 'as orientadas' : 'os orientados'
      : flexao(g, 'o orientado', 'a orientada', 'o(a) orientado(a)');
    // com vários orientados, cienciaOrientado vale para todos
    ciencia = extraida.cienciaOrientado === true
      ? `, tendo ${quem} tomado ciência das orientações`
      : `, [PENDENTE: ciência ${plural ? 'dos orientados' : 'do orientado'}]`;
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
  else if (tipo === 'orientacao') {
    const os = listarOrientados(meta);
    const al = os.filter((o) => categoriaDe(o) === 'aluno').length;
    const fu = os.length - al;
    const partes = [al ? (al > 1 ? 'ALUNOS' : 'ALUNO') : '', fu ? (fu > 1 ? 'FUNCIONÁRIOS' : 'FUNCIONÁRIO') : ''];
    // misto: sempre no plural
    nome = `${base}${os.length ? ` A ${al && fu ? 'ALUNOS E FUNCIONÁRIOS' : partes.filter(Boolean).join('')}` : ''}`;
  }
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
    const g = generoDoGrupo(aus) === 'f' ? 'f' : 'm';
    partes.push(
      aus.length === 1
        ? `Não compareceu ${g === 'f' ? 'a seguinte convocada' : 'o seguinte convocado'}: ${lista}.`
        : `Não compareceram ${g === 'f' ? 'as seguintes convocadas' : 'os seguintes convocados'}: ${lista}.`,
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
