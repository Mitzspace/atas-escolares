import { expect, test, type Page } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const gemini = process.env.GEMINI_API_KEY
const groq = process.env.GROQ_API_KEY
test.describe.configure({ mode: 'serial' })
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

const saida = path.resolve('e2e/saida/pacote-ata-inteligente')
const removerSegredos = (s: string) => s
  .replaceAll(gemini ?? '\0', '[CHAVE_REMOVIDA]')
  .replaceAll(groq ?? '\0', '[CHAVE_REMOVIDA]')
  .replace(/AIza[\w-]{20,}/g, '[CHAVE_REMOVIDA]')
  .replace(/gsk_[\w-]{20,}/g, '[CHAVE_REMOVIDA]')
  .replace(/([?&]key=)[^&\s]+/gi, '$1[CHAVE_REMOVIDA]')

function observar(page: Page, caso: string) {
  const arquivo = path.join(saida, `logs-${caso}.txt`)
  const salvar = (linha: string) => writeFile(arquivo, `${new Date().toISOString()} ${removerSegredos(linha)}\n`, { flag: 'a' })
  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warning') void salvar(`console:${msg.type()} ${msg.text()}`)
  })
  page.on('pageerror', e => void salvar(`pageerror ${e.message}`))
  page.on('response', r => {
    if (r.status() === 429 || r.status() >= 500) {
      const u = new URL(r.url())
      void salvar(`response ${r.status()} ${u.origin}${u.pathname}`)
    }
  })
  page.on('requestfailed', r => {
    const u = new URL(r.url())
    void salvar(`requestfailed ${r.method()} ${u.origin}${u.pathname} ${r.failure()?.errorText ?? ''}`)
  })
}

