import { describe, expect, it } from 'vitest'
import { iniciaisDoNome, rotuloDoParticipante, vinculoAnonimo, vinculoDoResponsavel } from './pessoas'

describe('vinculoDoResponsavel', () => {
  it('monta "aluno Fulano, turma"', () => {
    expect(vinculoDoResponsavel('Pedro Henrique', '5º ano B')).toBe('aluno Pedro Henrique, 5º ano B')
    expect(vinculoDoResponsavel(' Ana ', '')).toBe('aluno Ana')
    expect(vinculoDoResponsavel('', '5º B')).toBe('5º B')
    expect(vinculoDoResponsavel('', '')).toBe('')
  })
})

describe('anonimização do vínculo', () => {
  it('iniciais ignoram partículas', () => {
    expect(iniciaisDoNome('Pedro Henrique de Souza')).toBe('P.H.S.')
    expect(iniciaisDoNome('maria')).toBe('M.')
  })
  it('troca só o nome do aluno', () => {
    expect(vinculoAnonimo('aluno Pedro Henrique, 5º ano B')).toBe('aluno P.H., 5º ano B')
    expect(vinculoAnonimo('5º ano B')).toBe('5º ano B')
  })
})

describe('rotuloDoParticipante', () => {
  it('junta cargo e vínculo/turma', () => {
    expect(rotuloDoParticipante({ cargo: 'Mãe', vinculo: 'aluno Ana, 5º B' })).toBe('Mãe · aluno Ana, 5º B')
    expect(rotuloDoParticipante({ cargo: 'Professor(a)' })).toBe('Professor(a)')
  })
})
