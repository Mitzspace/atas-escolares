import { useCallback, useEffect, useRef, useState } from 'react'
import { apagarSessaoGravacao, iniciarSessaoGravacao, salvarPedacoGravacao, type SessaoGravacao } from '../db'
import { EXTENSOES_AUDIO } from '../gemini'
import {
  arquivoDosPedacos, BITRATE_VOZ, erroDeMicrofone, escolherFormato, formatarTempo, gravacoesRecuperaveis,
  nivelDoMicrofone, problemaDeSuporte, recuperarGravacao, TIMESLICE_MS, type FormatoGravacao,
} from '../gravacao'

type Fase = 'ocioso' | 'gravando' | 'pausado' | 'pronto'
type Modo = 'gravar' | 'arquivo'

const AVISO_TELA =
  'Mantenha a tela ligada e o site aberto; no celular, a gravação pode parar se a tela apagar ou se trocar de app.'

type Props = {
  arquivo: File | null
  /** `sessaoId` vem preenchido quando o arquivo é uma gravação feita aqui (para apagar os pedaços depois de usar) */
  onChange: (arquivo: File | null, sessaoId?: string) => void
}

export default function Gravador({ arquivo, onChange }: Props) {
  const [modo, setModo] = useState<Modo>('gravar')
  const [fase, setFase] = useState<Fase>('ocioso')
  const [ms, setMs] = useState(0)
  const [nivel, setNivel] = useState(0)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [url, setUrl] = useState('')
  const [recuperaveis, setRecuperaveis] = useState<SessaoGravacao[]>([])

  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const audioCtx = useRef<AudioContext | null>(null)
  const raf = useRef(0)
  const timer = useRef(0)
  const chunks = useRef<Blob[]>([])
  const seq = useRef(0)
  const sessaoId = useRef('')
  const formato = useRef<FormatoGravacao | null>(null)
  const acumulado = useRef(0)
  const inicioSeg = useRef<number | null>(null)
  const pedidoParar = useRef(false)
  const wakeLock = useRef<WakeLockSentinel | null>(null)
  const ocultoDesde = useRef<number | null>(null)
  const faseRef = useRef<Fase>('ocioso')
  faseRef.current = fase
  const emAndamento = fase === 'gravando' || fase === 'pausado'

  const tempoAtual = () => acumulado.current + (inicioSeg.current ? Date.now() - inicioSeg.current : 0)

  const liberarRecursos = useCallback(() => {
    cancelAnimationFrame(raf.current)
    clearInterval(timer.current)
    stream.current?.getTracks().forEach(t => { t.onended = null; t.stop() })
    stream.current = null
    audioCtx.current?.close().catch(() => {})
    audioCtx.current = null
    wakeLock.current?.release().catch(() => {})
    wakeLock.current = null
    setNivel(0)
  }, [])

  // gravações que ficaram no aparelho (aba fechada, travou, ou gravação pronta que não chegou a ser usada)
  useEffect(() => {
    gravacoesRecuperaveis().then(setRecuperaveis).catch(() => {})
  }, [])

  // ao sair da tela no meio da gravação, libera o microfone; os pedaços já salvos continuam recuperáveis
  useEffect(() => () => {
    if (recorder.current) { recorder.current.onstop = null; recorder.current.ondataavailable = null }
    if (recorder.current?.state && recorder.current.state !== 'inactive') recorder.current.stop()
    liberarRecursos()
  }, [liberarRecursos])

  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])

  // avisa antes de fechar a aba com gravação em andamento
  useEffect(() => {
    if (!emAndamento) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [emAndamento])

  // tela acesa e detecção de página oculta
  useEffect(() => {
    if (!emAndamento) return
    const pedirLock = () => navigator.wakeLock?.request('screen').then(l => { wakeLock.current = l }).catch(() => {})
    const h = () => {
      if (document.hidden) { ocultoDesde.current = Date.now(); return }
      pedirLock()
      if (ocultoDesde.current) {
        const seg = Math.round((Date.now() - ocultoDesde.current) / 1000)
        ocultoDesde.current = null
        const parou = recorder.current?.state === 'inactive' || stream.current?.getTracks().some(t => t.readyState !== 'live')
        setAviso(parou
          ? `Você saiu do site por ${seg} s e a gravação foi interrompida pelo aparelho. O que foi gravado até aqui está guardado.`
          : `Você saiu do site ou a tela apagou por ${seg} s. Confira se o cronômetro continua andando; se estiver parado, a gravação não está captando.`)
      }
    }
    document.addEventListener('visibilitychange', h)
    return () => document.removeEventListener('visibilitychange', h)
  }, [emAndamento])

  function montarPlayer(file: File) {
    setUrl(URL.createObjectURL(file))
  }

  function finalizar() {
    const f = formato.current!
    acumulado.current = tempoAtual()
    liberarRecursos()
    inicioSeg.current = null
    const file = arquivoDosPedacos(chunks.current, f)
    if (!pedidoParar.current) setAviso('A gravação foi interrompida pelo aparelho. O que foi gravado até aqui está guardado; ouça abaixo e use se estiver completo.')
    setMs(acumulado.current)
    montarPlayer(file)
    setFase('pronto')
    onChange(file, sessaoId.current)
  }

  async function iniciar() {
    setErro(''); setAviso('')
    const fmt = typeof MediaRecorder !== 'undefined' ? escolherFormato(t => MediaRecorder.isTypeSupported(t)) : null
    const problema = problemaDeSuporte({
      isSecureContext: window.isSecureContext,
      temGetUserMedia: !!navigator.mediaDevices?.getUserMedia,
      temMediaRecorder: typeof MediaRecorder !== 'undefined',
      formato: fmt,
    })
    if (problema) return setErro(problema.mensagem)
    let s: MediaStream
    try {
      s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
    } catch (e) {
      return setErro(erroDeMicrofone(e).mensagem)
    }
    let r: MediaRecorder
    try {
      try { r = new MediaRecorder(s, { mimeType: fmt!.mimeType, audioBitsPerSecond: BITRATE_VOZ }) }
      catch { r = new MediaRecorder(s, { mimeType: fmt!.mimeType }) }
    } catch (e) {
      s.getTracks().forEach(t => t.stop())
      return setErro(erroDeMicrofone(e).mensagem)
    }

    formato.current = fmt
    stream.current = s
    recorder.current = r
    chunks.current = []
    seq.current = 0
    acumulado.current = 0
    pedidoParar.current = false
    sessaoId.current = crypto.randomUUID()
    onChange(null)
    if (url) { URL.revokeObjectURL(url); setUrl('') }
    await iniciarSessaoGravacao({ id: sessaoId.current, mimeType: fmt!.mimeType, ext: fmt!.ext, iniciadaEm: Date.now(), duracaoMs: 0 }).catch(() => {})

    r.ondataavailable = e => {
      if (!e.data.size) return
      chunks.current.push(e.data)
      salvarPedacoGravacao(sessaoId.current, seq.current++, e.data, tempoAtual())
        .catch(() => setAviso('Não foi possível guardar a gravação no aparelho (espaço cheio?). Ela continua, mas não poderá ser recuperada se a página fechar.'))
    }
    r.onstop = finalizar
    r.onerror = () => { setErro('A gravação falhou. O que foi gravado até aqui está guardado.'); pararGravacao() }
    s.getAudioTracks().forEach(t => { t.onended = () => { setAviso('O microfone foi interrompido (desconectado ou tomado por outro app).'); pararGravacao() } })

    try {
      const ctx = new AudioContext()
      audioCtx.current = ctx
      const an = ctx.createAnalyser()
      an.fftSize = 1024
      ctx.createMediaStreamSource(s).connect(an)
      const buf = new Uint8Array(an.fftSize)
      let ultimo = 0
      const loop = (t: number) => {
        if (t - ultimo > 70) { an.getByteTimeDomainData(buf); setNivel(nivelDoMicrofone(buf)); ultimo = t }
        raf.current = requestAnimationFrame(loop)
      }
      raf.current = requestAnimationFrame(loop)
    } catch { /* o medidor é só um conforto */ }

    navigator.wakeLock?.request('screen').then(l => { wakeLock.current = l }).catch(() => {})
    inicioSeg.current = Date.now()
    timer.current = window.setInterval(() => setMs(tempoAtual()), 250)
    r.start(TIMESLICE_MS)
    setMs(0)
    setFase('gravando')
  }

  function pausar() {
    recorder.current?.pause()
    acumulado.current = tempoAtual()
    inicioSeg.current = null
    setFase('pausado')
  }
  function retomar() {
    recorder.current?.resume()
    inicioSeg.current = Date.now()
    setFase('gravando')
  }
  function pararGravacao() {
    if (faseRef.current === 'pronto' || faseRef.current === 'ocioso') return
    pedidoParar.current = true
    acumulado.current = tempoAtual()
    inicioSeg.current = null
    if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop()
    else finalizar()
  }

  async function descartar() {
    if (!confirm('Descartar esta gravação e gravar de novo? O que foi gravado será apagado.')) return
    if (sessaoId.current) await apagarSessaoGravacao(sessaoId.current).catch(() => {})
    sessaoId.current = ''
    chunks.current = []
    if (url) setUrl('')
    setAviso(''); setMs(0)
    setFase('ocioso')
    onChange(null)
  }

  async function usarRecuperada(s: SessaoGravacao) {
    const file = await recuperarGravacao(s)
    sessaoId.current = s.id
    formato.current = { mimeType: s.mimeType, ext: s.ext as FormatoGravacao['ext'] }
    setRecuperaveis(r => r.filter(x => x.id !== s.id))
    acumulado.current = s.duracaoMs
    setMs(s.duracaoMs)
    montarPlayer(file)
    setFase('pronto')
    onChange(file, s.id)
  }
  async function descartarRecuperada(s: SessaoGravacao) {
    if (!confirm(`Descartar a gravação interrompida (${formatarTempo(s.duracaoMs)})? Isso não pode ser desfeito.`)) return
    await apagarSessaoGravacao(s.id)
    setRecuperaveis(r => r.filter(x => x.id !== s.id))
  }

  async function escolherArquivo(f: File | null) {
    if (f && sessaoId.current) {
      await apagarSessaoGravacao(sessaoId.current).catch(() => {})
      sessaoId.current = ''
      setUrl(''); setFase('ocioso'); setMs(0)
    }
    onChange(f)
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-2 rounded-2xl border border-rule bg-slate-50 p-2 sm:grid-cols-2" role="group" aria-label="Como enviar o áudio">
        {([['gravar', 'Gravar agora'], ['arquivo', 'Enviar arquivo']] as const).map(([m, rot]) => (
          <button
            key={m} type="button" aria-pressed={modo === m} disabled={emAndamento}
            onClick={() => setModo(m)}
            className={modo === m ? 'btn-primary' : 'btn-secondary'}
          ><svg aria-hidden="true" className="shrink-0" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{m === 'gravar' ? <><rect x="9" y="2" width="6" height="13" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" /></> : <path d="M3 6h7l2 3h9v12H3zM3 6V3h7l2 3h9v3" />}</svg>{rot}</button>
        ))}
      </div>

      {modo === 'arquivo' && (
        <div className="space-y-2">
          <input
            type="file"
            accept={EXTENSOES_AUDIO.map(x => `.${x}`).join(',') + ',audio/*'}
            onChange={e => escolherArquivo(e.target.files?.[0] ?? null)}
            aria-label="Arquivo de áudio da reunião"
            className="field file:mr-3 file:min-h-11 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:text-blue-900"
          />
          <p className="text-sm text-slate-600">
            mp3, m4a, wav, ogg, webm ou aac.
            {arquivo && <> Selecionado: <b>{arquivo.name}</b> ({(arquivo.size / 1024 / 1024).toFixed(1)} MB).</>}
          </p>
          {fase === 'pronto' && <p className="text-sm text-amber-800">Há uma gravação pronta; escolher um arquivo vai substituí-la.</p>}
        </div>
      )}

      {modo === 'gravar' && (
        <div className="space-y-4">
          {recuperaveis.length > 0 && fase === 'ocioso' && recuperaveis.map(s => (
            <div key={s.id} className="rounded-2xl border border-amber-300 border-l-4 bg-amber-50 p-4 text-amber-900" role="status">
              <p className="font-semibold">Encontramos uma gravação interrompida</p>
              <p className="text-sm">Iniciada em {new Date(s.iniciadaEm).toLocaleString('pt-BR')}.</p>
              <div className="mt-4 grid gap-3">
                <button type="button" className="btn-primary" onClick={() => usarRecuperada(s)}>Recuperar gravação interrompida ({formatarTempo(s.duracaoMs)})</button>
                <button type="button" className="btn-danger" onClick={() => descartarRecuperada(s)}>Descartar</button>
              </div>
            </div>
          ))}

          {fase !== 'pronto' && (
            <p className="rounded-xl border border-rule bg-slate-50 p-4 text-base text-slate-700">{AVISO_TELA}</p>
          )}

          <div className={`recorder-clock ${fase === 'gravando' ? 'border-red-200 bg-red-50/50' : 'border-rule bg-slate-50'}`}>
            <div className="recorder-time" aria-live="off" aria-label={`Tempo gravado ${formatarTempo(ms)}`}>{formatarTempo(ms)}</div>
            <p className="mt-1 text-sm text-slate-600" aria-live="polite">
              {fase === 'gravando' && <><span className="recording-dot" aria-hidden="true" /><span className="font-semibold text-red-800">Gravando</span></>}
              {fase === 'pausado' && 'Pausado'}
              {fase === 'pronto' && 'Gravação pronta'}
              {fase === 'ocioso' && 'Pronto para gravar'}
            </p>
          </div>

          {emAndamento && (
            <div>
              <div className="h-4 w-full overflow-hidden rounded-full border border-slate-300 bg-slate-100" role="meter" aria-label="Nível do microfone" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(nivel * 100)}>
                <div className="h-full bg-emerald-700 transition-[width] duration-75" style={{ width: `${Math.max(2, nivel * 100)}%` }} />
              </div>
              <p className="mt-1 text-xs text-slate-600">{fase === 'pausado' ? 'Gravação pausada.' : nivel < 0.03 ? 'Não estou ouvindo nada. Fale ou aproxime o aparelho.' : 'O microfone está captando.'}</p>
            </div>
          )}

          {fase === 'ocioso' && <button type="button" className="btn-primary min-h-16 w-full" onClick={iniciar}>● Gravar</button>}
          {emAndamento && (
            <div className="grid grid-cols-2 gap-2">
              {fase === 'gravando'
                ? <button type="button" className="btn-secondary min-h-16" onClick={pausar}>⏸ Pausar</button>
                : <button type="button" className="btn-primary min-h-16" onClick={retomar}>▶ Retomar</button>}
              <button type="button" className="btn-danger min-h-16" onClick={pararGravacao}>■ Parar</button>
            </div>
          )}

          {fase === 'pronto' && url && (
            <div className="space-y-4 rounded-2xl border border-emerald-300 bg-emerald-50/50 p-4">
              <audio controls src={url} aria-label="Ouvir gravação da reunião" className="min-h-12 w-full" />
              <p className="text-sm text-slate-600">Ouça para conferir. {arquivo && <>Arquivo: <b>{arquivo.name}</b> ({(arquivo.size / 1024 / 1024).toFixed(1)} MB). </>}Ela será usada ao tocar em “Transcrever o áudio”.</p>
              <button type="button" className="btn-secondary w-full" onClick={descartar}>Descartar e gravar de novo</button>
            </div>
          )}
        </div>
      )}

      {aviso && <div role="status" className="rounded-xl border border-amber-300 border-l-4 bg-amber-50 p-4 text-base text-amber-900">{aviso}</div>}
      {erro && <div role="alert" className="rounded-xl border border-red-300 border-l-4 bg-red-50 p-4 text-base text-red-800">{erro}</div>}
    </div>
  )
}
