import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getSettings, saveSettings } from '../db'
import { testarChaveGroq } from '../groq'
import { testarChave } from '../gemini'
import { SETTINGS_PADRAO } from '../types'
import Configuracoes from './Configuracoes'

vi.mock('../db', () => ({ getSettings: vi.fn(), saveSettings: vi.fn() }))
vi.mock('../groq', () => ({ testarChaveGroq: vi.fn() }))
vi.mock('../gemini', () => ({ testarChave: vi.fn() }))
let container: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.mocked(saveSettings).mockResolvedValue()
  vi.mocked(testarChaveGroq).mockResolvedValue()
  vi.mocked(testarChave).mockResolvedValue()
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove(); vi.resetAllMocks(); vi.unstubAllGlobals()
})

it.each(['groq', 'gemini'] as const)('configura apenas %s, testa a chave correta e salva sem exigir a outra', async provedor => {
  vi.mocked(getSettings).mockResolvedValue({ ...SETTINGS_PADRAO,
    groqApiKey: provedor === 'groq' ? ' groq-chave-ficticia ' : '', apiKey: provedor === 'gemini' ? ' gemini-chave-ficticia ' : '',
  })
  await act(async () => root.render(<MemoryRouter><Configuracoes /></MemoryRouter>))
  expect(container.querySelector<HTMLInputElement>('#chave-groq')?.type).toBe('password')
  expect(container.querySelector<HTMLInputElement>('#chave-gemini')?.type).toBe('password')
  const botoes = [...container.querySelectorAll<HTMLButtonElement>('button')]
  const testeGroq = botoes.find(b => b.textContent === 'Testar chave do Groq')!
  const testeGemini = botoes.find(b => b.textContent === 'Testar chave do Gemini')!
  expect(testeGroq.disabled).toBe(provedor !== 'groq')
  expect(testeGemini.disabled).toBe(provedor !== 'gemini')
  await act(async () => (provedor === 'groq' ? testeGroq : testeGemini).click())
  if (provedor === 'groq') {
    expect(testarChaveGroq).toHaveBeenCalledWith('groq-chave-ficticia')
    expect(testarChave).not.toHaveBeenCalled()
  } else {
    expect(testarChave).toHaveBeenCalledWith('gemini-chave-ficticia', 'gemini-3.8-flash')
    expect(testarChaveGroq).not.toHaveBeenCalled()
  }
  expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({
    groqApiKey: provedor === 'groq' ? 'groq-chave-ficticia' : '', apiKey: provedor === 'gemini' ? 'gemini-chave-ficticia' : '',
  }))
  expect(container.querySelector('a[href="https://console.groq.com/keys"]')).not.toBeNull()
})

it('salva preferência e modelos Groq selecionados', async () => {
  vi.mocked(getSettings).mockResolvedValue(SETTINGS_PADRAO)
  await act(async () => root.render(<MemoryRouter><Configuracoes /></MemoryRouter>))
  for (const [id, valor] of [['provedor', 'gemini'], ['modelo-groq', 'qwen/qwen3.8-27b'], ['whisper-groq', 'whisper-large-v3-turbo']]) {
    const campo = container.querySelector<HTMLSelectElement>(`#${id}`)!
    await act(async () => { campo.value = valor; campo.dispatchEvent(new Event('change', { bubbles: true })) })
  }
  await act(async () => [...container.querySelectorAll('button')].find(b => b.textContent === 'Salvar')!.click())
  expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({
    provedorPreferido: 'gemini', modeloGroq: 'qwen/qwen3.8-27b', modeloTranscricaoGroq: 'whisper-large-v3-turbo',
  }))
})
