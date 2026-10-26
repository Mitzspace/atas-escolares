import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getAta, getSettings, patchAta } from '../db'
import RevisarTranscricao from './RevisarTranscricao'
import { SETTINGS_PADRAO } from '../types'

vi.mock('../db', () => ({ getAta: vi.fn(), getSettings: vi.fn(), patchAta: vi.fn() }))
let container: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.mocked(patchAta).mockResolvedValue()
  vi.mocked(getSettings).mockResolvedValue(SETTINGS_PADRAO)
  vi.mocked(getAta).mockResolvedValue({
    id: 'teste', criadaEm: 0, atualizadaEm: 0, status: 'transcricao', provedorTranscricao: 'groq', modeloTranscricao: 'whisper-large-v3',
    meta: {
      escola: 'Teste', rede: 'Municipal', municipioUf: 'Exemplo/SP', tipo: 'pedagogica', ordinaria: true, numero: 1, ano: 2026,
      data: '2026-10-25', horaInicio: '14:00', local: 'Escola', presidente: { nome: 'Maria', cargo: 'Diretora' },
      secretario: { nome: 'Joana', cargo: 'Coordenadora' }, participantes: [], pauta: [], anonimizarAlunos: true,
    },
    transcript: [
      { speaker: 'Falante', start: '00:00', end: '00:02', text: 'Sou Maria, diretora.' },
      { speaker: 'Falante', start: '00:03', end: '00:05', text: 'Sou Rui.' },
    ],
  })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetAllMocks()
})

it('atribui falantes por trecho sem renomear todas as vozes do Whisper', async () => {
  await act(async () => root.render(<MemoryRouter initialEntries={['/ata/teste/transcricao']}>
    <Routes><Route path="/ata/:id/transcricao" element={<RevisarTranscricao />} /></Routes>
  </MemoryRouter>))
  expect(container.textContent).toContain('O Whisper não separa falantes')
  expect(container.textContent).toContain('Groq · whisper-large-v3')
  const primeiro = container.querySelector<HTMLInputElement>('[aria-label="Falante do trecho 1"]')!
  const segundo = container.querySelector<HTMLInputElement>('[aria-label="Falante do trecho 2"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(primeiro, 'Maria')
    primeiro.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(primeiro.value).toBe('Maria')
  expect(segundo.value).toBe('Falante')
  await act(async () => vi.advanceTimersByTimeAsync(600))
  expect(patchAta).toHaveBeenCalledWith('teste', { transcript: [
    { speaker: 'Maria', start: '00:00', end: '00:02', text: 'Sou Maria, diretora.' },
    { speaker: 'Falante', start: '00:03', end: '00:05', text: 'Sou Rui.' },
  ] })
})
