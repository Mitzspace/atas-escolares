import { describe, expect, it } from 'vitest'
import { renderAta, renderAtaTextoLivre, type AtaExtraida, type MeetingMetadata } from './ata-api'
import { aplicarPresenca, listaDePresenca, listarMarcadores, preencherIguais, preencherMarcador } from './revisao'
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

describe('preencherMarcador com valores reais', () => {
  const um = (t: string, v: string, i = 0) => preencherMarcador(t, listarMarcadores(t)[i], v)

  it('ordinais, decimais, datas e abreviações vão por extenso', () => {
    const t = 'A turma [PENDENTE: turma citada] teve média [PENDENTE: média]. Falou [PENDENTE: nome], coordenadora, em [PENDENTE: data].'
    let r = um(t, '3º ano B')
    expect(r).toContain('A turma terceiro ano B teve')
    r = um(r, '2,5')
    expect(r).toContain('média dois vírgula cinco.')
    r = um(r, 'Prof. Carlos')
    expect(r).toContain('Falou professor Carlos, coordenadora')
    r = um(r, '05/11')
    expect(r).toContain('em cinco de novembro.')
    expect(listarMarcadores(r)).toEqual([])
    expect(r).not.toMatch(/\d/)
  })

  it('não repete a pontuação que já vem depois do marcador', () => {
    expect(um('Foi no dia [PENDENTE: data].', 'cinco de novembro.')).toBe('Foi no dia cinco de novembro.')
    expect(um('O aluno [confirmar: nome] faltou.', 'J.P.S.')).toBe('O aluno J.P.S. faltou.')
    expect(um('O aluno [confirmar: nome].', 'J.P.S.')).toBe('O aluno J.P.S.')
  })

  it('põe maiúscula quando o marcador abre a frase', () => {
    expect(um('Terminou. [PENDENTE: quem falou] disse que sim.', 'a professora Clara')).toBe('Terminou. A professora Clara disse que sim.')
    expect(um('[PENDENTE: quem falou] disse que sim.', 'prof. Carlos')).toBe('Professor Carlos disse que sim.')
  })

  it('[confirmar: ...] no meio da frase: preenche ou remove sem sobrar vírgula', () => {
    const t = 'A coordenadora, [confirmar: nome], informou o prazo.'
    expect(um(t, 'Joana Alves')).toBe('A coordenadora, Joana Alves, informou o prazo.')
    expect(um(t, '')).toBe('A coordenadora, informou o prazo.')
    expect(um('No segundo item da pauta, [PENDENTE: item não registrado].', '')).toBe('No segundo item da pauta.')
  })

  it('horários: 14:30, 14h30, 9h, sem repetir "às", e inválidos não quebram', () => {
    const t = 'Encerrada a reunião [PENDENTE: horário de término], e eu'
    expect(um(t, '14:30')).toBe('Encerrada a reunião às quatorze horas e trinta minutos, e eu')
    expect(um(t, '14h30')).toBe('Encerrada a reunião às quatorze horas e trinta minutos, e eu')
    expect(um(t, '9h')).toBe('Encerrada a reunião às nove horas, e eu')
    expect(um(t, '12:00')).toBe('Encerrada a reunião ao meio-dia, e eu')
    expect(um('Encerrada às [PENDENTE: horário de término], e eu', '15:10')).toBe('Encerrada às quinze horas e dez minutos, e eu')
    expect(() => um(t, '25:99')).not.toThrow()
    expect(um(t, 'por volta das quinze horas')).toBe('Encerrada a reunião por volta das quinze horas, e eu')
  })

  it('marcadores repetidos: um por vez, ou todos de uma vez', () => {
    const t = 'A [PENDENTE: nome da professora] disse. Depois a [PENDENTE: nome da professora] concordou. E [PENDENTE: prazo].'
    const ms = listarMarcadores(t)
    expect(ms).toHaveLength(3)
    const so1 = preencherMarcador(t, ms[0], 'Clara')
    expect(listarMarcadores(so1).map(m => m.descricao)).toEqual(['nome da professora', 'prazo'])
    const todos = preencherIguais(t, ms[1], 'Clara')
    expect(todos).toBe('A Clara disse. Depois a Clara concordou. E [PENDENTE: prazo].')
  })

  it('preencherIguais não entra em laço se o valor traz o mesmo marcador', () => {
    const t = 'A [PENDENTE: x] e a [PENDENTE: x].'
    expect(() => preencherIguais(t, listarMarcadores(t)[0], '[PENDENTE: x]')).not.toThrow()
  })

  it('listarMarcadores: contexto sem cortar a primeira palavra quando o texto é curto', () => {
    const [m] = listarMarcadores('Aos doze dias [PENDENTE: x]')
    expect(m.contexto).toBe('Aos doze dias ')
    const longo = 'palavra '.repeat(30) + '[PENDENTE: x]'
    expect(listarMarcadores(longo)[0].contexto.startsWith('…')).toBe(true)
  })

  it('reconhece os três tipos', () => {
    const ms = listarMarcadores('a [PENDENTE: p] b [confirmar: c] d [trecho inaudível] e [inaudível: f]')
    expect(ms.map(m => [m.tipo, m.descricao])).toEqual([
      ['pendente', 'p'], ['confirmar', 'c'], ['inaudivel', 'trecho inaudível'], ['inaudivel', 'f'],
    ])
  })
})

