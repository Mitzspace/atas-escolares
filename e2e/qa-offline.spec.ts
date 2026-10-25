import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const saida = path.resolve('e2e/saida')

async function abrir(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Atas de reunião' })).toBeVisible()
}

async function navegarNovaAta(page: Page) {
  await page.getByRole('button', { name: /Nova ata/ }).click()
  await expect(page.getByRole('heading', { name: 'Que tipo de ata?' })).toBeVisible()
}

test('configurações de escola, equipe e assunto próprio persistem após recarregar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await abrir(page)
  await page.getByLabel('Navegação principal').getByRole('link', { name: 'Configurações' }).click()
  await page.getByLabel('Nome da escola').fill('Escola QA Local')
  await page.getByLabel('Rede').fill('Secretaria Municipal de Educação')
  await page.getByLabel('Município/UF').fill('Campinas/SP')
  const pessoas = [
    ['Joana Alves', 'Coordenadora Pedagógica'],
    ['Carlos Mendes', 'Professor de Matemática'],
    ['Clara Dias', 'Professora de Ciências'],
  ]
  for (let i = 0; i < pessoas.length; i++) {
    await page.getByRole('button', { name: /Adicionar pessoa/ }).click()
    await page.getByLabel(`Nome da pessoa ${i + 1}`).fill(pessoas[i][0])
    await page.getByLabel(`Cargo da pessoa ${i + 1}`).fill(pessoas[i][1])
  }
  const pais = page.locator('details').filter({ hasText: 'Pais e responsáveis' })
  await pais.locator('summary').click()
  await pais.getByLabel('Novo assunto de Pais e responsáveis').fill('Assunto próprio QA')
  await pais.getByRole('button', { name: 'Adicionar' }).click()
  await page.getByRole('button', { name: 'Salvar' }).click()
  await expect(page.getByRole('status')).toContainText('Configurações salvas')
  await page.reload()
  await expect(page.getByLabel('Nome da escola')).toHaveValue('Escola QA Local')
  await expect(page.getByLabel('Nome da pessoa 3')).toHaveValue('Clara Dias')
  await pais.locator('summary').click()
  await expect(pais.getByText('Assunto próprio QA')).toBeVisible()
})

test('Nova ata sem escola configurada explica como corrigir', async ({ page }) => {
  await abrir(page)
  await page.getByLabel('Navegação principal').getByRole('link', { name: 'Configurações' }).click()
  await page.getByLabel('Nome da escola').fill('')
  await page.getByRole('button', { name: 'Salvar' }).click()
  await page.getByRole('link', { name: 'Início' }).click()
  await page.getByRole('button', { name: /Nova ata/ }).click()
  await page.getByRole('button', { name: /Reunião pedagógica/ }).click()
  await expect(page.getByText('Falta o nome da escola.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Preencher em Configurações' })).toBeVisible()
})

test('arquivo que não é áudio é recusado antes de iniciar o processamento', async ({ page }) => {
  await abrir(page)
  await page.getByLabel('Navegação principal').getByRole('link', { name: 'Configurações' }).click()
  await page.getByLabel('Nome da escola').fill('Escola QA Local')
  await page.getByRole('button', { name: 'Salvar' }).click()
  await page.getByLabel('Navegação principal').getByRole('link', { name: 'Início' }).click()
  await navegarNovaAta(page)
  await page.getByRole('button', { name: /Reunião pedagógica/ }).click()
  await page.getByRole('button', { name: 'Enviar arquivo' }).click()
  const arquivo = page.locator('input[type=file]')
  await arquivo.setInputFiles({ name: 'nao-e-audio.txt', mimeType: 'text/plain', buffer: Buffer.from('texto') })
  await page.locator('#Presidiu-nome').fill('Maria Souza')
  await page.locator('#Lavrou-nome').fill('Paulo Reis')
  await page.locator('#horaInicio').fill('14:00')
  await page.getByRole('button', { name: 'Transcrever o áudio' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('alert')).not.toContainText('Cadastre o nome da escola')
  await expect(page).not.toHaveURL(/processando/)
})

test('chave deliberadamente inválida apresenta erro legível sem persistir', async ({ page }) => {
  test.setTimeout(60_000)
  await abrir(page)
  await page.getByLabel('Navegação principal').getByRole('link', { name: 'Configurações' }).click()
  await page.getByLabel('Chave da API').fill('chave-invalida-qa-sem-credencial')
  await page.getByRole('button', { name: 'Testar a chave' }).click()
  await expect(page.getByRole('status')).toBeVisible({ timeout: 55_000 })
  await expect(page.getByRole('status')).not.toContainText('Chave funcionando')
  await expect(page.getByRole('status')).not.toBeEmpty()
  await page.reload()
  await expect(page.getByLabel('Chave da API')).toHaveValue('')
})

test('captura telas iniciais em celular e desktop e mede possíveis cortes/rolagem', async ({ page }) => {
  fs.mkdirSync(saida, { recursive: true })
  const avisos: string[] = []
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport)
    await abrir(page)
    await page.screenshot({ path: path.join(saida, `inicio-${viewport.width}.png`), fullPage: true })
    const dimensoesInicio = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }))
    if (dimensoesInicio.doc > dimensoesInicio.viewport) avisos.push(`Início ${viewport.width}: rolagem horizontal (${dimensoesInicio.doc}/${dimensoesInicio.viewport}).`)
    await page.getByLabel('Navegação principal').getByRole('link', { name: 'Configurações' }).click()
    await page.screenshot({ path: path.join(saida, `configuracoes-${viewport.width}.png`), fullPage: true })
    await page.getByRole('link', { name: 'Início' }).click()
    await navegarNovaAta(page)
    await page.screenshot({ path: path.join(saida, `nova-ata-tipos-${viewport.width}.png`), fullPage: true })
    const cortes = await page.locator('button, a').evaluateAll(els => els.flatMap(el => {
      const r = el.getBoundingClientRect()
      const s = getComputedStyle(el)
      return !el.classList.contains('sr-only') && r.width && (r.right > innerWidth || r.left < 0 || r.height < 44 && (el.textContent?.trim() || s.backgroundColor !== 'rgba(0, 0, 0, 0)'))
        ? [`${el.tagName.toLowerCase()} “${el.textContent?.trim().slice(0, 50)}” ${Math.round(r.width)}x${Math.round(r.height)}`] : []
    }))
    if (cortes.length) avisos.push(`Nova ata ${viewport.width}: controles fora da área ou abaixo de 44 px: ${cortes.join('; ')}`)
  }
  fs.writeFileSync(path.join(saida, 'inspecao-visual.txt'), avisos.length ? avisos.join('\n') : 'Sem rolagem horizontal ou controles detectados abaixo de 44 px nas telas capturadas.')
})
