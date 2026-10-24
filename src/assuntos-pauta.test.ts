import { describe, expect, it } from 'vitest'
import { adicionarExtra, alternarAssunto, assuntoJaUsado, removerExtra } from './assuntos'

describe('alternarAssunto', () => {
  it('preenche o primeiro item vazio', () => {
    expect(alternarAssunto(['', ''], 'A')).toEqual(['A', ''])
    expect(alternarAssunto(['X', '', 'Y'], 'A')).toEqual(['X', 'A', 'Y'])
  })
  it('acrescenta no fim quando não há vazio', () => {
    expect(alternarAssunto(['X'], 'A')).toEqual(['X', 'A'])
  })
  it('tocar de novo remove, ignorando caixa e espaços', () => {
    expect(alternarAssunto(['X', ' a '], 'A')).toEqual(['X'])
    expect(alternarAssunto(['A'], 'a')).toEqual([''])
    expect(assuntoJaUsado(['  Planejamento do bimestre'], 'planejamento do bimestre')).toBe(true)
  })
})

describe('assuntos extras', () => {
  it('adiciona sem repetir (nem os padrões) e remove', () => {
    let e = adicionarExtra({}, 'pais', 'Festa junina')
    expect(e.pais).toEqual(['Festa junina'])
    expect(adicionarExtra(e, 'pais', ' festa JUNINA ')).toBe(e)
    expect(adicionarExtra(e, 'pais', 'Calendário escolar e datas importantes')).toBe(e)
    expect(adicionarExtra(e, 'pais', '   ')).toBe(e)
    e = removerExtra(e, 'pais', 'festa junina')
    expect(e.pais).toEqual([])
  })
})
