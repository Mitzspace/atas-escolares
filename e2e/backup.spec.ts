import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('backup e restauração completos funcionam offline sem chaves nem áudios', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Atas de reunião' })).toBeVisible()
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const pedido = indexedDB.open('atas-escolares')
      pedido.onerror = () => reject(pedido.error)
      pedido.onsuccess = () => {
        const db = pedido.result
        const tx = db.transaction(['atas', 'settings', 'audios', 'pedacosGravacao'], 'readwrite')
        const meta = {
          escola: 'Escola do backup offline', rede: 'Municipal', municipioUf: 'Campinas/SP', tipo: 'pedagogica', ordinaria: true,
          numero: 7, ano: 2026, data: '2026-10-25', horaInicio: '14:00', local: 'Sala',
          presidente: { nome: 'Maria', cargo: 'diretora' }, secretario: { nome: 'Clara', cargo: 'professora' },
          participantes: [{ nome: 'Clara', cargo: 'professora', presente: false }], pauta: ['Projeto da escola'], anonimizarAlunos: true,
        }
        tx.objectStore('settings').put({ id: 'main', value: { escola: meta.escola, pessoas: [meta.presidente],
          assuntosExtras: { pedagogica: ['Projeto da escola'] }, apiKey: 'gemini-ficticia-nunca-enviar', groqApiKey: 'groq-ficticia-nunca-enviar' } })
        for (const id of ['backup-a', 'backup-b']) tx.objectStore('atas').put({
          id, criadaEm: 100, atualizadaEm: 200, status: 'ata', meta: { ...meta, numero: id === 'backup-a' ? 7 : 8 },
          transcript: [{ speaker: 'Clara', start: '00:00', end: '00:10', text: 'Fala revisada.' }],
          renderizada: { titulo: 'Ata', texto: 'Texto original.', cabecalho: ['Escola'], assinaturas: [meta.presidente], pendencias: [] },
          textoEditado: 'Texto editado offline.', convocados: ['clara'],
          provedorTranscricao: 'groq', modeloTranscricao: 'whisper-large-v3', provedorRedacao: 'gemini', modeloRedacao: 'gemini-3.8-flash',
        })
        tx.objectStore('audios').put({ id: 'backup-a', blob: new Blob(['áudio não exportar']), nome: 'audio.mp3', mimeType: 'audio/mp3' })
        tx.objectStore('pedacosGravacao').put({ sessaoId: 's', seq: 0, blob: new Blob(['pedaço não exportar']) })
        tx.oncomplete = () => { db.close(); resolve() }
        tx.onerror = () => { db.close(); reject(tx.error) }
      }
    })
  })
  // Todos os módulos da aplicação já estão carregados. A partir daqui não há conexão.
  await context.setOffline(true)
  await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Configurações', exact: true }).click()
  await expect(page.getByLabel('incluir as chaves de API (guarde o arquivo em local seguro)')).not.toBeChecked()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Salvar backup', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^atas-escolares-backup-\d{4}-\d{2}-\d{2}\.json$/)
  const texto = await readFile((await download.path())!, 'utf8')
  const dados = JSON.parse(texto)
  expect(dados.atas).toHaveLength(2)
  expect(dados.configuracoes).not.toHaveProperty('apiKey')
  expect(dados.configuracoes).not.toHaveProperty('groqApiKey')
  expect(texto).not.toMatch(/ficticia|não exportar/)
  expect(dados).not.toHaveProperty('audios')
  await expect(page.getByText('Último backup:', { exact: false })).toBeVisible()
  await page.getByRole('link', { name: 'Início', exact: true }).click()
  await expect(page.getByRole('complementary', { name: 'Lembrete de backup' })).toHaveCount(0)
  await expect(page.getByText('Ata nº 7/2026')).toBeVisible()
  // Limpa todos os registros do IndexedDB, incluindo as configurações e mídias.
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const pedido = indexedDB.open('atas-escolares')
      pedido.onsuccess = () => {
        const db = pedido.result
        const tx = db.transaction([...db.objectStoreNames], 'readwrite')
        for (const nome of db.objectStoreNames) tx.objectStore(nome).clear()
        tx.oncomplete = () => { db.close(); resolve() }
        tx.onerror = () => reject(tx.error)
      }
    })
  })
  await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Configurações', exact: true }).click()
  await page.getByLabel('Arquivo de backup').setInputFiles({ name: download.suggestedFilename(), mimeType: 'application/json', buffer: Buffer.from(texto) })
  await expect(page.locator('#backup').getByRole('status')).toContainText('2 atas')
  await expect(page.locator('#backup').getByRole('status')).toContainText('Escola do backup offline')
  await page.getByLabel('Substituir as configurações pelas do backup', { exact: true }).check()
  await page.getByRole('button', { name: 'Restaurar atas', exact: true }).click()
  await expect(page.getByText(/Restauração concluída: 2 atas importadas/)).toBeVisible()
  await expect(page.getByLabel('Nome da escola')).toHaveValue('Escola do backup offline')
  await page.getByRole('link', { name: 'Início', exact: true }).click()
  await expect(page.getByText('Ata nº 7/2026')).toBeVisible()
  await expect(page.getByText('Ata nº 8/2026')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Fazer backup agora' })).toBeVisible()
  const restaurado = await page.evaluate(async () => new Promise<{ atas: unknown[]; configuracoes: unknown; audios: number; pedacos: number }>((resolve, reject) => {
    const pedido = indexedDB.open('atas-escolares')
    pedido.onsuccess = () => {
      const db = pedido.result
      const tx = db.transaction(['atas', 'settings', 'audios', 'pedacosGravacao'], 'readonly')
      const atas = tx.objectStore('atas').getAll(), settings = tx.objectStore('settings').get('main')
      const audios = tx.objectStore('audios').count(), pedacos = tx.objectStore('pedacosGravacao').count()
      tx.oncomplete = () => { db.close(); resolve({ atas: atas.result, configuracoes: settings.result.value, audios: audios.result, pedacos: pedacos.result }) }
      tx.onerror = () => reject(tx.error)
    }
  }))
  expect(restaurado.atas).toEqual(dados.atas)
  expect(restaurado.configuracoes).toMatchObject({ escola: 'Escola do backup offline', apiKey: '', groqApiKey: '', pessoas: dados.configuracoes.pessoas })
  expect(restaurado.audios).toBe(0)
  expect(restaurado.pedacos).toBe(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