describe('aplicarPresenca em situações reais', () => {
  const com = (presentes: boolean[]) => meta.participantes.map((p, i) => ({ ...p, presente: presentes[i] }))
  const aplicar = (a: AtaRecord, presentes: boolean[]) => {
    const r = aplicarPresenca(a, com(presentes))
    // como a tela faz: guarda a nova ata e o texto visto pela usuária
    return { r, a: { ...a, meta: r.meta, renderizada: r.renderizada, textoEditado: r.texto } as AtaRecord }
  }

  it('todos ausentes: só presidente e secretário', () => {
    const { r } = aplicar(ata(), [false, false])
    expect(r.texto).toContain('totalizando dois presentes')
    expect(r.texto).toContain('Não compareceram os seguintes convocados: Joana Alves, coordenadora pedagógica e Carlos Mendes, professor.')
    expect(r.renderizada.assinaturas.map(p => p.nome)).toEqual(['Maria Souza', 'Paulo Reis'])
  })

  it('ida e volta (ausente -> presente) devolve o texto original, com edições preservadas', () => {
    const a0 = ata()
    const editado = a0.renderizada!.texto.replace('apresentou a proposta', 'apresentou com detalhes a proposta')
    const { a: a1, r: r1 } = aplicar({ ...a0, textoEditado: editado }, [true, false])
    expect(r1.textoPreservado).toBe(true)
    expect(r1.texto).toContain('Não compareceu o seguinte convocado: Carlos Mendes')
    const { r: r2 } = aplicar(a1, [true, true])
    expect(r2.textoPreservado).toBe(true)
    expect(r2.texto).toBe(editado)
    expect(r2.texto).not.toContain('Não compareceu')
  })

  it('edição só no meio e horário de término já preenchido continuam no texto', () => {
    const a0 = ata()
    const preenchido = preencherMarcador(
      a0.renderizada!.texto,
      listarMarcadores(a0.renderizada!.texto).find(m => m.hora)!,
      '15:10',
    ).replace('Enviar', 'Providenciar').replace('enviar o regulamento', 'providenciar o regulamento')
    const { r } = aplicar({ ...a0, textoEditado: preenchido }, [false, true])
    expect(r.textoPreservado).toBe(true)
    expect(r.texto).toContain('foi encerrada a reunião às quinze horas e dez minutos, e eu')
    expect(r.texto).toContain('providenciar o regulamento')
    expect(r.texto).toContain('Não compareceu a seguinte convocada: Joana Alves')
    expect(listarMarcadores(r.texto).map(m => m.descricao)).toEqual(['prazo do primeiro encaminhamento'])
  })

  it('pendência já preenchida em outro ponto do texto não volta', () => {
    const a0 = ata()
    const t0 = a0.renderizada!.texto
    const sem = preencherMarcador(t0, listarMarcadores(t0)[0], 'até trinta de outubro')
    const { r } = aplicar({ ...a0, textoEditado: sem }, [true, false])
    expect(r.texto).toContain('prazo: até trinta de outubro')
    expect(r.texto).not.toContain('prazo do primeiro encaminhamento')
  })

  it('texto idêntico ao gerado acompanha a presença mesmo sem textoEditado', () => {
    const { r } = aplicar({ ...ata(), textoEditado: ata().renderizada!.texto }, [false, false])
    expect(r.textoPreservado).toBe(true)
    expect(r.texto).toContain('Não compareceram')
  })
})

