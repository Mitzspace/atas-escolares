import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { TIPOS_ATA } from '../ata-api'
import { deleteAta, getSettings, listAtas } from '../db'
import { proximaRota } from '../pipeline'
import type { AtaRecord } from '../types'

const ROTULO: Record<string, string> = {
  rascunho: 'Rascunho', processando: 'Processando', transcricao: 'Transcrição pronta', ata: 'Ata pronta', erro: 'Erro',
}
const COR: Record<string, string> = {
  rascunho: 'bg-slate-100 text-slate-700', processando: 'bg-blue-100 text-blue-800',
  transcricao: 'bg-amber-100 text-amber-800', ata: 'bg-green-100 text-green-800', erro: 'bg-red-100 text-red-800',
}

export default function Inicio() {
  const [atas, setAtas] = useState<AtaRecord[] | null>(null)
  const [semChave, setSemChave] = useState(false)
  const nav = useNavigate()
  const recarregar = () => listAtas().then(setAtas)
  useEffect(() => { recarregar(); getSettings().then(s => setSemChave(!s.apiKey.trim() && !s.groqApiKey.trim())) }, [])

  async function apagar(a: AtaRecord) {
    if (!confirm(`Apagar a ata nº ${a.meta.numero}/${a.meta.ano}? Isso não pode ser desfeito.`)) return
    await deleteAta(a.id)
    recarregar()
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="eyebrow mb-2">ARQUIVO DA ESCOLA</p><h1>Atas de reunião</h1><p className="mt-3 text-slate-600">Da conversa ao registro oficial, passo a passo.</p></div>
        <button className="btn-primary shrink-0" onClick={() => nav('/nova')}>＋ Nova ata</button>
      </div>
      {semChave && (
        <div className="card border-amber-300 bg-amber-50 text-amber-900">
          Antes de começar, cole uma chave do Groq ou do Gemini em{' '}
          <Link to="/config" className="font-semibold underline">Configurações</Link>.
        </div>
      )}
      <div className="flex items-center justify-between border-b border-rule pb-3"><h2>Atas salvas</h2>{atas && <span className="text-slate-600">{atas.length} {atas.length === 1 ? 'registro' : 'registros'}</span>}</div>
      {atas === null ? <p className="text-slate-500">Carregando…</p> : atas.length === 0 ? (
        <div className="card py-10 text-center">
          <span className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-blue-900" aria-hidden="true"><svg width="32" height="32" viewBox="0 0 32 32" fill="none"><path d="M8 3h11l6 6v20H8zM19 3v7h6M12 16h9M12 21h9" stroke="currentColor" strokeWidth="1.7" /></svg></span>
          <h2>O próximo registro começa aqui</h2><p className="mx-auto mt-3 max-w-sm text-slate-600">Nenhuma ata ainda. Toque em “Nova ata” para começar.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {atas.map(a => (
            <li key={a.id} className="card">
              <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
                <div>
                  <p className="font-document text-xl font-semibold text-ink">Ata nº {a.meta.numero}/{a.meta.ano}</p>
                  <p className="mt-2 inline-flex rounded-lg border border-blue-100 bg-blue-50 px-3 py-1 font-medium text-blue-900">{TIPOS_ATA[a.meta.tipo ?? 'pedagogica']?.nome ?? 'Reunião pedagógica'}</p>
                  <p className="mt-2 text-base text-slate-600">{a.meta.data.split('-').reverse().join('/')} · {a.meta.escola}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${COR[a.status]}`}>{ROTULO[a.status]}</span>
              </div>
              {a.erro && <p className="mt-2 text-sm text-red-700">{a.erro}</p>}
              <div className="mt-5 flex flex-wrap gap-2 border-t border-rule pt-4">
                <Link to={proximaRota(a.status, a.id)} className="btn-secondary flex-1">
                  {a.status === 'ata' ? 'Abrir' : a.status === 'erro' ? 'Tentar de novo' : 'Continuar'}
                </Link>
                {a.status === 'ata' && <Link to={`/ata/${a.id}/imprimir`} className="btn-secondary flex-1">Imprimir</Link>}
                <button className="btn-danger" onClick={() => apagar(a)} aria-label={`Apagar ata nº ${a.meta.numero}/${a.meta.ano}`}>Apagar</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
