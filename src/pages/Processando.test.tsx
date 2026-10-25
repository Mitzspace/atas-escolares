import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { rodarGeracaoAta, rodarTranscricao } from '../pipeline'
import type { Progresso } from '../gemini'
import Processando from './Processando'

vi.mock('../pipeline', () => ({ rodarGeracaoAta: vi.fn(), rodarTranscricao: vi.fn() }))
let container: HTMLDivElement
let root: Root
let progresso: Progresso

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const executar = async (_id: string, onProgress: Progresso) => {
    progresso = onProgress
    await new Promise<void>(() => {})
  }
  vi.mocked(rodarGeracaoAta).mockImplementation(executar)
  vi.mocked(rodarTranscricao).mockImplementation(executar)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.resetAllMocks()
})

it.each(['ata', 'transcricao'])('aviso econômico acompanha modelo no progresso de %s', async etapa => {
  await act(async () => {
    root.render(<MemoryRouter initialEntries={[`/ata/teste/processando/${etapa}`]}>
      <Routes><Route path="/ata/:id/processando/:etapa" element={<Processando />} /></Routes>
    </MemoryRouter>)
  })
  const aviso = 'Esta ata foi redigida por um modelo econômico; revise com atenção.'
  expect(container.textContent).not.toContain(aviso)
  await act(async () => progresso('Tentando Gemini Flash-Lite', 0.3, 'gemini-3.5-flash-lite'))
  expect(container.textContent?.includes(aviso)).toBe(etapa === 'ata')
  await act(async () => progresso('Tentando Gemini Flash', 0.3, 'gemini-3.6-flash'))
  expect(container.textContent).not.toContain(aviso)
})
