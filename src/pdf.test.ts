import { describe, expect, it } from 'vitest'
import { larguraTexto, larguraUltimaLinha, preencherComTracos, gerarPdfBytes, LARGURA_TEXTO } from './pdf'
import type { AtaRenderizada } from './ata-api'

describe('medição Times-Roman 12pt', () => {
  it('largura de caracteres conhecidos', () => {
    expect(larguraTexto(' ')).toBeCloseTo(3, 1) // 250/1000*12
    expect(larguraTexto('-')).toBeCloseTo(4, 1) // 333
    expect(larguraTexto('á')).toBeCloseTo(larguraTexto('a'), 5)
  })
  it('texto curto cabe numa linha e traços preenchem o resto', () => {
    const t = preencherComTracos('Nada mais havendo a tratar.')
    const usada = larguraUltimaLinha(t)
    expect(t).toMatch(/ -{10,}$/)
    expect(usada).toBeLessThanOrEqual(LARGURA_TEXTO)
    expect(LARGURA_TEXTO - usada).toBeLessThan(4 * 3.5 + 1) // sobra de no máximo ~2 traços + espaço
  })
  it('texto longo: traços ficam na mesma última linha', () => {
    const base = 'palavra '.repeat(200).trim()
    const t = preencherComTracos(base)
    expect(larguraUltimaLinha(t)).toBeLessThanOrEqual(LARGURA_TEXTO)
  })
})

const ata: AtaRenderizada = {
  titulo: 'ATA Nº 3/2026 – REUNIÃO PEDAGÓGICA',
  cabecalho: ['Escola Municipal Teste', 'Rede Municipal', 'Cidade/SP'],
  texto: 'Aos dez dias do mês de março do ano de dois mil e vinte e seis, às quatorze horas, reuniram-se na sala dos professores... '.repeat(14) + 'Nada mais havendo a tratar, lavrei a presente ata.',
  assinaturas: [{ nome: 'Maria Souza', cargo: 'Diretora' }, { nome: 'Ana Lima', cargo: 'Secretária' }],
  pendencias: [],
}

describe('gerarPdfBytes', () => {
  it('gera um PDF válido', async () => {
    const bytes = await gerarPdfBytes(ata, ata.texto)
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-')
  })
})
