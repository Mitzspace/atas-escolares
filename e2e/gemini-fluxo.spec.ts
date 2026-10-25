import { expect, test, type Page } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const chaveGemini = process.env.GEMINI_API_KEY
test.skip(!chaveGemini, 'Defina GEMINI_API_KEY no ambiente para executar os fluxos com Gemini.')
test.describe.configure({ mode: 'serial' })
test.use({
  viewport: { width: 390, height: 844 },
  trace: 'off',
  video: 'off',
  screenshot: 'off',
})

const saida = path.resolve('e2e/saida')
const audioPedagogico = '/home/william/audio-teste-ata/reuniao-pedagogica-teste.mp3'
const escola = 'Escola Municipal Professora Ana Lima'
const equipe: [string, string][] = [
  ['Joana Alves', 'Coordenadora Pedagógica'],
  ['Carlos Mendes', 'Professor de Matemática'],
  ['Clara Dias', 'Professora de Ciências'],
]
const equipePais: [string, string][] = [
  ['Joana Alves', 'Coordenadora Pedagógica'],
  ['Clara Dias', 'Professora de Ciências'],
]

// O cenário do microfone fica em gemini-microfone.spec.ts para que os launchOptions
// de áudio falso se apliquem somente a ele; Playwright não permite escopá-los por describe.

type FalhaConferencia = { item: string; esperado: string; passou: false }

function semCredenciais(valor: string) {
  return valor
    .replaceAll(chaveGemini ?? '\0', '[CHAVE_REMOVIDA]')
    .replace(/AIza[\w-]{20,}/g, '[CHAVE_REMOVIDA]')
    .replace(/([?&]key=)[^&\s]+/gi, '$1[CHAVE_REMOVIDA]')
}

function registrarLogs(page: Page, cenario: string) {
  const arquivo = path.join(saida, `logs-${cenario}.txt`)
  fs.writeFileSync(arquivo, '')
  const salvar = (linha: string) => fs.appendFileSync(arquivo, `${new Date().toISOString()} ${semCredenciais(linha)}\n`)
  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warning') salvar(`console:${msg.type()} ${msg.text()}`)
  })
  page.on('pageerror', error => salvar(`pageerror ${error.message}`))
  page.on('requestfailed', request => {
    const url = new URL(request.url())
    salvar(`requestfailed ${request.method()} ${url.origin}${url.pathname} ${request.failure()?.errorText ?? ''}`)
  })
  page.on('response', response => {
    if (response.status() === 429 || response.status() >= 500) {
      const url = new URL(response.url())
      salvar(`response ${response.status()} ${url.origin}${url.pathname}`)
    }
  })
}

async function esperarResultadoProcessamento(page: Page, sucesso: ReturnType<Page['locator']>, etapa: string, cenario: string) {
  const inicio = Date.now()
  let ultimoLog = inicio
  const arquivo = path.join(saida, `logs-${cenario}.txt`)
  while (Date.now() - inicio < 14 * 60_000) {
    if (await sucesso.isVisible().catch(() => false)) return
    const alerta = page.getByRole('alert')
    if (await alerta.isVisible().catch(() => false)) {
      throw new Error(`${etapa} terminou com erro na tela: ${semCredenciais(await alerta.innerText())}`)
    }
    if (Date.now() - ultimoLog >= 30_000) {
      const progresso = await page.getByRole('progressbar').getAttribute('aria-valuenow').catch(() => 'indisponível')
      const status = (await page.locator('main').innerText().catch(() => 'tela principal indisponível')).replace(/\s+/g, ' ').slice(0, 240)
      fs.appendFileSync(arquivo, `${new Date().toISOString()} etapa:${etapa} ainda processando; progresso=${progresso}; tela=${semCredenciais(status)}\n`)
      ultimoLog = Date.now()
    }
    await page.waitForTimeout(1000)
  }
  const status = (await page.locator('main').innerText().catch(() => 'tela principal indisponível')).replace(/\s+/g, ' ').slice(0, 240)
  throw new Error(`${etapa} não chegou à tela de sucesso nem exibiu erro após 14 minutos. Tela final: ${semCredenciais(status)}`)
}

