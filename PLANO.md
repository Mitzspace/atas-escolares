# Plano: Gerador de Atas Escolares por Áudio (v3)

## Premissas (decididas)
- Custo zero: Gemini API no plano gratuito.
- Uma usuária só: a diretora, numa escola.
- A ata é impressa e assinada no papel.
- O computador tem pouca RAM e o app precisa rodar também no celular: nada de IA rodando no aparelho.

## 1. Arquitetura: site estático instalável (PWA), sem servidor
- Um site hospedado de graça (Cloudflare Pages, GitHub Pages ou Vercel) que vira app no celular ("Adicionar à tela inicial") e roda igual no PC.
- Todo o processamento fica no Gemini. O navegador fala direto com a API pelo SDK `@google/genai`.
- Chave da API: a diretora cria a chave grátis no Google AI Studio e cola uma vez em Configurações. A chave fica só no aparelho (IndexedDB), nunca no código.
- Os dados ficam no próprio aparelho (IndexedDB): atas, cadastro da escola e professores. Botão de backup/restauração (arquivo JSON) para passar do celular para o PC.
- Stack: Vite + React + TypeScript + Tailwind, responsivo e pensado primeiro para o celular.
- Por que sem servidor: custo zero, nada para manter e funciona em qualquer aparelho com navegador.

## 2. Transcrição (Gemini, de graça)
- O áudio vai pela Files API do Gemini, que aceita mp3, m4a, wav, ogg, webm e aac.
- Prompt: "transcreva em pt-BR com identificação de falantes e marcação de tempo", passando a lista de participantes e o glossário.
- Áudios longos (mais de 1 h): pedir a transcrição por faixas de tempo (00:00–20:00, 20:00–40:00...) para não estourar o limite de saída. O áudio é enviado uma vez e reaproveitado.
- Gravar no celular: a gravação pelo navegador para quando a tela apaga. Recomendado gravar com o gravador nativo do celular e enviar o arquivo depois. A gravação no app fica como opção, mantendo a tela ligada (Wake Lock).
- Alternativa se o Gemini falhar: Groq Whisper (plano gratuito), com a mesma interface trocável.

## 3. Geração da ata (Gemini)
- Modelo Gemini Flash (versão gratuita vigente). Conferir os limites do plano gratuito (requisições por minuto e por dia) no AI Studio.
- O fluxo não muda: a transcrição revisada e os dados do formulário viram um JSON estruturado (responseSchema do Gemini). O modelo redige o corpo em texto corrido. A abertura e o encerramento saem do template por código.
- Uma validação por código confere o formato (sem parágrafos, abertura/encerramento) e lista o que ficou [PENDENTE].
- Números e datas por extenso gerados por código, não pelo modelo (função própria em pt-BR).
- Prompt de sistema: o rascunho do agente #3 (não inventar, [PENDENTE], [trecho inaudível], anonimizar alunos).

## 4. Padrão da ata escolar (sem mudança)
- Bloco único de texto corrido, sem parágrafos, linhas em branco ou rasuras.
- Datas, horas e números por extenso. Pretérito perfeito, 3ª pessoa, impessoal.
- Abertura "Aos [dia] dias do mês de [mês] do ano de [ano], às [hora], ... reuniram-se ...".
- Encerramento "Nada mais havendo a tratar, ... lavrei a presente ata que, lida e aprovada, será assinada por mim e pelos demais presentes."
- Tipos de reunião: pedagógica, conselho de classe (quadro anexo), pais e mestres, Conselho Escolar/APM, HTPC/ATPC.

## 5. Impressão
- PDF gerado no próprio navegador (pdfmake) em A4, com botão para compartilhar ou imprimir. No celular, abre o menu de compartilhar (WhatsApp, Drive, impressora).
- DOCX gerado no navegador (biblioteca `docx`) para ajustes no Word.
- Layout:
  - cabeçalho com logo e "ATA Nº __/ANO – [TIPO]";
  - texto justificado em 12 pt;
  - traços preenchendo o resto da última linha;
  - linhas de assinatura com nome e cargo, sem espaço vazio antes;
  - lista de presença e quadro do conselho em páginas anexas;
  - "Folha X de Y" em todas as páginas;
  - opção de formato para colar no livro de atas.

## 6. Dados que a diretora informa
- Uma vez: escola, rede, município/UF, logo, professores e funcionários com cargo.
- Por reunião: tipo, nº da ata (sugere o próximo), data, horas, local, presidente, secretário, presentes (marcar na lista), pauta, anonimizar alunos.
- Na revisão: quem falou, trechos duvidosos, votações, prazos e responsáveis.

## 7. Telas (mobile-first)
1. Início: lista de atas e "Nova ata".
2. Nova ata: assistente em passos (tipo, dados, presentes, áudio).
3. Processando, com barra de progresso.
4. Revisar transcrição.
5. Revisar ata, com pendências destacadas.
6. Imprimir/compartilhar PDF ou DOCX.
7. Configurações: chave da API, escola, professores, backup.

## 8. Privacidade (risco aceito)
- No plano gratuito, o Google pode usar os dados enviados para melhorar os produtos, e o áudio inclui nomes. Mitigações:
  - aviso de gravação lido no início da reunião;
  - no conselho de classe, falar o número de chamada ou as iniciais dos alunos em vez do nome;
  - apagar o arquivo da Files API logo depois do uso (ele expira em 48 h de qualquer jeito);
  - nada guardado em servidor próprio.
- Se a escola puder pagar no futuro, ativar o faturamento muda a conta para o plano pago, em que os dados não são usados para treino. O código continua o mesmo.

## 9. Fases (1 dev)
- F1 MVP, cerca de 2 sem: PWA, configurações e chave, upload de áudio, transcrição e ata pelo Gemini (reunião pedagógica), PDF para imprimir.
- F2, cerca de 2 sem: os 5 tipos, cadastro de professores, quadro do conselho, DOCX, áudio longo por faixas, gravação no app.
- F3, cerca de 1 sem: backup/restauração, formato livro de atas, testes reais com a diretora no celular.
- Total: cerca de 5 semanas.

## Riscos
- Limites do plano gratuito mudam.
- Transcrição de áudio longo pelo Gemini.
- Qualidade do áudio em sala.
- Perda de dados se limpar o navegador (por isso o backup).
