import { ataResponseSchema, buildAtaPrompt, regrasDoModo, modoDe, type Anotacao, type AtaExtraida, type MeetingMetadata, type TranscriptSegment } from './ata-api'
import { blocosTranscricao, conferirCotaDiaria, consolidarParciais, estimarTokens, executarNaJanela, LIMITE_ENTRADA_GROQ } from './groq-limites'
import { dividirAudio, deslocarTempos } from './audio-partes'
import type { Progresso } from './gemini'
import { ErroProvedor, MODELOS_GROQ, MODELOS_TRANSCRICAO_GROQ } from './types'

// Conferido em 25/10/2026: console.groq.com/docs/{speech-to-text,structured-outputs,models,rate-limits}.
// Free: áudio de até 25 MB; Whisper: 20 RPM, 2 mil RPD, 7.200 ASH, 28.800 ASD.
// GPT-OSS/Qwen: 30 RPM, mil RPD, 8 mil TPM, 200 mil TPD (limites efetivos: console da organização).
export const LIMITE_AUDIO_GROQ_BYTES = 25_000_000
const API = 'https://api.groq.com/openai/v1'
class CotaGroq extends ErroProvedor {
  constructor(public diaria: boolean) { super('cota', diaria ? 'A cota diária do Groq foi esgotada. Use a reserva Gemini ou aguarde a renovação.' : 'O Groq atingiu o limite temporário de tokens ou requisições.') }
}

