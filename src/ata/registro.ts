// Registro da reunião (modos Digitar e Gravar e digitar), identificação de falantes e resumo.
// Só tipos, prompts, schemas e funções puras: sem UI, Gemini ou DB.
import type { AtaExtraida, MeetingMetadata, Participante, TranscriptSegment } from './types';
import { textoLivreParaPadrao } from './numeros';
import { listarOrientados } from './types';

/** Anotação digitada pela usuária. `tempo` = MM:SS da gravação, quando houve gravação simultânea. */
export type Anotacao = { texto: string; tempo?: string };

/** Como a reunião foi registrada. Ausente = 'audio' (atas antigas). */
export type ModoRegistro = 'audio' | 'digitar' | 'audio_digitar';

export type ResumoAta = { assuntos: string[]; decisoes: string[]; encaminhamentos: string[] };

/** Rótulo de quem não pôde ser identificado com segurança. */
export const FALANTE_NAO_IDENTIFICADO = 'Falante não identificado';

const limpar = (s: string) => s.replace(/\s+/g, ' ').trim();
const norm = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// ---------------------------------------------------------------- anotações

export const anotacoesValidas = (anotacoes: Anotacao[] = []): Anotacao[] =>
  anotacoes.map((a) => ({ ...a, texto: a.texto.trim() })).filter((a) => a.texto);

export function modoDe(transcript: TranscriptSegment[], anotacoes?: Anotacao[]): ModoRegistro {
  const temNotas = anotacoesValidas(anotacoes).length > 0;
  if (!temNotas) return 'audio';
  return transcript.length ? 'audio_digitar' : 'digitar';
}

const REGRAS_NOTAS_COMUNS =
  'Escreva o corpo da ata no padrão do sistema (texto corrido, terceira pessoa, pretérito perfeito, números por extenso, sem abertura nem encerramento). ' +
  'Corrija a ortografia, a pontuação e a organização, sem mudar fatos. NUNCA invente nomes, números, datas, decisões, votações, prazos ou responsáveis que não estejam no material; ' +
  'o que faltar ou estiver ambíguo vira [PENDENTE: descrição] ou [confirmar: descrição], também listado em "pendencias". ' +
  'Distribua o conteúdo pelos itens da pauta (use pauta 0 para o que não couber) e extraia deliberações e encaminhamentos somente quando o material mostrar que foram decididos ou assumidos.';

const REGRAS_SO_NOTAS =
  'MODO DIGITADO. Não há gravação: o material é o que a secretária anotou durante ou depois da reunião. ' +
  'As anotações são a única fonte; trate-as como fatos registrados por quem esteve presente, mas não acrescente nada além delas. ' + REGRAS_NOTAS_COMUNS;

const REGRAS_AUDIO_E_NOTAS =
  'MODO GRAVADO E DIGITADO. Há a transcrição da gravação e as anotações da secretária, feitas durante a reunião; o tempo [MM:SS] de cada anotação corresponde ao tempo da gravação. ' +
  'As ANOTAÇÕES TÊM PRIORIDADE sobre a transcrição para nomes, números, datas, valores e decisões (a transcrição automática erra esses dados). ' +
  'Use a transcrição para o contexto e os detalhes que as anotações não trazem. ' +
  'Quando transcrição e anotações divergirem em nome, número, data ou decisão, adote a versão das anotações e registre [confirmar: descrição da divergência] no texto e em "pendencias". ' + REGRAS_NOTAS_COMUNS;

export function regrasDoModo(modo: ModoRegistro): string {
  const base = modo === 'digitar' ? REGRAS_SO_NOTAS : modo === 'audio_digitar' ? REGRAS_AUDIO_E_NOTAS : '';
  return base ? `${base}\n\n${COBERTURA_ANOTACOES}` : '';
}

/** Anotações numeradas ("Anotação 2 [00:03]: ..."): o número deixa a regra de cobertura verificável pelo modelo. */
export function linhasAnotacoes(anotacoes: Anotacao[]): string[] {
  return anotacoesValidas(anotacoes).map(
    (a, i) => `Anotação ${i + 1}${a.tempo?.trim() ? ` [${a.tempo.trim()}]` : ''}: ${limpar(a.texto.replace(/\r?\n+/g, ' / '))}`,
  );
}

const COBERTURA_ANOTACOES =
  'COBERTURA DAS ANOTAÇÕES (obrigatória): as anotações vêm numeradas. CADA anotação deve aparecer no corpo — no relato do item da pauta a que se refere ' +
  '(ou em pauta 0 se não couber), em "deliberacoes" ou em "encaminhamentos" — com os mesmos nomes, números, datas e decisões. ' +
  'Se não souber onde encaixar ou houver dúvida, escreva-a mesmo assim e acrescente [confirmar: Anotação N]. ' +
  'Nunca omita uma anotação nem deixe um item da pauta como não registrado quando alguma anotação o tratar. Antes de responder, confira que as anotações 1 a N estão todas contempladas.';

