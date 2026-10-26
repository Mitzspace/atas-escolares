import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  CARGOS_SUGERIDOS,
  listarOrientados,
  OPCOES_TIPO_REUNIAO,
  OUTRO_TIPO_REUNIAO,
  quemLavra,
  tipoDaOpcao,
  type Anotacao,
  type MeetingMetadata,
  type ModoRegistro,
  type Participante,
  type Pessoa,
} from '../ata-api'
import AssuntosSugeridos from '../components/AssuntosSugeridos'
import RegistroReuniao from '../components/RegistroReuniao'
import { assuntosSugeridos, chavesDeAssuntos } from '../assuntos'
import {
  apagarSessaoGravacao,
  getAta,
  getAudio,
  getSettings,
  novoId,
  proximoNumero,
  saveAta,
  saveAudio,
  saveSettings,
} from '../db'
import { mimeDoAudio } from '../gemini'
import { usarTextoComoEsta } from '../pipeline'
import { vinculoDoResponsavel, type TratamentoAluno } from '../pessoas'
import type { Settings } from '../types'

type PessoaEditavel = {
  id: string
  nome: string
  cargo: string
  aluno: string
  turma: string
  tratamento: TratamentoAluno
  recebeOrientacao: boolean
}
const chave = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').trim().toLocaleLowerCase('pt-BR')
const categoria = (cargo: string) =>
  /^(mae|pai|responsavel)$/.test(chave(cargo))
    ? 'responsavel'
    : /^alun[oa]/.test(chave(cargo))
      ? 'aluno'
      : 'funcionario'
const hoje = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const pessoaVazia = (): PessoaEditavel => ({
  id: novoId(),
  nome: '',
  cargo: '',
  aluno: '',
  turma: '',
  tratamento: 'aluno(a)',
  recebeOrientacao: false,
})

function TituloCartao({
  titulo,
  descricao,
  icone,
}: {
  titulo: string
  descricao?: string
  icone: 'tipo' | 'pessoa' | 'grupo'
}) {
  return (
    <div className="flex items-start gap-3">
      <span
        className="flex size-12 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-900"
        aria-hidden="true"
      >
        <svg
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {icone === 'tipo' ? (
            <>
              <rect x="4" y="5" width="16" height="16" rx="2" />
              <path d="M8 2v6M16 2v6M4 11h16M8 15h2M14 15h2" />
            </>
          ) : icone === 'pessoa' ? (
            <>
              <circle cx="12" cy="7" r="4" />
              <path d="M4 22v-3a8 8 0 0 1 16 0v3" />
            </>
          ) : (
            <>
              <circle cx="9" cy="7" r="3" />
              <circle cx="18" cy="9" r="2.5" />
              <path d="M2 21v-3a7 7 0 0 1 14 0v3M17 14a5 5 0 0 1 5 5v2" />
            </>
          )}
        </svg>
      </span>
      <div>
        <h2>{titulo}</h2>
        {descricao && (
          <p className="mt-2 text-sm text-slate-600">{descricao}</p>
        )}
      </div>
    </div>
  )
}