async function configurar(page: Page) {
  await page.goto('/#/config')
  await page.getByLabel('Provedor preferido para transcrever').selectOption('groq')
  await page.getByLabel('Provedor preferido para redigir').selectOption('gemini')
  await page.getByLabel('Chave do Groq').fill(groq!)
  await page.getByLabel('Chave do Gemini (opcional)').fill(gemini!)
  await page.getByRole('button', { name: 'Salvar', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Configurações salvas')
}

async function preencherCadastro(page: Page, modo: 'Digitar' | 'Gravar e digitar' | 'Gravar áudio') {
  await page.goto('/#/nova')
  await page.getByLabel('Tipo de reunião', { exact: true }).selectOption('Reunião pedagógica')
  await page.getByLabel('Nome do(a) responsável', { exact: true }).fill('Maria Souza')
  await page.locator('#responsavel-cargo').fill('Diretora')
  await page.getByLabel('Início', { exact: true }).fill('14:00')
  await page.getByLabel('Término (opcional)', { exact: true }).fill('15:00')
  await page.getByLabel('Local', { exact: true }).fill('sala dos professores')
  await page.getByLabel('Item 1 da pauta', { exact: true }).fill('Planejamento escolar')
  await page.getByRole('radio', { name: modo, exact: true }).check()
}

async function aguardarEtapa(page: Page, sucesso: RegExp, etapa: string, caso: string) {
  const inicio = Date.now()
  let ultimoRegistro = inicio
  while (Date.now() - inicio < 14 * 60_000) {
    const texto = await page.locator('main').innerText().catch(() => '')
    if (sucesso.test(texto)) return texto
    const alerta = page.getByRole('alert')
    if (await alerta.isVisible().catch(() => false)) {
      const mensagem = removerSegredos(await alerta.innerText())
      await writeFile(path.join(saida, `erro-${caso}-${etapa}.txt`), `${mensagem}\n`)
      throw new Error(`${etapa} falhou na tela: ${mensagem}`)
    }
    if (Date.now() - ultimoRegistro >= 30_000) {
      await writeFile(path.join(saida, `logs-${caso}.txt`), `${new Date().toISOString()} ${etapa} processando\n`, { flag: 'a' })
      ultimoRegistro = Date.now()
    }
    await page.waitForTimeout(1000)
  }
  throw new Error(`${etapa} não concluiu em 14 minutos.`)
}

async function baixarPdf(page: Page, nome: string) {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Baixar PDF', exact: true }).click()
  const download = await downloadPromise
  const pdf = path.join(saida, nome)
  await download.saveAs(pdf)
  const extraido = spawnSync('pdftotext', [pdf, '-'], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
  if (extraido.error || extraido.status !== 0) throw new Error(`pdftotext falhou ao conferir ${nome}.`)
  await writeFile(path.join(saida, `${nome}.txt`), `${extraido.stdout}\n`)
  return extraido.stdout
}

test.beforeAll(async () => mkdir(saida, { recursive: true }))

test('Digitar sem IA: offline, marcadores bloqueiam finalização, PDF rascunho/final e reabertura', async ({ page, context }) => {
  test.setTimeout(3 * 60_000)
  page.setDefaultTimeout(60_000)
  observar(page, 'usar-como-esta')
  await page.goto('/#/nova')
  await page.getByLabel('Tipo de reunião', { exact: true }).selectOption('Reunião pedagógica')
  await page.getByRole('radio', { name: 'Digitar', exact: true }).check()
  await page.getByLabel('Nome do(a) responsável', { exact: true }).fill('Maria Souza')
  await page.locator('#responsavel-cargo').fill('Diretora')
  await page.getByLabel('Início', { exact: true }).fill('14:00')
  await page.getByLabel('Término (opcional)', { exact: true }).fill('15:00')
  await page.getByLabel('Local', { exact: true }).fill('sala dos professores')
  const texto = 'Maria apresentou o planejamento escolar e ficou decidido realizar novo encontro na sexta-feira.'
  await page.getByLabel('Texto da reunião', { exact: true }).fill(texto)
  await expect(page).toHaveURL(/rascunho=/)
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Usar como está', exact: true }).click()
  await expect(page.locator('#texto-ata')).toContainText('Maria apresentou o planejamento escolar')
  await expect(page.getByText('Rascunho — revise antes de assinar.', { exact: true })).toBeVisible()
  await page.locator('#texto-ata').fill(`Aos vinte e cinco dias do mês de outubro, ${texto} [PENDENTE: horário de término]. Nada mais havendo a tratar, lavrei a presente ata.`)
  await page.getByLabel('Revisei a ata e confirmo que está correta').check()
  await expect(page.getByRole('button', { name: 'Finalizar ata', exact: true })).toBeDisabled()
  await expect(page.locator('section[aria-label="Finalização da ata"] [role="alert"]')).toContainText('horário de término')
  await context.setOffline(false)
  await page.getByRole('button', { name: 'Imprimir / PDF', exact: true }).click()
  await expect(page.getByText('Rascunho — não assinar.', { exact: true })).toBeVisible()
  const textoPdfRascunho = await baixarPdf(page, 'usar-como-esta-rascunho.pdf')
  expect(textoPdfRascunho).toMatch(/RASCUNHO\s*[–-]\s*NÃO ASSINAR/i)
  await page.getByRole('link', { name: 'Revisar e finalizar', exact: true }).click()
  await page.locator('#texto-ata').fill(`Aos vinte e cinco dias do mês de outubro, ${texto} Nada mais havendo a tratar, lavrei a presente ata.`)
  await page.getByLabel('Revisei a ata e confirmo que está correta').check()
  await page.getByRole('button', { name: 'Finalizar ata', exact: true }).click()
  await expect(page.locator('#texto-ata')).toHaveAttribute('readonly', '')
  await page.getByRole('button', { name: 'Imprimir / PDF', exact: true }).click()
  await expect(page.getByText('Rascunho — não assinar.', { exact: true })).toHaveCount(0)
  const textoPdfFinal = await baixarPdf(page, 'usar-como-esta-final.pdf')
  expect(textoPdfFinal).not.toMatch(/RASCUNHO\s*[–-]\s*NÃO ASSINAR/i)
  await page.getByRole('link', { name: '← Voltar para editar a ata' }).click()
  await page.getByRole('button', { name: 'Reabrir para correção', exact: true }).click()
  await expect(page.locator('#texto-ata')).not.toHaveAttribute('readonly', '')
  await expect(page.getByText('Reaberta para correção em:', { exact: false })).toBeVisible()
  await writeFile(path.join(saida, 'resultado-usar-como-esta.txt'), 'Passou: fluxo executado offline; PDF rascunho e final baixados; finalização bloqueada pelo marcador; ata final somente leitura e reabertura datada.\n')
})

test('Usar como está mantém edições ao alternar presença e orientação respeita participante marcado', async ({ page }) => {
  test.setTimeout(3 * 60_000)
  page.setDefaultTimeout(60_000)
  observar(page, 'presenca-e-orientacao')
  await page.goto('/#/nova')
  await page.getByLabel('Tipo de reunião', { exact: true }).selectOption('Reunião pedagógica')
  await page.getByLabel('Nome do(a) responsável', { exact: true }).fill('Maria Souza')
  await page.locator('#responsavel-cargo').fill('Diretora')
  await page.getByLabel('Início', { exact: true }).fill('14:00')
  await page.getByLabel('Término (opcional)', { exact: true }).fill('15:00')
  await page.getByRole('button', { name: /Adicionar participante/ }).click()
  await page.getByLabel('Nome do participante 1').fill('Carlos Mendes')
  await page.getByLabel('Cargo do participante 1').fill('Professor de Matemática')
  await page.getByRole('radio', { name: 'Digitar', exact: true }).check()
  await page.getByLabel('Texto da reunião', { exact: true }).fill('A equipe aprovou o planejamento escolar.')
  await page.getByRole('button', { name: 'Usar como está', exact: true }).click()
  const corpo = page.locator('#texto-ata')
  await corpo.fill(`${await corpo.inputValue()} A diretora revisou este trecho manualmente.`)
  const c = page.locator('label').filter({ hasText: 'Carlos Mendes' }).locator('input[type="checkbox"]')
  await expect(c).toBeChecked()
  await c.uncheck()
  await expect(c).not.toBeChecked()
  await expect(corpo).toContainText('A diretora revisou este trecho manualmente.')
  await expect(corpo).toContainText('Não compareceu')
  await c.check()
  await expect(c).toBeChecked()
  await expect(corpo).not.toContainText('Não compareceu')
  await expect(corpo).toContainText('A diretora revisou este trecho manualmente.')

  await page.goto('/#/nova')
  await page.getByLabel('Tipo de reunião', { exact: true }).selectOption('Orientação a funcionário(s)')
  await page.getByLabel('Nome do(a) responsável', { exact: true }).fill('Maria Souza')
  await page.locator('#responsavel-cargo').fill('Diretora')
  await page.getByLabel('Início', { exact: true }).fill('14:00')
  await page.getByLabel('Término (opcional)', { exact: true }).fill('15:00')
  await page.getByRole('button', { name: /Adicionar participante/ }).click()
  await page.getByLabel('Nome do participante 1').fill('Clara Dias')
  await page.getByLabel('Cargo do participante 1').fill('Professora de Ciências')
  await page.getByLabel('Recebe a orientação', { exact: true }).check()
  await page.getByLabel('Item 1 da pauta', { exact: true }).fill('Acompanhamento do planejamento')
  await page.getByRole('radio', { name: 'Digitar', exact: true }).check()
  await page.getByLabel('Texto da reunião', { exact: true }).fill('A diretora orientou Clara Dias sobre o acompanhamento do planejamento.')
  await page.getByRole('button', { name: 'Usar como está', exact: true }).click()
  const orientada = page.locator('li').filter({ hasText: 'Clara Dias' }).filter({ hasText: 'recebeu a orientação' })
  await expect(orientada.locator('input[type="checkbox"]')).toBeChecked()
  await expect(orientada.locator('input[type="checkbox"]')).toBeDisabled()
  await expect(page.locator('#texto-ata')).toContainText('Clara Dias')
  await writeFile(path.join(saida, 'resultado-presenca-orientacao.txt'), 'Passou: corpo e edição manual preservados ao alternar presença em Usar como está; recebeOrientacao aparece como orientada na revisão.\n')
})

test('Digitar com IA: organiza anotações em ata e registra provedor/modelo', async ({ page }) => {
  test.skip(!gemini || !groq, 'Defina as duas chaves no ambiente para os cenários com IA.')
  test.setTimeout(15 * 60_000)
  page.setDefaultTimeout(60_000)
  observar(page, 'digitar-com-ia')
  await configurar(page)
  await preencherCadastro(page, 'Digitar')
  await page.getByLabel('Texto da reunião', { exact: true }).fill('A diretora Maria Souza apresentou o planejamento do quarto bimestre. As avaliações serão de 1 a 5 de dezembro e a recuperação de 8 a 12 de dezembro. A professora Clara Dias enviará o calendário atualizado na próxima semana.')
  await page.getByRole('button', { name: 'Organizar com IA', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Redigindo a ata', exact: true })).toBeVisible()
  const tela = await aguardarEtapa(page, /Texto da ata|Rascunho — revise antes de assinar\./, 'geração', 'digitar-com-ia')
  await expect(page.locator('#texto-ata')).toBeVisible()
  const textoAta = await page.locator('#texto-ata').inputValue()
  await writeFile(path.join(saida, 'ata-digitar-com-ia.txt'), `${textoAta}\n`)
  const provedor = await page.getByText(/^Redação: (?:Gemini|Groq) · /).innerText()
  await writeFile(path.join(saida, 'provedor-digitar-com-ia.txt'), `${provedor}\n`)
  expect(provedor).toMatch(/^Redação: Gemini · /)
  expect(textoAta).toMatch(/planejamento/i)
  expect(textoAta).toMatch(/dezembro/i)
  expect(tela).not.toMatch(/Erro ao gerar/i)
})

test('Gravar e digitar: microfone falso, três anotações temporizadas, transcrição e organização', async ({ page }) => {
  test.skip(!gemini || !groq, 'Defina as duas chaves no ambiente para os cenários com IA.')
  test.setTimeout(15 * 60_000)
  page.setDefaultTimeout(60_000)
  observar(page, 'gravar-e-digitar')
  await configurar(page)
  await preencherCadastro(page, 'Gravar e digitar')
  await page.getByRole('button', { name: '● Gravar', exact: true }).click()
  await expect(page.getByText('Gravando', { exact: true })).toBeVisible()
  await page.waitForTimeout(1800)
  const anotacoes = [
    'A reunião começa às 14 horas.',
    'Clara Dias apresentará o calendário de avaliações.',
    'O próximo encontro será na sexta-feira.',
  ]
  for (let i = 0; i < anotacoes.length; i++) {
    if (i > 0) await page.getByRole('button', { name: /Adicionar anotação/ }).click()
    await page.getByLabel(`Anotação ${i + 1}`, { exact: true }).fill(anotacoes[i])
    if (i < anotacoes.length - 1) await page.waitForTimeout(1100)
  }
  const tempos = await page.locator('label[for^="anotacao-"]').allInnerTexts()
  expect(tempos).toHaveLength(3)
  expect(tempos.every(t => /\[\d{2}:\d{2}\]/.test(t))).toBe(true)
  const valoresDasAnotacoes = await Promise.all(anotacoes.map((_, i) => page.getByLabel(`Anotação ${i + 1}`).inputValue()))
  expect(valoresDasAnotacoes).toEqual(anotacoes)
  await writeFile(path.join(saida, 'anotacoes-gravar-e-digitar.json'), `${JSON.stringify(valoresDasAnotacoes.map((texto, i) => ({ texto, tempo: tempos[i] })), null, 2)}\n`)
  await page.getByRole('button', { name: /■ Parar/ }).click()
  await expect(page.getByText('Gravação pronta', { exact: true })).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Transcrever o áudio', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Transcrevendo o áudio', exact: true })).toBeVisible()
  await aguardarEtapa(page, /Revisar a transcrição/, 'transcrição', 'gravar-e-digitar')
  const transcript = await page.locator('textarea').evaluateAll(els => els.map(e => (e as HTMLTextAreaElement).value).join('\n'))
  await writeFile(path.join(saida, 'transcricao-gravar-e-digitar.txt'), `${transcript}\n`)
  const provTranscricao = await page.getByText(/^Transcrição: (?:Gemini|Groq) · /).innerText()
  await page.getByRole('button', { name: 'Gerar a ata', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Redigindo a ata', exact: true })).toBeVisible()
  await aguardarEtapa(page, /Rascunho — revise antes de assinar\./, 'geração', 'gravar-e-digitar')
  const textoAta = await page.locator('#texto-ata').inputValue()
  const provRedacao = await page.getByText(/^Redação: (?:Gemini|Groq) · /).innerText()
  await writeFile(path.join(saida, 'ata-gravar-e-digitar.txt'), `${textoAta}\n`)
  await writeFile(path.join(saida, 'provedores-gravar-e-digitar.json'), `${JSON.stringify({ transcricao: provTranscricao, redacao: provRedacao, anotacoes: valoresDasAnotacoes.map((texto, i) => ({ texto, tempo: tempos[i] })) }, null, 2)}\n`)
  expect(textoAta).toMatch(/Clara Dias|calend[aá]rio/i)
  expect(textoAta).toMatch(/quatorze horas|14 horas/i)
  expect(textoAta).toMatch(/sexta-feira/i)
})

test('Gravar áudio: gravação pelo microfone falso, transcrição, ata e PDF', async ({ page }) => {
  test.skip(!gemini || !groq, 'Defina as duas chaves no ambiente para os cenários com IA.')
  test.setTimeout(15 * 60_000)
  page.setDefaultTimeout(60_000)
  observar(page, 'gravar-audio')
  await configurar(page)
  await preencherCadastro(page, 'Gravar áudio')
  await page.getByRole('button', { name: '● Gravar', exact: true }).click()
  await expect(page.getByText('Gravando', { exact: true })).toBeVisible()
  await page.waitForTimeout(2500)
  await page.getByRole('button', { name: /■ Parar/ }).click()
  await expect(page.getByText('Gravação pronta', { exact: true })).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Transcrever o áudio', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Transcrevendo o áudio', exact: true })).toBeVisible()
  await aguardarEtapa(page, /Revisar a transcrição/, 'transcrição', 'gravar-audio')
  const transcricao = await page.locator('textarea').evaluateAll(els => els.map(e => (e as HTMLTextAreaElement).value).join('\n'))
  const provTranscricao = await page.getByText(/^Transcrição: (?:Gemini|Groq) · /).innerText()
  await page.getByRole('button', { name: 'Gerar a ata', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Redigindo a ata', exact: true })).toBeVisible()
  await aguardarEtapa(page, /Rascunho — revise antes de assinar\./, 'geração', 'gravar-audio')
  const textoAta = await page.locator('#texto-ata').inputValue()
  const provRedacao = await page.getByText(/^Redação: (?:Gemini|Groq) · /).innerText()
  await writeFile(path.join(saida, 'ata-gravar-audio.txt'), `${textoAta}\n`)
  await writeFile(path.join(saida, 'transcricao-gravar-audio.txt'), `${transcricao}\n`)
  await writeFile(path.join(saida, 'provedores-gravar-audio.json'), `${JSON.stringify({ transcricao: provTranscricao, redacao: provRedacao }, null, 2)}\n`)
  await page.getByRole('button', { name: 'Imprimir / PDF', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Baixar PDF', exact: true })).toBeVisible({ timeout: 60_000 })
  await baixarPdf(page, 'gravar-audio.pdf')
})
