import { expect, test, type Page } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const chaveGemini = process.env.GEMINI_API_KEY
test.skip(!chaveGemini, 'Defina GEMINI_API_KEY no ambiente para executar os fluxos com Gemini.')
test.use({
  viewport: { width: 390, height: 844 },
  trace: 'off',
  video: 'off',
  screenshot: 'off',
  launchOptions: {
    args: [
      '--no-sandbox',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--use-file-for-fake-audio-capture=/home/william/audio-teste-ata/trecho-40s.wav',
    ],
  },
})

const saida = path.resolve('e2e/saida')
const equipe: [string, string][] = [
  ['Joana Alves', 'Coordenadora Pedagógica'],
  ['Carlos Mendes', 'Professor de Matemática'],
  ['Clara Dias', 'Professora de Ciências'],
]
type Falha = { item: string; esperado: string; passou: false }

function semCredenciais(valor: string) {
  return valor
    .replaceAll(chaveGemini ?? '\0', '[CHAVE_REMOVIDA]')
    .replace(/AIza[\w-]{20,}/g, '[CHAVE_REMOVIDA]')
    .replace(/([?&]key=)[^&\s]+/gi, '$1[CHAVE_REMOVIDA]')
}

function registrarLogs(page: Page) {
  const arquivo = path.join(saida, 'logs-orientacao.txt')
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

async function esperarResultado(page: Page, seletorSucesso: string, etapa: string) {
  const arquivo = path.join(saida, 'logs-orientacao.txt')
  const inicio = Date.now()
  let ultimoLog = inicio
  const sucesso = page.locator(seletorSucesso)
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

function preparar(falhas: Falha[]) {
  fs.mkdirSync(saida, { recursive: true })
  fs.writeFileSync(path.join(saida, 'conferencias-orientacao.json'), `${JSON.stringify(falhas, null, 2)}\n`)
}

function salvarFalhas(falhas: Falha[]) {
  fs.writeFileSync(path.join(saida, 'conferencias-orientacao.json'), `${JSON.stringify(falhas, null, 2)}\n`)
}

async function captura(page: Page, etapa: string) {
  await page.screenshot({ path: path.join(saida, `tela-orientacao-${etapa}.png`) })
}

async function conferir(texto: string, falhas: Falha[], item: string, regex: RegExp, presente = true) {
  const passou = regex.test(texto) === presente
  if (!passou) falhas.push({ item, esperado: `${presente ? 'conter' : 'não conter'} ${regex}`, passou: false })
  salvarFalhas(falhas)
  if (presente) expect.soft(texto, item).toMatch(regex)
  else expect.soft(texto, item).not.toMatch(regex)
}

function conferirCondicao(condicao: boolean, falhas: Falha[], item: string, esperado: string) {
  if (!condicao) falhas.push({ item, esperado, passou: false })
  salvarFalhas(falhas)
  expect.soft(condicao, item).toBe(true)
}

async function extrairPdf(pdfPath: string) {
  const resultado = spawnSync('pdftotext', [pdfPath, '-'], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
  if (!resultado.error) {
    if (resultado.status !== 0) throw new Error('pdftotext não conseguiu extrair texto do PDF baixado.')
    return resultado.stdout
  }
  if ((resultado.error as NodeJS.ErrnoException).code !== 'ENOENT') throw resultado.error
  const caminho = path.resolve('node_modules/pdfjs-dist/legacy/build/pdf.mjs')
  if (!fs.existsSync(caminho)) throw new Error('Instale pdftotext ou disponibilize pdfjs-dist para extrair o texto do PDF.')
  const importar = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<{
    getDocument: (args: { data: Uint8Array; disableWorker?: boolean }) => { promise: Promise<{
      numPages: number
      getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: { str?: string }[] }> }>
    }> }
  }>
  const pdfjs = await importar(pathToFileURL(caminho).href)
  const documento = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(pdfPath)), disableWorker: true }).promise
  const paginas: string[] = []
  for (let n = 1; n <= documento.numPages; n++) {
    paginas.push((await (await documento.getPage(n)).getTextContent()).items.map(x => x.str ?? '').join(' '))
  }
  return paginas.join('\n')
}