function prepararSaida(cenario: string) {
  fs.mkdirSync(saida, { recursive: true })
  fs.writeFileSync(path.join(saida, `conferencias-${cenario}.json`), '[]\n')
}

function atualizarFalhas(cenario: string, falhas: FalhaConferencia[]) {
  fs.writeFileSync(path.join(saida, `conferencias-${cenario}.json`), `${JSON.stringify(falhas, null, 2)}\n`)
}

async function captura(page: Page, cenario: string, etapa: string) {
  await page.screenshot({ path: path.join(saida, `tela-${cenario}-${etapa}.png`) })
}

async function configurarEscola(
  page: Page,
  pessoas: [string, string][] = equipe,
  assuntoPersonalizado = 'Entrega de avaliações às famílias',
  modelo?: string,
) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Atas de reunião' })).toBeVisible()
  await page.getByLabel('Navegação principal').getByRole('link', { name: 'Configurações' }).click()
  // A chave fica apenas no campo password e no IndexedDB isolado deste contexto.
  // Esta tela nunca é capturada e trace, vídeo e screenshots automáticos estão desligados.
  await page.getByLabel('Chave da API').fill(chaveGemini!)
  if (modelo) await page.getByLabel('Modelo para redigir a ata').selectOption(modelo)
  await page.getByLabel('Nome da escola').fill(escola)
  await page.getByLabel('Rede').fill('Secretaria Municipal de Educação')
  await page.getByLabel('Município/UF').fill('Campinas/SP')
  for (const [i, [nome, cargo]] of pessoas.entries()) {
    await page.getByRole('button', { name: /Adicionar pessoa/ }).click()
    await page.getByLabel(`Nome da pessoa ${i + 1}`).fill(nome)
    await page.getByLabel(`Cargo da pessoa ${i + 1}`).fill(cargo)
  }
  const grupoPais = page.locator('details').filter({ hasText: 'Pais e responsáveis' })
  await grupoPais.locator('summary').click()
  await grupoPais.getByLabel('Novo assunto de Pais e responsáveis').fill(assuntoPersonalizado)
  await grupoPais.getByRole('button', { name: 'Adicionar' }).click()
  await page.getByRole('button', { name: 'Salvar' }).click()
  await expect(page.getByRole('status')).toContainText('Configurações salvas')
  await page.getByLabel('Navegação principal').getByRole('link', { name: 'Início' }).click()
}

async function iniciarNovaAta(page: Page, cenario: string, tipo: RegExp) {
  await page.getByRole('button', { name: /Nova ata/ }).click()
  await expect(page.getByRole('heading', { name: 'Que tipo de ata?' })).toBeVisible()
  await captura(page, cenario, 'tipo')
  await page.getByRole('button', { name: tipo }).click()
  await expect(page.getByRole('heading', { name: /^Nova ata/ })).toBeVisible()
}

async function preencherDadosComuns(page: Page, inicio = '14:00', fim = '15:10') {
  await page.locator('#data').fill('2026-10-20')
  await page.locator('#horaInicio').fill(inicio)
  if (fim) await page.locator('#horaFim').fill(fim)
  await page.locator('#local').fill('sala dos professores')
}

async function selecionarAudio(page: Page, arquivo: string) {
  await page.getByRole('button', { name: 'Enviar arquivo' }).click()
  await page.getByLabel('Arquivo de áudio da reunião').setInputFiles(arquivo)
}

