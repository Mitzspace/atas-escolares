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
      description: 'Relatos dos itens efetivamente tratados, na ordem da pauta. Itens sem fala registrada ficam ausentes, para o código gerar pendência.',
      items: {
        type: 'OBJECT',
        properties: {
          pauta: {
            type: 'INTEGER',
            description: 'Número do item da pauta (começa em 1). Use 0 para assuntos tratados fora da pauta.',
          },
          relato: {
            type: 'STRING',
            description: 'Texto corrido, sem quebras de linha, pretérito perfeito, terceira pessoa, números por extenso. Preserve horários, datas, durações e limites explicitamente ditos no assunto, sem omitir nem trocar seus valores. Informe de regra vigente não é aprovação coletiva.',
          },
        },
        required: ['pauta', 'relato'],
        propertyOrdering: ['pauta', 'relato'],
      },
    },
    deliberacoes: {
      type: 'ARRAY',
      description: 'Decisões coletivas explicitamente tomadas na reunião. Não transformar comunicado ou reafirmação de regra vigente em decisão coletiva.',
      items: {
        type: 'OBJECT',
        properties: {
          texto: { type: 'STRING', description: 'A decisão, em uma frase no pretérito perfeito.' },
          votacao: {
            type: 'STRING',
            description: 'Resultado de votação ou consenso explicitamente associado a ESTA decisão (ex.: "aprovado por unanimidade"). Não transferir aprovação de outro assunto. Omitir se não dito para esta decisão.',
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
          acao: { type: 'STRING', description: 'O que ficou explicitamente combinado fazer, preservando os horários, datas, durações e limites ditos que definem a ação.' },
          responsavel: { type: 'STRING', description: 'Quem fará, só se dito. Omitir se não dito.' },
          prazo: { type: 'STRING', description: 'Prazo, só se dito, por extenso. Omitir se não dito.' },
        },
        required: ['acao'],
        propertyOrdering: ['acao', 'responsavel', 'prazo'],
      },
    },
    manifestacoes: {
      type: 'ARRAY',
      description:
        'OPCIONAL. Reunião de pais: dúvidas e demandas das famílias, sem identificar casos individuais. Orientação: manifestações do orientado e de quem o acompanha. Cada item, uma frase no pretérito perfeito. Omitir ou [] nas reuniões pedagógicas.',
      items: { type: 'STRING' },
    },
    orientacoes: {
      type: 'ARRAY',
      description: 'OPCIONAL. Só em orientação: cada orientação dada, uma frase no pretérito perfeito. Omitir ou [] nos demais tipos.',
      items: { type: 'STRING' },
    },
    cienciaOrientado: {
      type: 'BOOLEAN',
      description:
        'OPCIONAL. Só em orientação: true SOMENTE se a transcrição mostra que o orientado tomou ciência/declarou ter entendido as orientações; caso contrário false.',
    },
    pendencias: {
      type: 'ARRAY',
      description: 'Descrição de cada marcação [PENDENTE: ...] ou [trecho inaudível] usada nos relatos.',
      items: { type: 'STRING' },
    },
  },
  required: ['itens', 'deliberacoes', 'encaminhamentos', 'pendencias'],
  propertyOrdering: ['itens', 'manifestacoes', 'orientacoes', 'deliberacoes', 'encaminhamentos', 'cienciaOrientado', 'pendencias'],
};
