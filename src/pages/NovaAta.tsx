import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { MeetingMetadata, Pessoa } from '../ata-api'
import { getSettings, novoId, proximoNumero, saveAta, saveAudio } from '../db'
import { EXTENSOES_AUDIO, mimeDoAudio } from '../gemini'
import type { Settings } from '../types'

type Part = Pessoa & { presente: boolean }
const hoje = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const TAMANHO_MAX_MB = 200

export default function NovaAta() {
  const nav = useNavigate()
  const [cfg, setCfg] = useState<Settings | null>(null)
  const [escola, setEscola] = useState('')
  const [rede, setRede] = useState('')
  const [municipioUf, setMunicipioUf] = useState('')
  const [ordinaria, setOrdinaria] = useState(true)
  const [numero, setNumero] = useState(1)
  const [data, setData] = useState(hoje())
  const [horaInicio, setHoraInicio] = useState('')
  const [horaFim, setHoraFim] = useState('')
  const [local, setLocal] = useState('')
  const [presidente, setPresidente] = useState<Pessoa>({ nome: '', cargo: '' })
  const [secretario, setSecretario] = useState<Pessoa>({ nome: '', cargo: '' })
  const [parts, setParts] = useState<Part[]>([])
  const [pauta, setPauta] = useState<string[]>([''])
  const [anonimizar, setAnonimizar] = useState(true)
  const [glossario, setGlossario] = useState('')
  const [audio, setAudio] = useState<File | null>(null)
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    getSettings().then(async s => {
      setCfg(s)
      setEscola(s.escola); setRede(s.rede); setMunicipioUf(s.municipioUf); setLocal(s.local)
      setPresidente(s.presidente); setSecretario(s.secretario); setGlossario(s.glossario)
      setParts(s.pessoas.map(p => ({ ...p, presente: true })))
      setNumero(await proximoNumero(new Date().getFullYear()))
    })
  }, [])

  const upParte = (i: number, patch: Partial<Part>) => setParts(ps => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)))

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    if (!audio) return setErro('Escolha o arquivo de áudio da reunião.')
    try { mimeDoAudio(audio) } catch (x) { return setErro((x as Error).message) }
    if (audio.size > TAMANHO_MAX_MB * 1024 * 1024) return setErro(`O arquivo tem mais de ${TAMANHO_MAX_MB} MB. Envie um áudio menor (ou em mp3/m4a).`)
    if (!escola.trim()) return setErro('Informe o nome da escola.')
    if (!presidente.nome.trim() || !secretario.nome.trim()) return setErro('Informe quem presidiu a reunião e quem secretariou (lavrou a ata).')
    if (!horaInicio) return setErro('Informe a hora de início.')
    const presentes = parts.filter(p => p.nome.trim())
    const meta: MeetingMetadata = {
      escola: escola.trim(), rede: rede.trim(), municipioUf: municipioUf.trim(), tipo: 'pedagogica', ordinaria,
      numero, ano: Number(data.slice(0, 4)), data, horaInicio, horaFim: horaFim || undefined, local: local.trim(),
      presidente, secretario,
      participantes: presentes.map(p => ({ nome: p.nome.trim(), cargo: p.cargo.trim(), presente: p.presente })),
      pauta: pauta.map(x => x.trim()).filter(Boolean),
      anonimizarAlunos: anonimizar,
      glossario: glossario.split('\n').map(x => x.trim()).filter(Boolean),
    }
    setSalvando(true)
    const id = novoId()
    await saveAudio(id, audio)
    await saveAta({ id, criadaEm: Date.now(), atualizadaEm: Date.now(), status: 'rascunho', meta, audioNome: audio.name })
    nav(`/ata/${id}/processando/transcricao`, { replace: true })
  }

  if (!cfg) return <p className="text-slate-500">Carregando…</p>

  return (
    <form onSubmit={enviar} className="space-y-6">
      <h1 className="text-xl font-semibold">Nova ata – Reunião pedagógica</h1>
      {!cfg.apiKey.trim() && (
        <div className="card border-amber-300 bg-amber-50 text-amber-900">
          Falta a chave do Gemini. <Link to="/config" className="font-semibold underline">Colar em Configurações</Link>.
        </div>
      )}

      <section className="card space-y-3">
        <h2 className="font-semibold">Áudio da reunião</h2>
        <input
          type="file"
          accept={EXTENSOES_AUDIO.map(x => `.${x}`).join(',') + ',audio/*'}
          onChange={e => setAudio(e.target.files?.[0] ?? null)}
          className="field"
        />
        <p className="text-sm text-slate-600">
          mp3, m4a, wav, ogg, webm ou aac. Dica: grave com o gravador do celular e envie o arquivo aqui.
          {audio && <> Selecionado: <b>{audio.name}</b> ({(audio.size / 1024 / 1024).toFixed(1)} MB).</>}
        </p>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Dados da reunião</h2>
        <div><label className="label">Escola</label><input className="field" value={escola} onChange={e => setEscola(e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Rede</label><input className="field" value={rede} onChange={e => setRede(e.target.value)} placeholder="Rede Municipal" /></div>
          <div><label className="label">Município/UF</label><input className="field" value={municipioUf} onChange={e => setMunicipioUf(e.target.value)} placeholder="Cidade/SP" /></div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div><label className="label">Ata nº</label><input className="field" type="number" min={1} value={numero} onChange={e => setNumero(Number(e.target.value))} /></div>
          <div className="col-span-2"><label className="label">Data</label><input className="field" type="date" value={data} onChange={e => setData(e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Início</label><input className="field" type="time" value={horaInicio} onChange={e => setHoraInicio(e.target.value)} /></div>
          <div><label className="label">Término (opcional)</label><input className="field" type="time" value={horaFim} onChange={e => setHoraFim(e.target.value)} /></div>
        </div>
        <div><label className="label">Local</label><input className="field" value={local} onChange={e => setLocal(e.target.value)} /></div>
        <label className="flex items-center gap-3 py-1"><input type="checkbox" className="size-5" checked={ordinaria} onChange={e => setOrdinaria(e.target.checked)} /> Reunião ordinária</label>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Presidente e secretário(a)</h2>
        {([['Presidiu a reunião', presidente, setPresidente], ['Lavrou a ata', secretario, setSecretario]] as const).map(([rot, p, set]) => (
          <div key={rot} className="grid grid-cols-2 gap-3">
            <div><label className="label">{rot}</label><input className="field" value={p.nome} onChange={e => set({ ...p, nome: e.target.value })} placeholder="Nome" /></div>
            <div><label className="label">Cargo</label><input className="field" value={p.cargo} onChange={e => set({ ...p, cargo: e.target.value })} /></div>
          </div>
        ))}
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Participantes</h2>
        <p className="text-sm text-slate-600">Marque quem estava presente. Só os presentes assinam.</p>
        {parts.map((p, i) => (
          <div key={i} className="flex items-center gap-2">
            <input type="checkbox" className="size-6 shrink-0" checked={p.presente} onChange={e => upParte(i, { presente: e.target.checked })} aria-label="Presente" />
            <input className="field" value={p.nome} onChange={e => upParte(i, { nome: e.target.value })} placeholder="Nome" />
            <input className="field" value={p.cargo} onChange={e => upParte(i, { cargo: e.target.value })} placeholder="Cargo" />
            <button type="button" className="btn-secondary px-3" onClick={() => setParts(ps => ps.filter((_, j) => j !== i))} aria-label="Remover">✕</button>
          </div>
        ))}
        <button type="button" className="btn-secondary w-full" onClick={() => setParts(ps => [...ps, { nome: '', cargo: 'Professor(a)', presente: true }])}>＋ Adicionar participante</button>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Pauta</h2>
        {pauta.map((x, i) => (
          <div key={i} className="flex gap-2">
            <input className="field" value={x} onChange={e => setPauta(ps => ps.map((y, j) => (j === i ? e.target.value : y)))} placeholder={`Item ${i + 1}`} />
            {pauta.length > 1 && <button type="button" className="btn-secondary px-3" onClick={() => setPauta(ps => ps.filter((_, j) => j !== i))} aria-label="Remover item">✕</button>}
          </div>
        ))}
        <button type="button" className="btn-secondary w-full" onClick={() => setPauta(ps => [...ps, ''])}>＋ Adicionar item</button>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Outras opções</h2>
        <label className="flex items-center gap-3"><input type="checkbox" className="size-5" checked={anonimizar} onChange={e => setAnonimizar(e.target.checked)} /> Não citar nomes de alunos (usar iniciais)</label>
        <div><label className="label">Glossário (um termo por linha: siglas, nomes próprios)</label><textarea className="field" rows={3} value={glossario} onChange={e => setGlossario(e.target.value)} /></div>
      </section>

      {erro && <div role="alert" className="card border-red-300 bg-red-50 text-red-800">{erro}</div>}
      <button className="btn-primary w-full" disabled={salvando}>{salvando ? 'Salvando…' : 'Transcrever o áudio'}</button>
    </form>
  )
}