// ---------------------------------------------------------------- falantes

/** Nomes que podem ser atribuídos a um trecho (presentes, responsável, presidente/secretário antigos e orientados). */
export function nomesParaFalantes(meta: MeetingMetadata, participantes: Participante[] = meta.participantes): string[] {
  const vistos = new Map<string, string>();
  const nomes = [
    ...participantes.filter((p) => p.presente !== false).map((p) => p.nome),
    meta.responsavel?.nome,
    meta.presidente?.nome,
    meta.secretario?.nome,
    ...listarOrientados(meta).map((p) => p.nome),
  ];
  for (const n of nomes) if (n && limpar(n)) vistos.set(norm(n), limpar(n));
  return [...vistos.values()];
}

export const ehFalanteGenerico = (speaker: string): boolean => {
  const s = speaker.trim();
  return !s || /^(?:falante|speaker|spk)[\s_]*(?:\d+|n[aã]o identificado)?(?:\s*\(.*\))?$/iu.test(s) || norm(s) === norm(FALANTE_NAO_IDENTIFICADO);
};

export const falantesResponseSchema: object = {
  type: 'OBJECT',
  properties: {
    atribuicoes: {
      type: 'ARRAY',
      description: 'Uma entrada por trecho cuja autoria foi identificada de forma inequívoca. Trechos duvidosos NÃO entram na lista.',
      items: {
        type: 'OBJECT',
        properties: {
          trecho: { type: 'INTEGER', description: 'Número do trecho, como na entrada.' },
          falante: { type: 'STRING', description: 'Nome EXATO da lista de participantes.' },
          evidencia: { type: 'STRING', description: 'Citação curta do texto que comprova a autoria (apresentação, chamada pelo nome ou resposta direta).' },
        },
        required: ['trecho', 'falante', 'evidencia'],
        propertyOrdering: ['trecho', 'falante', 'evidencia'],
      },
    },
  },
  required: ['atribuicoes'],
  propertyOrdering: ['atribuicoes'],
};

export function buildFalantesPrompt(
  nomes: string[],
  trechos: { n: number; speaker: string; start: string; text: string }[],
): { systemInstruction: string; userPrompt: string } {
  const systemInstruction =
    'Você identifica quem falou em trechos de uma transcrição de reunião escolar feita sem separação de falantes. ' +
    'Atribua um trecho a uma pessoa da lista SOMENTE quando o próprio texto (do trecho ou de trechos vizinhos) mostrar isso de forma inequívoca: ' +
    'a pessoa se apresenta ("sou a Joana"), é chamada pelo nome e responde no trecho seguinte, ou fala de si com o nome. ' +
    'Cargo, assunto, tom, a pauta ou a presença na lista NÃO bastam. Nunca estenda a autoria para trechos vizinhos sem evidência própria. ' +
    'Na dúvida, não inclua o trecho: ele ficará como "' + FALANTE_NAO_IDENTIFICADO + '". Use os nomes exatamente como estão na lista, nunca outros. ' +
    'Cada atribuição leva uma citação curta do texto que a comprova.';
  const userPrompt = [
    'PARTICIPANTES (únicos nomes permitidos):',
    ...(nomes.length ? nomes.map((n) => `- ${n}`) : ['(lista vazia: não atribua ninguém)']),
    '',
    'TRECHOS (formato n [MM:SS] rótulo atual: texto)',
    ...trechos.map((t) => `${t.n} [${t.start}] ${limpar(t.speaker) || '—'}: ${limpar(t.text)}`),
    '',
    'Devolva as atribuições inequívocas em JSON.',
  ].join('\n');
  return { systemInstruction, userPrompt };
}

export type AtribuicaoFalante = { trecho: number; falante: string; evidencia: string };

/**
 * Aplica as atribuições devolvidas pela IA. Garantias por código (a IA não é confiável para isso):
 * - nome fora da lista de participantes é descartado;
 * - sem citação, ou com citação que não aparece nos trechos, é descartado;
 * - trecho que já tinha um nome específico (não genérico) é mantido;
 * - o restante vira "Falante não identificado".
 * `base` é o índice do primeiro trecho de `segmentos` na lista completa (para blocos).
 */