const formatos = new Set(['flac', 'mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'ogg', 'wav', 'webm'])

async function requisitar(path: string, apiKey: string, init: RequestInit = {}): Promise<unknown> {
  if (!apiKey.trim()) throw new ErroProvedor('chave', 'Cole a chave do Groq em Configurações.')
  const controle = new AbortController()
  const timeout = setTimeout(() => controle.abort(), 180_000)
  try {
    const resposta = await fetch(`${API}/${path}`, {
      ...init, signal: controle.signal,
      headers: { ...init.headers, Authorization: `Bearer ${apiKey.trim()}` },
    })
    if (!resposta.ok) {
      if (resposta.status === 401 || resposta.status === 403) throw new ErroProvedor('chave', 'A chave do Groq foi recusada. Confira a chave e as permissões em Configurações.')
      if (resposta.status === 429) {
        const detalhe = await resposta.text().catch(() => '')
        throw new CotaGroq(/TPD|per.?day|daily|di[aá]ri/i.test(detalhe))
      }
      if (resposta.status >= 500) throw new ErroProvedor('sobrecarga', 'O Groq está indisponível ou sobrecarregado no momento.')
      if (resposta.status === 413) throw new ErroProvedor('conteudo', 'O Groq aceita áudios de até 25 MB no plano gratuito. Grave e envie a reunião em partes menores.')
      throw new ErroProvedor('conteudo', `O Groq recusou o pedido (HTTP ${resposta.status}). Confira o modelo e o formato do arquivo em Configurações.`)
    }
    try { return await resposta.json() } catch (e) {
      if (e instanceof SyntaxError) throw new ErroProvedor('conteudo', 'O Groq devolveu uma resposta fora do formato JSON esperado.')
      throw e // conexão interrompida durante a leitura também permite tentar a reserva
    }
  } catch (e) {
    if (e instanceof ErroProvedor) throw e
    throw new ErroProvedor('rede', 'Não foi possível conectar ao Groq ou a resposta demorou demais. Confira a conexão e tente novamente.')
  } finally { clearTimeout(timeout) }
}

type Objeto = Record<string, unknown>
const objeto = (v: unknown): v is Objeto => !!v && typeof v === 'object' && !Array.isArray(v)
const mmss = (segundos: number) => `${String(Math.floor(segundos / 60)).padStart(2, '0')}:${String(Math.floor(segundos % 60)).padStart(2, '0')}`

export function parseTranscricaoGroq(resposta: unknown): TranscriptSegment[] {
  if (!objeto(resposta) || !Array.isArray(resposta.segments)) throw new ErroProvedor('conteudo', 'O Groq não devolveu os segmentos e tempos do áudio. Tente novamente.')
  const segmentos: TranscriptSegment[] = []
  for (const parte of resposta.segments) {
    if (!objeto(parte) || typeof parte.text !== 'string' || typeof parte.start !== 'number' || typeof parte.end !== 'number' ||
      !Number.isFinite(parte.start) || !Number.isFinite(parte.end) || parte.start < 0 || parte.end < parte.start) {
      throw new ErroProvedor('conteudo', 'O Groq devolveu um segmento de áudio inválido.')
    }
    if (parte.text.trim()) segmentos.push({ speaker: 'Falante', start: mmss(parte.start), end: mmss(parte.end), text: parte.text.trim() })
  }
  if (!segmentos.length) throw new ErroProvedor('conteudo', 'O Groq não identificou fala neste áudio. Confira o arquivo e tente novamente.')
  return segmentos
}

export async function transcreverGroq(opts: { apiKey: string; modelo: string; file: File; onProgress?: Progresso }): Promise<{ transcript: TranscriptSegment[]; modeloUsado: string }> {
  if (opts.file.size > LIMITE_AUDIO_GROQ_BYTES) {
    opts.onProgress?.('Preparando o áudio em partes de dez minutos…', 0.1, opts.modelo, 'groq')
    const transcript: TranscriptSegment[] = []
    let indice = 0
    for await (const parte of dividirAudio(opts.file)) {
      indice++
      opts.onProgress?.(`Transcrevendo parte ${indice} de ${parte.total} com Whisper…`, 0.2 + 0.7 * (indice - 1) / parte.total, opts.modelo, 'groq')
      const resultado = await transcreverGroq({ ...opts, file: parte.arquivo, onProgress: undefined })
      transcript.push(...deslocarTempos(resultado.transcript, parte.inicio))
    }
    return { transcript, modeloUsado: opts.modelo }
  }
  if (!formatos.has(opts.file.name.split('.').pop()?.toLowerCase() ?? '')) throw new ErroProvedor('conteudo', 'Formato não aceito pelo Groq. Use mp3, m4a, wav, webm, ogg, flac, mp4, mpeg ou mpga.')
  if (!MODELOS_TRANSCRICAO_GROQ.some(m => m.id === opts.modelo)) throw new ErroProvedor('conteudo', 'Escolha um modelo Whisper disponível em Configurações.')
  const form = new FormData()
  form.append('file', opts.file, opts.file.name)
  form.append('model', opts.modelo)
  form.append('language', 'pt')
  form.append('response_format', 'verbose_json')
  form.append('timestamp_granularities[]', 'segment')
  form.append('temperature', '0')
  opts.onProgress?.(`Transcrevendo com Groq · ${opts.modelo}…`, 0.2, opts.modelo, 'groq')
  const transcript = parseTranscricaoGroq(await requisitar('audio/transcriptions', opts.apiKey, { method: 'POST', body: form }))
  return { transcript, modeloUsado: opts.modelo }
}

// Adapta OpenAPI do Gemini para JSON Schema estrito do Groq; opcionais viram união com null.
type Schema = { type: string; properties?: Record<string, Schema>; items?: Schema; required?: string[]; description?: string }
function converterSchema(schema: Schema, opcional = false): Objeto {
  const tipo = schema.type.toLowerCase()
  const resultado: Objeto = { type: opcional ? [tipo, 'null'] : tipo }
  // As instruções ficam no prompt; schema sem descrições evita gastar TPM duplicando-as.
  if (schema.properties) {
    resultado.properties = Object.fromEntries(Object.entries(schema.properties).map(([chave, filho]) => [chave, converterSchema(filho, !schema.required?.includes(chave))]))
    resultado.required = Object.keys(schema.properties)
    resultado.additionalProperties = false
  }
  if (schema.items) resultado.items = converterSchema(schema.items)
  return resultado
}
export const schemaAtaGroq = converterSchema(ataResponseSchema as Schema)

function validarNo(valor: unknown, schema: Schema, opcional = false): unknown {
  if ((valor === null || valor === undefined) && opcional) return undefined
  const invalido = () => { throw new ErroProvedor('conteudo', 'A resposta do Groq não corresponde ao formato da ata. Tente novamente.') }
  switch (schema.type) {
    case 'OBJECT': {
      if (!objeto(valor)) return invalido()
      const campos = schema.properties ?? {}
      if (Object.keys(valor).some(chave => !Object.hasOwn(campos, chave))) return invalido()
      const resultado: Objeto = {}
      for (const [chave, filho] of Object.entries(campos)) {
        const validado = validarNo(valor[chave], filho, !schema.required?.includes(chave))
        if (validado !== undefined) resultado[chave] = validado
      }
      return resultado
    }
    case 'ARRAY': return Array.isArray(valor) ? valor.map(item => validarNo(item, schema.items!)) : invalido()
    case 'STRING': return typeof valor === 'string' ? valor : invalido()
    case 'INTEGER': return typeof valor === 'number' && Number.isSafeInteger(valor) ? valor : invalido()
    case 'BOOLEAN': return typeof valor === 'boolean' ? valor : invalido()
    default: return invalido()
  }
}
export function validarAtaGroq(valor: unknown): AtaExtraida { return validarNo(valor, ataResponseSchema as Schema) as AtaExtraida }

type OpcoesRedacaoGroq = { apiKey: string; modelo: string; meta: MeetingMetadata; transcript: TranscriptSegment[]; anotacoes?: Anotacao[]; onProgress?: Progresso }
const regrasParciais = `Extraia AtaExtraida parcial de uma reunião escolar, em português formal e terceira pessoa, sem abertura nem encerramento. Registre SOMENTE fatos destes trechos; não complete a reunião pela pauta/cadastro. Preserve todos os fatos relevantes: números, datas, votos, mais de quinze faltas, argumentos contrários (inclusive pais/professores trabalhando sábado), perguntas e respostas. Respeite o speaker informado por trecho. Rótulos genéricos como "Falante" não identificam uma pessoa, nem herdam autoria automaticamente; nunca adivinhe quem falou. Eu vou mandar é compromisso do speaker identificado, nunca do cargo presumido. Texto corrompido não vira sujeito fictício. Pergunta fora da pauta e será verificada fica em item de pauta 0, não cria tarefa. Não infira consenso; vincule votos àquela decisão. Use os índices originais da pauta. Só extraia tarefas efetivamente assumidas e dados de responsável/prazo ditos. Sem fato, arrays vazios; incerteza vira [confirmar: descrição]. Alunos não orientados: use iniciais quando anonimização estiver ativa. Preserve nomes de eventos e todos os dados relevantes. Use null para campos opcionais sem informação, sem inventar.`
function pedidoRedacao(opts: OpcoesRedacaoGroq, parcial = false) {
  const { systemInstruction, userPrompt } = buildAtaPrompt(opts.meta, opts.transcript, opts.anotacoes)
  const regrasModo = regrasDoModo(modoDe(opts.transcript, opts.anotacoes))
  return {
    model: opts.modelo, temperature: 0.2, max_completion_tokens: 3072,
    ...(opts.modelo.startsWith('openai/gpt-oss-') ? { reasoning_effort: 'low' } : {}),
    messages: [
      { role: 'system', content: parcial ? `${regrasParciais}${regrasModo ? `\n\n${regrasModo}` : ''}` : `${systemInstruction}\n\nResponda em português do Brasil. Na saída estruturada, use null para campos opcionais sem informação; null equivale a omitir o campo. Listas de fatos não registrados ficam vazias. Não invente para preencher campos do schema.` },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'ata_escolar', strict: true, schema: schemaAtaGroq } },
  }
}
function lerAtaResposta(resposta: unknown): AtaExtraida {
  const escolha = objeto(resposta) && Array.isArray(resposta.choices) ? resposta.choices[0] : undefined
  if (!objeto(escolha) || escolha.finish_reason === 'length') throw new ErroProvedor('conteudo', 'O Groq não concluiu a resposta da ata ou ela foi cortada. Reduza a transcrição e tente novamente.')
  const mensagem = escolha.message
  if (!objeto(mensagem) || mensagem.refusal || typeof mensagem.content !== 'string' || !mensagem.content.trim()) throw new ErroProvedor('conteudo', 'O Groq não devolveu o texto da ata ou recusou o conteúdo.')
  let json: unknown
  try { json = JSON.parse(mensagem.content) } catch { throw new ErroProvedor('conteudo', 'O Groq devolveu uma ata fora do formato JSON esperado.') }
  return validarAtaGroq(json)
}
export async function redigirGroq(opts: OpcoesRedacaoGroq) {
  if (!MODELOS_GROQ.some(m => m.id === opts.modelo)) throw new ErroProvedor('conteudo', 'Escolha um modelo de redação Groq disponível em Configurações.')
  const completo = pedidoRedacao(opts)
  const longo = estimarTokens(completo) > LIMITE_ENTRADA_GROQ
  const base = pedidoRedacao({ ...opts, transcript: [] }, true)
  const blocos = longo ? blocosTranscricao(opts.transcript, Math.min(4000, LIMITE_ENTRADA_GROQ - estimarTokens(base) - 128)) : [opts.transcript]
  const pedidos = blocos.map(transcript => pedidoRedacao({ ...opts, transcript }, longo))
  for (const pedido of pedidos) {
    const entrada = estimarTokens(pedido)
    if (entrada > LIMITE_ENTRADA_GROQ) throw new ErroProvedor('cota', 'A entrada não cabe no limite de tokens do Groq. Use a reserva Gemini ou reduza o cadastro e a pauta.')
    pedido.max_completion_tokens = Math.min(3072, 7900 - entrada)
  }
  conferirCotaDiaria(opts.apiKey, opts.modelo, pedidos.reduce((s, p) => s + estimarTokens(p) + p.max_completion_tokens, 0))
  const parciais: AtaExtraida[] = []
  for (let i = 0; i < pedidos.length; i++) {
    const pedido = pedidos[i]
    const legenda = `parte ${i + 1} de ${pedidos.length}`
    const progresso = 0.2 + 0.7 * i / pedidos.length
    const aguardando = () => opts.onProgress?.(`${legenda}, aguardando limite do Groq…`, progresso, opts.modelo, 'groq')
    let resposta: unknown
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      try {
        resposta = await executarNaJanela(opts.apiKey, opts.modelo, estimarTokens(pedido) + pedido.max_completion_tokens, () => {
          opts.onProgress?.(`Redigindo com Groq · ${opts.modelo} · ${legenda}…`, progresso, opts.modelo, 'groq')
          return requisitar('chat/completions', opts.apiKey, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pedido) })
        }, aguardando)
        break
      } catch (e) {
        if (!(e instanceof CotaGroq) || e.diaria || tentativa === 1) throw e
        aguardando()
      }
    }
    parciais.push(lerAtaResposta(resposta))
  }
  opts.onProgress?.('Consolidando os relatos sem duplicar decisões e encaminhamentos…', 0.95, opts.modelo, 'groq')
  return { extraida: parciais.length === 1 ? parciais[0] : consolidarParciais(parciais), modeloUsado: opts.modelo }
}

