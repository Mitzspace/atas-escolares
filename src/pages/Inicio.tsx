import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
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
  useEffect(() => { recarregar(); getSettings().then(s => setSemChave(!s.apiKey.trim())) }, [])

  async function apagar(a: AtaRecord) {
    if (!confirm(`Apagar a ata nº ${a.meta.numero}/${a.meta.ano}? Isso não pode ser desfeito.`)) return
    await deleteAta(a.id)
    recarregar()
  }

  return (
    <div className="space-y-4">
      {semChave && (
        <div className="card border-amber-300 bg-amber-50 text-amber-900">
          Antes de começar, cole sua chave gratuita do Gemini em{' '}
          <Link to="/config" className="font-semibold underline">Configurações</Link>.
        </div>
      )}
      <button className="btn-primary w-full" onClick={() => nav('/nova')}>＋ Nova ata</button>
      <h2 className="text-lg font-semibold">Atas salvas</h2>
      {atas === null ? <p className="text-slate-500">Carregando…</p> : atas.length === 0 ? (
        <p className="text-slate-500">Nenhuma ata ainda. Toque em “Nova ata” para começar.</p>
      ) : (
        <ul className="space-y-3">
          {atas.map(a => (
            <li key={a.id} className="card">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">Ata nº {a.meta.numero}/{a.meta.ano} – Reunião pedagógica</p>
                  <p className="text-sm text-slate-600">{a.meta.data.split('-').reverse().join('/')} · {a.meta.escola}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${COR[a.status]}`}>{ROTULO[a.status]}</span>
              </div>
              {a.erro && <p className="mt-2 text-sm text-red-700">{a.erro}</p>}
              <div className="mt-3 flex gap-2">
                <Link to={proximaRota(a.status, a.id)} className="btn-secondary flex-1">
                  {a.status === 'ata' ? 'Abrir' : a.status === 'erro' ? 'Tentar de novo' : 'Continuar'}
                </Link>
                {a.status === 'ata' && <Link to={`/ata/${a.id}/imprimir`} className="btn-secondary flex-1">Imprimir</Link>}
                <button className="btn-danger" onClick={() => apagar(a)} aria-label="Apagar">🗑</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