async function processarTranscricao(page: Page, cenario: string) {
  await page.getByRole('button', { name: 'Transcrever o áudio' }).click()
  await expect(page.getByRole('heading', { name: 'Transcrevendo o áudio' })).toBeVisible()
  await captura(page, cenario, 'transcrevendo')
  await esperarResultadoProcessamento(page, page.getByRole('heading', { name: 'Revisar a transcrição' }), 'transcrição', cenario)
  await captura(page, cenario, 'revisao-transcricao')
  const falasTranscritas = await page.locator('textarea').evaluateAll(elementos =>
    elementos.map(elemento => (elemento as HTMLTextAreaElement).value),
  )
  fs.writeFileSync(path.join(saida, `transcricao-${cenario}.txt`), `${falasTranscritas.join('\n')}\n`)
  const falante = page.getByLabel(/^Nome de /).first()
  if (await falante.count()) {
    await falante.fill('Maria Souza')
    await falante.press('Tab')
  }
  await captura(page, cenario, 'transcricao-revisada')
  await page.getByRole('button', { name: 'Gerar a ata' }).click()
  await expect(page.getByRole('heading', { name: 'Redigindo a ata' })).toBeVisible()
  await captura(page, cenario, 'gerando-ata')
  await esperarResultadoProcessamento(page, page.locator('#texto-ata'), 'geração da ata', cenario)
}

async function salvarPendenciasProblemas(page: Page, cenario: string) {
  const pendencias = await page.locator('section[aria-label="Completar pendências"] .card').allInnerTexts()
  const conferir = page.getByRole('heading', { name: 'Para conferir' })
  const problemas = page.getByRole('heading', { name: 'Problemas de formato' })
  const textoConferir = await conferir.count() ? await conferir.locator('xpath=..').innerText() : ''
  const textoProblemas = await problemas.count() ? await problemas.locator('xpath=..').innerText() : ''
  fs.writeFileSync(path.join(saida, `pendencias-problemas-${cenario}.json`), `${JSON.stringify({ pendencias, paraConferir: textoConferir, problemasFormato: textoProblemas }, null, 2)}\n`)
}

async function completarUmaPendencia(page: Page) {
  const primeira = page.locator('section[aria-label="Completar pendências"] .card').first()
  if (!(await primeira.count())) return
  const campo = primeira.locator('input').first()
  if (await campo.getAttribute('type') === 'time') await campo.fill('15:10')
  else await campo.fill('Confirmado em revisão pela equipe')
  await primeira.getByRole('button', { name: 'Preencher' }).click()
}

async function salvarTextoFinal(page: Page, cenario: string) {
  const texto = await page.locator('#texto-ata').inputValue()
  fs.writeFileSync(path.join(saida, `ata-${cenario}.txt`), `${texto}\n`)
  return texto
}

async function conferencia(
  texto: string,
  cenario: string,
  falhas: FalhaConferencia[],
  item: string,
  padrao: RegExp,
  deveEncontrar = true,
) {
  const encontrado = padrao.test(texto)
  const passou = encontrado === deveEncontrar
  if (!passou) falhas.push({ item, esperado: `${deveEncontrar ? 'conter' : 'não conter'} ${padrao}`, passou: false })
  atualizarFalhas(cenario, falhas)
  if (deveEncontrar) expect.soft(texto, item).toMatch(padrao)
  else expect.soft(texto, item).not.toMatch(padrao)
}

