import { useRef, useState } from 'react'

export const LOGO_PADRAO_URL = `${import.meta.env.BASE_URL}logo-escola.svg`
export const LIMITE_ARQUIVO_LOGO = 1_000_000

export function dimensoesLogo(largura: number, altura: number) {
  if (!largura || !altura || !Number.isFinite(largura + altura)) throw new Error('A imagem não tem dimensões válidas.')
  const escala = Math.min(1, 512 / Math.max(largura, altura))
  return { largura: Math.max(1, Math.round(largura * escala)), altura: Math.max(1, Math.round(altura * escala)) }
}

/** SVG é carregado como imagem isolada e rasterizado; nenhum SVG enviado é inserido no DOM. */
export async function prepararLogo(arquivo: File): Promise<string> {
  if (arquivo.size > LIMITE_ARQUIVO_LOGO) throw new Error('A logo deve ter até 1 MB. Escolha uma imagem menor.')
  const tipoValido = ['image/png', 'image/jpeg', 'image/svg+xml'].includes(arquivo.type)
  if (!tipoValido && (arquivo.type || !/\.(png|jpe?g|svg)$/i.test(arquivo.name))) {
    throw new Error('Escolha uma logo em PNG, JPG ou SVG.')
  }
  const url = await new Promise<string>((resolve, reject) => {
    const leitor = new FileReader()
    leitor.onload = () => resolve(leitor.result as string)
    leitor.onerror = () => reject(new Error('Não foi possível ler a imagem. Escolha o arquivo novamente.'))
    leitor.readAsDataURL(arquivo)
  })
  const imagem = new Image()
  await new Promise<void>((resolve, reject) => {
    imagem.onload = () => resolve()
    imagem.onerror = () => reject(new Error('Não foi possível abrir a logo. Confira se o arquivo é uma imagem válida.'))
    imagem.src = url
  })
  const tamanho = dimensoesLogo(imagem.naturalWidth, imagem.naturalHeight)
  const canvas = document.createElement('canvas')
  canvas.width = tamanho.largura; canvas.height = tamanho.altura
  const contexto = canvas.getContext('2d', { alpha: false })
  if (!contexto) throw new Error('Não foi possível preparar a imagem neste navegador.')
  contexto.fillStyle = '#fff'
  contexto.fillRect(0, 0, tamanho.largura, tamanho.altura)
  contexto.drawImage(imagem, 0, 0, tamanho.largura, tamanho.altura)
  try {
    const png = canvas.toDataURL('image/png')
    if (png.length > 1_500_000 || !png.startsWith('data:image/png;base64,')) throw new Error()
    return png
  } catch { throw new Error('Não foi possível preparar a logo. Use uma imagem PNG, JPG ou SVG sem recursos externos.') }
}

export default function LogoEscola({ logo, onTrocar }: { logo?: string; onTrocar: (logo: string) => Promise<void> }) {
  const arquivo = useRef<HTMLInputElement>(null)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  const [mensagem, setMensagem] = useState('')
  async function trocar(imagem?: File) {
    if (!imagem) return
    setOcupado(true); setErro(''); setMensagem('')
    try { await onTrocar(await prepararLogo(imagem)); setMensagem('Logo salva neste aparelho.') }
    catch (e) { setErro((e as Error).message) }
    finally { setOcupado(false) }
  }
  async function voltar() {
    setOcupado(true); setErro(''); setMensagem('')
    try { await onTrocar(''); setMensagem('Logo padrão restaurada.') }
    catch { setErro('Não foi possível restaurar a logo. Tente novamente.') }
    finally { setOcupado(false) }
  }
  return <div className="space-y-3">
    <div className="flex items-center gap-4 rounded-xl border border-rule bg-white p-4">
      <img src={logo || LOGO_PADRAO_URL} alt="Logo da escola" className="h-24 w-24 shrink-0 object-contain" />
      <p className="text-sm text-slate-600">{logo ? 'Logo personalizada' : 'Logo padrão da escola'}<span className="mt-1 block">Aparece no cabeçalho do app e nos PDFs.</span></p>
    </div>
    <p id="ajuda-logo" className="text-sm text-slate-600">Escolha PNG, JPG ou SVG de até 1 MB. A proporção será preservada. A troca da logo é salva automaticamente.</p>
    <input ref={arquivo} type="file" className="sr-only" tabIndex={-1} accept="image/png,image/jpeg,image/svg+xml,.png,.jpg,.jpeg,.svg" aria-label="Arquivo da logo" aria-describedby="ajuda-logo" disabled={ocupado} onChange={e => { void trocar(e.target.files?.[0]); e.target.value = '' }} />
    <div className="flex flex-wrap gap-3">
      <button type="button" className="btn-secondary" disabled={ocupado} onClick={() => arquivo.current?.click()}>Trocar logo</button>
      <button type="button" className="btn-secondary" disabled={ocupado || !logo} onClick={voltar}>Voltar à logo padrão</button>
    </div>
    {ocupado && <p role="status">Preparando a logo…</p>}
    {erro && <p role="alert" className="text-red-800">{erro}</p>}
    {mensagem && <p role="status" className="text-green-800">{mensagem}</p>}
  </div>
}
