import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { renderAta, type AtaExtraida, type MeetingMetadata } from '../ata-api'
import { getAta, getSettings, patchAta } from '../db'
import { SETTINGS_PADRAO, type AtaRecord } from '../types'
import RevisarAta from './RevisarAta'

vi.mock('../db', () => ({ getAta: vi.fn(), getSettings: vi.fn(), patchAta: vi.fn() }))

const meta: MeetingMetadata = {
  escola: 'Escola de teste', rede: 'Municipal', municipioUf: 'Exemplo/SP',
  tipo: 'pedagogica', ordinaria: true, numero: 1, ano: 2026, data: '2026-10-20',
  horaInicio: '14:00', horaFim: '15:10', local: 'sala dos professores',
  presidente: { nome: 'Maria Souza', cargo: 'Diretora' },
  secretario: { nome: 'Paulo Reis', cargo: 'Secretário' },
  participantes: [{ nome: 'Clara Dias', cargo: 'Professora de Ciências', presente: true }],
  pauta: ['Feira de Ciências'], anonimizarAlunos: true,
}
const extraida: AtaExtraida = { itens: [], deliberacoes: [], encaminhamentos: [], pendencias: [] }
let container: HTMLDivElement
let root: Root
let concluirGravacoes: (() => void)[]

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  concluirGravacoes = []
  vi.mocked(getAta).mockResolvedValue({
    id: 'teste', criadaEm: 0, atualizadaEm: 0, status: 'ata', meta, extraida,
    renderizada: renderAta(meta, extraida),
  })
  vi.mocked(getSettings).mockResolvedValue(SETTINGS_PADRAO)
  vi.mocked(patchAta).mockImplementation(() => new Promise<void>(resolve => concluirGravacoes.push(resolve)))
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => { concluirGravacoes.forEach(concluir => concluir()) })
  await act(async () => root.unmount())
  container.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.resetAllMocks()
})

it('atualiza checkbox, texto e assinaturas antes de concluir a gravação da presença', async () => {
  await act(async () => {
    root.render(<MemoryRouter initialEntries={['/ata/teste/revisar']}>
      <Routes><Route path="/ata/:id/revisar" element={<RevisarAta />} /></Routes>
    </MemoryRouter>)
  })
  const checkbox = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    .find(input => input.closest('label')?.textContent?.includes('Clara Dias'))!
  const texto = container.querySelector<HTMLTextAreaElement>('#texto-ata')!
  const assinaturas = () => [...container.querySelectorAll('section')]
    .find(section => section.querySelector('h2')?.textContent === 'Assinam')!.textContent!
  expect(checkbox.checked).toBe(true)
  expect(assinaturas()).toContain('Clara Dias')

  // IndexedDB continua pendente quando o navegador verifica o checkbox controlado.
  await act(async () => checkbox.click())
  expect(concluirGravacoes).toHaveLength(1)
  expect(checkbox.checked).toBe(false)
  expect(texto.value).toContain('Não compareceu a seguinte convocada: Clara Dias')
  expect(assinaturas()).not.toContain('Clara Dias')
  const patch = vi.mocked(patchAta).mock.calls[0][1] as Partial<AtaRecord>
  expect(patch.meta?.participantes[0].presente).toBe(false)
  expect(patch.textoEditado).toBe(texto.value)

  await act(async () => concluirGravacoes[0]())
  expect(checkbox.checked).toBe(false)
  await act(async () => checkbox.click())
  expect(checkbox.checked).toBe(true)
  expect(texto.value).not.toContain('Não compareceu')
  expect(assinaturas()).toContain('Clara Dias')
})
