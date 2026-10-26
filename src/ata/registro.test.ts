import { describe, expect, it } from 'vitest'
import {
  aplicarFalantes, buildAtaPrompt, extrairResumo, incorporarAnotacoes, FALANTE_NAO_IDENTIFICADO, modoDe, nomesParaFalantes, renderAta,
  renderAtaTextoLivre, validateAta, type AtaExtraida, type MeetingMetadata, type TranscriptSegment,
} from '../ata-api'

const meta: MeetingMetadata = {
  escola: 'Escola Municipal Teste', rede: 'Rede Municipal', municipioUf: 'Exemplo/SP', tipo: 'pedagogica', ordinaria: true,
  numero: 3, ano: 2026, data: '2026-10-20', horaInicio: '14:00', horaFim: '15:30', local: 'sala dos professores',
  presidente: { nome: 'Maria Souza', cargo: 'Diretora' }, secretario: { nome: 'Paulo Reis', cargo: 'Professor' },
  participantes: [
    { nome: 'Joana Alves', cargo: 'Coordenadora pedagógica', presente: true },
    { nome: 'Rui Dias', cargo: 'Professor', presente: false },
  ],
  pauta: ['Calendário de provas', 'Reforço escolar'], anonimizarAlunos: false,
}
const seg = (speaker: string, text: string, i = 0): TranscriptSegment => ({ speaker, start: `0${i}:00`, end: `0${i}:30`, text })

describe('aplicarFalantes', () => {
  const nomes = nomesParaFalantes(meta)
  const segs = [seg('Falante 1', 'Boa tarde, sou a Joana Alves e vou conduzir.', 0), seg('Falante 1', 'Vamos ao calendário.', 1), seg('Maria Souza', 'Certo.', 2)]
  it('aceita só nome da lista com citação presente no texto', () => {
    const r = aplicarFalantes(segs, [
      { trecho: 1, falante: 'joana alves', evidencia: 'sou a Joana Alves' },
      { trecho: 2, falante: 'Fulano Inventado', evidencia: 'calendário' },
    ], nomes, 1)
    expect(r[0].speaker).toBe('Joana Alves')
    expect(r[1].speaker).toBe(FALANTE_NAO_IDENTIFICADO)
  })
  it('descarta atribuição sem evidência verificável e mantém nomes já existentes', () => {
    const r = aplicarFalantes(segs, [
      { trecho: 1, falante: 'Joana Alves', evidencia: 'frase que não existe' },
      { trecho: 3, falante: 'Joana Alves', evidencia: 'Certo' },
    ], nomes, 1)
    expect(r[0].speaker).toBe(FALANTE_NAO_IDENTIFICADO)
    expect(r[2].speaker).toBe('Maria Souza')
  })
  it('lista de nomes: presentes, presidente e secretário; ausentes ficam de fora', () => {
    expect(nomes).toEqual(['Joana Alves', 'Maria Souza', 'Paulo Reis'])
  })
})

describe('modo e prompt com anotações', () => {
  const notas = [{ texto: 'Provas dia 10/11', tempo: '12:35' }, { texto: '  ' }]
  it('deduz o modo', () => {
    expect(modoDe([], notas)).toBe('digitar')
    expect(modoDe([seg('Falante 1', 'x')], notas)).toBe('audio_digitar')
    expect(modoDe([seg('Falante 1', 'x')], [])).toBe('audio')
  })
  it('modo digitar: sem seção de transcrição, com anotações e regra de não inventar', () => {
    const p = buildAtaPrompt(meta, [], notas)
    expect(p.userPrompt).not.toContain('TRANSCRIÇÃO')
    expect(p.userPrompt).toContain('Anotação 1 [12:35]: Provas dia 10/11')
    expect(p.systemInstruction).toContain('NUNCA invente')
  })
  it('modo gravar e digitar: prioridade das anotações e [confirmar:]', () => {
    const p = buildAtaPrompt(meta, [seg('Falante não identificado', 'dia dez')], notas)
    expect(p.systemInstruction).toContain('PRIORIDADE')
    expect(p.systemInstruction).toContain('[confirmar:')
    expect(p.userPrompt).toContain('TRANSCRIÇÃO')
  })
  it('sem anotações o prompt é o de sempre', () => {
    const p = buildAtaPrompt(meta, [seg('Falante 1', 'oi')])
    expect(p.userPrompt).not.toContain('ANOTAÇÕES')
    expect(p.systemInstruction).not.toContain('MODO')
  })
  it('"Falante não identificado" é tratado como genérico no prompt', () => {
    const p = buildAtaPrompt(meta, [seg(FALANTE_NAO_IDENTIFICADO, 'oi')])
    expect(p.userPrompt).not.toContain('Autoria informada')
  })
})

describe('renderAtaTextoLivre', () => {
  const r = renderAtaTextoLivre(meta, 'Foram tratados 2 assuntos.\nA prova será dia 10/11. Prof. Rui ausente.')
  it('gera abertura e encerramento por código e bloco único', () => {
    expect(r.texto).toMatch(/^Aos vinte dias do mês de outubro/)
    expect(r.texto).toContain('Nada mais havendo a tratar')
    expect(r.texto).not.toMatch(/\n/)
  })
  it('converte números para extenso e mantém o texto da usuária', () => {
    expect(r.texto).toContain('dois assuntos')
    expect(r.texto).not.toMatch(/\d/)
    expect(r.texto).toContain('Foram tratados')
  })
  it('texto vazio vira pendência', () => {
    const v = renderAtaTextoLivre(meta, '  ')
    expect(v.pendencias.join(' ')).toContain('desenvolvimento da reunião')
  })
  it('passa pela validação de formato', () => {
    expect(validateAta(r)).toEqual([])
  })
  it('renderAta continua igual', () => {
    const e: AtaExtraida = { itens: [{ pauta: 1, relato: 'Definiu-se o calendário.' }], deliberacoes: [], encaminhamentos: [], pendencias: [] }
    expect(renderAta(meta, e).texto).toContain('No primeiro item da pauta: Definiu-se o calendário.')
  })
})

