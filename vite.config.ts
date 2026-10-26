/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['logo-escola.svg', 'marca/ata-inteligente.webp', 'marca/ata-inteligente.png', 'marca/ata-inteligente-compacta.webp', 'marca/ata-inteligente-compacta.png'],
      manifest: {
        name: 'Ata Inteligente',
        short_name: 'Ata Inteligente',
        description: 'Gera atas de reunião escolar a partir de áudio.',
        lang: 'pt-BR',
        theme_color: '#012c61',
        background_color: '#f8fafc',
        display: 'standalone',
        start_url: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: { maximumFileSizeToCacheInBytes: 6 * 1024 * 1024 },
    }),
  ],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
