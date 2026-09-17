import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import {
  countDemoMarks, findDesignacion, findKickoff, linesFromItems, readSettlement,
  type PlacedText, type Settlement,
} from './settlement'

export interface PdfReading extends Settlement {
  /** Texto de todas las paginas. */
  text: string
  pages: string[]
  designacion: string | null
  demoHits: number
  /** Anotaciones /Subtype /Watermark: las que estampa PD4ML sin licencia. */
  watermarks: number
  /** Fecha y hora impresas en el PDF, por si el correo no se deja leer. */
  kickoff: { date: string; time: string | null } | null
}

/** pdf.js pesa mas de un mega: se carga la primera vez que hace falta. */
async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  return pdfjs
}

export interface PdfContent {
  pages: string[]
  watermarks: number
}

export async function extractPdfPages(data: Uint8Array): Promise<PdfContent> {
  const pdfjs = await loadPdfjs()
  const doc = await pdfjs.getDocument({ data }).promise
  const pages: string[] = []
  let watermarks = 0
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const content = await page.getTextContent()
      const items: PlacedText[] = content.items.flatMap((item) => {
        if (!('str' in item) || !item.str.trim()) return []
        return [{
          x: item.transform[4] as number,
          y: item.transform[5] as number,
          width: item.width as number,
          text: item.str.replace(/\u00a0/g, ' '),
        }]
      })
      pages.push(linesFromItems(items))

      // La marca "PD4ML DEMO MODE" no esta en el texto de la pagina: va en
      // anotaciones aparte, que getTextContent no mira.
      const annotations = await page.getAnnotations()
      watermarks += annotations.filter((a) => a.subtype === 'Watermark').length

      page.cleanup()
    }
  } finally {
    await doc.destroy()
  }
  return { pages, watermarks }
}

export async function readDesignationPdf(data: Uint8Array): Promise<PdfReading> {
  const { pages, watermarks } = await extractPdfPages(data)
  const text = pages.join('\n\f\n')
  return {
    ...readSettlement(pages),
    text,
    pages,
    watermarks,
    designacion: findDesignacion(text),
    demoHits: countDemoMarks(text),
    kickoff: findKickoff(text),
  }
}
