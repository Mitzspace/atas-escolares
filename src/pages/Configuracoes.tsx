import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import Backup from '../components/Backup'
import LogoEscola from '../components/LogoEscola'
import { adicionarExtra, ASSUNTOS_PADRAO, CHAVES_ASSUNTOS, removerExtra, ROTULOS_ASSUNTOS, type ChaveAssuntos } from '../assuntos'
import { getSettings, saveSettings } from '../db'
import { testarChave } from '../gemini'
import { testarChaveGroq } from '../groq'
import { MODELOS, MODELOS_GROQ, MODELOS_TRANSCRICAO_GROQ, type ProvedorId, type Settings } from '../types'

export default function Configuracoes() {
  const [s, setS] = useState<Settings | null>(null)
  const [verChave, setVerChave] = useState({ groq: false, gemini: false })
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)
  const [testando, setTestando] = useState<ProvedorId | null>(null)
  const [parametros] = useSearchParams()
  const carregado = s !== null
  useEffect(() => { getSettings().then(setS) }, [])
  useEffect(() => {
    if (carregado && parametros.has('backup')) document.getElementById('backup')?.scrollIntoView?.({ block: 'start' })
  }, [carregado, parametros])
  if (!s) return <p className="text-slate-500">Carregando…</p>
  const up = (patch: Partial<Settings>) => { setS({ ...s, ...patch }); setMsg(null) }

  async function salvar() {
    await saveSettings({ ...s!, apiKey: s!.apiKey.trim(), groqApiKey: s!.groqApiKey.trim() })
    setMsg({ ok: true, texto: 'Configurações salvas neste aparelho.' })
  }
  async function testar(provedor: ProvedorId) {
    setTestando(provedor); setMsg(null)
    try {
      if (provedor === 'groq') await testarChaveGroq(s!.groqApiKey.trim())
      else await testarChave(s!.apiKey.trim(), s!.modelo)
      await saveSettings({ ...s!, apiKey: s!.apiKey.trim(), groqApiKey: s!.groqApiKey.trim() })
      setMsg({ ok: true, texto: `Chave do ${provedor === 'groq' ? 'Groq' : 'Gemini'} funcionando! Configurações salvas.` })
    } catch (e) {
      setMsg({ ok: false, texto: (e as Error).message })
    } finally { setTestando(null) }
  }

  return (
    <div className="space-y-6">
      <div><p className="eyebrow mb-2">PREFERÊNCIAS DA ESCOLA</p><h1>Configurações</h1></div>

      <section className="card space-y-3">
        <h2 className="font-semibold">Fornecedores de inteligência artificial</h2>
        <label className="label" htmlFor="provedor-transcricao">Provedor preferido para transcrever</label>
        <select id="provedor-transcricao" className="field" value={s.provedorTranscricaoPreferido} onChange={e => up({ provedorTranscricaoPreferido: e.target.value as ProvedorId })}>
          <option value="groq">Groq Whisper (padrão)</option><option value="gemini">Gemini</option>
        </select>
        <label className="label" htmlFor="provedor-redacao">Provedor preferido para redigir</label>
        <select id="provedor-redacao" className="field" value={s.provedorRedacaoPreferido} onChange={e => up({ provedorRedacaoPreferido: e.target.value as ProvedorId })}>
          <option value="gemini">Gemini (padrão)</option><option value="groq">Groq</option>
        </select>
        <p className="text-sm text-slate-600">Basta uma das chaves. Por padrão transcrevemos com Groq e redigimos com Gemini. Se você cadastrar as duas chaves, usaremos a outra automaticamente em caso de falta de cota, sobrecarga ou falha de conexão. As chaves ficam só neste aparelho.</p>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Groq</h2>
        <p className="text-sm text-slate-600">Crie sua chave em <a className="font-semibold text-blue-800 underline" href="https://console.groq.com/keys" target="_blank" rel="noreferrer">Groq Console</a> e cole abaixo.</p>
        <label className="label" htmlFor="chave-groq">Chave do Groq</label>
        <div className="flex gap-2">
          <input id="chave-groq" className="field" type={verChave.groq ? 'text' : 'password'} autoComplete="off" value={s.groqApiKey} onChange={e => up({ groqApiKey: e.target.value })} placeholder="Cole a chave do Groq" />
          <button type="button" className="btn-secondary" onClick={() => setVerChave(v => ({ ...v, groq: !v.groq }))}>{verChave.groq ? 'Ocultar' : 'Ver'}<span className="sr-only"> chave do Groq</span></button>
        </div>
        <label className="label" htmlFor="modelo-groq">Modelo Groq para redigir a ata</label>
        <select id="modelo-groq" className="field" value={s.modeloGroq} onChange={e => up({ modeloGroq: e.target.value })}>
          {MODELOS_GROQ.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
        </select>
        <label className="label" htmlFor="whisper-groq">Modelo Groq para transcrever</label>
        <select id="whisper-groq" className="field" value={s.modeloTranscricaoGroq} onChange={e => up({ modeloTranscricaoGroq: e.target.value })}>
          {MODELOS_TRANSCRICAO_GROQ.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
        </select>
        <p className="text-sm text-slate-600">O Whisper transcreve em português com tempos, sem separar falantes. Você poderá atribuir quem falou a cada trecho na revisão. Acima de 25 MB, usamos o Gemini quando houver chave; sem ela, dividimos em partes de dez minutos se a memória do aparelho permitir.</p>
        <button className="btn-secondary w-full" onClick={() => testar('groq')} disabled={!s.groqApiKey.trim() || !!testando}>{testando === 'groq' ? 'Testando Groq…' : 'Testar chave do Groq'}</button>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Gemini (redação preferida)</h2>
        <p className="text-sm text-slate-600">Crie uma chave no <a className="font-semibold text-blue-800 underline" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Google AI Studio</a> para redigir as atas e ter reserva na transcrição. Você também pode usar apenas um dos fornecedores.</p>
        <label className="label" htmlFor="chave-gemini">Chave do Gemini (opcional)</label>
        <div className="flex gap-2">
          <input id="chave-gemini" className="field" type={verChave.gemini ? 'text' : 'password'} autoComplete="off" value={s.apiKey} onChange={e => up({ apiKey: e.target.value })} placeholder="Cole a chave do Gemini" />
          <button type="button" className="btn-secondary" onClick={() => setVerChave(v => ({ ...v, gemini: !v.gemini }))}>{verChave.gemini ? 'Ocultar' : 'Ver'}<span className="sr-only"> chave do Gemini</span></button>
        </div>
        <label className="label" htmlFor="modelo">Modelo Gemini para redigir a ata</label>
        <select id="modelo" aria-describedby="ajuda-modelo" className="field" value={s.modelo} onChange={e => up({ modelo: e.target.value })}>
          {MODELOS.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
          {!MODELOS.some(m => m.id === s.modelo) && <option value={s.modelo}>{s.modelo}</option>}
        </select>
        <p id="ajuda-modelo" className="text-sm text-slate-600">Gemini 3.8 Flash é o padrão de melhor qualidade no Gemini. Se estiver sem cota ou sobrecarregado, tentaremos os próximos modelos; os econômicos ficam como alternativa.</p>
        <button className="btn-secondary w-full" onClick={() => testar('gemini')} disabled={!s.apiKey.trim() || !!testando}>{testando === 'gemini' ? 'Testando Gemini…' : 'Testar chave do Gemini'}</button>
        <p className="text-xs text-slate-500">No plano gratuito o Google pode usar o conteúdo enviado para melhorar seus produtos. Prefira citar alunos só por iniciais.</p>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Identidade da escola</h2>
        <LogoEscola logo={s.logoEscola} onTrocar={async logoEscola => {
          await saveSettings({ ...await getSettings(), logoEscola })
          setS(atual => atual ? { ...atual, logoEscola } : atual)
        }} />
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

      <Backup ultimoBackupEm={s.ultimoBackupEm} onRestaurado={async () => { setS(await getSettings()); setMsg(null) }} />

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
