import { expect, test, type Page } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const chaveGroq = process.env.GROQ_API_KEY
const chaveGemini = process.env.GEMINI_API_KEY
test.skip(!chaveGroq || !chaveGemini, 'Defina GROQ_API_KEY e GEMINI_API_KEY para testar o áudio longo com os dois provedores.')
test.use({ viewport: { width: 390, height: 844 }, trace: 'off', video: 'off', screenshot: 'off' })

const saida = path.resolve('e2e/saida')
const audioLongo = '/home/william/audio-teste-ata/longo-40min.mp3'
const escola = 'Escola Municipal Professora Ana Lima'
const equipe: [string, string][] = [
  ['Joana Alves', 'Coordenadora Pedagógica'],
  ['Carlos Mendes', 'Professor de Matemática'],
  ['Clara Dias', 'Professora de Ciências'],
]

function semCredenciais(valor: string) {
  return valor
    .replaceAll(chaveGroq ?? '\0', '[CHAVE_REMOVIDA]')
    .replaceAll(chaveGemini ?? '\0', '[CHAVE_REMOVIDA]')
    .replace(/gsk_[\w-]{20,}/g, '[CHAVE_REMOVIDA]')
    .replace(/AIza[\w-]{20,}/g, '[CHAVE_REMOVIDA]')
    .replace(/([?&]key=)[^&\s]+/gi, '$1[CHAVE_REMOVIDA]')
}