describe('extrairResumo', () => {
  it('de AtaExtraida', () => {
    const e: AtaExtraida = {
      itens: [{ pauta: 2, relato: 'Foi apresentado o reforço. Alunos serão avisados.' }, { pauta: 0, relato: 'Pediu-se mais cadeiras. Será verificado.' }],
      deliberacoes: [{ texto: 'Aprovado o calendário.', votacao: 'por unanimidade' }],
      encaminhamentos: [{ acao: 'Enviar o aviso aos pais.', responsavel: 'Joana Alves', prazo: 'sexta-feira' }],
      pendencias: [], orientacoes: ['Chegar no horário.'],
    }
    const r = extrairResumo(e, meta)
    expect(r.assuntos).toEqual(['Reforço escolar', 'Pediu-se mais cadeiras'])
    expect(r.decisoes).toEqual(['Aprovado o calendário (por unanimidade)'])
    expect(r.encaminhamentos).toEqual(['Enviar o aviso aos pais — responsável: Joana Alves — prazo: sexta-feira', 'Chegar no horário'])
  })
  it('de texto: usa só o que o texto diz', () => {
    const t = 'Aos vinte dias, reuniram-se. No primeiro item da pauta: tratou-se do calendário. Ficou decidido que as provas serão em novembro. Ficou combinado que Joana enviará o aviso. Nada mais havendo a tratar, encerrou-se.'
    const r = extrairResumo(t)
    expect(r.assuntos).toEqual(['tratou-se do calendário'])
    expect(r.decisoes).toHaveLength(1)
    expect(r.encaminhamentos).toHaveLength(1)
  })
  it('vazio', () => {
    expect(extrairResumo('')).toEqual({ assuntos: [], decisoes: [], encaminhamentos: [] })
  })
})

describe('prompt de cobertura e incorporarAnotacoes', () => {
  const notas = [
    { texto: 'Prova de Matemática dia 10 de novembro', tempo: '00:01' },
    { texto: 'Carlos Mendes ficou responsável pelo cartaz', tempo: '00:03' },
    { texto: 'Reforço escolar começa terça-feira', tempo: '00:04' },
  ]
  const vazia: AtaExtraida = {
    itens: [{ pauta: 1, relato: 'No primeiro item da pauta, [PENDENTE: item não registrado na transcrição].' }],
    deliberacoes: [], encaminhamentos: [], pendencias: ['item não registrado'],
  }
  it('prompt numera as anotações e exige cobertura de cada uma', () => {
    const p = buildAtaPrompt(meta, [seg('Falante 1', 'bom dia')], notas)
    expect(p.userPrompt).toContain('Anotação 3 [00:04]: Reforço escolar começa terça-feira')
    expect(p.systemInstruction).toContain('CADA anotação deve aparecer')
    expect(p.systemInstruction).toContain('[confirmar: Anotação N]')
  })
  it('resposta que ignora as anotações recebe todas, por código, com pendência', () => {
    const { extraida, incorporadas } = incorporarAnotacoes(vazia, notas)
    expect(incorporadas).toHaveLength(3)
    const texto = renderAta(meta, extraida).texto
    expect(texto).toContain('Conforme anotações registradas durante a reunião')
    expect(texto).toMatch(/matemática dia dez de novembro/i)
    expect(texto).toContain('Carlos Mendes ficou responsável pelo cartaz')
    expect(extraida.pendencias.filter(p => p.startsWith('conferir anotação incorporada'))).toHaveLength(3)
    expect(vazia.itens).toHaveLength(1)
  })
  it('anotação que casa com um item da pauta entra no relato desse item', () => {
    const e: AtaExtraida = { ...vazia, itens: [{ pauta: 2, relato: 'Tratou-se do reforço escolar para os alunos.' }, { pauta: 1, relato: 'Avaliação.' }] }
    const r = incorporarAnotacoes(e, [{ texto: 'Reforço escolar começa terça-feira dia 12' }]).extraida
    expect(r.itens.find(i => i.pauta === 2)!.relato).toContain('Conforme anotação registrada durante a reunião, reforço escolar começa terça-feira dia 12.')
    expect(r.itens.some(i => i.pauta === 0)).toBe(false)
  })
  it('o que já está no corpo (mesmo com número por extenso) não é repetido', () => {
    const e: AtaExtraida = {
      itens: [{ pauta: 1, relato: 'A prova de Matemática foi marcada para o dia dez de novembro e Carlos Mendes ficou responsável pelo cartaz.' }],
      deliberacoes: [], encaminhamentos: [{ acao: 'Iniciar o reforço escolar na terça-feira' }], pendencias: [],
    }
    const r = incorporarAnotacoes(e, notas)
    expect(r.incorporadas).toEqual([])
    expect(r.extraida).toBe(e)
  })
  it('sem anotações devolve o mesmo objeto', () => {
    expect(incorporarAnotacoes(vazia, []).extraida).toBe(vazia)
  })
})
