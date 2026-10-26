import { describe, expect, it } from 'vitest'
import {
  CARGOS_SUGERIDOS, listarOrientados, OPCOES_TIPO_REUNIAO, quemLavra, quemOrienta, renderAta, tipoDaOpcao, validateAta,
  buildAtaPrompt, type AtaExtraida, type MeetingMetadata,
} from '../ata-api'

const base: MeetingMetadata = {
  escola: 'Escola Municipal Teste', rede: 'Secretaria Municipal de Educação', municipioUf: 'Exemplo/SP', tipo: 'outra',
  tipoReuniao: 'Conselho de classe', numero: 5, ano: 2026, data: '2026-10-20', horaInicio: '14:00', horaFim: '15:30',
  local: 'sala dos professores', responsavel: { nome: 'Paulo Reis', cargo: 'Secretário escolar' },
  participantes: [
    { nome: 'Joana Alves', cargo: 'Coordenadora pedagógica', presente: true },
    { nome: 'Clara Dias', cargo: '', presente: true },
  ],
  pauta: ['Notas do bimestre'], anonimizarAlunos: false,
}
const extraida: AtaExtraida = { itens: [{ pauta: 1, relato: 'Analisaram-se as notas.' }], deliberacoes: [], encaminhamentos: [], pendencias: [] }

describe('tipo de reunião', () => {
  it('rótulo -> TipoAta', () => {
    expect(tipoDaOpcao('Reunião pedagógica')).toBe('pedagogica')
    expect(tipoDaOpcao('reuniao de pais e responsaveis')).toBe('pais')
    expect(tipoDaOpcao('Orientação a funcionário(s)')).toBe('orientacao')
    expect(tipoDaOpcao('Conselho de classe')).toBe('outra')
    expect(tipoDaOpcao('Reunião sobre a festa junina')).toBe('outra')
    expect(OPCOES_TIPO_REUNIAO).toHaveLength(9)
    expect(CARGOS_SUGERIDOS).toContain('Mãe')
  })
  it('título dinâmico em maiúsculas', () => {
    expect(renderAta(base, extraida).titulo).toBe('ATA Nº 005/2026 – CONSELHO DE CLASSE')
    expect(renderAta({ ...base, tipoReuniao: 'Reunião sobre a festa junina' }, extraida).titulo).toContain('REUNIÃO SOBRE A FESTA JUNINA')
    expect(renderAta({ ...base, tipoReuniao: undefined }, extraida).titulo).toBe('ATA Nº 005/2026 – REUNIÃO')
  })
  it('pedagógica nova não leva ordinária/extraordinária; antiga leva', () => {
    expect(renderAta({ ...base, tipo: 'pedagogica' }, extraida).titulo).toBe('ATA Nº 005/2026 – REUNIÃO PEDAGÓGICA')
    expect(renderAta({ ...base, tipo: 'pedagogica', ordinaria: false }, extraida).titulo).toContain('EXTRAORDINÁRIA')
  })
})

describe('responsável pela ata', () => {
  const r = renderAta(base, extraida)
  it('abertura sem presidência e encerramento com o responsável', () => {
    expect(r.texto).not.toMatch(/presid|comigo|secret[aá]ri[ao] da reuni/i)
    expect(r.texto).toMatch(/reuniram-se Paulo Reis, secretário escolar; Joana Alves, coordenadora pedagógica; e Clara Dias, totalizando três presentes, para tratar/)
    expect(r.texto).toContain('e eu, Paulo Reis, secretário escolar, lavrei a presente ata que, lida e aprovada, será assinada por mim e pelos demais presentes.')
  })
  it('assinaturas: responsável primeiro, sem cargo quando vazio', () => {
    expect(r.assinaturas).toEqual([
      { nome: 'Paulo Reis', cargo: 'Secretário escolar' }, { nome: 'Joana Alves', cargo: 'Coordenadora pedagógica' }, { nome: 'Clara Dias', cargo: '' },
    ])
    expect(r.texto).not.toMatch(/Clara Dias,\s*[,.]|, ,|,,/)
  })
  it('responsável sem cargo: "e eu, Nome, lavrei" sem vírgula sobrando', () => {
    const t = renderAta({ ...base, responsavel: { nome: 'Paulo Reis', cargo: '' } }, extraida).texto
    expect(t).toContain('e eu, Paulo Reis, lavrei a presente ata')
    expect(t).not.toContain(', ,')
  })
  it('passa pela validação e o responsável não se repete se também está nos participantes', () => {
    expect(validateAta(r)).toEqual([])
    const dup = renderAta({ ...base, participantes: [...base.participantes, { nome: 'paulo reis', cargo: '', presente: true }] }, extraida)
    expect(dup.assinaturas.filter(a => /paulo reis/i.test(a.nome))).toHaveLength(1)
  })
  it('helpers', () => {
    expect(quemLavra(base).nome).toBe('Paulo Reis')
    expect(quemOrienta(base).nome).toBe('Paulo Reis')
    const antiga = { ...base, responsavel: undefined, presidente: { nome: 'Maria', cargo: 'Diretora' }, secretario: { nome: 'Pedro', cargo: 'Professor' } }
    expect(quemLavra(antiga).nome).toBe('Pedro')
    expect(quemOrienta(antiga).nome).toBe('Maria')
  })
  it('prompt traz o tipo, o responsável e nenhum presidente', () => {
    const p = buildAtaPrompt(base, [])
    expect(p.userPrompt).toContain('Conselho de classe')
    expect(p.userPrompt).toContain('Paulo Reis — Secretário escolar (responsável pelo registro da ata)')
    expect(p.userPrompt).not.toContain('presidente da reunião')
  })
})

describe('orientação com responsável', () => {
  const o: MeetingMetadata = {
    ...base, tipo: 'orientacao', tipoReuniao: 'Orientação a aluno(s)', responsavel: { nome: 'Maria Souza', cargo: 'Diretora' },
    participantes: [
      { nome: 'Pedro Lima', cargo: 'Aluno', categoria: 'aluno', vinculo: '5º ano B', presente: true, recebeOrientacao: true },
      { nome: 'Clara Lima', cargo: 'Mãe', categoria: 'responsavel', vinculo: 'aluno Pedro Lima, 5º ano B', presente: true },
    ],
    pauta: ['Comportamento em sala'],
  }
  it('participante marcado é o orientado; quem orienta é o responsável', () => {
    expect(listarOrientados(o).map(p => p.nome)).toEqual(['Pedro Lima'])
    const r = renderAta(o, { ...extraida, orientacoes: ['Respeitar os colegas.'], cienciaOrientado: true })
    expect(r.titulo).toBe('ATA Nº 005/2026 – ORIENTAÇÃO A ALUNO')
    expect(r.texto).toMatch(/reuniram-se Maria Souza, diretora, e o aluno orientado Pedro Lima, do quinto ano B, acompanhado de sua mãe, Clara Lima/)
    expect(r.texto).toContain('e eu, Maria Souza, diretora, lavrei')
    expect(r.texto).toContain('tendo o orientado tomado ciência')
    expect(validateAta(r)).toEqual([])
  })
  it('não duplica quando o orientado também está em orientados', () => {
    expect(listarOrientados({ ...o, orientados: [o.participantes[0]] })).toHaveLength(1)
  })
})