export function aplicarFalantes(
  segmentos: TranscriptSegment[],
  atribuicoes: AtribuicaoFalante[],
  nomes: string[],
  base = 0,
): TranscriptSegment[] {
  const porNome = new Map(nomes.map((n) => [norm(n), n]));
  const mapa = new Map<number, string>();
  for (const a of atribuicoes) {
    const nome = porNome.get(norm(a.falante ?? ''));
    const i = a.trecho - base;
    if (!nome || !Number.isInteger(i) || i < 0 || i >= segmentos.length) continue;
    const citacao = norm(a.evidencia ?? '');
    if (!citacao) continue;
    const contexto = norm(segmentos.slice(Math.max(0, i - 2), i + 3).map((s) => s.text).join(' '));
    if (!contexto.includes(citacao)) continue;
    mapa.set(i, nome);
  }
  return segmentos.map((s, i) => {
    if (!ehFalanteGenerico(s.speaker)) return s;
    return { ...s, speaker: mapa.get(i) ?? FALANTE_NAO_IDENTIFICADO };
  });
}

// ---------------------------------------------------------------- resumo

const frases = (texto: string) => limpar(texto).split(/(?<=[.!?])\s+(?=[A-ZÁÂÃÀÉÊÍÓÔÕÚÇ\[])/u).filter(Boolean);
const semPonto = (s: string) => limpar(s).replace(/[.;:,\s]+$/, '');
const unicos = (l: string[]) => [...new Map(l.filter(Boolean).map((s) => [norm(s), s])).values()];
const resumida = (s: string, max = 140) => {
  const t = semPonto(s);
  return t.length <= max ? t : `${t.slice(0, max).replace(/\s+\S*$/, '')}…`;
};

/**
 * Resumo para o painel da revisão. Pura, sem IA.
 * - `AtaExtraida`: assuntos = itens da pauta tratados (título da pauta se `meta` for passado; senão a 1ª frase do relato);
 *   decisões = deliberações (com a votação); encaminhamentos = ações (com responsável e prazo) e orientações.
 * - `string` (texto da ata, inclusive editado): heurística por frases, só reaproveita o que o texto já diz.
 */
export function extrairResumo(fonte: AtaExtraida | string, meta?: Pick<MeetingMetadata, 'pauta'>): ResumoAta {
  if (typeof fonte !== 'string') {
    const assuntos = fonte.itens
      .filter((i) => limpar(i.relato))
      .sort((a, b) => (a.pauta >= 1 ? a.pauta : Infinity) - (b.pauta >= 1 ? b.pauta : Infinity))
      .map((i) => (i.pauta >= 1 && meta?.pauta[i.pauta - 1] ? limpar(meta.pauta[i.pauta - 1]) : resumida(frases(i.relato)[0] ?? i.relato)));
    const decisoes = fonte.deliberacoes
      .filter((d) => limpar(d.texto))
      .map((d) => `${semPonto(d.texto)}${d.votacao && limpar(d.votacao) ? ` (${semPonto(d.votacao)})` : ''}`);
    const encaminhamentos = [
      ...fonte.encaminhamentos
        .filter((e) => limpar(e.acao))
        .map((e) => [semPonto(e.acao), e.responsavel && `responsável: ${semPonto(e.responsavel)}`, e.prazo && `prazo: ${semPonto(e.prazo)}`].filter(Boolean).join(' — ')),
      ...(fonte.orientacoes ?? []).filter((o) => limpar(o)).map((o) => semPonto(o)),
    ];
    return { assuntos: unicos(assuntos), decisoes: unicos(decisoes), encaminhamentos: unicos(encaminhamentos) };
  }
  const todas = frases(fonte);
  const assuntos: string[] = [];
  const decisoes: string[] = [];
  const encaminhamentos: string[] = [];
  const reAssunto = /^(?:No|Na|Quanto ao|Sobre o|Em relação ao)\s+[^:.]{0,60}\b(?:item|assunto|pauta)\b[^:]*:\s*(.+)$/iu;
  const reOutros = /^Em (?:assuntos gerais|outros assuntos):\s*(.+)$/iu;
  const reDecisao = /\b(?:deliberaç|deliberou|deliberaram|decidiu|decidiram|decidid[oa]s?|aprovad[oa]s?|aprovou|aprovaram|por unanimidade|ficou (?:decidido|definido|estabelecido))/iu;
  const reEncam = /\b(?:encaminh|ficou (?:combinado|sob (?:a )?responsabilidade|acordado)|ficaram? (?:responsáve|combinad)|comprometeu-se|comprometeram-se|prazo|providenciar[áa]?|será enviad|serão enviad)/iu;
  for (const f of todas) {
    const m = reAssunto.exec(f) ?? reOutros.exec(f);
    if (m) assuntos.push(resumida(frases(m[1])[0] ?? m[1]));
    if (/^(?:Nada mais havendo|Aos\s)/iu.test(f)) continue;
    if (reDecisao.test(f)) decisoes.push(resumida(f, 220));
    else if (reEncam.test(f)) encaminhamentos.push(resumida(f, 220));
  }
  return { assuntos: unicos(assuntos), decisoes: unicos(decisoes), encaminhamentos: unicos(encaminhamentos) };
}

// ---------------------------------------------------------------- garantia de cobertura das anotações

const STOP = new Set(
  ('a o as os um uma uns umas de da do das dos em no na nos nas ao aos para por com sem sobre que se e ou mas foi ser ter tem tinha ficou ficaram '
    + 'dia dias isso esse essa este esta tambem ainda ja mais muito pelo pela pelos pelas entre ate como quando').split(' '),
);
const radical = (w: string) => w.slice(0, 5);

/** Radicais das palavras que carregam conteúdo (nomes, números por extenso, verbos, substantivos). */
function radicais(texto: string): string[] {
  const t = norm(textoLivreParaPadrao(texto, false));
  return [...new Set(t.split(' ').filter((w) => w.length >= 3 && !STOP.has(w)).map(radical))];
}

function textoDoCorpo(e: AtaExtraida): string {
  return [
    ...e.itens.map((i) => i.relato),
    ...e.deliberacoes.flatMap((d) => [d.texto, d.votacao ?? '']),
    ...e.encaminhamentos.flatMap((x) => [x.acao, x.responsavel ?? '', x.prazo ?? '']),
    ...(e.manifestacoes ?? []),
    ...(e.orientacoes ?? []),
  ].join(' ');
}

const COBERTURA_MINIMA = 0.6;
const unidades = (texto: string) => frases(texto).map(semPonto).filter((f) => limpar(f));

/**
 * Garante por código que nenhuma anotação se perca. Para cada frase de cada anotação, confere se o conteúdo essencial
 * (radicais de nomes, números por extenso e palavras de conteúdo) aparece no corpo redigido; as que faltam entram no
 * relato do item da pauta com mais palavras em comum, ou num trecho "Conforme anotações registradas durante a reunião, ..."
 * em pauta 0, e viram a pendência "conferir anotação incorporada: ...". Pura: devolve uma cópia.
 */
export function incorporarAnotacoes(extraida: AtaExtraida, anotacoes: Anotacao[] = []): { extraida: AtaExtraida; incorporadas: string[] } {
  const notas = anotacoesValidas(anotacoes);
  if (!notas.length) return { extraida, incorporadas: [] };
  const corpo = new Set(radicais(textoDoCorpo(extraida)));
  const faltando: string[] = [];
  for (const n of notas) {
    for (const u of unidades(n.texto)) {
      const rs = radicais(u);
      if (!rs.length) continue;
      const achados = rs.filter((r) => corpo.has(r)).length;
      if (achados / rs.length < COBERTURA_MINIMA) faltando.push(u);
    }
  }
  if (!faltando.length) return { extraida, incorporadas: [] };

  const itens = extraida.itens.map((i) => ({ ...i }));
  const soltas: string[] = [];
  for (const u of faltando) {
    const rs = new Set(radicais(u));
    let melhor = -1;
    let pontos = 0;
    itens.forEach((it, idx) => {
      if (it.pauta < 1) return;
      const p = radicais(it.relato).filter((r) => rs.has(r)).length;
      if (p > pontos) { pontos = p; melhor = idx; }
    });
    if (melhor >= 0) itens[melhor].relato = `${itens[melhor].relato.replace(/\s+$/, '')}${/[.!?]$/.test(itens[melhor].relato.trim()) ? '' : '.'} Conforme anotação registrada durante a reunião, ${minuscula1(u)}.`;
    else soltas.push(u);
  }
  if (soltas.length) {
    const txt = `Conforme anotações registradas durante a reunião, ${soltas.map(minuscula1).join('; ')}.`;
    const geral = itens.find((i) => i.pauta === 0);
    if (geral) geral.relato = `${geral.relato.replace(/\s+$/, '')} ${txt}`;
    else itens.push({ pauta: 0, relato: txt });
  }
  const pendencias = [...extraida.pendencias, ...faltando.map((u) => `conferir anotação incorporada: ${resumida(u, 80)}`)];
  return { extraida: { ...extraida, itens, pendencias }, incorporadas: faltando };
}

const minuscula1 = (s: string) => (/^[A-ZÀ-Ý][a-zà-ÿ]/.test(s) && !/^[A-ZÀ-Ý][a-zà-ÿ]+\s+[A-ZÀ-Ý]/.test(s) ? s.charAt(0).toLocaleLowerCase('pt-BR') + s.slice(1) : s);
