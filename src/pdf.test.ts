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

import { cargoDaAssinatura, montarDocumento, responsaveisPresentes, temAnexoDePresenca } from './pdf'
import type { MeetingMetadata, Participante } from './ata-api'

const metaBase: MeetingMetadata = {
  escola: 'E', rede: 'R', municipioUf: 'X/SP', tipo: 'pais', ordinaria: true, numero: 1, ano: 2026, data: '2026-03-10',
  horaInicio: '19:00', local: 'pátio', presidente: { nome: 'Maria Souza', cargo: 'Diretora' },
  secretario: { nome: 'Ana Lima', cargo: 'Secretária' }, participantes: [], pauta: [], anonimizarAlunos: false,
}
const resp = (n: number): Participante[] => Array.from({ length: n }, (_, i) => ({
  nome: `Responsável ${i + 1}`, cargo: i % 2 ? 'Pai' : 'Mãe', presente: true, categoria: 'responsavel' as const, vinculo: `aluno Aluno ${i + 1}, 5º ano B`,
}))

describe('pais: anexo de presença', () => {
  it('só a partir do limite, só em pais, só presentes', () => {
    expect(temAnexoDePresenca({ ...metaBase, participantes: resp(8) })).toBe(false)
    expect(temAnexoDePresenca({ ...metaBase, participantes: resp(9) })).toBe(true)
    expect(temAnexoDePresenca({ ...metaBase, tipo: 'pedagogica', participantes: resp(8) })).toBe(false)
    expect(responsaveisPresentes({ ...metaBase, participantes: [...resp(2), { ...resp(1)[0], nome: 'Ausente', presente: false }] })).toHaveLength(2)
  })
  it('com anexo, o corpo não repete os responsáveis e a tabela lista todos', () => {
    const meta = { ...metaBase, participantes: resp(9) }
    const ata = { ...ata0(), assinaturas: [metaBase.presidente, ...resp(9)] }
    const doc = montarDocumento(ata, ata.texto, meta)
    const texto = JSON.stringify(doc.content)
    expect(texto).toContain('LISTA DE PRESENÇA')
    const assinaturasNoCorpo = doc.content.filter(c => 'stack' in c)
    expect(assinaturasNoCorpo).toHaveLength(1)
    const tabela = doc.content.find(c => 'table' in c) as { table: { body: unknown[][] } }
    expect(tabela.table.body).toHaveLength(10) // cabeçalho + 9
  })
  it('anexo anonimiza o aluno quando pedido', () => {
    const meta = { ...metaBase, anonimizarAlunos: true, participantes: resp(9) }
    expect(JSON.stringify(montarDocumento(ata0(), 'x', meta).content)).toContain('aluno A.1.')
  })
  it('gera PDF válido com anexo', async () => {
    const meta = { ...metaBase, participantes: resp(12) }
    const bytes = await gerarPdfBytes({ ...ata0(), assinaturas: [metaBase.presidente, ...resp(12)] }, 'Texto da ata.', meta)
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-')
  })
})

describe('cargoDaAssinatura', () => {
  it('responsável: parentesco + aluno; anonimiza se pedido', () => {
    const meta = { ...metaBase, participantes: [{ nome: 'Ana Costa', cargo: 'Mãe', presente: true, categoria: 'responsavel' as const, vinculo: 'aluno Pedro Henrique, 5º ano B' }] }
    expect(cargoDaAssinatura({ nome: 'Ana Costa', cargo: 'Mãe' }, meta)).toBe('Mãe do aluno Pedro Henrique, 5º ano B')
    expect(cargoDaAssinatura({ nome: 'Ana Costa', cargo: 'Mãe' }, { ...meta, anonimizarAlunos: true })).toBe('Mãe do aluno P.H., 5º ano B')
    // cargo já montado pelo renderAta não ganha o vínculo de novo
    expect(cargoDaAssinatura({ nome: 'Ana Costa', cargo: 'Mãe do aluno P.H., do quinto ano B' }, { ...meta, anonimizarAlunos: true })).toBe('Mãe do aluno P.H., do quinto ano B')
  })
  it('aluno orientado: cargo – turma; não repete se a ata já trouxe', () => {
    const meta = { ...metaBase, tipo: 'orientacao' as const, orientado: { nome: 'João', cargo: 'Aluno(a)', presente: true, categoria: 'aluno' as const, vinculo: '5º ano B' } }
    expect(cargoDaAssinatura({ nome: 'João', cargo: 'Aluno(a)' }, meta)).toBe('Aluno(a) – 5º ano B')
    expect(cargoDaAssinatura({ nome: 'João', cargo: 'Aluno(a) da turma 5º ano B' }, meta)).toBe('Aluno(a) da turma 5º ano B')
  })
  it('vários orientados mistos: cada um recebe o seu vínculo; atas antigas (orientado) continuam valendo', () => {
    const meta = {
      ...metaBase, tipo: 'orientacao' as const,
      orientados: [
        { nome: 'João', cargo: 'Aluno(a)', presente: true, categoria: 'aluno' as const, vinculo: '5º ano B' },
        { nome: 'Rita', cargo: 'Professora', presente: true, categoria: 'funcionario' as const },
        { nome: 'Lia', cargo: 'Aluno(a)', presente: true, categoria: 'aluno' as const, vinculo: '6º ano A' },
      ],
    }
    expect(cargoDaAssinatura({ nome: 'João', cargo: 'Aluno(a)' }, meta)).toBe('Aluno(a) – 5º ano B')
    expect(cargoDaAssinatura({ nome: 'Rita', cargo: 'Professora' }, meta)).toBe('Professora')
    expect(cargoDaAssinatura({ nome: 'Lia', cargo: 'Aluno(a)' }, meta)).toBe('Aluno(a) – 6º ano A')
    const antiga = { ...metaBase, tipo: 'orientacao' as const, orientado: { nome: 'Teo', cargo: 'Aluno(a)', presente: true, categoria: 'aluno' as const, vinculo: '7º B' } }
    expect(cargoDaAssinatura({ nome: 'Teo', cargo: 'Aluno(a)' }, antiga)).toBe('Aluno(a) – 7º B')
  })
  it('ata antiga (sem categoria) e funcionário ficam como estão', () => {
    const meta = { ...metaBase, tipo: 'pedagogica' as const, participantes: [{ nome: 'Rita', cargo: 'Professora', presente: true }] }
    expect(cargoDaAssinatura({ nome: 'Rita', cargo: 'Professora' }, meta)).toBe('Professora')
    expect(cargoDaAssinatura({ nome: 'Rita', cargo: 'Professora' })).toBe('Professora')
  })
})

function ata0(): AtaRenderizada {
  return { titulo: 'ATA Nº 1/2026 – REUNIÃO DE PAIS E RESPONSÁVEIS', cabecalho: ['Escola'], texto: 'Texto.', assinaturas: [], pendencias: [] }
}