describe('listaDePresenca: nomes com acento, caixa e espaços', () => {
  it('não repete "María  Souza" com "Maria Souza" e mantém quem já estava na ata', () => {
    const l = listaDePresenca(
      [{ nome: 'Joana Alves', cargo: 'Coordenadora', presente: false }],
      [{ nome: 'JOANA  ALVES', cargo: 'x' }, { nome: 'María Souza', cargo: 'Diretora' }, { nome: 'Ana Lima', cargo: 'Professora' }],
      [{ nome: 'Maria Souza', cargo: 'Diretora' }],
    )
    expect(l.map(p => [p.nome, p.presente])).toEqual([['Joana Alves', false], ['Ana Lima', false]])
  })
})

describe('aplicarPresenca: só convocados aparecem como ausentes', () => {
  const cadastro = [{ nome: 'Rui Lopes', cargo: 'Merendeiro' }]

  it('cadastrado não convocado e desmarcado fica fora da ata', () => {
    const lista = listaDePresenca(meta.participantes, cadastro, [meta.presidente, meta.secretario])
    const desmarcaCarlos = lista.map(p => (p.nome === 'Carlos Mendes' ? { ...p, presente: false } : p))
    const r = aplicarPresenca(ata(), desmarcaCarlos)
    expect(r.texto).toContain('Não compareceu o seguinte convocado: Carlos Mendes, professor')
    expect(r.texto).not.toContain('Rui Lopes')
    expect(r.convocados).toEqual(['joana alves', 'carlos mendes'])
  })

  it('cadastrado marcado e depois desmarcado some da ata em vez de virar ausente', () => {
    const lista = listaDePresenca(meta.participantes, cadastro)
    const marcado = aplicarPresenca(ata(), lista.map(p => ({ ...p, presente: true })))
    expect(marcado.renderizada.assinaturas.map(p => p.nome)).toContain('Rui Lopes')

    const a = { ...ata(), meta: marcado.meta, renderizada: marcado.renderizada, convocados: marcado.convocados }
    const volta = aplicarPresenca(a, listaDePresenca(a.meta.participantes, cadastro).map(p => (p.nome === 'Rui Lopes' ? { ...p, presente: false } : p)))
    expect(volta.texto).not.toContain('Rui Lopes')
    expect(volta.meta.participantes.map(p => p.nome)).not.toContain('Rui Lopes')
  })
})

describe('tipos de ata: categoria, vínculo e orientado', () => {
  const mae = { nome: 'Clara Lima', cargo: 'Mãe', categoria: 'responsavel' as const, vinculo: 'aluna Ana Lima, 5º ano B', presente: true }
  const aluna = { nome: 'Ana Lima', cargo: 'Aluna', categoria: 'aluno' as const, vinculo: '5º ano B', presente: true }
  const orientacao = (): AtaRecord => {
    const m: MeetingMetadata = { ...meta, tipo: 'orientacao', participantes: [mae], orientado: aluna, pauta: ['Faltas'] }
    const e = { ...extraida, orientacoes: ['A diretora orientou a justificar as faltas.'] }
    return { id: 'o', criadaEm: 0, atualizadaEm: 0, status: 'ata', meta: m, extraida: e, renderizada: renderAta(m, e) }
  }

  it('aplicarPresenca mantém categoria, vínculo e o orientado; o responsável ausente não some', () => {
    const r = aplicarPresenca(orientacao(), [{ ...mae, presente: false }])
    expect(r.meta.orientado).toEqual(aluna)
    expect(r.meta.participantes).toEqual([{ ...mae, presente: false }])
    expect(r.texto).toContain('a aluna orientada Ana Lima, do quinto ano B')
    expect(r.texto).toContain('Não compareceu a seguinte convocada: Clara Lima, mãe da aluna Ana Lima, do quinto ano B.')
    expect(r.renderizada.assinaturas.map(p => p.nome)).toEqual(['Maria Souza', 'Paulo Reis', 'Ana Lima'])
  })

  it('responsável adicionado à mão continua na lista mesmo fora dos convocados', () => {
    const a = { ...orientacao(), convocados: [] as string[] }
    const r = aplicarPresenca(a, [{ ...mae, presente: false }])
    expect(r.meta.participantes.map(p => p.nome)).toEqual(['Clara Lima'])
  })

  it('o orientado não vira participante repetido (nem ausente)', () => {
    const r = aplicarPresenca(orientacao(), [{ nome: 'Ana Lima', cargo: 'Aluna', presente: false }, mae])
    expect(r.meta.participantes.map(p => p.nome)).toEqual(['Clara Lima'])
    expect(r.renderizada.assinaturas.filter(p => p.nome === 'Ana Lima')).toHaveLength(1)
    expect(r.texto).not.toContain('Não compareceu')
  })

  it('listaDePresenca ignora o orientado vindo do cadastro e preserva categoria/vínculo', () => {
    const l = listaDePresenca([mae], [{ nome: 'Ana Lima', cargo: 'Aluna' }, { nome: 'Rui Lopes', cargo: 'Professor' }], [], aluna)
    expect(l.map(p => p.nome)).toEqual(['Clara Lima', 'Rui Lopes'])
    expect(l[0]).toMatchObject({ categoria: 'responsavel', vinculo: 'aluna Ana Lima, 5º ano B' })
  })

  it('ata antiga (sem categoria) continua mudando a presença como antes', () => {
    const r = aplicarPresenca(ata(), [meta.participantes[0], { ...meta.participantes[1], presente: false }])
    expect(r.texto).toContain('Não compareceu o seguinte convocado: Carlos Mendes, professor')
  })
})

