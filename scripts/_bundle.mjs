// Compila un modulo TypeScript del navegador a memoria para poder ejecutarlo
// desde Node sin duplicar la logica ni montar un runner de tests.
import { build } from 'esbuild'

export async function loadModule(entry) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    write: false,
  })
  const code = result.outputFiles[0].text
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
}

export const loadSettlement = () => loadModule('src/parse/settlement.ts')
export const loadEmail = () => loadModule('src/parse/email.ts')