async function conferirEstruturaEFinalizar(page: Page, cenario: string, texto: string, falhas: FalhaConferencia[]) {
  await conferencia(texto, cenario, falhas, 'texto em bloco único', /\r|\n/, false)
  await salvarTextoFinal(page, cenario)
  await salvarPendenciasProblemas(page, cenario)
  await captura(page, cenario, 'revisao-ata')
  await page.getByRole('button', { name: 'Imprimir / PDF' }).click()
  await expect(page.getByRole('heading', { name: 'Imprimir' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Baixar PDF' })).toBeVisible({ timeout: 60_000 })
  await captura(page, cenario, 'imprimir')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Baixar PDF' }).click()
  const download = await downloadPromise
  const pdfPath = path.join(saida, `ata-${cenario}.pdf`)
  await download.saveAs(pdfPath)
  const pdfText = await extrairTextoPdf(pdfPath)
  fs.writeFileSync(path.join(saida, `ata-${cenario}.pdf.txt`), `${pdfText}\n`)
  return pdfText
}

async function extrairTextoPdf(pdfPath: string): Promise<string> {
  const pdftotext = spawnSync('pdftotext', [pdfPath, '-'], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
  if (!pdftotext.error) {
    if (pdftotext.status !== 0) throw new Error('pdftotext não conseguiu extrair texto do PDF baixado.')
    return pdftotext.stdout
  }
  if ((pdftotext.error as NodeJS.ErrnoException).code !== 'ENOENT') throw pdftotext.error

  const pdfjsPath = path.resolve('node_modules/pdfjs-dist/legacy/build/pdf.mjs')
  if (!fs.existsSync(pdfjsPath)) throw new Error('Instale pdftotext ou disponibilize pdfjs-dist em node_modules para extrair o PDF.')
  const importar = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<{
    getDocument: (args: { data: Uint8Array; disableWorker?: boolean }) => {
      promise: Promise<{ numPages: number; getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: { str?: string }[] }> }> }>
    }
  }>
  const pdfjs = await importar(pathToFileURL(pdfjsPath).href)
  const documento = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(pdfPath)), disableWorker: true }).promise
  const paginas: string[] = []
  for (let n = 1; n <= documento.numPages; n++) {
    const pagina = await documento.getPage(n)
    const conteudo = await pagina.getTextContent()
    paginas.push(conteudo.items.map(item => item.str ?? '').join(' '))
  }
  return paginas.join('\n')
}

async function conferirNoPdf(texto: string, cenario: string, falhas: FalhaConferencia[], item: string, padrao: RegExp) {
  await conferencia(texto, cenario, falhas, item, padrao)
}

function salvarFalhas(cenario: string, falhas: FalhaConferencia[]) {
  atualizarFalhas(cenario, falhas)
}

