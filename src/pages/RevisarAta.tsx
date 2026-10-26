import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { extrairResumo, listarOrientados, quemLavra, quemOrienta, validateAta } from '../ata-api'
import { finalizarAta, patchAta, reabrirAta } from '../db'
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
  const [revisada, setRevisada] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  const area = useRef<HTMLTextAreaElement>(null)
  const cursor = useRef(0)

  useEffect(() => {
    if (ata?.renderizada) setTexto(ata.textoEditado ?? ata.renderizada.texto)
  }, [ata])
  useDebouncedEffect(() => {
    if (texto !== null && !salvo && !ata?.finalizadaEm) patchAta(id, { textoEditado: texto }).then(() => setSalvo(true)).catch(e => setErro(e.message))
  }, [texto, ata?.finalizadaEm])

  const problemas = useMemo(
    () => (ata?.renderizada && texto !== null ? validateAta({ ...ata.renderizada, texto }) : []),
    [ata, texto],
  )
  const marcadores = useMemo(() => (texto ? listarMarcadores(texto) : []), [texto])
  const resumo = useMemo(() => {
    if (!ata?.renderizada || texto === null) return null
    return texto === ata.renderizada.texto ? (ata.resumo ?? extrairResumo(ata.extraida ?? texto, ata.meta)) : extrairResumo(texto, ata.meta)
  }, [ata, texto])
  const lista = useMemo(
    () => (ata ? listaDePresenca(
      ata.meta.participantes,
      // na orientação só vale quem foi informado (o cadastro inteiro não é convocado)
      ata.meta.tipo === 'orientacao' ? [] : settings?.pessoas ?? [],
      [quemOrienta(ata.meta), quemLavra(ata.meta), ...listarOrientados(ata.meta)],
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
    if (atual.finalizadaEm) return
    setRevisada(false)
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
  const finalizada = !!atual.finalizadaEm

  return (
    <div className="space-y-5">
      <div><p className="eyebrow mb-2">REVISÃO DO DOCUMENTO</p><h1 className="break-words">{atual.renderizada!.titulo}</h1></div>
      <div className="text-sm text-slate-600">{atual.renderizada!.cabecalho.filter(Boolean).join(' · ')}</div>
      <p className={`rounded-xl border p-4 font-semibold ${finalizada ? 'border-green-300 bg-green-50 text-green-900' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
        {finalizada ? `Finalizada em ${new Date(atual.finalizadaEm!).toLocaleString('pt-BR')}` : 'Rascunho — revise antes de assinar.'}
      </p>
      {erro && <p role="alert" className="card text-red-800">{erro}</p>}

      {atual.provedorRedacao && <p className="text-sm text-slate-600">Redação: {atual.provedorRedacao === 'groq' ? 'Groq' : 'Gemini'} · {atual.modeloRedacao}</p>}
      <AvisoModeloEconomico modelo={atual.modeloRedacao} />
      {resumo && <section className="card space-y-4" aria-label="Resumo da reunião">
        <h2>Resumo para conferir</h2><p className="text-sm text-slate-600">Confira estes pontos com o texto completo antes de finalizar.</p>
        {([['Assuntos', resumo.assuntos], ['Decisões', resumo.decisoes], ['Encaminhamentos', resumo.encaminhamentos]] as const).map(([titulo, itens]) => <div key={titulo}><h3 className="font-semibold">{titulo}</h3>{itens.length ? <ul className="mt-2 list-disc space-y-2 pl-5">{itens.map((item, i) => <li key={i}>{item}</li>)}</ul> : <p className="mt-2 text-sm text-slate-600">Nenhum registro identificado.</p>}</div>)}
      </section>}

      <section className="card space-y-4">
        <h2 className="font-semibold">Quem estava presente</h2>
        <p className="text-sm text-slate-600">Marque quem compareceu. A abertura, a lista de ausentes e as assinaturas são refeitas na hora.</p>
        <ul className="space-y-3">
          {(mesmaPessoa(quemOrienta(atual.meta), quemLavra(atual.meta)) ? [quemOrienta(atual.meta)] : [quemOrienta(atual.meta), quemLavra(atual.meta)]).map((p, i) => (
            <li key={`fixo${i}`}>
              <label className="flex min-h-12 items-center gap-3 rounded-xl border border-rule bg-slate-50 p-4">
                <input type="checkbox" className="size-6 shrink-0 accent-blue-900" checked disabled />
                <span><b>{p.nome}</b> {p.cargo && <span className="text-slate-600">— {p.cargo}</span>} <span className="text-xs text-slate-500">({atual.meta.responsavel ? atual.meta.tipo === 'orientacao' ? 'orientou e lavrou a ata' : 'fez a ata' : mesmaPessoa(quemOrienta(atual.meta), quemLavra(atual.meta)) ? 'presidiu e lavrou a ata' : i === 0 ? 'presidiu' : 'lavrou a ata'})</span></span>
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
                <input type="checkbox" className="size-6 shrink-0 accent-blue-900" checked={p.presente} disabled={finalizada || ocupado} onChange={() => alternarPresenca(i)} />
                <span className="min-w-0 break-words"><b className="block text-ink">{p.nome}</b><span className="mt-1 block text-slate-600">{rotuloDoParticipante(p)}</span></span>
              </label>
            </li>
          ))}
        </ul>
        {lista.length === 0 && (
          <p className="text-sm text-slate-600">Nenhum outro participante.{atual.meta.tipo !== 'orientacao' && <> Cadastre professores e funcionários em <Link to="/config" className="font-semibold underline">Configurações</Link>.</>}</p>
        )}
        {textoDesatualizado && !finalizada && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900" role="alert">
            <p>Você editou à mão o início do texto, então a abertura não pôde ser atualizada com a nova presença (as assinaturas já foram).</p>
            <button className="btn-secondary mt-2 w-full" onClick={refazerTexto}>Refazer o texto com a nova presença (perde as edições)</button>
          </div>
        )}
      </section>

      {!finalizada && marcadores.length > 0 && (
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
          value={texto} readOnly={finalizada || ocupado} onChange={e => { setTexto(e.target.value); setSalvo(false); setRevisada(false) }}
        />
        <p className="mt-1 text-sm text-slate-600" aria-live="polite">{salvo ? 'Salvo.' : 'Salvando…'}</p>
      </div>

      <section className="card">
        <h2 className="font-semibold">Assinam</h2>
        <ul className="mt-3 space-y-3 divide-y divide-slate-200 text-base text-slate-700">
          {atual.renderizada!.assinaturas.map((p, i) => <li key={i}>{p.nome}{p.cargo ? ` — ${p.cargo}` : ''}</li>)}
        </ul>
      </section>

      <section className="card space-y-4" aria-label="Finalização da ata">
        <h2>{finalizada ? 'Documento finalizado' : 'Conferência final'}</h2>
        {finalizada ? <><p>Esta ata está somente para leitura. Para alterar o conteúdo, reabra para correção. A data da reabertura ficará registrada.</p>
          <button className="btn-secondary w-full" disabled={ocupado} onClick={async () => {
            setOcupado(true); setErro('')
            try { setAta(await reabrirAta(id)); setRevisada(false) } catch (e) { setErro((e as Error).message) }
            finally { setOcupado(false) }
          }}>Reabrir para correção</button></> : <>
          {marcadores.length > 0 && <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900"><p>Antes de finalizar, complete ou confirme estes trechos:</p><ul className="mt-2 list-disc pl-5">{marcadores.map((m, i) => <li key={i}>{m.descricao}</li>)}</ul></div>}
          <label className="flex min-h-12 items-center gap-3"><input type="checkbox" className="size-6 shrink-0" checked={revisada} disabled={ocupado} onChange={e => setRevisada(e.target.checked)} />Revisei a ata e confirmo que está correta</label>
          <button className="btn-primary w-full" disabled={ocupado || !revisada || !!marcadores.length} onClick={async () => {
            setOcupado(true); setErro('')
            try { setAta(await finalizarAta(id, texto, revisada)); setSalvo(true) } catch (e) { setErro((e as Error).message) }
            finally { setOcupado(false) }
          }}>Finalizar ata</button>
        </>}
        {!!atual.reabertaEm?.length && <p className="text-sm text-slate-600">Reaberta para correção em: {atual.reabertaEm.map(d => new Date(d).toLocaleString('pt-BR')).join('; ')}.</p>}
      </section>

      <div className="action-bar">
        <div className="mx-auto flex max-w-3xl gap-2 sm:px-8">
          {atual.modoRegistro !== 'digitar' && <Link to={`/ata/${id}/transcricao`} className="btn-secondary px-3 sm:px-5">← Transcrição</Link>}
          <button
            className="btn-primary flex-1"
            onClick={async () => { if (!finalizada) await patchAta(id, { textoEditado: texto }); nav(`/ata/${id}/imprimir`) }}
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
