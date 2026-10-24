import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { validateAta } from '../ata-api'
import { patchAta } from '../db'
import { useAta, useDebouncedEffect } from '../hooks'

export default function RevisarAta() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const [ata] = useAta(id)
  const [texto, setTexto] = useState<string | null>(null)
  const [salvo, setSalvo] = useState(true)
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
  const pendentes = texto ? (texto.match(/\[PENDENTE[^\]]*\]|\[trecho inaudível\]/gi) ?? []).length : 0

  if (ata === undefined) return <p className="text-slate-500">Carregando…</p>
  if (!ata?.renderizada || texto === null) return <p>Ata não encontrada. <Link to="/" className="underline">Voltar</Link></p>

  function proximaPendencia() {
    const re = /\[PENDENTE[^\]]*\]|\[trecho inaudível\]/gi
    re.lastIndex = cursor.current
    const m = re.exec(texto!) ?? (re.lastIndex = 0, re.exec(texto!))
    if (!m || !area.current) return
    cursor.current = m.index + m[0].length
    area.current.focus()
    area.current.setSelectionRange(m.index, m.index + m[0].length)
  }

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">{ata.renderizada.titulo}</h1>
      <div className="text-sm text-slate-600">{ata.renderizada.cabecalho.filter(Boolean).join(' · ')}</div>

      {(problemas.length > 0 || ata.renderizada.pendencias.length > 0 || pendentes > 0) && (
        <section className="space-y-3">
          {ata.renderizada.pendencias.length > 0 && (
            <div className="card border-amber-300 bg-amber-50 text-amber-900">
              <h2 className="font-semibold">Confirme antes de imprimir</h2>
              <ul className="mt-1 list-disc space-y-1 pl-5">{ata.renderizada.pendencias.map((p, i) => <li key={i}>{p}</li>)}</ul>
            </div>
          )}
          {problemas.length > 0 && (
            <div className="card border-red-300 bg-red-50 text-red-800" role="alert">
              <h2 className="font-semibold">Problemas de formato</h2>
              <ul className="mt-1 list-disc space-y-1 pl-5">{problemas.map((p, i) => <li key={i}>{p}</li>)}</ul>
            </div>
          )}
          {pendentes > 0 && (
            <button className="btn-secondary w-full" onClick={proximaPendencia}>
              Ir para o próximo trecho a completar ({pendentes})
            </button>
          )}
        </section>
      )}

      <div>
        <label className="label" htmlFor="texto-ata">Texto da ata (edite à vontade)</label>
        <textarea
          id="texto-ata" ref={area} className="field font-serif leading-relaxed" rows={18}
          value={texto} onChange={e => { setTexto(e.target.value); setSalvo(false) }}
        />
        <p className="mt-1 text-sm text-slate-600" aria-live="polite">{salvo ? 'Salvo.' : 'Salvando…'}</p>
      </div>

      <section className="card">
        <h2 className="font-semibold">Assinam</h2>
        <ul className="mt-1 text-sm text-slate-700">
          {ata.renderizada.assinaturas.map((p, i) => <li key={i}>{p.nome} — {p.cargo}</li>)}
        </ul>
      </section>

      <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white p-3">
        <div className="mx-auto flex max-w-3xl gap-2">
          <Link to={`/ata/${id}/transcricao`} className="btn-secondary">← Transcrição</Link>
          <button
            className="btn-primary flex-1"
            onClick={async () => { await patchAta(id, { textoEditado: texto }); nav(`/ata/${id}/imprimir`) }}
          >Imprimir / PDF</button>
        </div>
      </div>
    </div>
  )
}