test('2. reunião pedagógica: upload, revisão, ata e PDF', async ({ page }) => {
  test.setTimeout(15 * 60_000)
  page.setDefaultTimeout(15 * 60_000)
  const cenario = 'pedagogica'
  const falhas: FalhaConferencia[] = []
  prepararSaida(cenario)
  registrarLogs(page, cenario)
  try {
    await configurarEscola(page)
    await iniciarNovaAta(page, cenario, /Reunião pedagógica/)
    await preencherDadosComuns(page)
    await page.locator('#Presidiu-nome').fill('Maria Souza')
    await page.locator('#Presidiu-cargo').fill('Diretora')
    await page.locator('#Lavrou-nome').fill('Paulo Reis')
    await page.locator('#Lavrou-cargo').fill('Secretário')
    const itens = ['Resultados da avaliação do 3º bimestre', 'Feira de Ciências', 'Informes gerais']
    for (const [i, pauta] of itens.entries()) {
      if (i > 0) await page.getByRole('button', { name: /Adicionar item/ }).click()
      await page.getByLabel(`Item ${i + 1} da pauta`).fill(pauta)
    }
    await selecionarAudio(page, audioPedagogico)
    await captura(page, cenario, 'dados')
    await processarTranscricao(page, cenario)
    await salvarPendenciasProblemas(page, cenario)
    await completarUmaPendencia(page)

    const textoAta = page.locator('#texto-ata')
    const checkClara = page.locator('label').filter({ hasText: 'Clara Dias' }).locator('input[type="checkbox"]')
    await expect(checkClara).toBeChecked()
    await checkClara.uncheck()
    await expect(checkClara).not.toBeChecked()
    await expect(page.locator('#texto-ata')).toHaveValue(/Não compareceu a seguinte convocada/)
    await checkClara.check()
    await expect(checkClara).toBeChecked()
    await expect(page.locator('#texto-ata')).not.toHaveValue(/Não compareceu a seguinte convocada/)
    const texto = await salvarTextoFinal(page, cenario)

    await conferencia(texto, cenario, falhas, 'reforço de Matemática', /refor[cç]o.{0,100}Matem[aá]tica/i)
    await conferencia(texto, cenario, falhas, 'reforço às quintas', /quinta-feira|[àa]s quintas/i)
    await conferencia(texto, cenario, falhas, 'responsável Carlos Mendes', /Carlos Mendes/i)
    await conferencia(texto, cenario, falhas, 'início em cinco de novembro', /cinco de novembro|5 de novembro/i)
    await conferencia(texto, cenario, falhas, 'aprovação por unanimidade', /unanimidade|unanimemente|acolhido por todos/i)
    await conferencia(texto, cenario, falhas, 'aluno anonimizado por iniciais', /P\.?\s*H\.?/i)
    await conferencia(texto, cenario, falhas, 'quinze faltas acima do registrado', /quinze faltas|mais quinze faltas|\+\s*15 faltas/i)
    await conferencia(texto, cenario, falhas, 'acompanhamento de Joana Alves', /Joana Alves/i)
    await conferencia(texto, cenario, falhas, 'Feira de Ciências', /Feira de Ci[eê]ncias/i)
    await conferencia(texto, cenario, falhas, 'Feira em vinte e oito de novembro', /vinte e oito de novembro|28 de novembro/i)
    await conferencia(texto, cenario, falhas, 'votação de onze a um', /onze votos? a um|onze votos? a favor e um voto contr[aá]rio|onze votos? favor[aá]veis e um voto contr[aá]rio|11\s*(?:x|a)\s*1/i)
    await conferencia(texto, cenario, falhas, 'Carlos contrário à Feira', /Carlos Mendes.{0,120}(?:ponderou|manifestou).{0,120}(?:diverg[eê]ncia|s[aá]bado.{0,80}(?:comprometeria|prejudicaria)|(?:comprometeria|prejudicaria).{0,80}(?:s[aá]bado|fim de semana)).{0,120}(?:s[aá]bado|feira|evento)|contr[aá]rio.{0,100}Carlos Mendes/i)
    await conferencia(texto, cenario, falhas, 'Clara envia regulamento na semana seguinte', /a cargo d[eo] Clara Dias.{0,80}prazo: (?:at[eé] )?(?:a )?(?:semana seguinte|pr[oó]xima semana|semana que vem)|Clara Dias.{0,100}regulamento.{0,100}(?:semana seguinte|pr[oó]xima semana|semana que vem)/i)
    await conferencia(texto, cenario, falhas, 'conselho de classe em doze de novembro', /conselho de classe.{0,100}doze de novembro|conselho de classe.{0,100}12 de novembro/i)
    await conferencia(texto, cenario, falhas, 'conselho de classe às oito horas', /conselho de classe.{0,100}oito horas|conselho de classe.{0,100}8 horas/i)
    await conferencia(texto, cenario, falhas, 'sem aula em dois de novembro', /(?:sem aula|suspens[aã]o das aulas).{0,100}(?:(?:no )?dia |em )?(?:dois de novembro|2 de novembro)|(?:dois de novembro|2 de novembro).{0,100}(?:n[aã]o haver[aá] aula|suspens[aã]o das aulas)/i)
    await conferencia(texto, cenario, falhas, 'café não aparece', /caf[eé]/i, false)
    const encaminhamentoContato = texto.match(/(?:primeiro|segundo|terceiro|quarto),[^;]*(?:secretaria|fam[ií]lia|respons[aá]veis)[^;]*;/i)?.[0] ?? ''
    await conferencia(encaminhamentoContato, cenario, falhas, 'secretaria escolar responsável pelo contato com a família conforme áudio', /(?:contato|entrar em contato).{0,140}(?:fam[ií]lia|respons[aá]veis).{0,120}a cargo d[ae] secretaria(?: escolar)?/i)
    await conferencia(encaminhamentoContato, cenario, falhas, 'contato com a família não atribuído individualmente', /(?:a cargo d[eo]|respons[aá]vel(?: por| pela tarefa)?\s*[:,-]?)\s*(?:Maria Souza|Joana Alves|Paulo Reis|Carlos Mendes|Clara Dias)/i, false)
    await conferencia(texto, cenario, falhas, 'números e datas sem algarismos no texto corrido', /\d/,
      false)
    salvarFalhas(cenario, falhas)
    const pdfText = await conferirEstruturaEFinalizar(page, cenario, texto, falhas)
    await conferirNoPdf(pdfText, cenario, falhas, 'PDF contém título da ata', /ATA Nº 00\d\/2026.{0,80}REUNIÃO PEDAGÓGICA/i)
    await conferirNoPdf(pdfText, cenario, falhas, 'PDF contém numeração de folha', /Folha\s+1\s+de/i)
    await conferirNoPdf(pdfText, cenario, falhas, 'PDF contém assinaturas dos responsáveis pela ata', /Maria Souza.{0,100}Diretora.{0,200}Paulo Reis.{0,100}Secret[aá]rio/is)
  } finally {
    salvarFalhas(cenario, falhas)
  }
})

