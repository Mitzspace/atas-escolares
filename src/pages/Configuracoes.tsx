import { useEffect, useState } from 'react'
import { getSettings, saveSettings } from '../db'
import { testarChave } from '../gemini'
import { MODELOS, type Settings } from '../types'

export default function Configuracoes() {
  const [s, setS] = useState<Settings | null>(null)
  const [verChave, setVerChave] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)
  const [testando, setTestando] = useState(false)
  useEffect(() => { getSettings().then(setS) }, [])
  if (!s) return <p className="text-slate-500">Carregando…</p>
  const up = (patch: Partial<Settings>) => { setS({ ...s, ...patch }); setMsg(null) }

  async function salvar() {
    await saveSettings({ ...s!, apiKey: s!.apiKey.trim() })
    setMsg({ ok: true, texto: 'Configurações salvas neste aparelho.' })
  }
  async function testar() {
    setTestando(true); setMsg(null)
    try {
      await testarChave(s!.apiKey.trim(), s!.modelo)
      await saveSettings({ ...s!, apiKey: s!.apiKey.trim() })
      setMsg({ ok: true, texto: 'Chave funcionando! Configurações salvas.' })
    } catch (e) {
      setMsg({ ok: false, texto: (e as Error).message })
    } finally { setTestando(false) }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Configurações</h1>

      <section className="card space-y-3">
        <h2 className="font-semibold">Chave do Gemini (grátis)</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
          <li>Abra o <a className="font-semibold text-blue-800 underline" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Google AI Studio</a> e entre com sua conta Google.</li>
          <li>Toque em “Criar chave de API” e copie a chave.</li>
          <li>Cole abaixo. Ela fica só neste aparelho.</li>
        </ol>
        <div className="flex gap-2">
          <input className="field" type={verChave ? 'text' : 'password'} autoComplete="off" value={s.apiKey} onChange={e => up({ apiKey: e.target.value })} placeholder="Cole a chave aqui" aria-label="Chave da API" />
          <button type="button" className="btn-secondary" onClick={() => setVerChave(v => !v)}>{verChave ? 'Ocultar' : 'Ver'}</button>
        </div>
        <div>
          <label className="label">Modelo</label>
          <select className="field" value={s.modelo} onChange={e => up({ modelo: e.target.value })}>
            {MODELOS.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
            {!MODELOS.some(m => m.id === s.modelo) && <option value={s.modelo}>{s.modelo}</option>}
          </select>
        </div>
        <button className="btn-secondary w-full" onClick={testar} disabled={!s.apiKey.trim() || testando}>{testando ? 'Testando…' : 'Testar a chave'}</button>
        <p className="text-xs text-slate-500">No plano gratuito o Google pode usar o conteúdo enviado para melhorar seus produtos. Prefira citar alunos só por iniciais.</p>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Escola</h2>
        <div><label className="label">Nome da escola</label><input className="field" value={s.escola} onChange={e => up({ escola: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Rede</label><input className="field" value={s.rede} onChange={e => up({ rede: e.target.value })} /></div>
          <div><label className="label">Município/UF</label><input className="field" value={s.municipioUf} onChange={e => up({ municipioUf: e.target.value })} /></div>
        </div>
        <div><label className="label">Local habitual das reuniões</label><input className="field" value={s.local} onChange={e => up({ local: e.target.value })} /></div>
        {(['presidente', 'secretario'] as const).map(k => (
          <div key={k} className="grid grid-cols-2 gap-3">
            <div><label className="label">{k === 'presidente' ? 'Presidente (padrão)' : 'Secretário(a) (padrão)'}</label><input className="field" value={s[k].nome} onChange={e => up({ [k]: { ...s[k], nome: e.target.value } })} /></div>
            <div><label className="label">Cargo</label><input className="field" value={s[k].cargo} onChange={e => up({ [k]: { ...s[k], cargo: e.target.value } })} /></div>
          </div>
        ))}
        <div><label className="label">Glossário padrão (um termo por linha)</label><textarea className="field" rows={3} value={s.glossario} onChange={e => up({ glossario: e.target.value })} /></div>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Professores e funcionários</h2>
        <p className="text-sm text-slate-600">Aparecem já na lista de participantes de cada nova ata.</p>
        {s.pessoas.map((p, i) => (
          <div key={i} className="flex gap-2">
            <input className="field" value={p.nome} placeholder="Nome" onChange={e => up({ pessoas: s.pessoas.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)) })} />
            <input className="field" value={p.cargo} placeholder="Cargo" onChange={e => up({ pessoas: s.pessoas.map((x, j) => (j === i ? { ...x, cargo: e.target.value } : x)) })} />
            <button type="button" className="btn-secondary px-3" aria-label="Remover" onClick={() => up({ pessoas: s.pessoas.filter((_, j) => j !== i) })}>✕</button>
          </div>
        ))}
        <button type="button" className="btn-secondary w-full" onClick={() => up({ pessoas: [...s.pessoas, { nome: '', cargo: 'Professor(a)' }] })}>＋ Adicionar pessoa</button>
      </section>

      {msg && <div role="status" className={`card ${msg.ok ? 'border-green-300 bg-green-50 text-green-800' : 'border-red-300 bg-red-50 text-red-800'}`}>{msg.texto}</div>}
      <button className="btn-primary w-full" onClick={salvar}>Salvar</button>
    </div>
  )
}
