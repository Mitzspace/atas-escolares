import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import LogoEscola, { dimensoesLogo, prepararLogo } from './LogoEscola'

let container: HTMLDivElement, root: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})
const botao = (texto: string) => [...container.querySelectorAll('button')].find(b => b.textContent === texto)!

it('preserva proporção, limita a 512 px e não amplia imagens pequenas', () => {
  expect(dimensoesLogo(1200, 600)).toEqual({ largura: 512, altura: 256 })
  expect(dimensoesLogo(200, 800)).toEqual({ largura: 128, altura: 512 })
  expect(dimensoesLogo(48, 48)).toEqual({ largura: 48, altura: 48 })
  expect(() => dimensoesLogo(0, 10)).toThrow(/dimensões/)
})
it('recusa arquivo maior que 1 MB e formato não permitido antes de decodificar', async () => {
  await expect(prepararLogo(new File([new Uint8Array(1_000_001)], 'grande.png', { type: 'image/png' }))).rejects.toThrow(/até 1 MB/)
  await expect(prepararLogo(new File(['texto'], 'logo.html', { type: 'text/html' }))).rejects.toThrow(/PNG, JPG ou SVG/)
})
it.each(['image/png', 'image/jpeg', 'image/svg+xml'])('normaliza %s em PNG com dimensão limitada e fundo branco', async type => {
  vi.stubGlobal('Image', class {
    naturalWidth = 1200; naturalHeight = 600
    onload?: () => void
    set src(_valor: string) { queueMicrotask(() => this.onload?.()) }
  })
  const contexto = { drawImage: vi.fn(), fillRect: vi.fn(), fillStyle: '' }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(contexto as never)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function (this: HTMLCanvasElement) {
    expect([this.width, this.height]).toEqual([512, 256])
    return 'data:image/png;base64,aW1hZ2Vt'
  })
  expect(await prepararLogo(new File(['imagem'], 'logo', { type }))).toBe('data:image/png;base64,aW1hZ2Vt')
  expect(contexto.fillStyle).toBe('#fff')
  expect(contexto.fillRect).toHaveBeenCalledWith(0, 0, 512, 256)
  expect(contexto.drawImage).toHaveBeenCalledWith(expect.any(Object), 0, 0, 512, 256)
})
it('mostra prévia e permite voltar à logo padrão, salvando valor vazio', async () => {
  const onTrocar = vi.fn(async () => {})
  await act(async () => root.render(<LogoEscola logo="data:image/png;base64,aW1hZ2Vt" onTrocar={onTrocar} />))
  expect(container.querySelector('img')?.src).toBe('data:image/png;base64,aW1hZ2Vt')
  await act(async () => botao('Voltar à logo padrão').click())
  expect(onTrocar).toHaveBeenCalledWith('')
  expect(container.textContent).toContain('Logo padrão restaurada.')
})
it('uma falha ao salvar mantém a prévia anterior e apresenta erro', async () => {
  const onTrocar = vi.fn(async () => { throw new Error('Erro') })
  await act(async () => root.render(<LogoEscola logo="data:image/png;base64,aW1hZ2Vt" onTrocar={onTrocar} />))
  await act(async () => botao('Voltar à logo padrão').click())
  expect(container.querySelector('[role=alert]')?.textContent).toContain('Não foi possível restaurar')
  expect(container.querySelector('img')?.src).toBe('data:image/png;base64,aW1hZ2Vt')
})
