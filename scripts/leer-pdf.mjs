// Herramienta de diagnostico: lee un PDF de liquidacion desde el disco y enseña
// el texto que extrae la app y el importe que deduce. Sirve para comprobar un
// formato nuevo sin tener que pasar por Gmail.
//
//   node scripts/leer-pdf.mjs muestras/1968465_30858756.pdf
//   node scripts/leer-pdf.mjs muestras/demo.pdf --texto --cambiada
//
// --cambiada simula que el correo era de los de "Su designación ha sido
// cambiada", que es la segunda condición para considerar el partido una demo.

import { readFileSync } from 'node:fs'
import { loadSettlement } from './_bundle.mjs'

const [path, ...flags] = process.argv.slice(2)
if (!path) {
  console.error('Uso: node scripts/leer-pdf.mjs <fichero.pdf> [--texto] [--cambiada]')
  process.exit(1)
}

const { linesFromItems, readSettlement, countDemoMarks, findDesignacion, isDemoPdf, demoReason } =
  await loadSettlement()
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')

const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)) }).promise
const pages = []
let watermarks = 0
for (let n = 1; n <= doc.numPages; n++) {
  const page = await doc.getPage(n)
  const annotations = await page.getAnnotations()
  watermarks += annotations.filter((a) => a.subtype === 'Watermark').length
  const content = await page.getTextContent()
  pages.push(
    linesFromItems(
      content.items
        .filter((item) => 'str' in item && item.str.trim())
        .map((item) => ({
          x: item.transform[4],
          y: item.transform[5],
          width: item.width,
          text: item.str.replace(/ /g, ' '),
        })),
    ),
  )
}
await doc.destroy()

const text = pages.join('\n\f\n')
const settlement = readSettlement(pages)

if (flags.includes('--texto')) {
  pages.forEach((page, index) => {
    console.log(`\n=========== PÁGINA ${index + 1} ===========`)
    console.log(page)
  })
  console.log()
}

const signs = { watermarks, demoHits: countDemoMarks(text), changed: flags.includes('--cambiada') }
const esDemo = isDemoPdf(signs, 2)

console.log('Páginas:      ', pages.length)
console.log('Designación:  ', findDesignacion(text) ?? '—')
console.log('Marcas agua:  ', watermarks)
console.log('¿Es demo?:    ', esDemo ? 'SÍ — no cuenta para el total' : 'no, partido real')
console.log('Motivo:       ', demoReason(signs, 2))
console.log('Importe:      ', settlement.amount ?? '— no encontrado')
console.log('Procedencia:  ', settlement.amountSource)
if (settlement.breakdown.length) {
  console.log('Desglose:')
  for (const row of settlement.breakdown) console.log('  ', row.label, '->', row.value)
}
