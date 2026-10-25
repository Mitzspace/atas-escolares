import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { criarBackup, registrarBackupConcluido, restaurarBackup, validarBackup } from '../db'
import type { BackupAtas } from '../types'
import Backup from './Backup'

vi.mock('../db', () => ({ criarBackup: vi.fn(), registrarBackupConcluido: vi.fn(), restaurarBackup: vi.fn(), validarBackup: vi.fn() }))
const dados: BackupAtas = { formato: 'atas-escolares', versao: 1, criadoEm: '2026-10-25T12:00:00Z', configuracoes: { escola: 'Escola do backup', apiKey: 'chave-do-backup' }, atas: [] }
let container: HTMLDivElement, root: Root
const onRestaurado = vi.fn(async () => {})
const botao = (texto: string) => [...container.querySelectorAll('button')].find(b => b.textContent === texto)!
const campo = (texto: string) => [...container.querySelectorAll('label')].find(l => l.textContent === texto)!.querySelector<HTMLInputElement>('input')!
const lerArquivo = async () => {
  const arquivo = new File(['backup'], 'backup.json', { type: 'application/json' })
  Object.defineProperty(arquivo, 'text', { value: async () => 'backup' })
  const input = container.querySelector<HTMLInputElement>('#arquivo-backup')!
  Object.defineProperty(input, 'files', { value: [arquivo], configurable: true })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('navigator', { share: vi.fn(async () => {}), canShare: vi.fn(() => true) })
  vi.mocked(criarBackup).mockResolvedValue(dados)
  vi.mocked(registrarBackupConcluido).mockResolvedValue()
  vi.mocked(restaurarBackup).mockResolvedValue(0)
  vi.mocked(validarBackup).mockReturnValue(dados)
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => root.render(<Backup onRestaurado={onRestaurado} />))
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove(); vi.restoreAllMocks(); vi.resetAllMocks(); vi.unstubAllGlobals()
})
it('compartilha arquivo sem chaves por padrão, registra data só após sucesso e aceita inclusão explícita', async () => {
  expect(campo('incluir as chaves de API (guarde o arquivo em local seguro)').checked).toBe(false)
  await act(async () => botao('Salvar backup').click())
  expect(criarBackup).toHaveBeenLastCalledWith(false)
  expect(navigator.share).toHaveBeenCalledWith({ files: [expect.any(File)], title: 'Backup das atas escolares' })
  expect(registrarBackupConcluido).toHaveBeenCalledOnce()
  await act(async () => campo('incluir as chaves de API (guarde o arquivo em local seguro)').click())
  await act(async () => botao('Salvar backup').click())
  expect(criarBackup).toHaveBeenLastCalledWith(true)
})
it('cancelar compartilhamento não registra backup concluído', async () => {
  vi.mocked(navigator.share).mockRejectedValue(new DOMException('Cancelado', 'AbortError'))
  await act(async () => botao('Salvar backup').click())
  expect(registrarBackupConcluido).not.toHaveBeenCalled()
})
it('erro de leitura mostra mensagem de validação e não oferece restauração', async () => {
  vi.mocked(validarBackup).mockImplementation(() => { throw new Error('Versão futura: atualize o aplicativo.') })
  await lerArquivo()
  expect(container.querySelector('[role=alert]')?.textContent).toContain('Versão futura')
  expect(botao('Restaurar atas')).toBeUndefined()
  expect(restaurarBackup).not.toHaveBeenCalled()
})
it('mostra resumo e restaura por junção sem substituir configurações nem chaves por padrão', async () => {
  await lerArquivo()
  expect(container.textContent).toContain('0 atas · Escola: Escola do backup')
  expect(campo('Juntar com as atas deste aparelho').checked).toBe(true)
  expect(campo('Substituir as configurações pelas do backup').checked).toBe(false)
  expect(campo('Confirmo importar as chaves de API do backup e substituir as correspondentes neste aparelho').checked).toBe(false)
  await act(async () => botao('Restaurar atas').click())
  expect(restaurarBackup).toHaveBeenCalledWith(dados, { modo: 'juntar', substituirConfiguracoes: false, incluirChaves: false })
  expect(onRestaurado).toHaveBeenCalledOnce()
})
it('substituição exige digitar confirmação e mantém consentimento de chaves separado', async () => {
  await lerArquivo()
  await act(async () => campo('Substituir tudo').click())
  expect(botao('Restaurar atas').disabled).toBe(true)
  const input = container.querySelector<HTMLInputElement>('#confirmar-substituicao')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'SUBSTITUIR')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(botao('Restaurar atas').disabled).toBe(false)
  await act(async () => campo('Substituir as configurações pelas do backup').click())
  await act(async () => campo('Confirmo importar as chaves de API do backup e substituir as correspondentes neste aparelho').click())
  await act(async () => botao('Restaurar atas').click())
  expect(restaurarBackup).toHaveBeenCalledWith(dados, { modo: 'substituir', substituirConfiguracoes: true, incluirChaves: true })
})
it('não exibe opção de importar chaves quando o arquivo não as contém', async () => {
  vi.mocked(validarBackup).mockReturnValue({ ...dados, configuracoes: { escola: 'Escola' } })
  await lerArquivo()
  expect(container.textContent).not.toContain('Confirmo importar as chaves')
})