/** Chamada genérica de texto -> JSON estruturado, validada contra `schema`. A entrada precisa caber no limite do Groq (o chamador divide). */
export async function gerarJsonGroq<T>(opts: {
  apiKey: string; modelo: string; systemInstruction: string; userPrompt: string; schema: object; nome: string; etapa: string; onProgress?: Progresso
}): Promise<{ dados: T; modeloUsado: string }> {
  if (!MODELOS_GROQ.some(m => m.id === opts.modelo)) throw new ErroProvedor('conteudo', 'Escolha um modelo de redação Groq disponível em Configurações.')
  const pedido = {
    model: opts.modelo, temperature: 0.1, max_completion_tokens: 2048,
    ...(opts.modelo.startsWith('openai/gpt-oss-') ? { reasoning_effort: 'low' } : {}),
    messages: [
      { role: 'system', content: `${opts.systemInstruction}\n\nResponda em português do Brasil, só com o JSON do schema.` },
      { role: 'user', content: opts.userPrompt },
    ],
    response_format: { type: 'json_schema', json_schema: { name: opts.nome, strict: true, schema: converterSchema(opts.schema as Schema) } },
  }
  const entrada = estimarTokens(pedido)
  if (entrada > LIMITE_ENTRADA_GROQ) throw new ErroProvedor('cota', 'A entrada não cabe no limite de tokens do Groq.')
  pedido.max_completion_tokens = Math.min(2048, 7900 - entrada)
  const estimativa = entrada + pedido.max_completion_tokens
  conferirCotaDiaria(opts.apiKey, opts.modelo, estimativa)
  const aguardando = () => opts.onProgress?.(`${opts.etapa}, aguardando limite do Groq…`, 0.5, opts.modelo, 'groq')
  let resposta: unknown
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      resposta = await executarNaJanela(opts.apiKey, opts.modelo, estimativa, () => {
        opts.onProgress?.(`${opts.etapa} · ${opts.modelo}…`, 0.5, opts.modelo, 'groq')
        return requisitar('chat/completions', opts.apiKey, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pedido) })
      }, aguardando)
      break
    } catch (e) {
      if (!(e instanceof CotaGroq) || e.diaria || tentativa === 1) throw e
      aguardando()
    }
  }
  const escolha = objeto(resposta) && Array.isArray(resposta.choices) ? resposta.choices[0] : undefined
  const mensagem = objeto(escolha) ? escolha.message : undefined
  if (!objeto(escolha) || escolha.finish_reason === 'length' || !objeto(mensagem) || typeof mensagem.content !== 'string' || !mensagem.content.trim()) {
    throw new ErroProvedor('conteudo', 'O Groq não concluiu a resposta ou ela foi cortada.')
  }
  let json: unknown
  try { json = JSON.parse(mensagem.content) } catch { throw new ErroProvedor('conteudo', 'O Groq devolveu uma resposta fora do formato JSON esperado.') }
  return { dados: validarNo(json, opts.schema as Schema) as T, modeloUsado: opts.modelo }
}

/** Consulta somente o catálogo: não envia áudio nem gera texto para testar a chave. */
export async function testarChaveGroq(apiKey: string): Promise<void> { await requisitar('models', apiKey) }
