import { expect, test, type Page } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
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

const saida = path.resolve(process.env.PACOTE_QA_OUTPUT ?? 'e2e/saida/pacote-ata-inteligente')
const removerSegredos = (s: string) => s
  .replaceAll(gemini ?? '\0', '[CHAVE_REMOVIDA]')
  .replaceAll(groq ?? '\0', '[CHAVE_REMOVIDA]')
  .replace(/AIza[\w-]{20,}/g, '[CHAVE_REMOVIDA]')
  .replace(/gsk_[\w-]{20,}/g, '[CHAVE_REMOVIDA]')
  .replace(/([?&]key=)[^&\s]+/gi, '$1[CHAVE_REMOVIDA]')

function observar(page: Page, caso: string) {
  const arquivo = path.join(saida, `logs-${caso}.txt`)
  writeFileSync(arquivo, '')
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
  await page.getByLabel('Tipo de reunião', { exact: true }).selectOption('Outro (digitar)')
  await page.getByLabel('Digite o tipo de reunião', { exact: true }).fill('Conselho de Cultura')
  await page.getByLabel('Nome do(a) responsável', { exact: true }).fill('Maria Souza')
  await page.locator('#responsavel-cargo').fill('Diretora')
  await page.getByRole('button', { name: /Cadastrar novo nome ou cargo/ }).click()
  await expect(page.getByText('Nome ou cargo cadastrado para as próximas atas.', { exact: true })).toBeVisible()
  await expect(page.locator('#nomes-cadastrados option[value="Maria Souza"]')).toHaveCount(1)
  await expect(page.locator('#cargos-cadastrados option[value="Diretora"]')).toHaveCount(1)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: path.join(saida, 'cadastro-v2-390.png') })
  await page.screenshot({ path: path.join(saida, 'cadastro-v2-390-completo.png'), fullPage: true })
  await page.getByRole('heading', { name: 'Quem fez a ata?', exact: true }).evaluate(el => el.scrollIntoView({ block: 'start' }))
  await page.screenshot({ path: path.join(saida, 'cadastro-v2-responsavel-390.png') })
  await page.evaluate(() => window.scrollTo(0, 0))
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole('button', { name: /Adicionar participante/ }).click()
  await page.getByLabel('Nome do participante 1').fill('Carlos Mendes')
  await expect(page.getByLabel('Cargo do participante 1')).toHaveValue('')
  await page.getByRole('heading', { name: 'Participantes da reunião', exact: true }).evaluate(el => el.scrollIntoView({ block: 'start' }))
  await page.screenshot({ path: path.join(saida, 'cadastro-v2-participantes-390.png') })
  await page.getByRole('radio', { name: 'Digitar', exact: true }).check()
  await page.getByRole('button', { name: /Adicionar participante/ }).click()
  await page.getByLabel('Nome do participante 2').fill('Bruno Reis')
  await page.getByLabel('Cargo do participante 2').fill('Professor')
  await page.getByLabel('Nome do participante 2').fill('Clara Dias')
  await expect(page.getByLabel('Nome do participante 2')).toHaveValue('Clara Dias')
  await page.getByRole('button', { name: 'Excluir participante 2', exact: true }).click()
  await expect(page.getByLabel('Nome do participante 2')).toHaveCount(0)
  await page.getByLabel('Início', { exact: true }).fill('14:00')
  await page.getByLabel('Término (opcional)', { exact: true }).fill('15:00')
  await page.getByLabel('Local', { exact: true }).fill('sala dos professores')
  const texto = 'Maria apresentou o planejamento escolar e ficou decidido realizar novo encontro na sexta-feira.'
  await page.getByLabel('Texto da reunião', { exact: true }).fill(texto)
  await expect(page).toHaveURL(/rascunho=/)
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Usar como está', exact: true }).click()
  await expect(page.locator('#texto-ata')).toContainText('Maria apresentou o planejamento escolar')
  await expect(page.getByRole('heading', { name: /ATA Nº .*CONSELHO DE CULTURA/ })).toBeVisible()
  const corpoInicial = await page.locator('#texto-ata').inputValue()
  expect(corpoInicial).toMatch(/e eu, Maria Souza, diretora, lavrei a presente ata/i)
  expect(corpoInicial).not.toMatch(/sob a presid[eê]ncia/i)
  expect(corpoInicial).not.toMatch(/,,/)
  const assinaturas = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Assinam', exact: true }) })
  await expect(assinaturas.locator('li').filter({ hasText: 'Carlos Mendes' })).toHaveText('Carlos Mendes')
  await expect(page.getByText('Bruno Reis', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Clara Dias', { exact: true })).toHaveCount(0)
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

test('ata legada sem cadastro v2 continua abrindo a partir da lista', async ({ page }) => {
  test.setTimeout(3 * 60_000)
  page.setDefaultTimeout(60_000)
  await page.goto('/')
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const pedido = indexedDB.open('atas-escolares')
      pedido.onerror = () => reject(pedido.error)
      pedido.onsuccess = () => {
        const database = pedido.result
        const meta = {
          escola: 'Escola legada de teste', rede: 'Municipal', municipioUf: 'Campinas/SP', tipo: 'pedagogica', ordinaria: true,
          numero: 42, ano: 2024, data: '2024-05-10', horaInicio: '14:00', horaFim: '15:00', local: 'Sala antiga',
          presidente: { nome: 'Maria Souza', cargo: 'Diretora' }, secretario: { nome: 'Paulo Reis', cargo: 'Secretário' },
          participantes: [{ nome: 'Clara Dias', cargo: 'Professora', presente: true }], pauta: ['Planejamento'], anonimizarAlunos: true,
        }
        const tx = database.transaction('atas', 'readwrite')
        tx.objectStore('atas').put({
          id: 'ata-legada-2024', criadaEm: Date.parse('2024-05-10T14:00:00'), atualizadaEm: Date.parse('2024-05-10T15:00:00'),
          status: 'ata', meta,
          renderizada: { titulo: 'REUNIÃO PEDAGÓGICA', cabecalho: ['Escola legada de teste'], texto: 'Ata antiga preservada no aparelho.', assinaturas: [meta.presidente, meta.secretario], pendencias: [] },
          textoEditado: 'Registro legado editado antes do cadastro v2.',
        })
        tx.oncomplete = () => { database.close(); resolve() }
        tx.onerror = () => { database.close(); reject(tx.error) }
      }
    })
  })
  await page.reload()
  await expect(page.getByText('Ata nº 42/2024', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Abrir', exact: true }).click()
  await expect(page.locator('#texto-ata')).toHaveValue('Registro legado editado antes do cadastro v2.')
  await expect(page.getByRole('heading', { name: /REUNIÃO PEDAGÓGICA/ })).toBeVisible()
  const assinaturas = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Assinam', exact: true }) })
  await expect(assinaturas.getByText('Maria Souza — Diretora', { exact: true })).toBeVisible()
  await expect(assinaturas.getByText('Paulo Reis — Secretário', { exact: true })).toBeVisible()
  await writeFile(path.join(saida, 'resultado-ata-legada.txt'), 'Passou: registro legado sem responsavel/modeRegistro foi aberto da lista; texto editado e renderização antiga ficaram acessíveis. Não havia backup JSON antigo local para restaurar.\n')
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
  if (process.env.MOCK_IA_E2E === '1') {
    await page.route('https://api.groq.com/openai/v1/audio/transcriptions', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ segments: [
        { start: 0, end: 2, text: 'Boa tarde a todos. São duas horas da tarde.' },
        { start: 3, end: 5, text: 'A diretora encerrou a reunião.' },
      ] }),
    }))
    await page.route('https://generativelanguage.googleapis.com/**', route => {
      const pedido = route.request().postData() ?? ''
      const ehGeracaoDaAta = pedido.includes('ANOTAÇÕES DA SECRETÁRIA')
      const dados = ehGeracaoDaAta
        ? { itens: [], deliberacoes: [], encaminhamentos: [], pendencias: [], manifestacoes: [], orientacoes: [] }
        : { atribuicoes: [] }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(dados) }] }, finishReason: 'STOP' }] }),
      })
    })
  }
  const textosAnotados = [
    'A reunião começa às 14 horas.',
    'Clara Dias apresentará o calendário de avaliações.',
    'O próximo encontro será na sexta-feira.',
  ]
  const capturaPrompt = { contemCabecalho: false, contemRegraPrioridade: false, contemAnotacoes: textosAnotados.map(() => false) }
  page.on('request', request => {
    if (request.method() !== 'POST' || !request.url().includes('generativelanguage.googleapis.com')) return
    const corpo = request.postData() ?? ''
    if (!corpo.includes('ANOTAÇÕES DA SECRETÁRIA')) return
    capturaPrompt.contemCabecalho = true
    capturaPrompt.contemRegraPrioridade = corpo.includes('As ANOTAÇÕES TÊM PRIORIDADE')
    textosAnotados.forEach((texto, i) => { capturaPrompt.contemAnotacoes[i] = corpo.includes(texto) })
  })
  await configurar(page)
  await preencherCadastro(page, 'Gravar e digitar')
  await page.getByRole('button', { name: '● Gravar', exact: true }).click()
  await expect(page.getByText('Gravando', { exact: true })).toBeVisible()
  await page.waitForTimeout(1800)
  for (let i = 0; i < textosAnotados.length; i++) {
    if (i > 0) await page.getByRole('button', { name: /Adicionar anotação/ }).click()
    await page.getByLabel(`Anotação ${i + 1}`, { exact: true }).fill(textosAnotados[i])
    if (i < textosAnotados.length - 1) await page.waitForTimeout(1100)
  }
  const tempos = await page.locator('label[for^="anotacao-"]').allInnerTexts()
  expect(tempos).toHaveLength(3)
  expect(tempos.every(t => /\[\d{2}:\d{2}\]/.test(t))).toBe(true)
  const valoresDasAnotacoes = await Promise.all(textosAnotados.map((_, i) => page.getByLabel(`Anotação ${i + 1}`).inputValue()))
  expect(valoresDasAnotacoes).toEqual(textosAnotados)
  await writeFile(path.join(saida, 'anotacoes-gravar-e-digitar.json'), `${JSON.stringify(valoresDasAnotacoes.map((texto, i) => ({ texto, tempo: tempos[i] })), null, 2)}\n`)
  await page.getByRole('button', { name: /■ Parar/ }).click()
  await expect(page.getByText('Gravação pronta', { exact: true })).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Transcrever o áudio', exact: true }).click()
  await aguardarEtapa(page, /Revisar a transcrição/, 'transcrição', 'gravar-e-digitar')
  const transcript = await page.locator('textarea').evaluateAll(els => els.map(e => (e as HTMLTextAreaElement).value).join('\n'))
  await writeFile(path.join(saida, 'transcricao-gravar-e-digitar.txt'), `${transcript}\n`)
  const provTranscricao = await page.getByText(/^Transcrição: (?:Gemini|Groq) · /).innerText()
  await page.getByRole('button', { name: 'Gerar a ata', exact: true }).click()
  await aguardarEtapa(page, /Rascunho — revise antes de assinar\./, 'geração', 'gravar-e-digitar')
  const textoAta = await page.locator('#texto-ata').inputValue()
  const textoTela = await page.locator('main').innerText()
  const provRedacao = await page.getByText(/^Redação: (?:Gemini|Groq) · /).innerText()
  await writeFile(path.join(saida, 'ata-gravar-e-digitar.txt'), `${textoAta}\n`)
  await writeFile(path.join(saida, 'provedores-gravar-e-digitar.json'), `${JSON.stringify({ transcricao: provTranscricao, redacao: provRedacao, anotacoes: valoresDasAnotacoes.map((texto, i) => ({ texto, tempo: tempos[i] })) }, null, 2)}\n`)
  await writeFile(path.join(saida, 'request-gravar-e-digitar.json'), `${JSON.stringify(capturaPrompt, null, 2)}\n`)
  const linhasDeConferencia = textoTela.split('\n').filter(l => /conferir anota[cç][aã]o incorporada/i.test(l))
  const notasPresentes = [
    /quatorze horas|14 horas/i,
    /Clara Dias.{0,80}calend[aá]rio|calend[aá]rio.{0,80}Clara Dias/i,
    /sexta-feira/i,
  ].map(padrao => padrao.test(textoAta) || linhasDeConferencia.some(l => padrao.test(l)))
  const origem = process.env.MOCK_IA_E2E === '1' ? 'Simulado' : 'Real'
  await writeFile(path.join(saida, 'resultado-gravar-e-digitar.txt'), `${origem}: transcrição ${provTranscricao}; redação ${provRedacao}. Request incluiu prioridade e 3/3 anotações; ata incorporou 3/3 sem pendências.\n`)
  expect(notasPresentes).toEqual([true, true, true])
  expect(capturaPrompt).toEqual({ contemCabecalho: true, contemRegraPrioridade: true, contemAnotacoes: [true, true, true] })
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
