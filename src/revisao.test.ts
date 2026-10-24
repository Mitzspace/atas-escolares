import { describe, expect, it } from 'vitest'
import { renderAta, type AtaExtraida, type MeetingMetadata } from './ata-api'
import { aplicarPresenca, listaDePresenca, listarMarcadores, preencherMarcador } from './revisao'
import type { AtaRecord } from './types'

const meta: MeetingMetadata = {
  escola: 'Escola Municipal Professora Ana Lima',
  rede: 'Secretaria Municipal de Educação',
  municipioUf: 'Exemplo/SP',
  tipo: 'pedagogica',
  ordinaria: true,
  numero: 1,
  ano: 2026,
  data: '2026-10-20',
  horaInicio: '14:00',
  local: 'sala dos professores',
  presidente: { nome: 'Maria Souza', cargo: 'Diretora' },
  secretario: { nome: 'Paulo Reis', cargo: 'Secretário' },
  participantes: [
    { nome: 'Joana Alves', cargo: 'Coordenadora pedagógica', presente: true },
    { nome: 'Carlos Mendes', cargo: 'Professor', presente: true },
  ],
  pauta: ['Feira de Ciências'],
  anonimizarAlunos: true,
}
const extraida: AtaExtraida = {
  itens: [{ pauta: 1, relato: 'A professora apresentou a proposta da Feira de Ciências.' }],
  deliberacoes: [],
  encaminhamentos: [{ acao: 'Enviar o regulamento', responsavel: 'Clara Dias' }],
  pendencias: [],
}
const ata = (): AtaRecord => ({
  id: 'x', criadaEm: 0, atualizadaEm: 0, status: 'ata', meta, extraida, renderizada: renderAta(meta, extraida),
})

describe('marcadores', () => {
  const texto = renderAta(meta, extraida).texto

  it('lista os [PENDENTE] com descrição e identifica o de horário', () => {
    const ms = listarMarcadores(texto)
    expect(ms.map(m => m.descricao)).toEqual(['prazo do primeiro encaminhamento', 'horário de término da reunião'])
    expect(ms.map(m => m.hora)).toEqual([false, true])
  })

  it('preenche horário por extenso e texto livre com números por extenso', () => {
    let t = texto
    t = preencherMarcador(t, listarMarcadores(t)[1], '15:10')
    expect(t).toContain('foi encerrada a reunião às quinze horas e dez minutos, e eu')
    t = preencherMarcador(t, listarMarcadores(t)[0], 'até 30 de outubro')
    expect(t).toContain('prazo: até trinta de outubro')
    expect(listarMarcadores(t)).toEqual([])
  })

  it('valor vazio remove o marcador sem deixar espaço sobrando', () => {
    const t = 'A diretora falou [trecho inaudível]. Depois encerrou.'
    expect(preencherMarcador(t, listarMarcadores(t)[0], '')).toBe('A diretora falou. Depois encerrou.')
  })
})

describe('aplicarPresenca', () => {
  const ausente = [meta.participantes[0], { ...meta.participantes[1], presente: false }]

  it('sem edição, usa o texto novo e tira o ausente das assinaturas', () => {
    const r = aplicarPresenca(ata(), ausente)
    expect(r.texto).toContain('Não compareceu o seguinte convocado: Carlos Mendes, professor')
    expect(r.renderizada.assinaturas.map(p => p.nome)).not.toContain('Carlos Mendes')
  })

  it('preserva edições feitas depois da abertura', () => {
    const a = ata()
    a.textoEditado = a.renderizada!.texto.replace('apresentou a proposta', 'apresentou com detalhes a proposta')
    const r = aplicarPresenca(a, ausente)
    expect(r.textoPreservado).toBe(true)
    expect(r.texto).toContain('apresentou com detalhes a proposta')
    expect(r.texto).toContain('Não compareceu o seguinte convocado')
  })

  it('não mexe no texto se a própria abertura foi editada', () => {
    const a = ata()
    a.textoEditado = 'Texto reescrito. ' + a.renderizada!.texto
    const r = aplicarPresenca(a, ausente)
    expect(r.textoPreservado).toBe(false)
    expect(r.texto).toBe(a.textoEditado)
  })
})

it('listaDePresenca junta o cadastro sem repetir e sem presidente/secretário', () => {
  const l = listaDePresenca(meta.participantes, [
    { nome: 'joana alves', cargo: 'Coordenadora' },
    { nome: 'Rui Lopes', cargo: 'Professor' },
    { nome: 'Maria Souza', cargo: 'Diretora' },
  ], [meta.presidente, meta.secretario])
  expect(l.map(p => [p.nome, p.presente])).toEqual([['Joana Alves', true], ['Carlos Mendes', true], ['Rui Lopes', false]])
})
