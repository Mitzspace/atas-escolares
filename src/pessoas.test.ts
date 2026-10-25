import { describe, expect, it } from 'vitest'
import { iniciaisDoNome, rotuloDoParticipante, vinculoAnonimo, vinculoDoResponsavel } from './pessoas'

describe('vinculoDoResponsavel', () => {
  it('usa tratamento neutro quando não informado', () => {
    expect(vinculoDoResponsavel('Pedro Henrique', '5º ano B')).toBe('aluno(a) Pedro Henrique, 5º ano B')
    expect(vinculoDoResponsavel(' Ana ', '')).toBe('aluno(a) Ana')
    expect(vinculoDoResponsavel('', '5º B')).toBe('5º B')
    expect(vinculoDoResponsavel('', '')).toBe('')
  })
})

it('preserva o tratamento explicitamente informado', () => {
  expect(vinculoDoResponsavel('Laura Dias', '3º ano A', 'aluna')).toBe('aluna Laura Dias, 3º ano A')
  expect(vinculoDoResponsavel('Pedro Henrique', '5º ano B', 'aluno')).toBe('aluno Pedro Henrique, 5º ano B')
})

describe('anonimização do vínculo', () => {
  it('iniciais ignoram partículas', () => {
    expect(iniciaisDoNome('Pedro Henrique de Souza')).toBe('P.H.S.')
    expect(iniciaisDoNome('maria')).toBe('M.')
  })
  it('troca só o nome do aluno', () => {
    expect(vinculoAnonimo('aluno Pedro Henrique, 5º ano B')).toBe('aluno P.H., 5º ano B')
    expect(vinculoAnonimo('aluna Laura Dias, 3º ano A')).toBe('aluna L.D., 3º ano A')
    expect(vinculoAnonimo('aluno(a) Laura Dias, 3º ano A')).toBe('aluno(a) L.D., 3º ano A')
    expect(vinculoAnonimo('5º ano B')).toBe('5º ano B')
  })
})

describe('rotuloDoParticipante', () => {
  it('junta cargo e vínculo/turma', () => {
    expect(rotuloDoParticipante({ cargo: 'Mãe', vinculo: 'aluno Ana, 5º B' })).toBe('Mãe · aluno Ana, 5º B')
    expect(rotuloDoParticipante({ cargo: 'Professor(a)' })).toBe('Professor(a)')
  })
})
