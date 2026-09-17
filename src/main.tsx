import { StrictMode } from 'react'
import { installPolyfills } from './lib/polyfills'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import './styles.css'

// Antes de nada: pdf.js necesita APIs que faltan en iOS sin actualizar.
installPolyfills()

registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
