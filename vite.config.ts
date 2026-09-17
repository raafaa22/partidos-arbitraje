import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// El repo se publica en https://raafaa22.github.io/partidos-arbitraje/
const BASE = '/partidos-arbitraje/'

export default defineConfig({
  base: BASE,
  // Se inyecta la hora de compilación para poder ver desde Ajustes si el
  // navegador está ejecutando una versión vieja.
  define: {
    __BUILD__: JSON.stringify(
      new Date().toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
    ),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png'],
      manifest: {
        name: 'Partidos Arbitraje',
        short_name: 'Partidos',
        description: 'Control de partidos arbitrados y pendientes de cobro',
        lang: 'es',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0f1511',
        theme_color: '#0f1511',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // El worker de pdf.js es grande; hay que subir el limite por defecto (2 MiB).
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,png,svg,woff2,mjs}'],
        navigateFallback: BASE + 'index.html',
        // Nada de Google se cachea: ni la API de Gmail ni el script de login.
        navigateFallbackDenylist: [/^\/gmail/, /accounts\.google\.com/],
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.hostname.endsWith('googleapis.com') || url.hostname.endsWith('google.com'),
            handler: 'NetworkOnly',
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
})