export default function NovaAta() {
  const nav = useNavigate(),
    [parametros] = useSearchParams()
  const [idRegistro] = useState(() => parametros.get('rascunho') || novoId())
  const criadaEm = useRef(Date.now()),
    rotaRascunho = useRef(!!parametros.get('rascunho'))
  const [cfg, setCfg] = useState<Settings | null>(null)
  const [opcao, setOpcao] = useState(''),
    [outro, setOutro] = useState('')
  const [responsavel, setResponsavel] = useState<Pessoa>({
    nome: '',
    cargo: '',
  })
  const [participantes, setParticipantes] = useState<PessoaEditavel[]>([])
  const [numero, setNumero] = useState(1),
    [data, setData] = useState(hoje())
  const [horaInicio, setHoraInicio] = useState(''),
    [horaFim, setHoraFim] = useState(''),
    [local, setLocal] = useState('')
  const [pauta, setPauta] = useState<string[]>(['']),
    [anonimizar, setAnonimizar] = useState(true),
    [glossario, setGlossario] = useState('')
  const [modoRegistro, setModoRegistro] = useState<ModoRegistro>('audio'),
    [anotacoes, setAnotacoes] = useState<Anotacao[]>([{ texto: '' }])
  const [audio, setAudio] = useState<File | null>(null),
    [sessao, setSessao] = useState<string>()
  const [tempoMs, setTempoMs] = useState(0),
    [gravando, setGravando] = useState(false)
  const [salvando, setSalvando] = useState(false),
    [salvoAutomatico, setSalvoAutomatico] = useState(false)
  const [erro, setErro] = useState(''),
    [mensagem, setMensagem] = useState('')
  const rotulo = opcao === OUTRO_TIPO_REUNIAO ? outro.trim() : opcao
  const tipo = tipoDaOpcao(rotulo)

  useEffect(() => {
    void (async () => {
      const s = await getSettings()
      setLocal(s.local)
      setGlossario(s.glossario)
      setNumero(await proximoNumero(new Date().getFullYear()))
      if (parametros.has('rascunho')) {
        const a = await getAta(idRegistro)
        if (a?.renderizada || a?.finalizadaEm) {
          nav(`/ata/${a.id}/revisar`, { replace: true })
          return
        }
        if (a) {
          const m = a.meta,
            r =
              m.tipoReuniao ||
              OPCOES_TIPO_REUNIAO.find((o) => o.tipo === m.tipo)?.rotulo ||
              ''
          setOpcao(
            OPCOES_TIPO_REUNIAO.some((o) => o.rotulo === r)
              ? r
              : OUTRO_TIPO_REUNIAO,
          )
          setOutro(r)
          setResponsavel(quemLavra(m))
          setNumero(m.numero)
          setData(m.data)
          setHoraInicio(m.horaInicio)
          setHoraFim(m.horaFim ?? '')
          setLocal(m.local)
          setPauta(m.pauta.length ? m.pauta : [''])
          setAnonimizar(m.anonimizarAlunos)
          setGlossario((m.glossario ?? []).join('\n'))
          setModoRegistro(a.modoRegistro ?? 'audio')
          setAnotacoes(a.anotacoes?.length ? a.anotacoes : [{ texto: '' }])
          criadaEm.current = a.criadaEm
          const orientados = new Set(
            listarOrientados(m).map((p) => chave(p.nome)),
          )
          setParticipantes(
            m.participantes.map((p) => {
              const v = (p.vinculo ?? '')
                .replace(/^alun[oa](?:\(a\))?\s+/i, '')
                .split(',')
              return {
                ...pessoaVazia(),
                nome: p.nome,
                cargo: p.cargo,
                aluno: p.categoria === 'responsavel' ? (v[0] ?? '') : '',
                turma:
                  p.categoria === 'responsavel'
                    ? v.slice(1).join(',').trim()
                    : (p.vinculo ?? ''),
                tratamento: p.vinculo?.startsWith('aluna ')
                  ? 'aluna'
                  : 'aluno(a)',
                recebeOrientacao: orientados.has(chave(p.nome)),
              }
            }),
          )
          const f = await getAudio(a.id)
          if (f) setAudio(new File([f.blob], f.nome, { type: f.mimeType }))
          setSalvoAutomatico(true)
        }
      }
      setCfg(s)
    })().catch(() =>
      setErro(
        'Não foi possível carregar os dados deste aparelho. Tente recarregar a página.',
      ),
    )
  }, [])

  const meta = useMemo<MeetingMetadata>(
    () => ({
      escola: cfg?.escola ?? '',
      rede: cfg?.rede ?? '',
      municipioUf: cfg?.municipioUf ?? '',
      tipo,
      tipoReuniao: rotulo,
      numero,
      ano: Number(data.slice(0, 4)),
      data,
      horaInicio,
      horaFim: horaFim || undefined,
      local: local.trim(),
      responsavel,
      participantes: participantes
        .filter((p) => p.nome.trim())
        .map((p) => {
          const c = categoria(p.cargo)
          return {
            nome: p.nome.trim(),
            cargo: p.cargo.trim(),
            presente: true,
            categoria: c,
            ...(c === 'responsavel' && (p.aluno.trim() || p.turma.trim())
              ? {
                  vinculo: vinculoDoResponsavel(p.aluno, p.turma, p.tratamento),
                }
              : c === 'aluno' && p.turma.trim()
                ? { vinculo: p.turma.trim() }
                : {}),
            ...(tipo === 'orientacao' && p.recebeOrientacao
              ? { recebeOrientacao: true }
              : {}),
          } as Participante
        }),
      pauta: pauta.map((p) => p.trim()).filter(Boolean),
      anonimizarAlunos: anonimizar,
      glossario: glossario
        .split('\n')
        .map((p) => p.trim())
        .filter(Boolean),
    }),
    [
      cfg,
      tipo,
      rotulo,
      numero,
      data,
      horaInicio,
      horaFim,
      local,
      responsavel,
      participantes,
      pauta,
      anonimizar,
      glossario,
    ],
  )

  useEffect(() => {
    if (
      !cfg ||
      modoRegistro === 'audio' ||
      salvando ||
      !anotacoes.some((a) => a.texto.trim())
    )
      return
    let vivo = true
    setSalvoAutomatico(false)
    const timer = setTimeout(() => {
      void saveAta({
        id: idRegistro,
        criadaEm: criadaEm.current,
        atualizadaEm: Date.now(),
        status: 'rascunho',
        meta,
        modoRegistro,
        anotacoes: anotacoes.filter((a) => a.texto.trim()),
      })
        .then(() => {
          if (!vivo) return
          setSalvoAutomatico(true)
          if (!rotaRascunho.current) {
            rotaRascunho.current = true
            nav(`/nova?rascunho=${idRegistro}`, { replace: true })
          }
        })
        .catch(() => {
          if (vivo)
            setErro(
              'Não foi possível guardar as anotações neste aparelho. Confira o espaço disponível antes de sair.',
            )
        })
    }, 600)
    return () => {
      vivo = false
      clearTimeout(timer)
    }
  }, [cfg, meta, modoRegistro, anotacoes, salvando, idRegistro, nav])

  const atualizar = (id: string, patch: Partial<PessoaEditavel>) =>
    setParticipantes((ps) =>
      ps.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    )
  async function cadastrar(pessoas: Pessoa[]) {
    const atual = await getSettings(),
      todas = [...atual.pessoas]
    for (const p of pessoas.filter((p) => p.nome.trim()))
      if (
        !todas.some(
          (x) =>
            chave(x.nome) === chave(p.nome) &&
            chave(x.cargo) === chave(p.cargo),
        )
      )
        todas.push({ nome: p.nome.trim(), cargo: p.cargo.trim() })
    const cargosExtras = [
      ...new Set([
        ...(atual.cargosExtras ?? []),
        ...pessoas.map((p) => p.cargo.trim()).filter(Boolean),
      ]),
    ]
    const novo = { ...atual, pessoas: todas, cargosExtras }
    await saveSettings(novo)
    setCfg(novo)
  }
  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    if (!rotulo) return setErro('Selecione ou digite o tipo de reunião.')
    if (!responsavel.nome.trim()) return setErro('Informe quem fez a ata.')
    if (!horaInicio) return setErro('Informe a hora de início.')
    if (
      tipo === 'orientacao' &&
      !meta.participantes.some((p) => p.recebeOrientacao)
    )
      return setErro(
        'Marque quem recebe a orientação na lista de participantes.',
      )
    if (modoRegistro === 'digitar') {
      if (!anotacoes.some((a) => a.texto.trim()))
        return setErro('Escreva o texto ou as anotações antes de continuar.')
    } else {
      if (!audio) return setErro('Grave ou envie o áudio da reunião.')
      try {
        mimeDoAudio(audio)
      } catch (x) {
        return setErro((x as Error).message)
      }
      if (audio.size > 200 * 1024 * 1024)
        return setErro(
          'O arquivo tem mais de 200 MB. Envie um áudio menor (ou em mp3/m4a).',
        )
    }
    const semIA =
      (e.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'usar'
    setSalvando(true)
    try {
      await cadastrar([responsavel, ...meta.participantes])
      if (modoRegistro !== 'digitar' && audio)
        await saveAudio(idRegistro, audio)
      await saveAta({
        id: idRegistro,
        criadaEm: criadaEm.current,
        atualizadaEm: Date.now(),
        status: 'rascunho',
        meta,
        modoRegistro,
        anotacoes:
          modoRegistro === 'audio'
            ? undefined
            : anotacoes.filter((a) => a.texto.trim()),
        audioNome: modoRegistro !== 'digitar' ? audio?.name : undefined,
      })
      if (sessao) await apagarSessaoGravacao(sessao)
      if (modoRegistro === 'digitar' && semIA) {
        await usarTextoComoEsta(
          idRegistro,
          anotacoes.map((a) => a.texto).join('\n'),
        )
        nav(`/ata/${idRegistro}/revisar`, { replace: true })
      } else
        nav(
          `/ata/${idRegistro}/processando/${modoRegistro === 'digitar' ? 'ata' : 'transcricao'}`,
          { replace: true },
        )
    } catch (x) {
      setErro((x as Error).message)
      setSalvando(false)
    }
  }
  if (!cfg) return <p role="status">Carregando…</p>
  const nomes = [...new Set(cfg.pessoas.map((p) => p.nome))],
    cargos = [
      ...new Set(
        [
          ...CARGOS_SUGERIDOS,
          ...(cfg.cargosExtras ?? []),
          ...cfg.pessoas.map((p) => p.cargo),
        ].filter(Boolean),
      ),
    ]
  const escolherNome = (nome: string) => {
    const p = cfg.pessoas.find((p) => p.nome === nome)
    setResponsavel((r) => ({ nome, cargo: p?.cargo ?? r.cargo }))
  }
  return (
    <form onSubmit={enviar} className="space-y-6">
      <div>
        <p className="eyebrow mb-2">REGISTRO DA REUNIÃO</p>
        <h1>Nova ata</h1>
      </div>
      <datalist id="nomes-cadastrados">
        {nomes.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <datalist id="cargos-cadastrados">
        {cargos.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <section className="card space-y-4">
        <TituloCartao titulo="Tipo de reunião" icone="tipo" />
        <label className="sr-only" htmlFor="tipo-reuniao">
          Tipo de reunião
        </label>
        <select
          id="tipo-reuniao"
          className="field"
          value={opcao}
          onChange={(e) => {
            setOpcao(e.target.value)
            if (tipoDaOpcao(e.target.value) === 'orientacao')
              setAnonimizar(false)
          }}
        >
          <option value="">Selecione o tipo de reunião</option>
          {OPCOES_TIPO_REUNIAO.map((o) => (
            <option key={o.rotulo}>{o.rotulo}</option>
          ))}
          <option>{OUTRO_TIPO_REUNIAO}</option>
        </select>
        {opcao === OUTRO_TIPO_REUNIAO && (
          <div>
            <label className="label" htmlFor="tipo-personalizado">
              Digite o tipo de reunião
            </label>
            <input
              id="tipo-personalizado"
              className="field"
              value={outro}
              onChange={(e) => setOutro(e.target.value)}
            />
          </div>
        )}
      </section>
      <section className="card space-y-4 border-blue-200 bg-blue-50/70">
        <TituloCartao
          titulo="Quem fez a ata?"
          descricao="Selecione o nome e o cargo do responsável pelo registro."
          icone="pessoa"
        />
        <div>
          <label className="label" htmlFor="responsavel-nome">
            Nome do(a) responsável
          </label>
          <input
            id="responsavel-nome"
            className="field"
            list="nomes-cadastrados"
            placeholder="Selecione ou digite o nome"
            value={responsavel.nome}
            onChange={(e) => escolherNome(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="responsavel-cargo">
            Cargo
          </label>
          <input
            id="responsavel-cargo"
            className="field"
            list="cargos-cadastrados"
            placeholder="Selecione ou digite o cargo"
            value={responsavel.cargo}
            onChange={(e) =>
              setResponsavel((r) => ({ ...r, cargo: e.target.value }))
            }
          />
        </div>
        <button
          type="button"
          className="btn-secondary w-full bg-blue-100"
          onClick={async () => {
            setMensagem('')
            setErro('')
            if (!responsavel.nome.trim() && !responsavel.cargo.trim()) {
              setErro('Digite um nome ou cargo para cadastrar.')
              return
            }
            try {
              await cadastrar([responsavel])
              setMensagem('Nome ou cargo cadastrado para as próximas atas.')
            } catch {
              setErro('Não foi possível cadastrar. Tente novamente.')
            }
          }}
        >
          ＋ Cadastrar novo nome ou cargo
        </button>
        {mensagem && (
          <p role="status" className="text-green-800">
            {mensagem}
          </p>
        )}
      </section>
      <section className="card space-y-4">
        <TituloCartao
          titulo="Participantes da reunião"
          descricao="Selecione os participantes ou adicione novos."
          icone="grupo"
        />
        <button
          type="button"
          className="btn-secondary w-full"
          onClick={() => setParticipantes((ps) => [...ps, pessoaVazia()])}
        >
          ＋ Adicionar participante
        </button>
        {!participantes.length && (
          <p className="rounded-xl border border-rule bg-slate-50 p-5 text-center text-slate-500">
            Nenhum participante adicionado.
          </p>
        )}
        {participantes.map((p, i) => (
          <div
            key={p.id}
            className="person-card space-y-3"
            role="group"
            aria-label={`Participante ${i + 1}`}
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-semibold">Participante {i + 1}</h3>
              <button
                type="button"
                className="btn-danger"
                onClick={() =>
                  setParticipantes((ps) => ps.filter((x) => x.id !== p.id))
                }
                aria-label={`Excluir participante ${i + 1}`}
              >
                Excluir
              </button>
            </div>
            <label className="block">
              <span className="label">Nome</span>
              <input
                className="field"
                list="nomes-cadastrados"
                aria-label={`Nome do participante ${i + 1}`}
                value={p.nome}
                onChange={(e) => {
                  const conhecido = cfg.pessoas.find(
                    (x) => x.nome === e.target.value,
                  )
                  atualizar(p.id, {
                    nome: e.target.value,
                    ...(conhecido ? { cargo: conhecido.cargo } : {}),
                  })
                }}
              />
            </label>
            <label className="block">
              <span className="label">Cargo ou função (opcional)</span>
              <input
                className="field"
                list="cargos-cadastrados"
                aria-label={`Cargo do participante ${i + 1}`}
                value={p.cargo}
                onChange={(e) => atualizar(p.id, { cargo: e.target.value })}
              />
            </label>
            {categoria(p.cargo) === 'responsavel' && (
              <>
                <label className="block">
                  <span className="label">Aluno (opcional)</span>
                  <input
                    className="field"
                    aria-label={`Aluno do responsável ${i + 1}`}
                    value={p.aluno}
                    onChange={(e) => atualizar(p.id, { aluno: e.target.value })}
                  />
                </label>
                <label className="block">
                  <span className="label">Tratamento do aluno</span>
                  <select
                    className="field"
                    aria-label={`Tratamento do aluno ${i + 1}`}
                    value={p.tratamento}
                    onChange={(e) =>
                      atualizar(p.id, {
                        tratamento: e.target.value as TratamentoAluno,
                      })
                    }
                  >
                    <option value="aluno(a)">Aluno(a) — não informado</option>
                    <option value="aluno">Aluno</option>
                    <option value="aluna">Aluna</option>
                  </select>
                </label>
              </>
            )}
            {categoria(p.cargo) !== 'funcionario' && (
              <label className="block">
                <span className="label">Turma (opcional)</span>
                <input
                  className="field"
                  aria-label={`Turma do participante ${i + 1}`}
                  value={p.turma}
                  onChange={(e) => atualizar(p.id, { turma: e.target.value })}
                />
              </label>
            )}
            {tipo === 'orientacao' && (
              <label className="flex min-h-12 items-center gap-3">
                <input
                  type="checkbox"
                  className="size-6"
                  checked={p.recebeOrientacao}
                  onChange={(e) =>
                    atualizar(p.id, { recebeOrientacao: e.target.checked })
                  }
                />
                Recebe a orientação
              </label>
            )}
          </div>
        ))}
      </section>
      <section className="card space-y-4">
        <h2>Dados da reunião</h2>
        <div className="grid grid-cols-3 gap-3">
          <label>
            <span className="label">Ata nº</span>
            <input
              className="field"
              type="number"
              min={1}
              value={numero}
              onChange={(e) => setNumero(Number(e.target.value))}
            />
          </label>
          <label className="col-span-2">
            <span className="label">Data</span>
            <input
              className="field"
              type="date"
              value={data}
              onChange={(e) => setData(e.target.value)}
            />
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            <span className="label">Início</span>
            <input
              className="field"
              type="time"
              value={horaInicio}
              onChange={(e) => setHoraInicio(e.target.value)}
            />
          </label>
          <label>
            <span className="label">Término (opcional)</span>
            <input
              className="field"
              type="time"
              value={horaFim}
              onChange={(e) => setHoraFim(e.target.value)}
            />
          </label>
        </div>
        <label className="block">
          <span className="label">Local</span>
          <input
            className="field"
            value={local}
            onChange={(e) => setLocal(e.target.value)}
          />
        </label>
      </section>
      {!cfg.apiKey.trim() && !cfg.groqApiKey.trim() && (
        <p className="card border-amber-300 bg-amber-50 text-amber-900">
          Para usar IA, cadastre uma chave em{' '}
          <Link to="/config" className="underline">
            Configurações
          </Link>
          . Digitar e usar como está funciona sem chave.
        </p>
      )}
      <RegistroReuniao
        modoRegistro={modoRegistro}
        setModoRegistro={setModoRegistro}
        anotacoes={anotacoes}
        setAnotacoes={setAnotacoes}
        audio={audio}
        onAudio={(f, s) => {
          setAudio(f)
          setSessao(s)
        }}
        tempoMs={tempoMs}
        setTempoMs={setTempoMs}
        gravando={gravando}
        setGravando={setGravando}
        salvando={salvando}
        salvoAutomatico={salvoAutomatico}
      />
      <section className="card space-y-4">
        <h2>{tipo === 'orientacao' ? 'Assuntos da orientação' : 'Pauta'}</h2>
        <AssuntosSugeridos
          sugestoes={assuntosSugeridos(
            chavesDeAssuntos(
              tipo,
              meta.participantes
                .filter((p) => p.recebeOrientacao)
                .map((p) => p.categoria ?? 'funcionario'),
            ),
            cfg.assuntosExtras,
          )}
          pauta={pauta}
          onChange={setPauta}
        />
        {pauta.map((p, i) => (
          <div key={i} className="flex gap-2">
            <input
              className="field"
              aria-label={`Item ${i + 1} da pauta`}
              value={p}
              onChange={(e) =>
                setPauta((ps) =>
                  ps.map((x, j) => (j === i ? e.target.value : x)),
                )
              }
            />
            {pauta.length > 1 && (
              <button
                type="button"
                className="btn-secondary"
                aria-label={`Excluir item ${i + 1}`}
                onClick={() => setPauta((ps) => ps.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          className="btn-secondary w-full"
          onClick={() => setPauta((ps) => [...ps, ''])}
        >
          ＋ Adicionar item
        </button>
      </section>
      <section className="card space-y-4">
        <h2>Outras opções</h2>
        <label className="flex min-h-12 items-center gap-3">
          <input
            className="size-6 shrink-0"
            type="checkbox"
            checked={anonimizar}
            onChange={(e) => setAnonimizar(e.target.checked)}
          />
          Não citar nomes de alunos (usar iniciais)
        </label>
        <label className="block">
          <span className="label">Glossário (um termo por linha)</span>
          <textarea
            className="field"
            rows={3}
            value={glossario}
            onChange={(e) => setGlossario(e.target.value)}
          />
        </label>
      </section>
      {erro && (
        <p role="alert" className="card border-red-300 bg-red-50 text-red-800">
          {erro}
        </p>
      )}
      {modoRegistro === 'digitar' && (
        <section id="opcoes-texto" tabIndex={-1} className="card space-y-3">
          <h2>Como preparar a ata?</h2>
          <p className="text-sm text-slate-600">
            Organize suas anotações com IA ou mantenha seu texto, com a abertura
            e o encerramento da escola.
          </p>
          <button
            type="submit"
            value="organizar"
            className="btn-primary w-full"
            disabled={
              salvando || (!cfg.apiKey.trim() && !cfg.groqApiKey.trim())
            }
          >
            Organizar com IA
          </button>
          <button
            type="submit"
            value="usar"
            className="btn-secondary w-full"
            disabled={salvando}
          >
            Usar como está
          </button>
        </section>
      )}
      <div className="action-bar">
        <div className="mx-auto max-w-3xl sm:px-8">
          {modoRegistro === 'digitar' ? (
            <button
              type="button"
              className="btn-primary w-full"
              onClick={() => {
                const opcoes = document.getElementById('opcoes-texto')
                opcoes?.scrollIntoView({ block: 'center' })
                opcoes?.focus()
              }}
            >
              Continuar
            </button>
          ) : (
            <button
              type="submit"
              className="btn-primary w-full"
              disabled={salvando || gravando}
            >
              {salvando ? 'Salvando…' : 'Transcrever o áudio'}
            </button>
          )}
        </div>
      </div>
    </form>
  )
}
