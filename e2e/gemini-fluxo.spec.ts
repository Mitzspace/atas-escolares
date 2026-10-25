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
const audioCurto = '/home/william/audio-teste-ata/trecho-40s.wav'
const escola = 'Escola Municipal Professora Ana Lima'
const equipe: [string, string][] = [
  ['Joana Alves', 'Coordenadora Pedagógica'],
  ['Carlos Mendes', 'Professor de Matemática'],
  ['Clara Dias', 'Professora de Ciências'],
]

// O cenário do microfone fica em gemini-microfone.spec.ts para que os launchOptions
// de áudio falso se apliquem somente a ele; Playwright não permite escopá-los por describe.

type FalhaConferencia = { item: string; esperado: string; passou: false }

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

async function configurarEscola(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Atas de reunião' })).toBeVisible()
  await page.getByLabel('Navegação principal').getByRole('link', { name: 'Configurações' }).click()
  // A chave fica apenas no campo password e no IndexedDB isolado deste contexto.
  // Esta tela nunca é capturada e trace, vídeo e screenshots automáticos estão desligados.
  await page.getByLabel('Chave da API').fill(chaveGemini!)
  await page.getByLabel('Nome da escola').fill(escola)
  await page.getByLabel('Rede').fill('Secretaria Municipal de Educação')
  await page.getByLabel('Município/UF').fill('Campinas/SP')
  for (const [i, [nome, cargo]] of equipe.entries()) {
    await page.getByRole('button', { name: /Adicionar pessoa/ }).click()
    await page.getByLabel(`Nome da pessoa ${i + 1}`).fill(nome)
    await page.getByLabel(`Cargo da pessoa ${i + 1}`).fill(cargo)
  }
  const grupoPais = page.locator('details').filter({ hasText: 'Pais e responsáveis' })
  await grupoPais.locator('summary').click()
  await grupoPais.getByLabel('Novo assunto de Pais e responsáveis').fill('Entrega de avaliações às famílias')
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
  await expect(page.getByRole('heading', { name: 'Revisar a transcrição' })).toBeVisible({ timeout: 9 * 60_000 })
  await captura(page, cenario, 'revisao-transcricao')
  const falante = page.getByLabel(/^Nome de /).first()
  if (await falante.count()) {
    await falante.fill('Maria Souza')
    await falante.press('Tab')
  }
  await captura(page, cenario, 'transcricao-revisada')
  await page.getByRole('button', { name: 'Gerar a ata' }).click()
  await expect(page.getByRole('heading', { name: 'Redigindo a ata' })).toBeVisible()
  await captura(page, cenario, 'gerando-ata')
  await expect(page.locator('#texto-ata')).toBeVisible({ timeout: 9 * 60_000 })
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
  test.setTimeout(10 * 60_000)
  page.setDefaultTimeout(10 * 60_000)
  const cenario = 'pedagogica'
  const falhas: FalhaConferencia[] = []
  prepararSaida(cenario)
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
    const antes = await textoAta.inputValue()
    await textoAta.fill(antes.replace(/^Aos /, 'Aos  '))
    const checkClara = page.locator('label').filter({ hasText: 'Clara Dias' }).locator('input[type="checkbox"]')
    await expect(checkClara).toBeChecked()
    await checkClara.uncheck()
    await expect(page.getByRole('alert')).toContainText('texto')
    await expect(page.locator('#texto-ata')).toHaveValue(/Não compareceu a seguinte convocada/)
    await checkClara.check()
    await expect(checkClara).toBeChecked()
    const texto = await salvarTextoFinal(page, cenario)

    await conferencia(texto, cenario, falhas, 'reforço de Matemática', /refor[cç]o.{0,100}Matem[aá]tica/i)
    await conferencia(texto, cenario, falhas, 'reforço às quintas', /quinta-feira|[àa]s quintas/i)
    await conferencia(texto, cenario, falhas, 'responsável Carlos Mendes', /Carlos Mendes/i)
    await conferencia(texto, cenario, falhas, 'início em cinco de novembro', /cinco de novembro|5 de novembro/i)
    await conferencia(texto, cenario, falhas, 'aprovação por unanimidade', /unanimidade|unanimemente/i)
    await conferencia(texto, cenario, falhas, 'aluno anonimizado por iniciais', /P\.?\s*H\.?/i)
    await conferencia(texto, cenario, falhas, 'quinze faltas acima do registrado', /quinze faltas|mais quinze faltas|\+\s*15 faltas/i)
    await conferencia(texto, cenario, falhas, 'acompanhamento de Joana Alves', /Joana Alves/i)
    await conferencia(texto, cenario, falhas, 'Feira de Ciências', /Feira de Ci[eê]ncias/i)
    await conferencia(texto, cenario, falhas, 'Feira em vinte e oito de novembro', /vinte e oito de novembro|28 de novembro/i)
    await conferencia(texto, cenario, falhas, 'votação de onze a um', /onze votos? a um|11\s*(?:x|a)\s*1/i)
    await conferencia(texto, cenario, falhas, 'Carlos contrário à Feira', /Carlos Mendes.{0,100}contr[aá]rio|contr[aá]rio.{0,100}Carlos Mendes/i)
    await conferencia(texto, cenario, falhas, 'Clara envia regulamento na semana seguinte', /Clara Dias.{0,100}regulamento.{0,100}semana que vem|Clara Dias.{0,100}regulamento.{0,100}pr[oó]xima semana/i)
    await conferencia(texto, cenario, falhas, 'conselho de classe em doze de novembro', /conselho de classe.{0,100}doze de novembro|conselho de classe.{0,100}12 de novembro/i)
    await conferencia(texto, cenario, falhas, 'conselho de classe às oito horas', /conselho de classe.{0,100}oito horas|conselho de classe.{0,100}8 horas/i)
    await conferencia(texto, cenario, falhas, 'sem aula em dois de novembro', /sem aula.{0,80}dois de novembro|sem aula.{0,80}2 de novembro/i)
    await conferencia(texto, cenario, falhas, 'café não aparece', /caf[eé]/i, false)
    await conferencia(texto, cenario, falhas, 'sem responsável inventado para a secretaria avisar a família', /secretaria.{0,100}(avisar|avisar[aá]|comunicar).{0,100}fam[ií]lia/i, false)
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

test('4. pais e responsáveis: dois funcionários, duas famílias, chips e PDF', async ({ page }) => {
  test.setTimeout(10 * 60_000)
  page.setDefaultTimeout(10 * 60_000)
  const cenario = 'pais'
  const falhas: FalhaConferencia[] = []
  prepararSaida(cenario)
  try {
    await configurarEscola(page)
    await iniciarNovaAta(page, cenario, /Pais e responsáveis/)
    await preencherDadosComuns(page)
    await page.locator('#Presidiu-nome').fill('Maria Souza')
    await page.locator('#Presidiu-cargo').fill('Diretora')
    await page.locator('#Lavrou-nome').fill('Paulo Reis')
    await page.locator('#Lavrou-cargo').fill('Secretário')
    const clara = page.locator('label').filter({ hasText: 'Clara Dias' }).locator('input[type="checkbox"]')
    await clara.uncheck()
    await page.getByRole('button', { name: /Adicionar respons[aá]vel/ }).click()
    await page.getByRole('button', { name: /Adicionar respons[aá]vel/ }).click()
    const responsaveis = page.locator('.person-card')
    const ana = responsaveis.nth(0)
    await ana.getByLabel('Nome do responsável').fill('Ana Costa')
    await ana.getByLabel('Parentesco').selectOption({ label: 'Mãe' })
    await ana.getByLabel('Nome do aluno').fill('Pedro Henrique')
    await ana.getByLabel('Turma').fill('5º ano B')
    const rui = responsaveis.nth(1)
    await rui.getByLabel('Nome do responsável').fill('Rui Dias')
    await rui.getByLabel('Parentesco').selectOption({ label: 'Pai' })
    await rui.getByLabel('Nome do aluno').fill('Laura Dias')
    await rui.getByLabel('Turma').fill('3º ano A')
    const assunto1 = page.getByRole('button', { name: 'Calendário escolar e datas importantes' })
    const assunto2 = page.getByRole('button', { name: 'Dúvidas e sugestões das famílias' })
    const assuntoProprio = page.getByRole('button', { name: 'Entrega de avaliações às famílias' })
    await assunto1.click()
    await assunto2.click()
    await assuntoProprio.click()
    await selecionarAudio(page, audioCurto)
    await captura(page, cenario, 'dados')
    await processarTranscricao(page, cenario)
    await salvarPendenciasProblemas(page, cenario)
    await completarUmaPendencia(page)
    const texto = await salvarTextoFinal(page, cenario)
    const titulo = await page.getByRole('heading', { level: 1 }).first().innerText()
    await conferencia(titulo, cenario, falhas, 'título de reunião de pais e responsáveis', /REUNI[AÃ]O DE PAIS E RESPONS[AÁ]VEIS/i)
    await conferencia(texto, cenario, falhas, 'concordância e vínculo de Ana Costa', /a respons[aá]vel Ana Costa.{0,180}m[aã]e do aluno P\.?\s*H\.?/i)
    await conferencia(texto, cenario, falhas, 'concordância e vínculo de Rui Dias', /o respons[aá]vel Rui Dias.{0,180}pai da aluna L\.?\s*D\.?/i)
    await conferencia(texto, cenario, falhas, 'alunos identificados apenas por iniciais', /Pedro Henrique|Laura Dias/i, false)
    await conferencia(texto, cenario, falhas, 'assunto próprio incluído', /Entrega de avalia[cç][oõ]es [àa]s fam[ií]lias/i)
    await conferencia(texto, cenario, falhas, 'texto em bloco único', /\r|\n/, false)
    const assinaturas = await page.getByRole('heading', { name: 'Assinam' }).locator('xpath=..').innerText()
    await conferencia(assinaturas, cenario, falhas, 'assinatura de Ana inclui um vínculo', /Ana Costa[\s\S]*P\.?\s*H\.?/i)
    await conferencia(assinaturas, cenario, falhas, 'assinatura de Rui inclui um vínculo', /Rui Dias[\s\S]*L\.?\s*D\.?/i)
    salvarFalhas(cenario, falhas)
    const pdfText = await conferirEstruturaEFinalizar(page, cenario, texto, falhas)
    await conferirNoPdf(pdfText, cenario, falhas, 'PDF contém título de pais e responsáveis', /REUNI[AÃ]O DE PAIS E RESPONS[AÁ]VEIS/i)
    await conferirNoPdf(pdfText, cenario, falhas, 'PDF contém numeração de folha', /Folha\s+1\s+de/i)
    await conferirNoPdf(pdfText, cenario, falhas, 'PDF contém assinatura de Ana e vínculo', /Ana Costa.{0,100}P\.?\s*H\.?/is)
    await conferirNoPdf(pdfText, cenario, falhas, 'PDF contém assinatura de Rui e vínculo', /Rui Dias.{0,100}L\.?\s*D\.?/is)
    const linhaAna = pdfText.slice(pdfText.indexOf('Ana Costa'), pdfText.indexOf('Rui Dias') > -1 ? pdfText.indexOf('Rui Dias') : undefined)
    const linhaRui = pdfText.slice(pdfText.indexOf('Rui Dias'))
    await conferencia(linhaAna, cenario, falhas, 'vínculo de Ana não aparece duplicado na assinatura', /P\.?\s*H\.?[\s\S]*P\.?\s*H\.?/i, false)
    await conferencia(linhaRui, cenario, falhas, 'vínculo de Rui não aparece duplicado na assinatura', /L\.?\s*D\.?[\s\S]*L\.?\s*D\.?/i, false)
  } finally {
    salvarFalhas(cenario, falhas)
  }
})
