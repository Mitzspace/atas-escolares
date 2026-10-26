import { expect, test } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const escola = 'Escola Municipal Professora Luiza Maria de Souza'
const saida = path.resolve('e2e/saida/identidade-escola')

test('identidade padrão, troca e restauração da logo no backup e no PDF, em celular', async ({ page }) => {
  await mkdir(saida, { recursive: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.locator('header').getByText(escola, { exact: true })).toBeVisible()
  await expect(page.locator('header img')).toHaveAttribute('src', /ata-inteligente-compacta.png$/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: path.join(saida, 'inicio-390.png') })
  await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Configurações' }).click()
  await expect(page.getByLabel('Nome da escola')).toHaveValue(escola)
  await expect(page.getByRole('heading', { name: 'Identidade da escola' })).toBeVisible()
  await page.getByRole('heading', { name: 'Identidade da escola' }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(saida, 'configuracoes-390.png') })
  await page.evaluate(async escola => {
    await new Promise<void>((resolve, reject) => {
      const pedido = indexedDB.open('atas-escolares')
      pedido.onsuccess = () => {
        const db = pedido.result, tx = db.transaction('atas', 'readwrite')
        const pessoa = { nome: 'Maria Souza', cargo: 'diretora' }
        const texto = 'Aos vinte e cinco dias do mês de outubro do ano de dois mil e vinte e seis, às quatorze horas, reuniram-se na sala dos professores os participantes da reunião pedagógica. Maria Souza apresentou a pauta e os presentes registraram as observações sobre o planejamento escolar. Nada mais havendo a tratar, a presidente encerrou a reunião e lavrou a presente ata, que será assinada pelos presentes.'
        tx.objectStore('atas').put({ id: 'identidade', criadaEm: 1, atualizadaEm: 1, status: 'ata',
          meta: { escola, rede: 'Rede Municipal', municipioUf: 'Município/SP', tipo: 'pedagogica', ordinaria: true, numero: 1, ano: 2026,
            data: '2026-10-25', horaInicio: '14:00', local: 'sala dos professores', presidente: pessoa, secretario: pessoa,
            participantes: [{ ...pessoa, presente: true }], pauta: ['Planejamento escolar'], anonimizarAlunos: true },
          renderizada: { titulo: 'ATA Nº 1/2026 – REUNIÃO PEDAGÓGICA', cabecalho: [escola, 'Rede Municipal', 'Município/SP'], texto, assinaturas: [pessoa], pendencias: [] },
        })
        tx.oncomplete = () => { db.close(); resolve() }
        tx.onerror = () => reject(tx.error)
      }
    })
  }, escola)
  await page.evaluate(() => { location.hash = '/ata/identidade/imprimir' })
  await expect(page.getByRole('button', { name: 'Baixar PDF' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Logo da escola na impressão' })).toBeVisible()
  await page.screenshot({ path: path.join(saida, 'imprimir-390.png') })
  let downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Baixar PDF' }).click()
  await (await downloadPromise).saveAs(path.join(saida, 'ata-logo-padrao.pdf'))
  await page.getByRole('link', { name: 'Configurações', exact: true }).click()
  await page.getByLabel('Arquivo da logo').setInputFiles({ name: 'grande.png', mimeType: 'image/png', buffer: Buffer.alloc(1_000_001) })
  await expect(page.getByRole('alert')).toContainText('até 1 MB')
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"><rect width="1200" height="600" fill="white"/><path d="M100 450V150h150v300Zm300 0V150h300v300Z" fill="#172d49"/><circle cx="950" cy="300" r="150" fill="#b68a35"/></svg>'
  await page.getByLabel('Arquivo da logo').setInputFiles({ name: 'personalizada.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) })
  await expect(page.getByText('Logo salva neste aparelho.', { exact: true })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Logo da escola', exact: true })).toHaveAttribute('src', /^data:image\/png;base64,/)
  const imagem = await page.getByRole('img', { name: 'Logo da escola', exact: true }).evaluate(async (img: HTMLImageElement) => {
    await img.decode(); return { largura: img.naturalWidth, altura: img.naturalHeight, url: img.src }
  })
  expect([imagem.largura, imagem.altura]).toEqual([512, 256])
  downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Salvar backup', exact: true }).click()
  const backup = await downloadPromise
  const conteudo = await readFile((await backup.path())!, 'utf8')
  expect(JSON.parse(conteudo).configuracoes.logoEscola).toBe(imagem.url)
  await page.getByRole('button', { name: 'Voltar à logo padrão' }).click()
  await expect(page.getByRole('img', { name: 'Logo da escola', exact: true })).toHaveAttribute('src', /logo-escola.svg$/)
  await expect(page.locator('header img')).toHaveAttribute('src', /ata-inteligente-compacta.png$/)
  await page.getByLabel('Arquivo de backup').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(conteudo) })
  await page.getByLabel('Substituir as configurações pelas do backup').check()
  await page.getByRole('button', { name: 'Restaurar atas', exact: true }).click()
  await expect(page.getByText(/Restauração concluída/)).toBeVisible()
  await expect(page.getByRole('img', { name: 'Logo da escola', exact: true })).toHaveAttribute('src', imagem.url)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.evaluate(() => { location.hash = '/ata/identidade/imprimir' })
  await expect(page.getByRole('button', { name: 'Baixar PDF' })).toBeVisible()
  downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Baixar PDF' }).click()
  await (await downloadPromise).saveAs(path.join(saida, 'ata-logo-personalizada.pdf'))
})
