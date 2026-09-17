/** Marca de compilación que inyecta Vite; se enseña en Ajustes para poder ver
 *  si el navegador está ejecutando una versión vieja. */
declare const __BUILD__: string

/** El worker de pdf.js no trae tipos: solo se importa por su efecto. */
declare module 'pdfjs-dist/build/pdf.worker.min.mjs'

/** Los workers envueltos por Vite se importan como URL. */
declare module '*?worker&url' {
  const url: string
  export default url
}
