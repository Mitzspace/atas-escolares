# Atas Escolares

PWA estática (Vite + React + TypeScript + Tailwind) que transcreve o áudio de uma reunião pedagógica e gera a ata em PDF A4, usando a API do Gemini (plano gratuito) direto do navegador. Dados e chave da API ficam só no aparelho (IndexedDB). Plano completo em `PLANO.md`.

## Rodar

Requer Node 20+.

```
npm install
npm run dev      # desenvolvimento
npm test         # vitest
npm run build    # gera dist/ (site estático + service worker)
npm run preview  # serve dist/
```

Na primeira vez, abra **Configurações**, crie a chave em https://aistudio.google.com/apikey e cole.

## Organização

- `src/ata/` — regras da ata (prompts, schemas, render, validação).
- `src/ata-api.ts` — único ponto de importação de `src/ata`.
- `src/gemini.ts` — Files API, transcrição (por faixas se > 60 min), geração da ata, erros de cota.
- `src/pipeline.ts` — orquestra áudio → transcrição → ata.
- `src/pdf.ts` — PDF com pdfmake (Times 12 pt, traços no fim, assinaturas, “Folha X de Y”).
- `src/db.ts` — IndexedDB (Dexie).
- `src/pages/` — telas.