describe('vários orientados', () => {
  const al = (nome: string, turma: string) => ({ nome, cargo: 'Aluna', categoria: 'aluno' as const, vinculo: turma, presente: true })
  const prof = { nome: 'Carlos Mendes', cargo: 'Professor', presente: true }
  const mae = { nome: 'Clara Lima', cargo: 'Mãe', categoria: 'responsavel' as const, vinculo: 'aluna Ana Lima, 5º ano B', presente: true }
  const registro = (): AtaRecord => {
    const m: MeetingMetadata = { ...meta, tipo: 'orientacao', pauta: ['Faltas'], orientados: [al('Ana Lima', '5º ano B'), prof], participantes: [mae] }
    const e = { ...extraida, orientacoes: ['A diretora orientou os presentes.'] }
    return { id: 'v', criadaEm: 0, atualizadaEm: 0, status: 'ata', meta: m, extraida: e, renderizada: renderAta(m, e) }
  }

  it('os orientados ficam fixos, não duplicam e não viram ausentes', () => {
    const r = aplicarPresenca(registro(), [{ ...mae, presente: false }, { ...prof, presente: false }, { nome: 'Ana Lima', cargo: 'Aluna', presente: false }])
    expect(r.meta.orientados?.map(o => o.nome)).toEqual(['Ana Lima', 'Carlos Mendes'])
    expect(r.meta.participantes.map(p => p.nome)).toEqual(['Clara Lima'])
    expect(r.renderizada.assinaturas.map(a => a.nome)).toEqual(['Maria Souza', 'Paulo Reis', 'Ana Lima', 'Carlos Mendes'])
    expect(r.texto).toContain('Não compareceu a seguinte convocada: Clara Lima')
  })

  it('listaDePresenca aceita lista de orientados', () => {
    const l = listaDePresenca([mae], [{ nome: 'Ana Lima', cargo: 'Aluna' }, { nome: 'carlos mendes', cargo: 'Professor' }, { nome: 'Rui Lopes', cargo: 'Professor' }], [], [al('Ana Lima', '5º ano B'), prof])
    expect(l.map(p => p.nome)).toEqual(['Clara Lima', 'Rui Lopes'])
  })

  it('ata antiga com meta.orientado continua funcionando', () => {
    const a = registro()
    a.meta = { ...a.meta, orientados: undefined, orientado: al('Ana Lima', '5º ano B') }
    a.renderizada = renderAta(a.meta, a.extraida!)
    const r = aplicarPresenca(a, [{ ...mae, presente: false }])
    expect(r.meta.orientado?.nome).toBe('Ana Lima')
    expect(r.renderizada.assinaturas.map(x => x.nome)).toEqual(['Maria Souza', 'Paulo Reis', 'Ana Lima'])
  })
})