test('4. pais e responsáveis: equipe, três famílias, assuntos e PDF', async ({ page }) => {
  test.setTimeout(15 * 60_000)
  page.setDefaultTimeout(15 * 60_000)
  const cenario = 'pais'
  const falhas: FalhaConferencia[] = []
  prepararSaida(cenario)
  registrarLogs(page, cenario)
  try {
    await configurarEscola(page, equipePais, 'Feira de Ciências e voluntariado', 'gemini-3.5-flash-lite')
    await iniciarNovaAta(page, cenario, /Pais e responsáveis/)
    await preencherDadosComuns(page, '19:00', '19:50')
    await page.locator('#Presidiu-nome').fill('Maria Souza')
    await page.locator('#Presidiu-cargo').fill('Diretora')
    await page.locator('#Lavrou-nome').fill('Joana Alves')
    await page.locator('#Lavrou-cargo').fill('Coordenadora Pedagógica')
    const nomeClara = page.getByRole('textbox', { name: 'Nome', exact: true }).nth(1)
    await expect(nomeClara).toHaveValue('Clara Dias')
    const clara = page.getByRole('checkbox', { name: 'Presente', exact: true }).nth(1)
    await expect(clara).toBeChecked()
    await page.getByRole('button', { name: /Adicionar respons[aá]vel/ }).click()
    await page.getByRole('button', { name: /Adicionar respons[aá]vel/ }).click()
    await page.getByRole('button', { name: /Adicionar respons[aá]vel/ }).click()
    const responsaveis = page.locator('.person-card')
    const ana = responsaveis.nth(0)
    await ana.getByLabel('Nome do responsável').fill('Ana Costa')
    await ana.getByLabel('Parentesco').selectOption({ label: 'Mãe' })
    await ana.getByLabel('Nome do aluno').fill('Pedro Henrique')
    await ana.getByLabel('Tratamento do aluno').selectOption({ label: 'Aluno' })
    await ana.getByLabel('Turma').fill('5º ano B')
    const rui = responsaveis.nth(1)
    await rui.getByLabel('Nome do responsável').fill('Rui Dias')
    await rui.getByLabel('Parentesco').selectOption({ label: 'Pai' })
    await rui.getByLabel('Nome do aluno').fill('Laura Dias')
    await rui.getByLabel('Tratamento do aluno').selectOption({ label: 'Aluna' })
    await rui.getByLabel('Turma').fill('5º ano B')
    const beatriz = responsaveis.nth(2)
    await beatriz.getByLabel('Nome do responsável').fill('Beatriz Lima')
    await beatriz.getByLabel('Parentesco').selectOption({ label: 'Mãe' })
    await beatriz.getByLabel('Nome do aluno').fill('Lucas Lima')
    await beatriz.getByLabel('Tratamento do aluno').selectOption({ label: 'Aluno' })
    await beatriz.getByLabel('Turma').fill('5º ano B')
    const assunto1 = page.getByRole('button', { name: 'Calendário escolar e datas importantes' })
    const assunto2 = page.getByRole('button', { name: 'Frequência, faltas e atrasos' })
    const assuntoProprio = page.getByRole('button', { name: 'Feira de Ciências e voluntariado' })
    await assunto1.click()
    await assunto2.click()
    await assuntoProprio.click()
    await selecionarAudio(page, '/home/william/audio-teste-ata/reuniao-pais-teste.mp3')
    await captura(page, cenario, 'dados')
    await processarTranscricao(page, cenario)
    await salvarPendenciasProblemas(page, cenario)
    const texto = await salvarTextoFinal(page, cenario)
    const titulo = await page.getByRole('heading', { level: 1 }).first().innerText()
    await conferencia(titulo, cenario, falhas, 'título de reunião de pais e responsáveis', /REUNI[AÃ]O DE PAIS E RESPONS[AÁ]VEIS/i)
    await conferencia(texto, cenario, falhas, 'Ana é mãe de P.H. do 5º ano B', /Ana Costa.{0,120}m[aã]e do aluno P\.?\s*H\.?[, ]+do quinto ano B/i)
    await conferencia(texto, cenario, falhas, 'Rui é pai da aluna L.D. do 5º ano B', /Rui Dias.{0,120}pai da aluna L\.?\s*D\.?[, ]+do quinto ano B/i)
    await conferencia(texto, cenario, falhas, 'Beatriz é mãe de L.L. do 5º ano B', /Beatriz Lima.{0,120}m[aã]e do aluno L\.?\s*L\.?[, ]+do quinto ano B/i)
    await conferencia(texto, cenario, falhas, 'alunos identificados apenas por iniciais', /Pedro Henrique|Laura Dias|Lucas Lima/i, false)
    await conferencia(texto, cenario, falhas, 'chips de calendário e frequência incluídos', /Calend[aá]rio.{0,120}(?:frequ[eê]ncia|atrasos)|(?:frequ[eê]ncia|atrasos).{0,120}calend[aá]rio/i)
    await conferencia(texto, cenario, falhas, 'assunto próprio da Feira de Ciências incluído', /Feira de Ci[eê]ncias e voluntariado/i)
    await conferencia(texto, cenario, falhas, 'provas de 1 a 5 de dezembro', /(?:primeiro|1)[º°]? a cinco de dezembro|(?:primeiro|1)[º°]? a 5 de dezembro/i)
    await conferencia(texto, cenario, falhas, 'recuperação de 8 a 12 de dezembro', /oito a doze de dezembro|8 a 12 de dezembro/i)
    await conferencia(texto, cenario, falhas, 'ano letivo termina em 19 de dezembro', /dezenove de dezembro|19 de dezembro/i)
    await conferencia(texto, cenario, falhas, 'portão fecha às 7h10', /sete e dez|sete horas e dez|7h10/i)
    await conferencia(texto, cenario, falhas, 'tolerância de 10 minutos mantida', /toler[aâ]ncia.{0,80}dez minutos.{0,100}(?:manter|mantida)|toler[aâ]ncia.{0,80}10 minutos.{0,100}(?:manter|mantida)/i)
    await conferencia(texto, cenario, falhas, 'Feira de Ciências em 28 de novembro', /Feira de Ci[eê]ncias.{0,100}vinte e oito de novembro|Feira de Ci[eê]ncias.{0,100}28 de novembro/i)
    await conferencia(texto, cenario, falhas, 'Ana Costa se voluntaria', /Ana Costa.{0,120}(?:tamb[eé]m se voluntariou|volunt[aá]ria)/i)
    await conferencia(texto, cenario, falhas, 'Beatriz Lima oferece ajuda voluntária', /Beatriz Lima.{0,120}(?:ofereceu ajuda|ofereceu aux[ií]lio|volunt[aá]ria)/i)
    await conferencia(texto, cenario, falhas, 'consenso para reunião preparatória em 10 de novembro', /consenso.{0,220}(?:reuni[aã]o preparat[oó]ria|preparar a feira).{0,160}(?:dez|10) de novembro/i)
    await conferencia(texto, cenario, falhas, 'Clara participa da reunião preparatória em 10 de novembro', /respons[aá]veis volunt[aá]rias reunir(?:am-se|ão) com a professora de Ci[eê]ncias Clara Dias.{0,100}prazo: dez de novembro/i)
    await conferencia(texto, cenario, falhas, 'pergunta de estacionamento mencionada', /estacionamento/i)
    await conferencia(texto, cenario, falhas, 'encerramento às 19h50', /dezenove horas e cinquenta minutos|19h50/i)
    await conferencia(texto, cenario, falhas, 'não inventa exposição de resultados pedagógicos', /Joana Alves.{0,150}(?:apresentou|exp[oõ]s|relatou).{0,120}(?:resultados|desempenho|notas)/i, false)
    await conferencia(texto, cenario, falhas, 'pergunta de estacionamento não vira decisão inventada', /estacionamento.{0,120}(?:decidiu-se|fica decidido|foi aprovado|ser[aá] implantado)/i, false)
    await conferencia(texto, cenario, falhas, 'não atribui consenso à regra do portão', /toler[aâ]ncia.{0,120}(?:por consenso|consensualmente)/i, false)
    await conferencia(texto, cenario, falhas, 'texto em bloco único', /\r|\n/, false)
    const assinaturas = await page.getByRole('heading', { name: 'Assinam' }).locator('xpath=..').innerText()
    await conferencia(assinaturas, cenario, falhas, 'assinatura de Ana inclui um vínculo', /Ana Costa[\s\S]*P\.?\s*H\.?/i)
    await conferencia(assinaturas, cenario, falhas, 'assinatura de Rui inclui vínculo feminino', /Rui Dias[\s\S]*aluna L\.?\s*D\.?/i)
    await conferencia(assinaturas, cenario, falhas, 'assinatura de Beatriz inclui um vínculo', /Beatriz Lima[\s\S]*L\.?\s*L\.?/i)
    salvarFalhas(cenario, falhas)
    const pdfText = await conferirEstruturaEFinalizar(page, cenario, texto, falhas)
    await conferirNoPdf(pdfText, cenario, falhas, 'PDF contém título de pais e responsáveis', /REUNI[AÃ]O DE PAIS E RESPONS[AÁ]VEIS/i)
    await conferirNoPdf(pdfText, cenario, falhas, 'PDF contém numeração de folha', /Folha\s+1\s+de/i)
    const inicioAnaPdf = pdfText.lastIndexOf('Ana Costa')
    const inicioRuiPdf = pdfText.lastIndexOf('Rui Dias')
    const inicioBeatrizPdf = pdfText.lastIndexOf('Beatriz Lima')
    const linhaAna = pdfText.slice(inicioAnaPdf, inicioRuiPdf)
    const linhaRui = pdfText.slice(inicioRuiPdf, inicioBeatrizPdf)
    const linhaBeatriz = pdfText.slice(inicioBeatrizPdf)
    await conferencia(linhaAna, cenario, falhas, 'PDF contém assinatura de Ana e vínculo', /Ana Costa.{0,100}P\.?\s*H\.?/is)
    await conferencia(linhaRui, cenario, falhas, 'PDF contém assinatura de Rui e vínculo feminino', /Rui Dias.{0,100}aluna L\.?\s*D\.?/is)
    await conferencia(linhaBeatriz, cenario, falhas, 'PDF contém assinatura de Beatriz e vínculo', /Beatriz Lima.{0,100}L\.?\s*L\.?/is)
    await conferencia(linhaAna, cenario, falhas, 'vínculo de Ana não aparece duplicado na assinatura', /P\.?\s*H\.?[\s\S]*P\.?\s*H\.?/i, false)
    await conferencia(linhaRui, cenario, falhas, 'vínculo de Rui não aparece duplicado na assinatura', /L\.?\s*D\.?[\s\S]*L\.?\s*D\.?/i, false)
    await conferencia(linhaBeatriz, cenario, falhas, 'vínculo de Beatriz não aparece duplicado na assinatura', /L\.?\s*L\.?[\s\S]*L\.?\s*L\.?/i, false)
  } finally {
    salvarFalhas(cenario, falhas)
  }
})
