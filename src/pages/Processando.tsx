import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import AvisoModeloEconomico from '../components/AvisoModeloEconomico'
import { rodarGeracaoAta, rodarTranscricao } from '../pipeline'

export default function Processando() {
  const { id = '', etapa = 'transcricao' } = useParams()
  const nav = useNavigate()
  const [rotulo, setRotulo] = useState('Iniciando…')
  const [fracao, setFracao] = useState(0)
  const [modeloAtual, setModeloAtual] = useState<string | undefined>()
  const [erro, setErro] = useState('')
  const [tentativa, setTentativa] = useState(0)
  const rodando = useRef(false)

  useEffect(() => {
    if (rodando.current) return
    rodando.current = true
    setErro(''); setFracao(0); setModeloAtual(undefined)
    const onProgress = (r: string, f: number, modelo?: string) => { setRotulo(r); setFracao(f); setModeloAtual(modelo) }
    const tarefa = etapa === 'ata' ? rodarGeracaoAta(id, onProgress) : rodarTranscricao(id, onProgress)
    tarefa
      .then(() => nav(etapa === 'ata' ? `/ata/${id}/revisar` : `/ata/${id}/transcricao`, { replace: true }))
      .catch(e => setErro((e as Error).message))
      .finally(() => { rodando.current = false })
  }, [id, etapa, tentativa, nav])

  // mantém a tela acesa enquanto processa (se o navegador permitir)
  useEffect(() => {
    let lock: WakeLockSentinel | undefined
    navigator.wakeLock?.request('screen').then(l => { lock = l }).catch(() => {})
    return () => { lock?.release().catch(() => {}) }
  }, [])

  return (
    <div className="space-y-6 pt-4">
      <h1 className="text-xl font-semibold">{etapa === 'ata' ? 'Redigindo a ata' : 'Transcrevendo o áudio'}</h1>
      {erro ? (
        <>
          <div role="alert" className="card border-red-300 bg-red-50 text-red-800">{erro}</div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <button className="btn-primary flex-1" onClick={() => setTentativa(t => t + 1)}>Tentar de novo</button>
            <Link to="/config" className="btn-secondary flex-1">Configurações</Link>
          </div>
          <Link to="/" className="btn-secondary w-full">Voltar ao início</Link>
        </>
      ) : (
        <div className="card space-y-5" aria-live="polite">
          <div className="flex items-center justify-between gap-3"><p className="font-semibold text-ink">{rotulo}</p><span className="text-slate-600">{Math.round(fracao * 100)}%</span></div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-slate-200" aria-label="Progresso do processamento" role="progressbar" aria-valuenow={Math.round(fracao * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-blue-900 transition-all duration-500" style={{ width: `${Math.max(4, fracao * 100)}%` }} />
          </div>
          {etapa === 'ata' && <AvisoModeloEconomico modelo={modeloAtual} />}
          <p className="text-sm text-slate-600">
            Isso pode levar alguns minutos, conforme o tamanho do registro. Mantenha esta tela aberta.
          </p>
        </div>
      )}
    </div>
  )
}
