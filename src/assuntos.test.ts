import { describe, expect, it } from 'vitest'
import { ASSUNTOS_PADRAO, assuntosSugeridos, chavesDeAssuntos } from './assuntos'

describe('assuntos padrão', () => {
  it('escolhe a lista de orientação conforme quem recebe', () => {
    expect(chavesDeAssuntos('pais')).toEqual(['pais'])
    expect(chavesDeAssuntos('orientacao', ['aluno', 'aluno'])).toEqual(['orientacao_aluno'])
    expect(chavesDeAssuntos('orientacao', ['funcionario'])).toEqual(['orientacao_funcionario'])
    expect(chavesDeAssuntos('orientacao', ['aluno', 'funcionario'])).toEqual(['orientacao_aluno', 'orientacao_funcionario'])
    expect(chavesDeAssuntos('orientacao', [])).toEqual(['orientacao_aluno', 'orientacao_funcionario'])
  })

  it('junta os extras da escola sem repetir', () => {
    const l = assuntosSugeridos(['pais'], { pais: ['Festa junina', 'calendário escolar e datas importantes'] })
    expect(l).toHaveLength(ASSUNTOS_PADRAO.pais.length + 1)
    expect(l.at(-1)).toBe('Festa junina')
  })
})