describe('aplicarPresenca: ata digitada sem IA ("Usar como está")', () => {
  const corpo = 'Tratou-se da Feira de Ciências. Ficou combinado enviar o regulamento.'
  const livre = (): AtaRecord => ({ id: 'y', criadaEm: 0, atualizadaEm: 0, status: 'ata', meta, renderizada: renderAtaTextoLivre(meta, corpo) })
  const desmarca = meta.participantes.map(p => (p.nome === 'Carlos Mendes' ? { ...p, presente: false } : p))

  it('alternar presença mantém o corpo digitado e atualiza abertura e ausentes', () => {
    const r = aplicarPresenca(livre(), desmarca)
    expect(r.texto).toContain(corpo)
    expect(r.texto).toContain('Não compareceu o seguinte convocado: Carlos Mendes, professor')
    expect(r.texto).toContain('totalizando três presentes')
    expect(r.renderizada.assinaturas.map(a => a.nome)).not.toContain('Carlos Mendes')
  })

  it('voltar a marcar restaura o texto original', () => {
    const a = livre()
    const ida = aplicarPresenca(a, desmarca)
    const volta = aplicarPresenca({ ...a, meta: ida.meta, renderizada: ida.renderizada, convocados: ida.convocados }, meta.participantes)
    expect(volta.texto).toBe(a.renderizada!.texto)
  })

  it('preserva a edição manual do corpo', () => {
    const a = livre()
    const editado = a.renderizada!.texto.replace('Tratou-se da Feira de Ciências', 'Tratou-se da Feira de Ciências e Artes')
    const r = aplicarPresenca({ ...a, textoEditado: editado }, desmarca)
    expect(r.texto).toContain('Feira de Ciências e Artes')
    expect(r.texto).toContain('Carlos Mendes')
    expect(r.textoPreservado).toBe(true)
  })

  it('texto renderizado que não bate: não lança nem perde o texto', () => {
    const a = { ...livre(), renderizada: { ...livre().renderizada!, texto: 'Texto sem a estrutura esperada.' } }
    const r = aplicarPresenca(a, desmarca)
    expect(r.texto).toBe('Texto sem a estrutura esperada.')
    expect(r.textoPreservado).toBe(false)
  })
})

describe('aplicarPresenca: cadastro v2 (orientados são participantes)', () => {
  const v2: MeetingMetadata = {
    ...meta, tipo: 'orientacao', presidente: undefined, secretario: undefined, ordinaria: undefined,
    responsavel: { nome: 'Maria Souza', cargo: 'Diretora' },
    participantes: [
      { nome: 'Pedro Lima', cargo: 'Aluno', categoria: 'aluno', vinculo: '5º ano B', presente: true, recebeOrientacao: true },
      { nome: 'Clara Lima', cargo: 'Mãe', categoria: 'responsavel', vinculo: 'aluno Pedro Lima, 5º ano B', presente: true },
    ],
  }
  const ex: AtaExtraida = { ...extraida, orientacoes: ['Respeitar os colegas.'], cienciaOrientado: true }
  const a: AtaRecord = { id: 'z', criadaEm: 0, atualizadaEm: 0, status: 'ata', meta: v2, extraida: ex, renderizada: renderAta(v2, ex) }

  it('mudar a presença de outro participante não remove o orientado', () => {
    const r = aplicarPresenca(a, v2.participantes.map(p => (p.nome === 'Clara Lima' ? { ...p, presente: false } : p)))
    expect(r.meta.participantes.map(p => p.nome)).toEqual(['Pedro Lima', 'Clara Lima'])
    expect(r.texto).toContain('o aluno orientado Pedro Lima')
    expect(r.renderizada.assinaturas.map(x => x.nome)).toContain('Pedro Lima')
  })

  it('o orientado fica mesmo se a lista o trouxer desmarcado e fora dos convocados', () => {
    const r = aplicarPresenca({ ...a, convocados: [] }, v2.participantes.map(p => ({ ...p, presente: p.nome !== 'Pedro Lima' })))
    expect(r.meta.participantes.map(p => p.nome)).toContain('Pedro Lima')
  })

  it('formato legado continua tirando o orientado de participantes', () => {
    const leg: MeetingMetadata = { ...meta, tipo: 'orientacao', orientados: [{ nome: 'Pedro Lima', cargo: 'Aluno', categoria: 'aluno', vinculo: '5º ano B', presente: true }] }
    const al: AtaRecord = { ...a, meta: leg, renderizada: renderAta(leg, ex) }
    const r = aplicarPresenca(al, [...leg.participantes, ...leg.orientados!])
    expect(r.meta.participantes.map(p => p.nome)).not.toContain('Pedro Lima')
  })
})
