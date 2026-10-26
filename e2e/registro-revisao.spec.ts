import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const saida = path.resolve('e2e/saida/registro-revisao')
test('Digitar salva e recupera rascunho, usa como está offline e exige revisão para finalizar/reabrir', async ({
  page,
  context,
}) => {
  await mkdir(saida, { recursive: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/nova')
  await page
    .getByLabel('Tipo de reunião', { exact: true })
    .selectOption('Reunião pedagógica')
  await page.getByRole('radio', { name: 'Digitar', exact: true }).check()
  const texto =
    'Maria apresentou o planejamento. Ficou decidido que o encontro será na sexta-feira.'
  await page.getByLabel('Texto da reunião', { exact: true }).fill(texto)
  await expect(
    page.getByText('Anotações salvas neste aparelho.', { exact: true }),
  ).toBeVisible()
  await expect(page).toHaveURL(/rascunho=/)
  await page.reload()
  await expect(
    page.getByLabel('Texto da reunião', { exact: true }),
  ).toHaveValue(texto)
  await page
    .getByLabel('Nome do(a) responsável', { exact: true })
    .fill('Maria Souza')
  await page.locator('#responsavel-cargo').fill('Diretora')
  await page.getByLabel('Início', { exact: true }).fill('14:00')
  await page.getByLabel('Término (opcional)').fill('15:00')
  await page
    .getByRole('textbox', { name: 'Item 1 da pauta', exact: true })
    .fill('Planejamento')
  await context.setOffline(true)
  await page
    .getByRole('button', { name: 'Usar como está', exact: true })
    .click()
  await expect(page.locator('#texto-ata')).toContainText(
    'Maria apresentou o planejamento',
  )
  await expect(
    page.getByRole('region', { name: 'Resumo da reunião' }),
  ).toContainText('Assuntos')
  await expect(
    page.getByRole('button', { name: 'Finalizar ata', exact: true }),
  ).toBeDisabled()
  await page
    .locator('#texto-ata')
    .fill(
      'Aos vinte e cinco dias, reuniram-se os presentes. [confirmar: decisão] Nada mais havendo a tratar, lavrei a presente ata.',
    )
  await page.getByLabel('Revisei a ata e confirmo que está correta').check()
  await expect(
    page.getByRole('button', { name: 'Finalizar ata', exact: true }),
  ).toBeDisabled()
  await context.setOffline(false) // Vite serve o chunk de PDF sob demanda; o PWA de produção o pré-armazena.
  await page.getByRole('button', { name: 'Imprimir / PDF' }).click()
  await expect(
    page.getByText('Rascunho — não assinar.', { exact: true }),
  ).toBeVisible()
  let download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Baixar PDF' }).click()
  await (await download).saveAs(path.join(saida, 'rascunho.pdf'))
  await page
    .getByRole('link', { name: 'Revisar e finalizar', exact: true })
    .click()
  await page
    .locator('#texto-ata')
    .fill(
      'Aos vinte e cinco dias, reuniram-se os presentes. Maria manifestou-se sobre o planejamento. Nada mais havendo a tratar, lavrei a presente ata.',
    )
  await page.getByLabel('Revisei a ata e confirmo que está correta').check()
  await page.getByRole('button', { name: 'Finalizar ata', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Reabrir para correção', exact: true }),
  ).toBeVisible()
  await expect(page.locator('#texto-ata')).toHaveAttribute('readonly', '')
  await page.getByRole('button', { name: 'Imprimir / PDF' }).click()
  await expect(
    page.getByText('Rascunho — não assinar.', { exact: true }),
  ).toHaveCount(0)
  download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Baixar PDF' }).click()
  await (await download).saveAs(path.join(saida, 'finalizada.pdf'))
  await page.getByRole('link', { name: '← Voltar para editar a ata' }).click()
  await page
    .getByRole('button', { name: 'Reabrir para correção', exact: true })
    .click()
  await expect(page.locator('#texto-ata')).not.toHaveAttribute('readonly', '')
  await expect(
    page.getByText('Reaberta para correção em:', { exact: false }),
  ).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
})

test('cadastro v2 aceita tipo digitado, cadastro de cargo e participante sem cargo', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/nova')
  await page
    .getByLabel('Tipo de reunião', { exact: true })
    .selectOption('Outro (digitar)')
  await page.getByLabel('Digite o tipo de reunião').fill('Conselho de classe')
  await page.locator('#responsavel-cargo').fill('Gestora escolar')
  await page
    .getByRole('button', { name: /Cadastrar novo nome ou cargo/ })
    .click()
  await expect(
    page.getByText('Nome ou cargo cadastrado para as próximas atas.'),
  ).toBeVisible()
  await page
    .getByLabel('Nome do(a) responsável', { exact: true })
    .fill('Maria Souza')
  await page.getByRole('button', { name: /Adicionar participante/ }).click()
  await page.getByLabel('Nome do participante 1').fill('Carlos Mendes')
  await expect(page.getByLabel('Cargo do participante 1')).toHaveValue('')
  await expect(
    page.getByLabel('Reunião ordinária', { exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByLabel('Presidiu a reunião', { exact: true }),
  ).toHaveCount(0)
  await page.getByLabel('Início', { exact: true }).fill('14:00')
  await page.getByLabel('Término (opcional)').fill('15:00')
  await page.getByRole('radio', { name: 'Digitar', exact: true }).check()
  await page
    .getByLabel('Texto da reunião', { exact: true })
    .fill('Carlos Mendes apresentou as observações do conselho de classe.')
  await page.getByRole('button', { name: 'Continuar', exact: true }).click()
  await page
    .getByRole('button', { name: 'Usar como está', exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: /CONSELHO DE CLASSE/ }),
  ).toBeVisible()
  await expect(page.locator('#texto-ata')).not.toHaveValue(/sob a presidência/)
  await expect(page.locator('#texto-ata')).toHaveValue(/Maria Souza/)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
})
