import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { TIPOS_ATA, type MeetingMetadata, type Participante, type Pessoa, type TipoAta } from '../ata-api'
import Gravador from '../components/Gravador'
import { apagarSessaoGravacao, getSettings, novoId, proximoNumero, saveAta, saveAudio, saveSettings } from '../db'
import { mimeDoAudio } from '../gemini'
import { vinculoDoResponsavel } from '../pessoas'
import type { Settings } from '../types'

type Part = Pessoa & { presente: boolean }
type Aluno = { nome: string; turma: string; foco?: boolean }
type Responsavel = { nome: string; parentesco: Parentesco; aluno: string; turma: string; foco?: boolean }
type Parentesco = 'Mãe' | 'Pai' | 'Responsável'
const PARENTESCOS: Parentesco[] = ['Mãe', 'Pai', 'Responsável']
const TIPOS: TipoAta[] = ['pedagogica', 'pais', 'orientacao']
const chaveNome = (n: string) => n.trim().toLocaleLowerCase('pt-BR')

const hoje = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const TAMANHO_MAX_MB = 200

export default function NovaAta() {
  const nav = useNavigate()
  const [cfg, setCfg] = useState<Settings | null>(null)
  const [tipo, setTipo] = useState<TipoAta | null>(null)
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
  const [alunos, setAlunos] = useState<Aluno[]>([])
  const [responsaveis, setResponsaveis] = useState<Responsavel[]>([])
  const [orientadoTipo, setOrientadoTipo] = useState<'funcionario' | 'aluno'>('funcionario')
  const [orientadoFunc, setOrientadoFunc] = useState<Pessoa>({ nome: '', cargo: '' })
  const [orientadoAluno, setOrientadoAluno] = useState<Aluno>({ nome: '', turma: '' })
  const [acompanhante, setAcompanhante] = useState<{ nome: string; parentesco: Parentesco }>({ nome: '', parentesco: 'Mãe' })
  const [pauta, setPauta] = useState<string[]>([''])
  const [anonimizar, setAnonimizar] = useState(true)
  const [glossario, setGlossario] = useState('')
  const [audio, setAudio] = useState<File | null>(null)
  const [sessaoGravacao, setSessaoGravacao] = useState<string | undefined>()
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    getSettings().then(async s => {
      setCfg(s)
      setLocal(s.local)
      setGlossario(s.glossario)
      setParts(s.pessoas.map(p => ({ ...p, presente: true })))
      setNumero(await proximoNumero(new Date().getFullYear()))
    })
  }, [])

  const upParte = (i: number, patch: Partial<Part>) => setParts(ps => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)))
  const upAluno = (i: number, patch: Partial<Aluno>) => setAlunos(as => as.map((a, j) => (j === i ? { ...a, ...patch } : a)))
  const upResp = (i: number, patch: Partial<Responsavel>) => setResponsaveis(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  function escolherTipo(t: TipoAta) {
    setTipo(t)
    // na orientação o aluno orientado é o próprio assunto, e quem orienta costuma lavrar a ata
    setAnonimizar(t !== 'orientacao')
    setMesmaPessoa(t === 'orientacao')
    setOrdinaria(t !== 'orientacao')
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    if (!audio) return setErro('Grave ou envie o áudio da reunião.')
    try { mimeDoAudio(audio) } catch (x) { return setErro((x as Error).message) }
    if (audio.size > TAMANHO_MAX_MB * 1024 * 1024) return setErro(`O arquivo tem mais de ${TAMANHO_MAX_MB} MB. Envie um áudio menor (ou em mp3/m4a).`)
    if (!cfg?.escola.trim()) return setErro('Cadastre o nome da escola em Configurações antes de criar a ata.')
    const quemLavrou = mesmaPessoa ? presidente : secretario
    if (!presidente.nome.trim() || !quemLavrou.nome.trim()) return setErro(tipo === 'orientacao'
      ? 'Informe quem orienta e quem lavrou a ata.'
      : 'Informe quem presidiu a reunião e quem secretariou (lavrou a ata).')
    if (!horaInicio) return setErro('Informe a hora de início.')
    if (tipo === 'orientacao') {
      if (orientadoTipo === 'funcionario' && (!orientadoFunc.nome.trim() || !orientadoFunc.cargo.trim())) return setErro('Informe o nome e o cargo do funcionário que recebe a orientação.')
      if (orientadoTipo === 'aluno' && !orientadoAluno.nome.trim()) return setErro('Informe o nome do aluno que recebe a orientação.')
    }

    const funcionarios: Participante[] = tipo === 'orientacao' ? [] : parts.filter(p => p.nome.trim())
      .map(p => ({ nome: p.nome.trim(), cargo: p.cargo.trim(), presente: p.presente, categoria: 'funcionario' as const }))
    const extras: Participante[] = []
    if (tipo === 'pedagogica') {
      for (const a of alunos.filter(a => a.nome.trim())) extras.push({ nome: a.nome.trim(), cargo: 'Aluno(a)', presente: true, categoria: 'aluno', vinculo: a.turma.trim() })
    }
    if (tipo === 'pais') {
      for (const r of responsaveis.filter(r => r.nome.trim())) extras.push({ nome: r.nome.trim(), cargo: r.parentesco, presente: true, categoria: 'responsavel', vinculo: vinculoDoResponsavel(r.aluno, r.turma) })
    }
    let orientado: Participante | undefined
    if (tipo === 'orientacao') {
      if (orientadoTipo === 'funcionario') {
        orientado = { nome: orientadoFunc.nome.trim(), cargo: orientadoFunc.cargo.trim(), presente: true, categoria: 'funcionario' }
      } else {
        orientado = { nome: orientadoAluno.nome.trim(), cargo: 'Aluno(a)', presente: true, categoria: 'aluno', vinculo: orientadoAluno.turma.trim() }
        if (acompanhante.nome.trim()) {
          extras.push({ nome: acompanhante.nome.trim(), cargo: acompanhante.parentesco, presente: true, categoria: 'responsavel', vinculo: vinculoDoResponsavel(orientadoAluno.nome, orientadoAluno.turma) })
        }
      }
    }
    const meta: MeetingMetadata = {
      escola: cfg.escola.trim(), rede: cfg.rede.trim(), municipioUf: cfg.municipioUf.trim(), tipo: tipo!, ordinaria,
      numero, ano: Number(data.slice(0, 4)), data, horaInicio, horaFim: horaFim || undefined, local: local.trim(),
      presidente, secretario: quemLavrou,
      participantes: [...funcionarios, ...extras],
      ...(orientado ? { orientado } : {}),
      pauta: pauta.map(x => x.trim()).filter(Boolean),
      anonimizarAlunos: anonimizar,
      glossario: glossario.split('\n').map(x => x.trim()).filter(Boolean),
    }
    setSalvando(true)
    // só funcionários entram no cadastro (responsáveis e alunos são digitados a cada ata)
    const candidatos: Pessoa[] = [...funcionarios, ...(orientado?.categoria === 'funcionario' ? [orientado] : [])]
    const conhecidos = new Set(cfg!.pessoas.map(p => chaveNome(p.nome)))
    const novos = candidatos.filter(p => {
      const k = chaveNome(p.nome)
      if (conhecidos.has(k)) return false
      conhecidos.add(k)
      return true
    }).map(p => ({ nome: p.nome.trim(), cargo: p.cargo.trim() }))
    if (novos.length) await saveSettings({ ...cfg!, pessoas: [...cfg!.pessoas, ...novos] })
    const id = novoId()
    await saveAudio(id, audio)
    if (sessaoGravacao) await apagarSessaoGravacao(sessaoGravacao)
    await saveAta({ id, criadaEm: Date.now(), atualizadaEm: Date.now(), status: 'rascunho', meta, audioNome: audio.name })
    nav(`/ata/${id}/processando/transcricao`, { replace: true })
  }

  if (!cfg) return <p className="text-slate-500">Carregando…</p>

  if (tipo === null) {
    return (
      <div className="space-y-6">
        <div><p className="eyebrow mb-2">NOVA ATA</p><h1>Que tipo de ata?</h1></div>
        <ul className="space-y-3">
          {TIPOS.map(t => (
            <li key={t}>
              <button type="button" onClick={() => escolherTipo(t)} className="card w-full min-h-24 text-left active:bg-slate-50">
                <span className="block font-document text-xl font-semibold text-ink">{TIPOS_ATA[t].nome}</span>
                <span className="mt-1 block text-slate-600">{TIPOS_ATA[t].descricao}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  const ehOrientacao = tipo === 'orientacao'
  const nomeTipo = TIPOS_ATA[tipo].nome

  return (
    <form onSubmit={enviar} className="space-y-6">
      <div>
        <p className="eyebrow mb-2">DADOS DA REUNIÃO</p>
        <h1>Nova ata – {nomeTipo}</h1>
        <button type="button" className="mt-2 min-h-11 text-sm font-semibold text-blue-900 underline" onClick={() => setTipo(null)}>Trocar o tipo de ata</button>
      </div>
      {!cfg.apiKey.trim() && (
        <div className="card border-amber-300 bg-amber-50 text-amber-900">
          Falta a chave do Gemini. <Link to="/config" className="font-semibold underline">Colar em Configurações</Link>.
        </div>
      )}
      {!cfg.escola.trim() && (
        <div className="card border-amber-300 bg-amber-50 text-amber-900">
          Falta o nome da escola. <Link to="/config" className="font-semibold underline">Preencher em Configurações</Link>.
        </div>
      )}

      <section className="card space-y-5">
        <h2 className="font-semibold">Áudio da reunião</h2>
        <Gravador arquivo={audio} onChange={(f, sessao) => { setAudio(f); setSessaoGravacao(sessao) }} />
      </section>

      <section className="card space-y-5">
        <h2 className="font-semibold">Dados da reunião</h2>
        <div className="grid grid-cols-3 gap-3">
          <div><label className="label" htmlFor="numero">Ata nº</label><input id="numero" className="field" type="number" min={1} value={numero} onChange={e => setNumero(Number(e.target.value))} /></div>
          <div className="col-span-2"><label className="label" htmlFor="data">Data</label><input id="data" className="field" type="date" value={data} onChange={e => setData(e.target.value)} /></div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label" htmlFor="horaInicio">Início</label><input id="horaInicio" className="field" type="time" value={horaInicio} onChange={e => setHoraInicio(e.target.value)} /></div>
          <div><label className="label" htmlFor="horaFim">Término (opcional)</label><input id="horaFim" className="field" type="time" value={horaFim} onChange={e => setHoraFim(e.target.value)} /></div>
        </div>
        <div><label className="label" htmlFor="local">Local</label><input id="local" className="field" value={local} onChange={e => setLocal(e.target.value)} /></div>
        {!ehOrientacao && (
          <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-rule bg-slate-50 p-3"><input type="checkbox" className="size-6 shrink-0" checked={ordinaria} onChange={e => setOrdinaria(e.target.checked)} /> Reunião ordinária</label>
        )}
      </section>

      <section className="card space-y-5">
        <h2 className="font-semibold">{ehOrientacao ? 'Quem orienta e quem lavra a ata' : 'Presidente e secretário(a)'}</h2>
        {([[ehOrientacao ? 'Quem orienta' : 'Presidiu a reunião', presidente, setPresidente], ...(mesmaPessoa ? [] : [['Lavrou a ata', secretario, setSecretario]] as const)] as const).map(([rot, p, set]) => (
          <div key={rot} className="grid gap-4 sm:grid-cols-2">
            <div><label className="label" htmlFor={`${rot.split(' ')[0]}-nome`}>{rot}</label><input id={`${rot.split(' ')[0]}-nome`} className="field" value={p.nome} onChange={e => set({ ...p, nome: e.target.value })} placeholder="Nome" /></div>
            <div><label className="label" htmlFor={`${rot.split(' ')[0]}-cargo`}>Cargo</label><input id={`${rot.split(' ')[0]}-cargo`} className="field" value={p.cargo} onChange={e => set({ ...p, cargo: e.target.value })} placeholder={ehOrientacao ? 'Diretora, Coordenadora, Pedagoga…' : undefined} /></div>
          </div>
        ))}
        <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-rule bg-slate-50 p-3"><input type="checkbox" className="size-6 shrink-0" checked={mesmaPessoa} onChange={e => setMesmaPessoa(e.target.checked)} /> {ehOrientacao ? 'Quem orienta também lavrou a ata' : 'Quem presidiu também lavrou a ata'}</label>
      </section>

      {ehOrientacao && (
        <section className="card space-y-5">
          <h2 className="font-semibold">Quem recebe a orientação</h2>
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Quem recebe a orientação">
            {([['funcionario', 'Funcionário'], ['aluno', 'Aluno']] as const).map(([v, rot]) => (
              <button key={v} type="button" aria-pressed={orientadoTipo === v} onClick={() => setOrientadoTipo(v)} className={orientadoTipo === v ? 'btn-primary' : 'btn-secondary'}>{rot}</button>
            ))}
          </div>
          {orientadoTipo === 'funcionario' ? (
            <div className="space-y-4">
              {cfg.pessoas.length > 0 && (
                <div>
                  <label className="label" htmlFor="orientado-cadastro">Escolher do cadastro</label>
                  <select
                    id="orientado-cadastro" className="field" value=""
                    onChange={e => { const p = cfg.pessoas[Number(e.target.value)]; if (p) setOrientadoFunc({ nome: p.nome, cargo: p.cargo }) }}
                  >
                    <option value="">Selecione…</option>
                    {cfg.pessoas.map((p, i) => <option key={i} value={i}>{p.nome} — {p.cargo}</option>)}
                  </select>
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <div><label className="label" htmlFor="orientado-nome">Nome</label><input id="orientado-nome" className="field" autoComplete="off" value={orientadoFunc.nome} onChange={e => setOrientadoFunc({ ...orientadoFunc, nome: e.target.value })} /></div>
                <div><label className="label" htmlFor="orientado-cargo">Cargo</label><input id="orientado-cargo" className="field" autoComplete="off" value={orientadoFunc.cargo} onChange={e => setOrientadoFunc({ ...orientadoFunc, cargo: e.target.value })} placeholder="Professor(a), Inspetor(a)…" /></div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div><label className="label" htmlFor="aluno-nome">Nome do aluno</label><input id="aluno-nome" className="field" autoComplete="off" value={orientadoAluno.nome} onChange={e => setOrientadoAluno({ ...orientadoAluno, nome: e.target.value })} /></div>
                <div><label className="label" htmlFor="aluno-turma">Turma</label><input id="aluno-turma" className="field" autoComplete="off" value={orientadoAluno.turma} onChange={e => setOrientadoAluno({ ...orientadoAluno, turma: e.target.value })} placeholder="5º ano B" /></div>
              </div>
              <div className="space-y-3 rounded-xl border border-rule p-4">
                <p className="font-semibold">Responsável presente (opcional)</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div><label className="label" htmlFor="acomp-nome">Nome</label><input id="acomp-nome" className="field" autoComplete="off" value={acompanhante.nome} onChange={e => setAcompanhante({ ...acompanhante, nome: e.target.value })} /></div>
                  <div><label className="label" htmlFor="acomp-par">Parentesco</label><select id="acomp-par" className="field" value={acompanhante.parentesco} onChange={e => setAcompanhante({ ...acompanhante, parentesco: e.target.value as Parentesco })}>{PARENTESCOS.map(x => <option key={x}>{x}</option>)}</select></div>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {!ehOrientacao && (
        <section className="card space-y-5">
          <h2 className="font-semibold">{tipo === 'pais' ? 'Funcionários' : 'Participantes'}</h2>
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
          <button type="button" className="btn-secondary w-full" onClick={() => setParts(ps => [...ps, { nome: '', cargo: 'Professor(a)', presente: true }])}>＋ Adicionar {tipo === 'pais' ? 'funcionário' : 'participante'}</button>
        </section>
      )}

      {tipo === 'pedagogica' && (
        <section className="card space-y-5">
          <h2 className="font-semibold">Alunos (se participaram)</h2>
          <p className="text-sm text-slate-600">Alunos são digitados a cada ata e não entram no cadastro.</p>
          {alunos.map((a, i) => (
            <div key={i} className="grid gap-3 rounded-xl border border-rule p-4 sm:grid-cols-[1fr_10rem_auto]">
              <input className="field" autoFocus={a.foco} autoComplete="off" value={a.nome} onChange={e => upAluno(i, { nome: e.target.value })} placeholder="Nome do aluno" aria-label="Nome do aluno" />
              <input className="field" autoComplete="off" value={a.turma} onChange={e => upAluno(i, { turma: e.target.value })} placeholder="Turma" aria-label="Turma" />
              <button type="button" className="btn-danger" onClick={() => setAlunos(as => as.filter((_, j) => j !== i))} aria-label="Remover aluno">Remover</button>
            </div>
          ))}
          <button type="button" className="btn-secondary w-full" onClick={() => setAlunos(as => [...as, { nome: '', turma: '', foco: true }])}>＋ Adicionar aluno</button>
        </section>
      )}

      {tipo === 'pais' && (
        <section className="card space-y-5">
          <h2 className="font-semibold">Pais e responsáveis</h2>
          <p className="text-sm text-slate-600">Digite quem compareceu. Eles não entram no cadastro de funcionários.</p>
          {responsaveis.map((r, i) => (
            <div key={i} className="space-y-3 rounded-xl border border-rule p-4">
              <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
                <input className="field" autoFocus={r.foco} autoComplete="off" value={r.nome} onChange={e => upResp(i, { nome: e.target.value })} placeholder="Nome do responsável" aria-label="Nome do responsável" />
                <select className="field" value={r.parentesco} onChange={e => upResp(i, { parentesco: e.target.value as Parentesco })} aria-label="Parentesco">
                  {PARENTESCOS.map(x => <option key={x}>{x}</option>)}
                </select>
              </div>
              <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
                <input className="field" autoComplete="off" value={r.aluno} onChange={e => upResp(i, { aluno: e.target.value })} placeholder="Nome do aluno" aria-label="Nome do aluno" />
                <input className="field" autoComplete="off" value={r.turma} onChange={e => upResp(i, { turma: e.target.value })} placeholder="Turma" aria-label="Turma" />
              </div>
              <button type="button" className="btn-danger w-full" onClick={() => setResponsaveis(rs => rs.filter((_, j) => j !== i))}>Remover responsável</button>
            </div>
          ))}
          <button type="button" className="btn-secondary w-full" onClick={() => setResponsaveis(rs => [...rs, { nome: '', parentesco: 'Mãe', aluno: '', turma: '', foco: true }])}>＋ Adicionar responsável</button>
          {responsaveis.length > 0 && <p className="text-sm text-slate-600">{responsaveis.filter(r => r.nome.trim()).length} responsável(is) na lista.</p>}
        </section>
      )}

      <section className="card space-y-5">
        <h2 className="font-semibold">{ehOrientacao ? 'Motivo e assuntos da orientação' : 'Pauta'}</h2>
        {pauta.map((x, i) => (
          <div key={i} className="flex gap-2">
            <input aria-label={ehOrientacao ? `Assunto ${i + 1}` : `Item ${i + 1} da pauta`} className="field" value={x} onChange={e => setPauta(ps => ps.map((y, j) => (j === i ? e.target.value : y)))} placeholder={ehOrientacao ? `Assunto ${i + 1}` : `Item ${i + 1}`} />
            {pauta.length > 1 && <button type="button" className="btn-secondary px-3" onClick={() => setPauta(ps => ps.filter((_, j) => j !== i))} aria-label="Remover item">✕</button>}
          </div>
        ))}
        <button type="button" className="btn-secondary w-full" onClick={() => setPauta(ps => [...ps, ''])}>＋ Adicionar {ehOrientacao ? 'assunto' : 'item'}</button>
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
