import { useEffect, useId, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { quemLavra, quemOrienta, ehFalanteGenerico, type TranscriptSegment } from '../ata-api'
import { patchAta } from '../db'
import { useAta, useDebouncedEffect, useSettings } from '../hooks'
import { identificarFalantes } from '../provedores'

export default function RevisarTranscricao() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const listaFalantesId = useId()
  const [ata] = useAta(id)
  const [segs, setSegs] = useState<TranscriptSegment[] | null>(null)
  const [salvo, setSalvo] = useState(true)
  const [settings] = useSettings()
  const [identificando, setIdentificando] = useState(false)
  const [mensagem, setMensagem] = useState('')

  useEffect(() => { if (ata?.transcript) setSegs(ata.transcript) }, [ata])
  useDebouncedEffect(() => {
    if (segs && !salvo && !ata?.finalizadaEm) patchAta(id, { transcript: segs }).then(() => setSalvo(true))
  }, [segs, ata?.finalizadaEm])

  const falantes = useMemo(() => [...new Set((segs ?? []).map(s => s.speaker))], [segs])

  if (ata === undefined) return <p className="text-slate-500">Carregando…</p>
  if (!ata || !segs) return <p>Transcrição não encontrada. <Link to="/" className="underline">Voltar</Link></p>
  if (ata.finalizadaEm) return <div className="space-y-4"><h1>Transcrição — somente leitura</h1><p>A ata foi finalizada. Reabra para correção antes de alterar a transcrição.</p><ul className="space-y-3">{segs.map((s, i) => <li className="card" key={i}><b>{s.speaker} · {s.start}–{s.end}</b><p>{s.text}</p></li>)}</ul><Link className="btn-secondary" to={`/ata/${id}/revisar`}>Voltar à ata</Link></div>

  const mudar = (novo: TranscriptSegment[]) => { setSegs(novo); setSalvo(false) }
  const renomear = (de: string, para: string) => mudar(segs.map(s => (s.speaker === de ? { ...s, speaker: para } : s)))

  async function gerar() {
    await patchAta(id, { transcript: segs! })
    nav(`/ata/${id}/processando/ata`)
  }

  async function identificar() {
    if (!settings || !segs || !ata || identificando) return
    setIdentificando(true); setMensagem('Identificando quem falou…')
    try {
      await patchAta(id, { transcript: segs })
      const resultado = await identificarFalantes(segs, ata.meta.participantes, { settings, meta: ata.meta,
        onProgress: rotulo => setMensagem(rotulo) })
      setSegs(resultado.dados)
      await patchAta(id, { transcript: resultado.dados })
      setSalvo(true)
      setMensagem(`${resultado.identificados} trechos identificados. Confira os nomes; o que não for inequívoco permanece como Falante não identificado.`)
    } catch (e) { setMensagem((e as Error).message) }
    finally { setIdentificando(false) }
  }

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Revisar a transcrição</h1>
      <p className="text-sm text-slate-600">
        Corrija o que estiver errado e dê nome a quem falou. O que você escrever aqui é o que vai para a ata.
        {' '}<span aria-live="polite">{salvo ? 'Salvo.' : 'Salvando…'}</span>
      </p>

      {ata.provedorTranscricao && <p className="text-sm text-slate-600">Transcrição: {ata.provedorTranscricao === 'groq' ? 'Groq' : 'Gemini'} · {ata.modeloTranscricao}</p>}
      {ata.provedorTranscricao === 'groq' && <p role="status" className="card border-blue-200 bg-blue-50 text-blue-900">O Whisper não separa falantes. A identificação por contexto só atribui nomes quando houver evidência. Confira cada trecho; “Falante não identificado” pode representar pessoas diferentes.</p>}
      <section className="card space-y-3"><h2>Falantes identificados</h2><p>{falantes.filter(f => !ehFalanteGenerico(f)).join(' · ') || 'Nenhum nome identificado com segurança.'}</p><p className="text-sm text-slate-600">{segs.filter(s => ehFalanteGenerico(s.speaker)).length} trecho(s) para atribuir manualmente.</p>
        <button className="btn-secondary w-full" disabled={identificando || !settings || (!settings.apiKey && !settings.groqApiKey)} onClick={identificar}>Identificar de novo com IA</button>
        {mensagem && <p role="status">{mensagem}</p>}
      </section>
      <datalist id={listaFalantesId}>
        {[...new Set([quemOrienta(ata.meta).nome, quemLavra(ata.meta).nome, ...ata.meta.participantes.map(p => p.nome)])].filter(Boolean).map(nome => <option key={nome} value={nome} />)}
      </datalist>
      <section className="card space-y-3">
        <h2 className="font-semibold">Renomear falante em todos os trechos</h2>
        {falantes.map(f => (
          <FalanteInput key={f} nome={f} onRenomear={renomear} />
        ))}
      </section>

      <ul className="space-y-3">
        {segs.map((s, i) => (
          <li key={i} className="card space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-base text-slate-600">
              <span><b className="text-slate-900">{s.speaker}</b> · {s.start}–{s.end}</span>
              <button className="btn-danger shrink-0 px-3" onClick={() => mudar(segs.filter((_, j) => j !== i))} aria-label="Remover trecho">Remover</button>
            </div>
            <label className="block"><span className="label">Quem falou neste trecho</span>
              <input className="field" disabled={identificando} list={listaFalantesId} aria-label={`Falante do trecho ${i + 1}`} value={s.speaker}
                onChange={e => mudar(segs.map((x, j) => j === i ? { ...x, speaker: e.target.value } : x))}
                onBlur={() => { if (!s.speaker.trim()) mudar(segs.map((x, j) => j === i ? { ...x, speaker: 'Falante' } : x)) }} />
            </label>
            <textarea
              disabled={identificando} aria-label={`Trecho de ${s.speaker}, ${s.start} a ${s.end}`} className="field" rows={Math.max(2, Math.ceil(s.text.length / 45))}
              value={s.text} onChange={e => mudar(segs.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
            />
          </li>
        ))}
      </ul>

      <div className="action-bar">
        <div className="mx-auto max-w-3xl"><button className="btn-primary w-full" disabled={identificando} onClick={gerar}>Gerar a ata</button></div>
      </div>
    </div>
  )
}

function FalanteInput({ nome, onRenomear }: { nome: string; onRenomear: (de: string, para: string) => void }) {
  const [v, setV] = useState(nome)
  useEffect(() => setV(nome), [nome])
  return (
    <div className="flex items-center gap-2">
      <input className="field" value={v} onChange={e => setV(e.target.value)} onBlur={() => v.trim() && v !== nome && onRenomear(nome, v.trim())} aria-label={`Nome de ${nome}`} />
    </div>
  )
}
