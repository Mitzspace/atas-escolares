// Schemas no subconjunto OpenAPI aceito pelo Gemini (responseSchema).

export const transcriptResponseSchema: object = {
  type: 'ARRAY',
  description: 'Segmentos de fala em ordem cronológica.',
  items: {
    type: 'OBJECT',
    properties: {
      speaker: { type: 'STRING', description: 'Nome do falante (da lista de participantes) ou "Falante N".' },
      start: { type: 'STRING', description: 'Início do segmento, formato MM:SS contado do início do áudio.' },
      end: { type: 'STRING', description: 'Fim do segmento, formato MM:SS contado do início do áudio.' },
      text: { type: 'STRING', description: 'Fala transcrita, em português do Brasil.' },
    },
    required: ['speaker', 'start', 'end', 'text'],
    propertyOrdering: ['speaker', 'start', 'end', 'text'],
  },
};

export const ataResponseSchema: object = {
  type: 'OBJECT',
  properties: {
    itens: {
      type: 'ARRAY',
      description: 'Um relato por item da pauta, na ordem da pauta.',
      items: {
        type: 'OBJECT',
        properties: {
          pauta: {
            type: 'INTEGER',
            description: 'Número do item da pauta (começa em 1). Use 0 para assuntos tratados fora da pauta.',
          },
          relato: {
            type: 'STRING',
            description: 'Texto corrido, sem quebras de linha, pretérito perfeito, terceira pessoa, números por extenso.',
          },
        },
        required: ['pauta', 'relato'],
        propertyOrdering: ['pauta', 'relato'],
      },
    },
    deliberacoes: {
      type: 'ARRAY',
      description: 'Decisões efetivamente tomadas na reunião.',
      items: {
        type: 'OBJECT',
        properties: {
          texto: { type: 'STRING', description: 'A decisão, em uma frase no pretérito perfeito.' },
          votacao: {
            type: 'STRING',
            description: 'Resultado da votação, só se mencionado (ex.: "aprovado por unanimidade"). Omitir se não houve.',
          },
        },
        required: ['texto'],
        propertyOrdering: ['texto', 'votacao'],
      },
    },
    encaminhamentos: {
      type: 'ARRAY',
      description: 'Ações combinadas para depois da reunião.',
      items: {
        type: 'OBJECT',
        properties: {
          acao: { type: 'STRING', description: 'O que ficou combinado fazer.' },
          responsavel: { type: 'STRING', description: 'Quem fará, só se dito. Omitir se não dito.' },
          prazo: { type: 'STRING', description: 'Prazo, só se dito, por extenso. Omitir se não dito.' },
        },
        required: ['acao'],
        propertyOrdering: ['acao', 'responsavel', 'prazo'],
      },
    },
    pendencias: {
      type: 'ARRAY',
      description: 'Descrição de cada marcação [PENDENTE: ...] ou [trecho inaudível] usada nos relatos.',
      items: { type: 'STRING' },
    },
  },
  required: ['itens', 'deliberacoes', 'encaminhamentos', 'pendencias'],
  propertyOrdering: ['itens', 'deliberacoes', 'encaminhamentos', 'pendencias'],
};