test('3. grava, pausa, retoma, orienta aluno e funcionário e oferece recuperação', async ({ page }) => {
  test.setTimeout(15 * 60_000)
  page.setDefaultTimeout(15 * 60_000)
  const falhas: Falha[] = []
  preparar(falhas)
  registrarLogs(page)
  try {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Atas de reunião' })).toBeVisible()
    await page.getByLabel('Navegação principal').getByRole('link', { name: 'Configurações' }).click()
    // Chave usada só neste contexto local; tela e valor nunca são capturados.
    await page.getByLabel('Chave da API').fill(chaveGemini!)
    await page.getByLabel('Nome da escola').fill('Escola Municipal Professora Ana Lima')
    await page.getByLabel('Rede').fill('Secretaria Municipal de Educação')
    await page.getByLabel('Município/UF').fill('Campinas/SP')
    for (const [i, [nome, cargo]] of equipe.entries()) {
      await page.getByRole('button', { name: /Adicionar pessoa/ }).click()
      await page.getByLabel(`Nome da pessoa ${i + 1}`).fill(nome)
      await page.getByLabel(`Cargo da pessoa ${i + 1}`).fill(cargo)
    }
    await page.getByRole('button', { name: 'Salvar' }).click()
    await expect(page.getByRole('status')).toContainText('Configurações salvas')
    await page.getByLabel('Navegação principal').getByRole('link', { name: 'Início' }).click()
    await page.getByRole('button', { name: /Nova ata/ }).click()
    await expect(page.getByRole('heading', { name: 'Que tipo de ata?' })).toBeVisible()
    await captura(page, 'tipo')
    await page.getByRole('button', { name: /^Orientação/ }).click()
    await page.locator('#data').fill('2026-10-20')
    await page.locator('#horaInicio').fill('14:00')
    await page.locator('#local').fill('sala dos professores')
    await page.locator('#Quem-nome').fill('Maria Souza')
    await page.locator('#Quem-cargo').fill('Diretora')
    await page.getByRole('button', { name: /Adicionar funcionário/ }).click()
    await page.locator('#orientado-nome-1').fill('Carlos Mendes')
    await page.locator('#orientado-cargo-1').fill('Professor de Matemática')
    await page.getByRole('button', { name: /Adicionar aluno/ }).click()
    await page.locator('#aluno-nome-2').fill('Pedro Henrique')
    await page.locator('#aluno-turma-2').fill('5º ano B')
    await page.locator('#acomp-nome-2').fill('Ana Costa')
    await page.getByLabel('Assunto 1').fill('Faltas e atrasos frequentes')
    await captura(page, 'dados')

    await page.getByRole('button', { name: /Gravar$/ }).click()
    await expect(page.getByText('Gravando', { exact: true })).toBeVisible()
    await captura(page, 'gravando')
    await page.waitForTimeout(20_000)
    await page.getByRole('button', { name: /Pausar/ }).click()
    await expect(page.getByText('Pausado')).toBeVisible()
    await captura(page, 'pausado')
    await page.waitForTimeout(1_000)
    await page.getByRole('button', { name: /Retomar/ }).click()
    await expect(page.getByText('Gravando', { exact: true })).toBeVisible()
    await page.waitForTimeout(20_000)
    await page.getByRole('button', { name: /Parar/ }).click()
    await expect(page.getByText('Gravação pronta')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByLabel('Ouvir gravação da reunião')).toBeVisible()
    await captura(page, 'gravacao-pronta')

    await page.getByRole('button', { name: 'Transcrever o áudio' }).click()
    await expect(page.getByRole('heading', { name: 'Transcrevendo o áudio' })).toBeVisible()
    await captura(page, 'transcrevendo')
    await esperarResultado(page, 'h1:has-text("Revisar a transcrição")', 'transcrição')
    await captura(page, 'revisao-transcricao')
    await page.getByRole('button', { name: 'Gerar a ata' }).click()
    await expect(page.getByRole('heading', { name: 'Redigindo a ata' })).toBeVisible()
    await captura(page, 'gerando-ata')
    const campoTexto = page.locator('#texto-ata')
    await esperarResultado(page, '#texto-ata', 'geração da ata')
    const texto = await campoTexto.inputValue()
    fs.writeFileSync(path.join(saida, 'ata-orientacao.txt'), `${texto}\n`)

    const titulo = await page.getByRole('heading', { level: 1 }).first().innerText()
    await conferir(titulo, falhas, 'título da orientação mista', /ORIENTA[CÇ][AÃ]O A ALUNOS E FUNCION[AÁ]RIOS/i)
    await conferir(texto, falhas, 'aluno orientado presente no texto', /Pedro Henrique/i)
    await conferir(texto, falhas, 'funcionário orientado presente no texto', /Carlos Mendes/i)
    await conferir(texto, falhas, 'ciência registrada ou marcada pendente', /ci[eê]ncia|\[PENDENTE:[^\]]*ci[eê]ncia/i)
    const checkPedro = page.getByRole('checkbox', { name: /^Aluno Pedro Henrique/ })
    const checkCarlos = page.getByRole('checkbox', { name: /^Funcionário Carlos Mendes/ })
    conferirCondicao(await checkPedro.count() > 0 && await checkPedro.isChecked(), falhas, 'aluno orientado permanece presente', 'checkbox marcado')
    conferirCondicao(await checkPedro.count() > 0 && await checkPedro.isDisabled(), falhas, 'presença do aluno orientado é fixa', 'checkbox desabilitado')
    conferirCondicao(await checkCarlos.count() > 0 && await checkCarlos.isChecked(), falhas, 'funcionário orientado permanece presente', 'checkbox marcado')
    conferirCondicao(await checkCarlos.count() > 0 && await checkCarlos.isDisabled(), falhas, 'presença do funcionário orientado é fixa', 'checkbox desabilitado')
    const assinaturas = await page.getByRole('heading', { name: 'Assinam' }).locator('xpath=..').innerText()
    await conferir(assinaturas, falhas, 'assinaturas incluem aluno e funcionário', /Pedro Henrique[\s\S]*Carlos Mendes|Carlos Mendes[\s\S]*Pedro Henrique/i)
    await conferir(assinaturas, falhas, 'assinatura do aluno inclui turma', /Pedro Henrique[\s\S]*5º ano B/i)
    await fs.promises.writeFile(path.join(saida, 'pendencias-problemas-orientacao.json'), JSON.stringify({
      pendencias: await page.locator('section[aria-label="Completar pendências"] .card').allInnerTexts(),
      problemasFormato: await page.getByRole('alert').allInnerTexts(),
    }, null, 2) + '\n')
    await captura(page, 'revisao-ata')

    await page.getByRole('button', { name: 'Imprimir / PDF' }).click()
    await expect(page.getByRole('heading', { name: 'Imprimir' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Baixar PDF' })).toBeVisible({ timeout: 60_000 })
    await captura(page, 'imprimir')
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Baixar PDF' }).click()
    const download = await downloadPromise
    const pdfPath = path.join(saida, 'ata-orientacao.pdf')
    await download.saveAs(pdfPath)
    const pdfText = await extrairPdf(pdfPath)
    fs.writeFileSync(path.join(saida, 'ata-orientacao.pdf.txt'), `${pdfText}\n`)
    await conferir(pdfText, falhas, 'PDF contém título de orientação mista', /ORIENTA[CÇ][AÃ]O A ALUNOS E FUNCION[AÁ]RIOS/i)
    await conferir(pdfText, falhas, 'PDF contém assinatura do aluno orientado', /Pedro Henrique.{0,120}5º ano B/is)
    await conferir(pdfText, falhas, 'PDF contém assinatura do funcionário orientado', /Carlos Mendes.{0,120}Professor de Matem[aá]tica/is)

    // Interrompe uma segunda gravação e confirma que o aviso aparece após recarregar.
    await page.getByLabel('Navegação principal').getByRole('link', { name: 'Início' }).click()
    await page.getByRole('button', { name: /Nova ata/ }).click()
    await page.getByRole('button', { name: /^Orientação/ }).click()
    await page.getByRole('button', { name: /Gravar$/ }).click()
    await expect(page.getByText('Gravando', { exact: true })).toBeVisible()
    await page.waitForTimeout(2_500)
    page.once('dialog', dialog => dialog.accept())
    await page.reload()
    await page.getByRole('button', { name: /^Orientação/ }).click()
    await expect(page.getByText('Encontramos uma gravação interrompida')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: /Recuperar gravação interrompida/ })).toBeVisible()
    await captura(page, 'recuperar-gravacao')
  } finally {
    salvarFalhas(falhas)
  }
})