function registrarLogs(page: Page) {
  const arquivo = path.join(saida, 'logs-longo.txt')
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

async function configurar(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Atas de reunião' })).toBeVisible()
  await page.getByLabel('Navegação principal').getByRole('link', { name: 'Configurações' }).click()
  await page.getByLabel('Provedor preferido para transcrever').selectOption('groq')
  await page.getByLabel('Provedor preferido para redigir').selectOption('gemini')
  await page.getByLabel('Chave do Groq').fill(chaveGroq!)
  await page.getByLabel('Chave do Gemini (opcional)').fill(chaveGemini!)
  await page.getByLabel('Modelo Groq para transcrever').selectOption('whisper-large-v3')
  await page.getByLabel('Modelo Groq para redigir a ata').selectOption('openai/gpt-oss-120b')
  await page.getByLabel('Modelo Gemini para redigir a ata').selectOption('gemini-3.8-flash')
  await page.getByLabel('Nome da escola').fill(escola)
  await page.getByLabel('Rede').fill('Secretaria Municipal de Educação')
  await page.getByLabel('Município/UF').fill('Campinas/SP')
  await page.getByLabel('Local habitual das reuniões').fill('sala dos professores')
  for (const [i, [nome, cargo]] of equipe.entries()) {
    await page.getByRole('button', { name: /Adicionar pessoa/ }).click()
    await page.getByLabel(`Nome da pessoa ${i + 1}`).fill(nome)
    await page.getByLabel(`Cargo da pessoa ${i + 1}`).fill(cargo)
  }
  await page.getByRole('button', { name: 'Salvar' }).click()
  await expect(page.getByRole('status')).toContainText('Configurações salvas')
  await page.reload()
  await expect(page.getByLabel('Provedor preferido para transcrever')).toHaveValue('groq')
  await expect(page.getByLabel('Provedor preferido para redigir')).toHaveValue('gemini')
  const tamanhos = await page.evaluate(() => ({
    groq: (document.querySelector('#chave-groq') as HTMLInputElement).value.length,
    gemini: (document.querySelector('#chave-gemini') as HTMLInputElement).value.length,
  }))
  expect(tamanhos).toEqual({ groq: chaveGroq!.length, gemini: chaveGemini!.length })
  await page.getByLabel('Navegação principal').getByRole('link', { name: 'Início' }).click()
}

async function esperarResultado(page: Page, sucesso: ReturnType<Page['locator']>, etapa: string) {
  const inicio = Date.now()
  let ultimoLog = inicio
  const arquivo = path.join(saida, 'logs-longo.txt')
  while (Date.now() - inicio < 40 * 60_000) {
    if (await sucesso.isVisible().catch(() => false)) return
    const alerta = page.getByRole('alert')
    if (await alerta.isVisible().catch(() => false)) {
      throw new Error(`${etapa} terminou com erro na tela: ${semCredenciais(await alerta.innerText())}`)
    }
    if (Date.now() - ultimoLog >= 30_000) {
      const progresso = await page.getByRole('progressbar').getAttribute('aria-valuenow').catch(() => 'indisponível')
      const status = (await page.locator('main').innerText().catch(() => 'tela principal indisponível')).replace(/\s+/g, ' ').slice(0, 280)
      fs.appendFileSync(arquivo, `${new Date().toISOString()} etapa:${etapa} ainda processando; progresso=${progresso}; tela=${semCredenciais(status)}\n`)
      ultimoLog = Date.now()
    }
    await page.waitForTimeout(1000)
  }
  const status = (await page.locator('main').innerText().catch(() => 'tela principal indisponível')).replace(/\s+/g, ' ').slice(0, 280)
  throw new Error(`${etapa} não chegou ao sucesso nem exibiu erro após 40 minutos. Tela: ${semCredenciais(status)}`)
}

async function textoPdf(arquivo: string) {
  const resultado = spawnSync('pdftotext', [arquivo, '-'], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
  if (resultado.error || resultado.status !== 0) throw new Error('pdftotext não conseguiu extrair texto do PDF longo.')
  return resultado.stdout
}

test('5. áudio de 40 minutos: Gemini automático acima de 25 MB, ata e PDF', async ({ page }) => {
  test.setTimeout(45 * 60_000)
  page.setDefaultTimeout(40 * 60_000)
  fs.mkdirSync(saida, { recursive: true })
  registrarLogs(page)
  try {
    const stat = fs.statSync(audioLongo)
    expect(stat.size).toBeGreaterThan(25_000_000)
    await configurar(page)
    await page.getByRole('button', { name: /Nova ata/ }).click()
    await expect(page.getByRole('heading', { name: 'Que tipo de ata?' })).toBeVisible()
    await page.getByRole('button', { name: /Reunião pedagógica/ }).click()
    await expect(page.getByRole('heading', { name: /^Nova ata/ })).toBeVisible()
    await page.locator('#data').fill('2026-10-20')
    await page.locator('#horaInicio').fill('14:00')
    await page.locator('#horaFim').fill('15:10')
    await page.locator('#local').fill('sala dos professores')
    await page.locator('#Presidiu-nome').fill('Maria Souza')
    await page.locator('#Presidiu-cargo').fill('Diretora')
    await page.locator('#Lavrou-nome').fill('Paulo Reis')
    await page.locator('#Lavrou-cargo').fill('Secretário')
    for (const [i, pauta] of ['Resultados da avaliação do 3º bimestre', 'Feira de Ciências', 'Informes gerais'].entries()) {
      if (i) await page.getByRole('button', { name: /Adicionar item/ }).click()
      await page.getByLabel(`Item ${i + 1} da pauta`).fill(pauta)
    }
    await page.getByRole('button', { name: 'Enviar arquivo' }).click()
    await page.getByLabel('Arquivo de áudio da reunião').setInputFiles(audioLongo)
    await page.screenshot({ path: path.join(saida, 'tela-longo-dados.png') })

    await page.evaluate(() => {
      const w = window as typeof window & { __ataProgressoLongo?: string[]; __ataObserverLongo?: MutationObserver }
      w.__ataProgressoLongo = []
      const guardar = () => {
        const texto = document.querySelector('[aria-live="polite"]')?.textContent ?? ''
        if (texto.includes('Áudio acima de 25 MB: usando Gemini')) w.__ataProgressoLongo!.push(texto)
      }
      w.__ataObserverLongo = new MutationObserver(guardar)
      w.__ataObserverLongo.observe(document.documentElement, { subtree: true, childList: true, characterData: true })
      guardar()
    })
    await page.getByRole('button', { name: 'Transcrever o áudio' }).click()
    await expect(page.getByRole('heading', { name: 'Transcrevendo o áudio' })).toBeVisible()
    await esperarResultado(page, page.getByRole('heading', { name: 'Revisar a transcrição' }), 'transcrição do áudio longo')
    await page.screenshot({ path: path.join(saida, 'tela-longo-revisao-transcricao.png') })
    const indicouGemini = await page.evaluate(() => {
      const w = window as typeof window & { __ataProgressoLongo?: string[] }
      return w.__ataProgressoLongo?.some(texto => texto.includes('Áudio acima de 25 MB: usando Gemini')) ?? false
    })
    expect(indicouGemini).toBe(true)
    const origemTranscricao = page.getByText(/^Transcrição: Gemini · gemini-[\w., -]+$/)
    await expect(origemTranscricao).toBeVisible()
    const transcricao = await page.locator('textarea').evaluateAll(els => els.map(el => (el as HTMLTextAreaElement).value).join('\n'))
    fs.writeFileSync(path.join(saida, 'transcricao-longo.txt'), `${transcricao}\n`)
    const proveniencia: Record<string, string> = { transcricao: await origemTranscricao.innerText() }
    fs.writeFileSync(path.join(saida, 'provedores-longo.json'), `${JSON.stringify(proveniencia, null, 2)}\n`)

    await page.getByRole('button', { name: 'Gerar a ata' }).click()
    await expect(page.getByRole('heading', { name: 'Redigindo a ata' })).toBeVisible()
    await esperarResultado(page, page.locator('#texto-ata'), 'redação do áudio longo')
    const origemRedacao = page.getByText(/^Redação: (?:Gemini · gemini-[\w., -]+|Groq · [\w/.-]+)$/)
    await expect(origemRedacao).toBeVisible()
    proveniencia.redacao = await origemRedacao.innerText()
    fs.writeFileSync(path.join(saida, 'provedores-longo.json'), `${JSON.stringify(proveniencia, null, 2)}\n`)
    const ata = await page.locator('#texto-ata').inputValue()
    fs.writeFileSync(path.join(saida, 'ata-longo.txt'), `${ata}\n`)
    expect(ata).toMatch(/P\.?\s*H\.?/i)
    expect(ata).not.toMatch(/Pedro Henrique/i)
    expect(ata).toMatch(/quinze faltas|mais de quinze faltas|\+\s*15 faltas/i)
    expect(ata).toMatch(/Carlos Mendes.{0,550}(?:pais.{0,120}trabalh(?:am|arem)|professor.{0,140}(?:disponibilidade|vir|comparecer|trabalhar))/i)
    expect(ata).toMatch(/Clara Dias.{0,150}regulamento.{0,100}(?:semana seguinte|pr[oó]xima semana)/i)
    await page.screenshot({ path: path.join(saida, 'tela-longo-revisao-ata.png') })
    await page.getByRole('button', { name: 'Imprimir / PDF' }).click()
    await expect(page.getByRole('heading', { name: 'Imprimir' })).toBeVisible()
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Baixar PDF' }).click()
    const download = await downloadPromise
    const pdfPath = path.join(saida, 'ata-longo.pdf')
    await download.saveAs(pdfPath)
    const pdf = await textoPdf(pdfPath)
    fs.writeFileSync(path.join(saida, 'ata-longo.pdf.txt'), `${pdf}\n`)
    expect(pdf).toMatch(/REUNIÃO PEDAGÓGICA/i)
    expect(pdf).toMatch(/Folha\s+1\s+de/i)
    expect(pdf).not.toMatch(/Pedro Henrique/i)
  } finally {
    await page.evaluate(() => {
      const w = window as typeof window & { __ataObserverLongo?: MutationObserver }
      w.__ataObserverLongo?.disconnect()
    }).catch(() => {})
  }
})
