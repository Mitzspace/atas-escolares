import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { MeetingMetadata, Pessoa } from '../ata-api'
import { getSettings, novoId, proximoNumero, saveAta, saveAudio, saveSettings } from '../db'
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
  const [mesmaPessoa, setMesmaPessoa] = useState(false)
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
      setGlossario(s.glossario)
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
    const quemLavrou = mesmaPessoa ? presidente : secretario
    if (!presidente.nome.trim() || !quemLavrou.nome.trim()) return setErro('Informe quem presidiu a reunião e quem secretariou (lavrou a ata).')
    if (!horaInicio) return setErro('Informe a hora de início.')
    const presentes = parts.filter(p => p.nome.trim())
    const meta: MeetingMetadata = {
      escola: escola.trim(), rede: rede.trim(), municipioUf: municipioUf.trim(), tipo: 'pedagogica', ordinaria,
      numero, ano: Number(data.slice(0, 4)), data, horaInicio, horaFim: horaFim || undefined, local: local.trim(),
      presidente, secretario: quemLavrou,
      participantes: presentes.map(p => ({ nome: p.nome.trim(), cargo: p.cargo.trim(), presente: p.presente })),
      pauta: pauta.map(x => x.trim()).filter(Boolean),
      anonimizarAlunos: anonimizar,
      glossario: glossario.split('\n').map(x => x.trim()).filter(Boolean),
    }
    setSalvando(true)
    // guarda no cadastro quem foi digitado agora, sem repetir nomes
    const chave = (n: string) => n.trim().toLocaleLowerCase('pt-BR')
    const conhecidos = new Set(cfg!.pessoas.map(p => chave(p.nome)))
    const novos = presentes.filter(p => {
      const k = chave(p.nome)
      if (conhecidos.has(k)) return false
      conhecidos.add(k)
      return true
    }).map(p => ({ nome: p.nome.trim(), cargo: p.cargo.trim() }))
    if (novos.length) await saveSettings({ ...cfg!, pessoas: [...cfg!.pessoas, ...novos] })
    const id = novoId()
    await saveAudio(id, audio)
    await saveAta({ id, criadaEm: Date.now(), atualizadaEm: Date.now(), status: 'rascunho', meta, audioNome: audio.name })
    nav(`/ata/${id}/processando/transcricao`, { replace: true })
  }

  if (!cfg) return <p className="text-slate-500">Carregando…</p>

  return (
    <form onSubmit={enviar} className="space-y-6">
      <div><p className="eyebrow mb-2">DADOS DA REUNIÃO</p><h1>Nova ata – Reunião pedagógica</h1></div>
      {!cfg.apiKey.trim() && (
        <div className="card border-amber-300 bg-amber-50 text-amber-900">
          Falta a chave do Gemini. <Link to="/config" className="font-semibold underline">Colar em Configurações</Link>.
        </div>
      )}

      <section className="card space-y-5">
        <h2 className="font-semibold">Áudio da reunião</h2>
        <input
          type="file"
          accept={EXTENSOES_AUDIO.map(x => `.${x}`).join(',') + ',audio/*'}
          onChange={e => setAudio(e.target.files?.[0] ?? null)}
          aria-label="Áudio da reunião" className="field file:mr-3 file:min-h-11 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:text-blue-900"
        />
        <p className="text-sm text-slate-600">
          mp3, m4a, wav, ogg, webm ou aac. Dica: grave com o gravador do celular e envie o arquivo aqui.
          {audio && <> Selecionado: <b>{audio.name}</b> ({(audio.size / 1024 / 1024).toFixed(1)} MB).</>}
        </p>
      </section>

      <section className="card space-y-5">
        <h2 className="font-semibold">Dados da reunião</h2>
        <div><label className="label" htmlFor="escola">Escola</label><input id="escola" className="field" value={escola} onChange={e => setEscola(e.target.value)} /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label" htmlFor="rede">Rede</label><input id="rede" className="field" value={rede} onChange={e => setRede(e.target.value)} placeholder="Rede Municipal" /></div>
          <div><label className="label" htmlFor="municipioUf">Município/UF</label><input id="municipioUf" className="field" value={municipioUf} onChange={e => setMunicipioUf(e.target.value)} placeholder="Cidade/SP" /></div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div><label className="label" htmlFor="numero">Ata nº</label><input id="numero" className="field" type="number" min={1} value={numero} onChange={e => setNumero(Number(e.target.value))} /></div>
          <div className="col-span-2"><label className="label" htmlFor="data">Data</label><input id="data" className="field" type="date" value={data} onChange={e => setData(e.target.value)} /></div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label" htmlFor="horaInicio">Início</label><input id="horaInicio" className="field" type="time" value={horaInicio} onChange={e => setHoraInicio(e.target.value)} /></div>
          <div><label className="label" htmlFor="horaFim">Término (opcional)</label><input id="horaFim" className="field" type="time" value={horaFim} onChange={e => setHoraFim(e.target.value)} /></div>
        </div>
        <div><label className="label" htmlFor="local">Local</label><input id="local" className="field" value={local} onChange={e => setLocal(e.target.value)} /></div>
        <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-rule bg-slate-50 p-3"><input type="checkbox" className="size-6 shrink-0" checked={ordinaria} onChange={e => setOrdinaria(e.target.checked)} /> Reunião ordinária</label>
      </section>

      <section className="card space-y-5">
        <h2 className="font-semibold">Presidente e secretário(a)</h2>
        {([['Presidiu a reunião', presidente, setPresidente], ...(mesmaPessoa ? [] : [['Lavrou a ata', secretario, setSecretario]] as const)] as const).map(([rot, p, set]) => (
          <div key={rot} className="grid gap-4 sm:grid-cols-2">
            <div><label className="label" htmlFor={`${rot.split(' ')[0]}-nome`}>{rot}</label><input id={`${rot.split(' ')[0]}-nome`} className="field" value={p.nome} onChange={e => set({ ...p, nome: e.target.value })} placeholder="Nome" /></div>
            <div><label className="label" htmlFor={`${rot.split(' ')[0]}-cargo`}>Cargo</label><input id={`${rot.split(' ')[0]}-cargo`} className="field" value={p.cargo} onChange={e => set({ ...p, cargo: e.target.value })} /></div>
          </div>
        ))}
        <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-rule bg-slate-50 p-3"><input type="checkbox" className="size-6 shrink-0" checked={mesmaPessoa} onChange={e => setMesmaPessoa(e.target.checked)} /> Quem presidiu também lavrou a ata</label>
      </section>

      <section className="card space-y-5">
        <h2 className="font-semibold">Participantes</h2>
        <p className="text-sm text-slate-600">Marque quem estava presente. Só os presentes assinam.</p>
        {cfg.pessoas.length === 0 && (
          <p className="rounded-lg bg-slate-100 p-3 text-sm text-slate-700">
            Dica: cadastre os professores e funcionários uma vez em{' '}
            <Link to="/config" className="font-semibold underline">Configurações</Link>{' '}
            e eles já aparecem aqui. Quem você digitar abaixo também fica guardado para as próximas atas.
          </p>
        )}
        {parts.map((p, i) => (
          <div key={i} className={`flex flex-wrap items-center gap-3 rounded-xl border p-4 ${p.presente ? 'border-blue-200 bg-blue-50/50' : 'border-rule bg-slate-50'}`}>
            <label className="flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-lg font-semibold text-ink">
              <input type="checkbox" className="size-6 shrink-0" checked={p.presente} onChange={e => upParte(i, { presente: e.target.checked })} />
              Presente
            </label>
            <input className="field min-w-0 flex-1 basis-40" value={p.nome} onChange={e => upParte(i, { nome: e.target.value })} placeholder="Nome" aria-label="Nome" />
            <input className="field min-w-0 flex-1 basis-32" value={p.cargo} onChange={e => upParte(i, { cargo: e.target.value })} placeholder="Cargo" aria-label="Cargo" />
            <button type="button" className="btn-danger min-w-12 px-3" onClick={() => setParts(ps => ps.filter((_, j) => j !== i))} aria-label="Remover participante">✕</button>
          </div>
        ))}
        <button type="button" className="btn-secondary w-full" onClick={() => setParts(ps => [...ps, { nome: '', cargo: 'Professor(a)', presente: true }])}>＋ Adicionar participante</button>
      </section>

      <section className="card space-y-5">
        <h2 className="font-semibold">Pauta</h2>
        {pauta.map((x, i) => (
          <div key={i} className="flex gap-2">
            <input aria-label={`Item ${i + 1} da pauta`} className="field" value={x} onChange={e => setPauta(ps => ps.map((y, j) => (j === i ? e.target.value : y)))} placeholder={`Item ${i + 1}`} />
            {pauta.length > 1 && <button type="button" className="btn-secondary px-3" onClick={() => setPauta(ps => ps.filter((_, j) => j !== i))} aria-label="Remover item">✕</button>}
          </div>
        ))}
        <button type="button" className="btn-secondary w-full" onClick={() => setPauta(ps => [...ps, ''])}>＋ Adicionar item</button>
      </section>

      <section className="card space-y-5">
        <h2 className="font-semibold">Outras opções</h2>
        <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-rule bg-slate-50 p-3"><input type="checkbox" className="size-6 shrink-0" checked={anonimizar} onChange={e => setAnonimizar(e.target.checked)} /> Não citar nomes de alunos (usar iniciais)</label>
        <div><label className="label" htmlFor="glossario">Glossário (um termo por linha: siglas, nomes próprios)</label><textarea id="glossario" className="field" rows={3} value={glossario} onChange={e => setGlossario(e.target.value)} /></div>
      </section>

      {erro && <div role="alert" className="card border-red-300 bg-red-50 text-red-800">{erro}</div>}
      <div className="action-bar"><div className="mx-auto max-w-3xl sm:px-8"><button className="btn-primary w-full" disabled={salvando}>{salvando ? 'Salvando…' : 'Transcrever o áudio'}</button></div></div>
    </form>
  )
}
