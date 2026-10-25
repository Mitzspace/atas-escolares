import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { listarOrientados, validateAta } from '../ata-api'
import { patchAta } from '../db'
import { useAta, useDebouncedEffect, useSettings } from '../hooks'
import { rotuloDoParticipante } from '../pessoas'
import { aplicarPresenca, listaDePresenca, mesmaPessoa, listarMarcadores, preencherMarcador, type Marcador } from '../revisao'
import AvisoModeloEconomico from '../components/AvisoModeloEconomico'
import type { AtaRecord } from '../types'

const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').trim()
const ehHoraFim = (m: Marcador) => m.hora && /t[eé]rmino|encerr|fim/i.test(m.descricao)

/** chave estável por marcador: descrição + nº de ocorrência (as posições mudam a cada preenchimento) */
function chaves(ms: Marcador[]) {
  const vistos = new Map<string, number>()
  return ms.map(m => {
    const n = vistos.get(m.descricao) ?? 0
    vistos.set(m.descricao, n + 1)
    return `${m.tipo}|${m.descricao}|${n}`
  })
}

export default function RevisarAta() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const [ata, setAta] = useAta(id)
  const [settings] = useSettings()
  const [texto, setTexto] = useState<string | null>(null)
  const [salvo, setSalvo] = useState(true)
  const [textoDesatualizado, setTextoDesatualizado] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const cursor = useRef(0)

  useEffect(() => {
    if (ata?.renderizada) setTexto(ata.textoEditado ?? ata.renderizada.texto)
  }, [ata])
  useDebouncedEffect(() => {
    if (texto !== null && !salvo) patchAta(id, { textoEditado: texto }).then(() => setSalvo(true))
  }, [texto])

  const problemas = useMemo(
    () => (ata?.renderizada && texto !== null ? validateAta({ ...ata.renderizada, texto }) : []),
    [ata, texto],
  )
  const marcadores = useMemo(() => (texto ? listarMarcadores(texto) : []), [texto])
  const lista = useMemo(
    () => (ata ? listaDePresenca(
      ata.meta.participantes,
      // na orientação só vale quem foi informado (o cadastro inteiro não é convocado)
      ata.meta.tipo === 'orientacao' ? [] : settings?.pessoas ?? [],
      [ata.meta.presidente, ata.meta.secretario, ...listarOrientados(ata.meta)],
    ) : []),
    [ata, settings],
  )
  const paraConferir = useMemo(() => {
    if (!ata?.extraida || !ata.renderizada) return []
    const descs = [...listarMarcadores(ata.renderizada.texto), ...marcadores].map(m => normalizar(m.descricao))
    return ata.extraida.pendencias.filter(p => {
      const n = normalizar(p)
      return n && !descs.some(d => d === n || d.includes(n) || n.includes(d))
    })
  }, [ata, marcadores])

  if (ata === undefined) return <p className="text-slate-500">Carregando…</p>
  if (!ata?.renderizada || texto === null) return <p>Ata não encontrada. <Link to="/" className="underline">Voltar</Link></p>
  const atual: AtaRecord = ata

  /** grava no banco e na tela; o efeito acima atualiza o textarea a partir de `ata` */
  async function aplicar(patch: Partial<AtaRecord>) {
    // Checkbox controlado precisa do novo estado no próprio evento, antes do IndexedDB.
    setAta(a => (a ? { ...a, ...patch } : a))
    await patchAta(id, patch)
    setSalvo(true)
  }

  async function alternarPresenca(i: number) {
    const participantes = lista.map((p, j) => (j === i ? { ...p, presente: !p.presente } : p))
    const r = aplicarPresenca({ ...atual, textoEditado: texto ?? undefined }, participantes)
    setTextoDesatualizado(!r.textoPreservado)
    await aplicar({ meta: r.meta, renderizada: r.renderizada, textoEditado: r.texto, convocados: r.convocados })
  }

  async function refazerTexto() {
    if (!confirm('Refazer o texto do zero com a nova presença? As suas edições no texto serão perdidas.')) return
    setTextoDesatualizado(false)
    await aplicar({ textoEditado: undefined })
  }

  async function preencher(m: Marcador, valor: string) {
    const novo = preencherMarcador(texto!, m, valor)
    const patch: Partial<AtaRecord> = { textoEditado: novo }
    if (ehHoraFim(m) && /^\d{1,2}:\d{2}$/.test(valor.trim())) patch.meta = { ...atual.meta, horaFim: valor.trim() }
    await aplicar(patch)
  }

  function proximaPendencia() {
    if (!marcadores.length || !area.current) return
    const m = marcadores.find(x => x.inicio >= cursor.current) ?? marcadores[0]
    cursor.current = m.fim
    area.current.focus()
    area.current.setSelectionRange(m.inicio, m.fim)
  }

  const ks = chaves(marcadores)

  return (
    <div className="space-y-5">
      <div><p className="eyebrow mb-2">REVISÃO DO DOCUMENTO</p><h1 className="break-words">{atual.renderizada!.titulo}</h1></div>
      <div className="text-sm text-slate-600">{atual.renderizada!.cabecalho.filter(Boolean).join(' · ')}</div>

      {atual.provedorRedacao && <p className="text-sm text-slate-600">Redação: {atual.provedorRedacao === 'groq' ? 'Groq' : 'Gemini'} · {atual.modeloRedacao}</p>}
      <AvisoModeloEconomico modelo={atual.modeloRedacao} />

      <section className="card space-y-4">
        <h2 className="font-semibold">Quem estava presente</h2>
        <p className="text-sm text-slate-600">Marque quem compareceu. A abertura, a lista de ausentes e as assinaturas são refeitas na hora.</p>
        <ul className="space-y-3">
          {(mesmaPessoa(atual.meta.presidente, atual.meta.secretario) ? [atual.meta.presidente] : [atual.meta.presidente, atual.meta.secretario]).map((p, i) => (
            <li key={`fixo${i}`}>
              <label className="flex min-h-12 items-center gap-3 rounded-xl border border-rule bg-slate-50 p-4">
                <input type="checkbox" className="size-6 shrink-0 accent-blue-900" checked disabled />
                <span><b>{p.nome}</b> <span className="text-slate-600">— {p.cargo}</span> <span className="text-xs text-slate-500">({mesmaPessoa(atual.meta.presidente, atual.meta.secretario) ? 'presidiu e lavrou a ata' : i === 0 ? 'presidiu' : 'lavrou a ata'})</span></span>
              </label>
            </li>
          ))}
          {listarOrientados(atual.meta).map((o, i) => (
            <li key={`orientado${i}`}>
              <label className={`flex min-h-12 items-center gap-3 rounded-xl border border-l-4 p-4 ${o.categoria === 'aluno' ? 'border-teal-200 border-l-teal-700 bg-teal-50/40' : 'border-blue-200 border-l-blue-900 bg-blue-50/40'}`}>
                <input type="checkbox" className="size-6 shrink-0 accent-blue-900" checked disabled />
                <span className="min-w-0 break-words"><span className={`person-badge mb-2 ${o.categoria === 'aluno' ? 'bg-teal-100 text-teal-900' : 'bg-blue-100 text-blue-900'}`}>{o.categoria === 'aluno' ? 'Aluno' : 'Funcionário'}</span><b className="block text-ink">{o.nome}</b><span className="mt-1 block text-slate-600">{rotuloDoParticipante(o)}</span><span className="block text-slate-600">(recebeu a orientação)</span></span>
              </label>
            </li>
          ))}
          {lista.map((p, i) => (
            <li key={`${p.nome}|${i}`}>
              <label className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border p-4 transition-colors ${p.presente ? 'border-blue-200 bg-blue-50/50' : 'border-rule bg-slate-50'}`}>
                <input type="checkbox" className="size-6 shrink-0 accent-blue-900" checked={p.presente} onChange={() => alternarPresenca(i)} />
                <span className="min-w-0 break-words"><b className="block text-ink">{p.nome}</b><span className="mt-1 block text-slate-600">{rotuloDoParticipante(p)}</span></span>
              </label>
            </li>
          ))}
        </ul>
        {lista.length === 0 && (
          <p className="text-sm text-slate-600">Nenhum outro participante.{atual.meta.tipo !== 'orientacao' && <> Cadastre professores e funcionários em <Link to="/config" className="font-semibold underline">Configurações</Link>.</>}</p>
        )}
        {textoDesatualizado && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900" role="alert">
            <p>Você editou à mão o início do texto, então a abertura não pôde ser atualizada com a nova presença (as assinaturas já foram).</p>
            <button className="btn-secondary mt-2 w-full" onClick={refazerTexto}>Refazer o texto com a nova presença (perde as edições)</button>
          </div>
        )}
      </section>

      {marcadores.length > 0 && (
        <section className="space-y-4" aria-label="Completar pendências">
          <h2 className="font-semibold">Completar pendências ({marcadores.length})</h2>
          {marcadores.map((m, i) => (
            <CartaoPendencia key={ks[i]} m={m} onPreencher={v => preencher(m, v)} onRemover={() => preencher(m, '')} />
          ))}
        </section>
      )}

      {(paraConferir.length > 0 || problemas.length > 0) && (
        <section className="space-y-3">
          {paraConferir.length > 0 && (
            <div className="card border-amber-300 bg-amber-50 text-amber-900">
              <h2 className="font-semibold text-amber-900">Para conferir</h2>
              <ul className="mt-3 list-disc space-y-3 pl-5">{paraConferir.map((p, i) => <li key={i}>{p}</li>)}</ul>
            </div>
          )}
          {problemas.length > 0 && (
            <div className="card border-red-300 bg-red-50 text-red-800" role="alert">
              <h2 className="font-semibold text-red-800">Problemas de formato</h2>
              <ul className="mt-3 list-disc space-y-3 pl-5">{problemas.map((p, i) => <li key={i}>{p}</li>)}</ul>
            </div>
          )}
        </section>
      )}

      <div>
        <label className="label" htmlFor="texto-ata">Texto da ata (edite à vontade)</label>
        {marcadores.length > 0 && (
          <button className="btn-secondary mb-2 w-full" onClick={proximaPendencia}>Ir para o próximo trecho a completar ({marcadores.length})</button>
        )}
        <textarea
          id="texto-ata" ref={area} className="field font-serif leading-relaxed" rows={18}
          value={texto} onChange={e => { setTexto(e.target.value); setSalvo(false) }}
        />
        <p className="mt-1 text-sm text-slate-600" aria-live="polite">{salvo ? 'Salvo.' : 'Salvando…'}</p>
      </div>

      <section className="card">
        <h2 className="font-semibold">Assinam</h2>
        <ul className="mt-3 space-y-3 divide-y divide-slate-200 text-base text-slate-700">
          {atual.renderizada!.assinaturas.map((p, i) => <li key={i}>{p.nome} — {p.cargo}</li>)}
        </ul>
      </section>

      <div className="action-bar">
        <div className="mx-auto flex max-w-3xl gap-2 sm:px-8">
          <Link to={`/ata/${id}/transcricao`} className="btn-secondary px-3 sm:px-5">← Transcrição</Link>
          <button
            className="btn-primary flex-1"
            onClick={async () => { await patchAta(id, { textoEditado: texto }); nav(`/ata/${id}/imprimir`) }}
          >Imprimir / PDF</button>
        </div>
      </div>
    </div>
  )
}

function CartaoPendencia({ m, onPreencher, onRemover }: { m: Marcador; onPreencher: (v: string) => void; onRemover: () => void }) {
  const campoId = useId()
  const [v, setV] = useState('')
  const removivel = m.tipo !== 'pendente'
  const rotulo = m.tipo === 'inaudivel' ? 'Trecho que não deu para entender' : m.tipo === 'confirmar' ? 'Confirme' : 'Falta informar'
  return (
    <div className="card space-y-4 border-amber-300 border-l-4 bg-white">
      <p className="text-base font-semibold text-amber-900">{rotulo}</p>
      <p className="rounded-xl border border-rule bg-slate-50 p-3 text-base text-slate-600 break-words">{m.contexto ? <>“{m.contexto} <span className="font-semibold text-amber-900">[…]</span>”</> : 'No início do texto'}</p>
      <label htmlFor={campoId} className="label text-slate-900">{m.descricao}</label>
      <input
        id={campoId} className="field" type={m.hora ? 'time' : 'text'} value={v} onChange={e => setV(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && v.trim()) onPreencher(v) }}
        aria-label={m.descricao}
      />
      <div className="flex gap-2">
        <button className="btn-primary flex-1" disabled={!v.trim()} onClick={() => onPreencher(v)}>Preencher</button>
        {removivel && <button className="btn-secondary flex-1" onClick={onRemover}>Remover</button>}
      </div>
    </div>
  )
}
