# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## O projeto

PWA estática (Vite + React 19 + TypeScript + Tailwind 4) para uma única usuária (a diretora de uma escola). Ela envia o áudio de uma reunião, o Gemini (plano gratuito) transcreve e redige o corpo da ata, e o app gera um PDF A4 no padrão de ata escolar brasileira para impressão. Não há servidor: o navegador chama a API do Gemini direto via `@google/genai`, e a chave da API e todos os dados ficam em IndexedDB no aparelho. Tem de funcionar bem no celular (mobile-first). Decisões e escopo estão em `PLANO.md`; o MVP cobre só o tipo "reunião pedagógica".

## Comandos

Node 20+. Nesta máquina o Node fica em `~/.local/node`: `export PATH=$HOME/.local/node/bin:$PATH`.

```
npm run dev -- --host     # dev server (--host para abrir no celular pela rede local)
npm test                  # vitest (jsdom), todos os testes
npx vitest run src/ata/extenso.test.ts   # um arquivo
npx vitest run -t "nome do teste"        # um teste pelo nome
npm run build             # tsc -b && vite build -> dist/ (site estático + service worker)
```

Não há linter configurado; `tsc -b` (no build) é a checagem de tipos.

## Arquitetura

Fluxo de uma ata (orquestrado em `src/pipeline.ts`, com estado salvo em IndexedDB a cada etapa):

1. **NovaAta**: o formulário monta `MeetingMetadata`, e o áudio é salvo em `db.audios`.
2. **`rodarTranscricao`**: `gemini.transcreverAudio` envia o arquivo pela Files API, espera `ACTIVE` e pede `TranscriptSegment[]` em JSON (`responseSchema`). Áudio com mais de 60 min é transcrito por faixas de 20 min. O arquivo remoto é apagado no `finally`, e o áudio local é apagado após sucesso.
3. **RevisarTranscricao**: a usuária edita os trechos e renomeia os falantes.
4. **`rodarGeracaoAta`**: `gemini.gerarAta` devolve `AtaExtraida` (JSON). `renderAta` monta o texto final.
5. **RevisarAta**: mostra `validateAta` e os marcadores `[PENDENTE: ...]`. O texto editado vai para `textoEditado`, que tem precedência sobre `renderizada.texto`.
6. **Imprimir**: `src/pdf.ts` (pdfmake) gera o PDF.

`AtaRecord.status` (`rascunho | processando | transcricao | ata | erro`) decide a rota via `proximaRota`. O roteamento usa `HashRouter`, e o `base: './'` do Vite permite hospedagem estática em qualquer caminho.

### `src/ata/`: regras da ata (sem dependência de UI, Gemini ou DB)

Importe sempre por `src/ata-api.ts` (reexporta `src/ata`), nunca por caminhos internos.

- Divisão de responsabilidade central: **o LLM só redige o corpo** (relato por item de pauta, deliberações, encaminhamentos). Abertura ("Aos ... dias do mês de ..."), encerramento padrão ("Nada mais havendo a tratar..."), datas, horas e números por extenso são gerados **por código** em `render.ts` / `extenso.ts` / `numeros.ts`. `renderAta` também converte dígitos que o modelo deixar no corpo.
- O texto final é um **bloco único corrido, sem quebras de linha** (exigência formal de ata). `validate.ts` checa isso, mais abertura/encerramento, dígitos, abreviações, 1ª pessoa/futuro e marcadores.
- Lacunas nunca são inventadas: viram `[PENDENTE: ...]` no texto e entram em `pendencias`. Trechos não compreendidos viram `[inaudível]`.
- `schemas.ts` usa o subconjunto OpenAPI aceito pelo `responseSchema` do Gemini (`type: OBJECT/ARRAY/STRING`).
- `AtaExtraida.itens[].pauta` é o índice 1-based do item da pauta; `0` = assunto fora da pauta.

### Outros pontos

- `src/gemini.ts`: `traduzirErro` converte falhas em `GeminiError` com `kind` (`cota`, `chave`, `sobrecarga`, `rede`, `conteudo`), exibido em pt-BR. Há retry com backoff em 5xx e erro de rede. Os modelos disponíveis ficam em `MODELOS` (`src/types.ts`), e o modelo é configurável pela usuária.
- `src/pdf.ts`: A4, Times 12 pt, margens tipo ABNT. `preencherComTracos` mede a última linha com as métricas AFM da Times para preencher o resto com traços (regra de ata: sem espaço para acréscimos). As assinaturas vêm logo após o texto, e o rodapé leva "Folha X de Y". O pdfmake fica em chunk separado, carregado só ao imprimir.
- `src/db.ts` (Dexie): tabelas `settings` (linha única `main`), `atas`, `audios`. Mudar o schema exige nova `version()`.
- Textos de UI, prompts, identificadores de domínio e mensagens de commit são em português.

## Equipe de agentes (Maestri)

O código foi escrito por agentes coordenados via Maestri: `src/ata/**` pelo "Claude Code #3", e o resto do app pelo "Claude Code #2". Antes de editar uma área, verifique (`maestri list` / `maestri check`) se outro agente não está trabalhando nela.
