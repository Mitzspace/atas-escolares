import { useEffect, useState } from 'react'
import { adicionarExtra, ASSUNTOS_PADRAO, CHAVES_ASSUNTOS, removerExtra, ROTULOS_ASSUNTOS, type ChaveAssuntos } from '../assuntos'
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
      <div><p className="eyebrow mb-2">PREFERÊNCIAS DA ESCOLA</p><h1>Configurações</h1></div>

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
          <label className="label" htmlFor="modelo">Modelo para redigir a ata</label>
          <select id="modelo" aria-describedby="ajuda-modelo" className="field" value={s.modelo} onChange={e => up({ modelo: e.target.value })}>
            {MODELOS.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
            {!MODELOS.some(m => m.id === s.modelo) && <option value={s.modelo}>{s.modelo}</option>}
          </select>
          <p id="ajuda-modelo" className="mt-1 text-sm text-slate-600">Gemini 3.8 Flash é o padrão de melhor qualidade. Se o modelo escolhido estiver sem cota ou sobrecarregado, tentaremos os próximos; os modelos econômicos ficam como alternativa.</p>
        </div>
        <button className="btn-secondary w-full" onClick={testar} disabled={!s.apiKey.trim() || testando}>{testando ? 'Testando…' : 'Testar a chave'}</button>
        <p className="text-xs text-slate-500">No plano gratuito o Google pode usar o conteúdo enviado para melhorar seus produtos. Prefira citar alunos só por iniciais.</p>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Escola</h2>
        <div><label className="label" htmlFor="escola">Nome da escola</label><input id="escola" className="field" value={s.escola} onChange={e => up({ escola: e.target.value })} /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label" htmlFor="rede">Rede</label><input id="rede" className="field" value={s.rede} onChange={e => up({ rede: e.target.value })} /></div>
          <div><label className="label" htmlFor="municipioUf">Município/UF</label><input id="municipioUf" className="field" value={s.municipioUf} onChange={e => up({ municipioUf: e.target.value })} /></div>
        </div>
        <div><label className="label" htmlFor="local">Local habitual das reuniões</label><input id="local" className="field" value={s.local} onChange={e => up({ local: e.target.value })} /></div>
        <div><label className="label" htmlFor="glossario">Glossário padrão (um termo por linha)</label><textarea id="glossario" className="field" rows={3} value={s.glossario} onChange={e => up({ glossario: e.target.value })} /></div>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Assuntos padrão das atas</h2>
        <p className="text-sm text-slate-600">Aparecem como sugestões na pauta de cada tipo de ata. Os padrões não podem ser removidos; acrescente os assuntos da sua escola.</p>
        {CHAVES_ASSUNTOS.map(k => (
          <GrupoAssuntos key={k} chave={k} extras={s.assuntosExtras[k] ?? []}
            onAdd={t => up({ assuntosExtras: adicionarExtra(s.assuntosExtras, k, t) })}
            onRemove={t => up({ assuntosExtras: removerExtra(s.assuntosExtras, k, t) })} />
        ))}
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Professores e funcionários</h2>
        <p className="text-sm text-slate-600">Aparecem já na lista de participantes de cada nova ata.</p>
        {s.pessoas.map((p, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto] gap-3 rounded-xl border border-rule bg-slate-50 p-3 sm:grid-cols-[1fr_1fr_auto]">
            <input className="field" aria-label={`Nome da pessoa ${i + 1}`} value={p.nome} placeholder="Nome" onChange={e => up({ pessoas: s.pessoas.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)) })} />
            <input className="field col-start-1 sm:col-start-auto" aria-label={`Cargo da pessoa ${i + 1}`} value={p.cargo} placeholder="Cargo" onChange={e => up({ pessoas: s.pessoas.map((x, j) => (j === i ? { ...x, cargo: e.target.value } : x)) })} />
            <button type="button" className="btn-danger col-start-2 row-start-1 sm:col-start-auto sm:row-start-auto px-3" aria-label="Remover" onClick={() => up({ pessoas: s.pessoas.filter((_, j) => j !== i) })}>✕</button>
          </div>
        ))}
        <button type="button" className="btn-secondary w-full" onClick={() => up({ pessoas: [...s.pessoas, { nome: '', cargo: 'Professor(a)' }] })}>＋ Adicionar pessoa</button>
      </section>

      {msg && <div role="status" className={`card ${msg.ok ? 'border-green-300 bg-green-50 text-green-800' : 'border-red-300 bg-red-50 text-red-800'}`}>{msg.texto}</div>}
      <button className="btn-primary w-full" onClick={salvar}>Salvar</button>
    </div>
  )
}

function GrupoAssuntos({ chave, extras, onAdd, onRemove }: { chave: ChaveAssuntos; extras: string[]; onAdd: (t: string) => void; onRemove: (t: string) => void }) {
  const [novo, setNovo] = useState('')
  const adicionar = () => { if (novo.trim()) { onAdd(novo); setNovo('') } }
  return (
    <details className="subject-group group">
      <summary className="subject-summary"><span className="min-w-0 flex-1">{ROTULOS_ASSUNTOS[chave]}</span><span className="rounded-full border border-rule bg-white px-3 py-1 font-normal text-slate-700">{ASSUNTOS_PADRAO[chave].length + extras.length}</span><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 transition-transform group-open:rotate-180" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg></summary>
      <div className="space-y-4 border-t border-rule p-4">
      <h3 className="font-semibold text-slate-700">Assuntos padrão · somente leitura</h3>
      <ul className="list-disc space-y-3 pl-5 text-base text-slate-700">
        {ASSUNTOS_PADRAO[chave].map(a => <li key={a}>{a}</li>)}
      </ul>
      {extras.length > 0 && (
        <div className="border-t border-rule pt-4"><h3 className="mb-3 font-semibold text-ink">Assuntos da escola</h3><ul className="space-y-3">
          {extras.map(a => (
            <li key={a} className="flex items-start gap-3">
              <span className="min-w-0 flex-1 break-words rounded-xl border border-blue-100 bg-blue-50 px-3 py-3 text-base text-blue-900">{a}</span>
              <button type="button" className="btn-danger px-3" onClick={() => onRemove(a)} aria-label={`Remover ${a}`}>✕</button>
            </li>
          ))}
        </ul></div>
      )}
      <div className="grid gap-3 border-t border-rule pt-4 sm:grid-cols-[1fr_auto]">
        <input className="field" value={novo} onChange={e => setNovo(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); adicionar() } }} placeholder="Assunto da escola" aria-label={`Novo assunto de ${ROTULOS_ASSUNTOS[chave]}`} />
        <button type="button" className="btn-secondary" onClick={adicionar} disabled={!novo.trim()}>Adicionar</button>
      </div>
      </div>
    </details>
  )
}
