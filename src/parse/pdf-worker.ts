/**
 * El worker de pdf.js, envuelto para parchearlo antes de arrancar.
 *
 * Un worker tiene su propio contexto global: lo que se parchea en la pagina no
 * llega aqui, y el worker de pdf.js usa `Promise.withResolvers`, que no existe
 * en los iPhone anteriores a iOS 17.4. Sin esto, leer un PDF falla ahi con un
 * "undefined is not a function" sin mas pistas.
 *
 * El import del worker de verdad es dinamico a proposito: los estaticos se
 * evaluan antes que cualquier codigo del modulo, asi que se cargaria sin el
 * parche puesto.
 */
import { installPolyfills } from '../lib/polyfills'

installPolyfills()

await import('pdfjs-dist/build/pdf.worker.min.mjs')
