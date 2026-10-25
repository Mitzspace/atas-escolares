import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

test.use({ viewport: { width: 390, height: 844 }, trace: 'off', video: 'off', screenshot: 'off' })
const saida = path.resolve('e2e/saida')
const audioLongo = '/home/william/audio-teste-ata/longo-40min.mp3'

test('áudio acima de 25 MB sem Gemini é dividido localmente em quatro partes com tempos absolutos', async ({ page }) => {
  test.setTimeout(10 * 60_000)
  page.setDefaultTimeout(9 * 60_000)
  fs.mkdirSync(saida, { recursive: true })
  const chamadas: number[] = []
  let chamadasGemini = 0
  await page.route('https://api.groq.com/openai/v1/audio/transcriptions', async route => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: {
        'access-control-allow-origin': 'http://127.0.0.1:4179',
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'authorization,content-type',
      } })
      return
    }
    chamadas.push(Date.now())
    await route.fulfill({ status: 200, headers: {
      'access-control-allow-origin': 'http://127.0.0.1:4179',
      'content-type': 'application/json',
    }, body: JSON.stringify({ segments: [{ start: 1, end: 2, text: `Fala simulada da parte ${chamadas.length}.` }] }) })
  })
  await page.route('https://generativelanguage.googleapis.com/**', async route => {
    chamadasGemini++
    await route.abort()
  })

  const stat = fs.statSync(audioLongo)
  expect(stat.size).toBeGreaterThan(25_000_000)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Atas de reunião' })).toBeVisible()
  await page.getByLabel('Navegação principal').getByRole('link', { name: 'Configurações' }).click()
  await page.getByLabel('Provedor preferido para transcrever').selectOption('groq')
  await page.getByLabel('Provedor preferido para redigir').selectOption('groq')
  await page.getByLabel('Chave do Groq').fill('chave-falsa-interceptada-no-playwright')
  await page.getByLabel('Chave do Gemini (opcional)').fill('')
  await page.getByLabel('Nome da escola').fill('Escola QA Local')
  await page.getByLabel('Rede').fill('Secretaria Municipal de Educação')
  await page.getByLabel('Município/UF').fill('Campinas/SP')
  await page.getByRole('button', { name: 'Salvar' }).click()
  await expect(page.getByRole('status')).toContainText('Configurações salvas')
  await page.reload()
  await expect(page.getByLabel('Provedor preferido para transcrever')).toHaveValue('groq')
  await expect(page.getByLabel('Provedor preferido para redigir')).toHaveValue('groq')
  expect(await page.getByLabel('Chave do Gemini (opcional)').evaluate(el => (el as HTMLInputElement).value.length)).toBe(0)
  await page.getByLabel('Navegação principal').getByRole('link', { name: 'Início' }).click()

  await page.getByRole('button', { name: /Nova ata/ }).click()
  await expect(page.getByRole('heading', { name: 'Que tipo de ata?' })).toBeVisible()
  await page.getByRole('button', { name: /Reunião pedagógica/ }).click()
  await expect(page.getByRole('heading', { name: /^Nova ata/ })).toBeVisible()
  await page.locator('#data').fill('2026-10-20')
  await page.locator('#horaInicio').fill('14:00')
  await page.locator('#local').fill('sala dos professores')
  await page.locator('#Presidiu-nome').fill('Maria Souza')
  await page.locator('#Presidiu-cargo').fill('Diretora')
  await page.locator('#Lavrou-nome').fill('Paulo Reis')
  await page.locator('#Lavrou-cargo').fill('Secretário')
  await page.getByLabel('Item 1 da pauta').fill('Teste de divisão local do áudio')
  await page.getByRole('button', { name: 'Enviar arquivo' }).click()
  await page.getByLabel('Arquivo de áudio da reunião').setInputFiles(audioLongo)
  await page.getByRole('button', { name: 'Transcrever o áudio' }).click()
  await expect(page.getByRole('heading', { name: 'Transcrevendo o áudio' })).toBeVisible()
  await expect(page.getByText(/Transcrevendo parte 2 de 4 com Whisper/)).toBeVisible({ timeout: 120_000 })
  await expect(page.getByRole('heading', { name: 'Revisar a transcrição' })).toBeVisible({ timeout: 8 * 60_000 })
  await expect(page.getByText(/^Transcrição: Groq · whisper-large-v3$/)).toBeVisible()
  await expect(page.getByText(/Whisper n[aã]o separa falantes/)).toBeVisible()
  expect(chamadas).toHaveLength(4)
  expect(chamadasGemini).toBe(0)
  const trechos = page.locator('ul li.card')
  await expect(trechos).toHaveCount(4)
  const tempos = await trechos.evaluateAll(items => items.map(item => item.querySelector('div span')?.textContent ?? ''))
  expect(tempos[0]).toContain('00:01–00:02')
  expect(tempos[1]).toContain('10:01–10:02')
  expect(tempos[2]).toContain('20:01–20:02')
  expect(tempos[3]).toContain('30:01–30:02')
  const textos = await page.locator('textarea').evaluateAll(items => items.map(item => (item as HTMLTextAreaElement).value))
  expect(textos).toEqual([
    'Fala simulada da parte 1.',
    'Fala simulada da parte 2.',
    'Fala simulada da parte 3.',
    'Fala simulada da parte 4.',
  ])
  fs.writeFileSync(path.join(saida, 'transcricao-local-sem-gemini.json'), `${JSON.stringify({ chamadasWhisperFalsas: chamadas.length, chamadasGemini: chamadasGemini, tempos, textos }, null, 2)}\n`)
})
