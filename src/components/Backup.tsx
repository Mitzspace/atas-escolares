import { useState } from 'react'
import { criarBackup, registrarBackupConcluido, restaurarBackup, validarBackup } from '../db'
import type { BackupAtas } from '../types'

const dataLegivel = (data: string | number) => new Date(data).toLocaleString('pt-BR')

function baixar(arquivo: File) {
  const url = URL.createObjectURL(arquivo)
  const link = document.createElement('a')
  link.href = url; link.download = arquivo.name
  document.body.append(link); link.click(); link.remove()
  // Dá tempo para o navegador iniciar o download, inclusive no celular.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export default function Backup({ ultimoBackupEm, onRestaurado }: { ultimoBackupEm?: number; onRestaurado: () => Promise<void> }) {
  const [incluirChaves, setIncluirChaves] = useState(false)
  const [backup, setBackup] = useState<BackupAtas | null>(null)
  const [modo, setModo] = useState<'juntar' | 'substituir'>('juntar')
  const [configuracoes, setConfiguracoes] = useState(false)
  const [chaves, setChaves] = useState(false)
  const [confirmacao, setConfirmacao] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [ultimaExportacao, setUltimaExportacao] = useState<number>()
  const [msg, setMsg] = useState<{ erro: boolean; texto: string } | null>(null)
  const temChaves = backup && (backup.configuracoes.apiKey !== undefined || backup.configuracoes.groqApiKey !== undefined)

  async function exportar() {
    setOcupado(true); setMsg(null)
    try {
      const dados = await criarBackup(incluirChaves)
      const hoje = new Date()
      const data = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`
      const arquivo = new File([JSON.stringify(dados, null, 2)], `atas-escolares-backup-${data}.json`, { type: 'application/json' })
      if (navigator.share && navigator.canShare?.({ files: [arquivo] })) {
        try { await navigator.share({ files: [arquivo], title: 'Backup das atas escolares' }) }
        catch (erro) {
          if ((erro as Error).name === 'AbortError') return
          baixar(arquivo)
        }
      } else baixar(arquivo)
      await registrarBackupConcluido()
      setUltimaExportacao(Date.now())
      setMsg({ erro: false, texto: 'Backup enviado para salvar. Confira o arquivo no destino escolhido. Áudios e gravações não foram incluídos.' })
    } catch {
      setMsg({ erro: true, texto: 'Não foi possível salvar o backup. Tente novamente; as atas continuam neste aparelho.' })
    } finally { setOcupado(false) }
  }

  async function selecionar(arquivo?: File) {
    setBackup(null); setMsg(null); setModo('juntar'); setConfiguracoes(false); setChaves(false); setConfirmacao('')
    if (!arquivo) return
    setOcupado(true)
    try { setBackup(validarBackup(await arquivo.text())) }
    catch (erro) { setMsg({ erro: true, texto: (erro as Error).message }) }
    finally { setOcupado(false) }
  }

  async function restaurar() {
    if (!backup || (modo === 'substituir' && confirmacao !== 'SUBSTITUIR')) return
    setOcupado(true); setMsg(null)
    try {
      const quantidade = await restaurarBackup(backup, { modo, substituirConfiguracoes: configuracoes, incluirChaves: chaves })
      setBackup(null); setChaves(false); setConfirmacao('')
      setMsg({ erro: false, texto: `Restauração concluída: ${quantidade} ${quantidade === 1 ? 'ata importada' : 'atas importadas'}. No modo juntar, registros iguais ou mais recentes deste aparelho foram mantidos.` })
      try { await onRestaurado() }
      catch { setMsg({ erro: false, texto: 'Atas restauradas. Reabra as Configurações para atualizar os campos na tela.' }) }
    } catch {
      setMsg({ erro: true, texto: 'Não foi possível restaurar o backup. Nenhuma alteração parcial foi salva. Tente novamente.' })
    } finally { setOcupado(false) }
  }

  return (
    <section id="backup" className="card scroll-mt-6 space-y-4" aria-labelledby="titulo-backup" aria-busy={ocupado}>
      <h2 id="titulo-backup">Backup</h2>
      <p className="text-slate-600">Guarde suas atas em outro lugar, como no Drive, para recuperar em outro aparelho. O arquivo inclui todas as atas, transcrições, textos editados, presenças, modelos usados e configurações salvas. Não inclui áudios nem pedaços de gravação.</p>
      <p className="text-sm text-slate-600">Salve as alterações das configurações antes de fazer o backup.</p>
      <label className="flex min-h-12 items-center gap-3"><input type="checkbox" className="h-5 w-5 shrink-0" checked={incluirChaves} disabled={ocupado} onChange={e => setIncluirChaves(e.target.checked)} />incluir as chaves de API (guarde o arquivo em local seguro)</label>
      <button type="button" className="btn-primary w-full" disabled={ocupado} onClick={exportar}>Salvar backup</button>
      {(ultimaExportacao ?? ultimoBackupEm) && <p className="text-sm text-slate-600">Último backup: {dataLegivel((ultimaExportacao ?? ultimoBackupEm)!)}</p>}
      <div className="space-y-4 border-t border-rule pt-4">
        <h3 className="font-semibold">Restaurar backup</h3>
        <p className="text-sm text-slate-600">Escolha um arquivo JSON de backup para conferir o conteúdo antes de importar. Atas que ainda precisam de áudio exigirão o envio do arquivo novamente.</p>
        <input id="arquivo-backup" type="file" accept=".json,application/json" className="field" aria-label="Arquivo de backup" disabled={ocupado} onChange={e => { void selecionar(e.target.files?.[0]); e.target.value = '' }} />
        {backup && <div className="space-y-4 rounded-xl border border-rule bg-slate-50 p-4">
          <p role="status">{backup.atas.length} {backup.atas.length === 1 ? 'ata' : 'atas'} · Escola: {backup.configuracoes.escola || 'não informada'} · Backup de {dataLegivel(backup.criadoEm)}</p>
          <fieldset className="space-y-2" disabled={ocupado}>
            <legend className="font-semibold">Como restaurar as atas?</legend>
            <label className="flex min-h-12 items-center gap-3"><input type="radio" name="modo-backup" value="juntar" checked={modo === 'juntar'} onChange={() => { setModo('juntar'); setConfirmacao('') }} />Juntar com as atas deste aparelho</label>
            <p className="text-sm text-slate-600">Para o mesmo identificador, fica a ata com a data de atualização mais recente.</p>
            <label className="flex min-h-12 items-center gap-3"><input type="radio" name="modo-backup" value="substituir" checked={modo === 'substituir'} onChange={() => setModo('substituir')} />Substituir tudo</label>
          </fieldset>
          <label className="flex min-h-12 items-center gap-3"><input type="checkbox" checked={configuracoes} disabled={ocupado} onChange={e => setConfiguracoes(e.target.checked)} />Substituir as configurações pelas do backup</label>
          {temChaves && <label className="flex min-h-12 items-center gap-3"><input type="checkbox" checked={chaves} disabled={ocupado} onChange={e => setChaves(e.target.checked)} />Confirmo importar as chaves de API do backup e substituir as correspondentes neste aparelho</label>}
          {modo === 'substituir' && <div className="space-y-3 rounded-lg border border-red-300 bg-red-50 p-3 text-red-900">
            <p>Isso apagará todas as atas, áudios e gravações deste aparelho e colocará as atas do backup no lugar. Esta ação não pode ser desfeita. Salve um backup atual antes de continuar. Configurações e chaves só mudam se você marcar as opções acima.</p>
            <label className="label" htmlFor="confirmar-substituicao">Digite SUBSTITUIR para confirmar</label>
            <input id="confirmar-substituicao" className="field" autoComplete="off" value={confirmacao} disabled={ocupado} onChange={e => setConfirmacao(e.target.value)} />
          </div>}
          <div className="flex flex-wrap gap-3">
            <button type="button" className={modo === 'substituir' ? 'btn-danger' : 'btn-primary'} disabled={ocupado || (modo === 'substituir' && confirmacao !== 'SUBSTITUIR')} onClick={restaurar}>Restaurar atas</button>
            <button type="button" className="btn-secondary" disabled={ocupado} onClick={() => setBackup(null)}>Cancelar restauração</button>
          </div>
        </div>}
      </div>
      {ocupado && <p role="status">Preparando o backup…</p>}
      {msg && <p role={msg.erro ? 'alert' : 'status'} className={msg.erro ? 'text-red-800' : 'text-green-800'}>{msg.texto}</p>}
    </section>
  )
}
