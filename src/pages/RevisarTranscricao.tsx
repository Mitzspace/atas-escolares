import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { TranscriptSegment } from '../ata-api'
import { patchAta } from '../db'
import { useAta, useDebouncedEffect } from '../hooks'

export default function RevisarTranscricao() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const [ata] = useAta(id)
  const [segs, setSegs] = useState<TranscriptSegment[] | null>(null)
  const [salvo, setSalvo] = useState(true)

  useEffect(() => { if (ata?.transcript) setSegs(ata.transcript) }, [ata])
  useDebouncedEffect(() => {
    if (segs && !salvo) patchAta(id, { transcript: segs }).then(() => setSalvo(true))
  }, [segs])

  const falantes = useMemo(() => [...new Set((segs ?? []).map(s => s.speaker))], [segs])

  if (ata === undefined) return <p className="text-slate-500">Carregando…</p>
  if (!ata || !segs) return <p>Transcrição não encontrada. <Link to="/" className="underline">Voltar</Link></p>

  const mudar = (novo: TranscriptSegment[]) => { setSegs(novo); setSalvo(false) }
  const renomear = (de: string, para: string) => mudar(segs.map(s => (s.speaker === de ? { ...s, speaker: para } : s)))

  async function gerar() {
    await patchAta(id, { transcript: segs! })
    nav(`/ata/${id}/processando/ata`)
  }

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Revisar a transcrição</h1>
      <p className="text-sm text-slate-600">
        Corrija o que estiver errado e dê nome a quem falou. O que você escrever aqui é o que vai para a ata.
        {' '}<span aria-live="polite">{salvo ? 'Salvo.' : 'Salvando…'}</span>
      </p>

      <section className="card space-y-3">
        <h2 className="font-semibold">Quem falou</h2>
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
            <textarea
              aria-label={`Trecho de ${s.speaker}, ${s.start} a ${s.end}`} className="field" rows={Math.max(2, Math.ceil(s.text.length / 45))}
              value={s.text} onChange={e => mudar(segs.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
            />
          </li>
        ))}
      </ul>

      <div className="action-bar">
        <div className="mx-auto max-w-3xl"><button className="btn-primary w-full" onClick={gerar}>Gerar a ata</button></div>
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
