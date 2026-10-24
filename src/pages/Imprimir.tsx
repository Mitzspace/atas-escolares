import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAta } from '../hooks'
import { baixar, compartilhar, gerarPdfBlob, nomeArquivo } from '../pdf'

export default function Imprimir() {
  const { id = '' } = useParams()
  const [ata] = useAta(id)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : ''), [blob])
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])

  useEffect(() => {
    if (!ata?.renderizada) return
    gerarPdfBlob(ata.renderizada, ata.textoEditado ?? ata.renderizada.texto, ata.meta).then(setBlob).catch(e => setErro(`Não foi possível gerar o PDF: ${e.message}`))
  }, [ata])

  if (ata === undefined) return <p className="text-slate-500">Carregando…</p>
  if (!ata?.renderizada) return <p>Ata não encontrada. <Link to="/" className="underline">Voltar</Link></p>
  const nome = nomeArquivo(ata.renderizada)

  return (
    <div className="space-y-4">
      <div><p className="eyebrow mb-2">DOCUMENTO FINAL</p><h1>Imprimir</h1><p className="mt-3 text-slate-600">Ata nº {ata.meta.numero}/{ata.meta.ano} · {ata.meta.escola}</p></div>
      {erro && <div role="alert" className="card border-red-300 bg-red-50 text-red-800">{erro}</div>}
      {!blob && !erro && <p className="text-slate-500">Gerando o PDF…</p>}
      {blob && (
        <>
          <div className="card grid gap-3 sm:grid-cols-2">
            <button className="btn-primary" onClick={async () => {
              if (!(await compartilhar(blob, nome, ata.renderizada!.titulo))) setAviso('Este aparelho não permite compartilhar o arquivo. Use “Baixar PDF”.')
            }}>Compartilhar / imprimir</button>
            <button className="btn-secondary" onClick={() => baixar(blob, nome)}>Baixar PDF</button>
            <a className="btn-secondary sm:col-span-2" href={url} target="_blank" rel="noreferrer">Abrir PDF em outra aba</a>
          </div>
          {aviso && <p className="card border-amber-300 bg-amber-50 text-amber-900" role="status">{aviso}</p>}
          <iframe title="Pré-visualização do PDF" src={url} className="hidden h-[70vh] w-full rounded-lg border border-slate-300 bg-white md:block" />
        </>
      )}
      <Link to={`/ata/${id}/revisar`} className="btn-secondary w-full">← Voltar para editar a ata</Link>
    </div>
  )
}
