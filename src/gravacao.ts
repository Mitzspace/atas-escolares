import { apagarSessaoGravacao, listarSessoesGravacao, pedacosDaSessao, type SessaoGravacao } from './db'

export type FormatoGravacao = { mimeType: string; ext: 'webm' | 'm4a' | 'ogg' }

/** em ordem de preferência: Chrome/Android/Firefox gravam webm/opus; Safari/iPhone, mp4/AAC */
const CANDIDATOS: FormatoGravacao[] = [
  { mimeType: 'audio/webm;codecs=opus', ext: 'webm' },
  { mimeType: 'audio/webm', ext: 'webm' },
  { mimeType: 'audio/mp4;codecs=mp4a.40.2', ext: 'm4a' },
  { mimeType: 'audio/mp4', ext: 'm4a' },
  { mimeType: 'audio/ogg;codecs=opus', ext: 'ogg' },
]

export const TIMESLICE_MS = 5000
/** voz: ~32 kbps deixa 1 h de reunião em cerca de 14 MB */
export const BITRATE_VOZ = 32_000

export function escolherFormato(suporta: (mimeType: string) => boolean): FormatoGravacao | null {
  return CANDIDATOS.find(c => suporta(c.mimeType)) ?? null
}

export function formatarTempo(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export function nomeDaGravacao(ext: string, agora = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `gravacao-${agora.getFullYear()}${p(agora.getMonth() + 1)}${p(agora.getDate())}-${p(agora.getHours())}${p(agora.getMinutes())}.${ext}`
}

/** os pedaços do timeslice só valem concatenados na ordem em que chegaram */
export function arquivoDosPedacos(pedacos: Blob[], formato: { mimeType: string; ext: string }, agora = new Date()): File {
  const tipo = formato.mimeType.split(';')[0]
  return new File(pedacos, nomeDaGravacao(formato.ext, agora), { type: tipo })
}

/** nível 0..1 a partir de amostras de forma de onda (0..255, silêncio em 128) */
export function nivelDoMicrofone(amostras: Uint8Array): number {
  if (!amostras.length) return 0
  let soma = 0
  for (const a of amostras) soma += ((a - 128) / 128) ** 2
  return Math.min(1, Math.sqrt(soma / amostras.length) * 3)
}

export type GravacaoRecuperavel = { sessao: SessaoGravacao; pedacos: number }

/** sessões que ficaram no aparelho (aba fechada, travou ou gravação ainda não usada) */
export async function gravacoesRecuperaveis(ignorar?: string): Promise<SessaoGravacao[]> {
  const out: SessaoGravacao[] = []
  for (const s of await listarSessoesGravacao()) {
    if (s.id === ignorar) continue
    if ((await pedacosDaSessao(s.id)).length === 0) await apagarSessaoGravacao(s.id)
    else out.push(s)
  }
  return out
}

export async function recuperarGravacao(sessao: SessaoGravacao): Promise<File> {
  return arquivoDosPedacos(await pedacosDaSessao(sessao.id), sessao, new Date(sessao.iniciadaEm))
}

export type ErroMicrofone = { codigo: 'seguranca' | 'sem-suporte' | 'permissao' | 'sem-microfone' | 'em-uso' | 'outro'; mensagem: string }

export function erroDeMicrofone(e: unknown): ErroMicrofone {
  const nome = (e as { name?: string })?.name ?? ''
  if (nome === 'NotAllowedError' || nome === 'SecurityError' || nome === 'PermissionDeniedError') {
    return {
      codigo: 'permissao',
      mensagem: 'O acesso ao microfone foi bloqueado. Toque no cadeado (ou no ícone de configurações) ao lado do endereço do site, ' +
        'permita o Microfone e tente de novo. No iPhone: Ajustes › Safari › Microfone. No Android: toque nos três pontinhos › Configurações › Configurações do site › Microfone.',
    }
  }
  if (nome === 'NotFoundError' || nome === 'DevicesNotFoundError' || nome === 'OverconstrainedError') {
    return { codigo: 'sem-microfone', mensagem: 'Nenhum microfone foi encontrado neste aparelho. Conecte um microfone ou envie um arquivo de áudio.' }
  }
  if (nome === 'NotReadableError' || nome === 'TrackStartError' || nome === 'AbortError') {
    return { codigo: 'em-uso', mensagem: 'Não foi possível usar o microfone: outro aplicativo pode estar usando. Feche-o e tente de novo.' }
  }
  return { codigo: 'outro', mensagem: `Não foi possível iniciar a gravação${nome ? ` (${nome})` : ''}. Tente de novo ou envie um arquivo de áudio.` }
}

/** verifica o que é preciso antes de pedir o microfone; null = pode gravar */
export function problemaDeSuporte(env: {
  isSecureContext: boolean; temGetUserMedia: boolean; temMediaRecorder: boolean; formato: FormatoGravacao | null
}): ErroMicrofone | null {
  if (!env.isSecureContext) {
    return {
      codigo: 'seguranca',
      mensagem: 'A gravação só funciona em uma página segura (endereço começando com https://). Abra o site pelo endereço https ou envie um arquivo de áudio.',
    }
  }
  if (!env.temGetUserMedia || !env.temMediaRecorder || !env.formato) {
    return { codigo: 'sem-suporte', mensagem: 'Este navegador não permite gravar áudio pelo site. Use o Chrome (Android/PC) ou o Safari atualizado (iPhone), ou envie um arquivo de áudio.' }
  }
  return null
}
