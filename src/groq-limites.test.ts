import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { blocosTranscricao, consolidarParciais, conferirCotaDiaria, estimarTokens, executarNaJanela } from './groq-limites'
import type { AtaExtraida } from './ata-api'
beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-25T12:00:00Z')) })
afterEach(() => vi.useRealTimers())
it('estima todo o objeto do pedido, inclusive prompt e schema', () => {
  const pedido = { messages: [{ content: 'texto' }], response_format: { schema: { type: 'object' } } }
  expect(estimarTokens(pedido)).toBe(Math.ceil(JSON.stringify(pedido).length / 4))
})
it('divide por orçamento e tempo sem descartar texto ou atribuições', () => {
  const texto = 'mais de 15 faltas; pais trabalham sábado. '.repeat(100)
  const partes = blocosTranscricao([{ speaker: 'Carlos', start: '00:00', end: '00:10', text: texto }], 200)
  expect(partes.length).toBeGreaterThan(1)
  expect(partes.flat().map(p => p.text).join('')).toBe(texto)
  expect(partes.flat().slice(0, -1).every(p => /\s$/.test(p.text))).toBe(true)
  expect(partes.flat().every(p => p.speaker === 'Carlos' && p.start === '00:00')).toBe(true)
  expect(blocosTranscricao([
    { speaker: 'Ana', start: '00:00', end: '00:10', text: 'Um.' },
    { speaker: 'Rui', start: '21:00', end: '21:10', text: 'Dois.' },
  ])).toHaveLength(2)
})
it('consolida sem novo resumo, remove repetições e preserva detalhes distintos', () => {
  const parcial: AtaExtraida = { itens: [{ pauta: 1, relato: 'Houve mais de 15 faltas.' }],
    deliberacoes: [{ texto: 'Foi aprovada a feira.', votacao: 'onze votos favoráveis' }],
    encaminhamentos: [{ acao: 'Enviar regulamento' }], pendencias: [] }
  const unido = consolidarParciais([parcial, { ...parcial, itens: [{ pauta: 1, relato: 'Carlos argumentou que pais e professores trabalhavam sábado.' }],
    encaminhamentos: [{ acao: 'enviar regulamento.', responsavel: 'Clara', prazo: 'sexta-feira' }] }])
  expect(unido.itens[0].relato).toContain('mais de 15 faltas')
  expect(unido.itens[0].relato).toContain('pais e professores trabalhavam sábado')
  expect(unido.deliberacoes).toHaveLength(1)
  expect(unido.encaminhamentos).toEqual([{ acao: 'Enviar regulamento', responsavel: 'Clara', prazo: 'sexta-feira' }])
})
it('não resolve conflito de prazo silenciosamente', () => {
  const base: AtaExtraida = { itens: [], deliberacoes: [], encaminhamentos: [{ acao: 'Enviar regulamento', prazo: 'quinta' }], pendencias: [] }
  const unido = consolidarParciais([base, { ...base, encaminhamentos: [{ acao: 'Enviar regulamento', prazo: 'sexta' }] }])
  expect(unido.encaminhamentos).toHaveLength(1)
  expect(unido.encaminhamentos[0].prazo).toMatch(/confirmar.*quinta.*sexta/)
})
it('espera uma janela de minuto entre chamadas, inclusive concorrentes', async () => {
  const chamada = vi.fn(async () => ({})); const espera = vi.fn()
  const a = executarNaJanela('teste', 'modelo', 1000, chamada, espera)
  const b = executarNaJanela('teste', 'modelo', 1000, chamada, espera)
  await vi.advanceTimersByTimeAsync(0)
  expect(chamada).toHaveBeenCalledTimes(1)
  expect(espera).toHaveBeenCalledWith(60000)
  await vi.advanceTimersByTimeAsync(59999); expect(chamada).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1); await Promise.all([a, b])
  expect(chamada).toHaveBeenCalledTimes(2)
})
it('impede novas chamadas quando a cota diária estimada está perto do fim', async () => {
  await executarNaJanela('teste', 'modelo', 179000, async () => ({}), vi.fn())
  expect(() => conferirCotaDiaria('teste', 'modelo', 2000)).toThrow(/cota diária/)
  vi.setSystemTime(new Date('2026-10-26T12:00:00Z'))
  expect(() => conferirCotaDiaria('teste', 'modelo', 2000)).not.toThrow()
})
