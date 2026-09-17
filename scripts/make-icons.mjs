// Genera los iconos de la PWA sin dependencias: un campo de futbol dibujado a mano.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'

const GREEN = [0x14, 0x35, 0x1f]
const LINE = [0xff, 0xff, 0xff]
const SS = 3 // supermuestreo para que los bordes no queden dentados

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function png(width, height, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bits por canal
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * Pinta el campo en coordenadas normalizadas 0..1. `pad` deja margen para los
 * iconos maskable de Android, que recortan los bordes.
 */
function pitch(u, v, pad) {
  const inset = 0.5 - (0.5 - pad) * 0.92
  const left = inset, right = 1 - inset, top = inset + 0.06, bottom = 1 - inset - 0.06
  const w = 0.016
  const near = (value, target) => Math.abs(value - target) < w

  if (u < left - w || u > right + w || v < top - w || v > bottom + w) return null
  // Banda exterior
  if (near(u, left) || near(u, right) || near(v, top) || near(v, bottom)) return LINE
  // Linea de medio campo
  if (near(v, (top + bottom) / 2)) return LINE
  // Circulo central
  const cx = (left + right) / 2, cy = (top + bottom) / 2
  const r = Math.hypot(u - cx, (v - cy) * 1.0)
  if (Math.abs(r - (right - left) * 0.17) < w) return LINE
  // Areas
  const areaW = (right - left) * 0.42
  const areaH = (bottom - top) * 0.13
  for (const side of [top, bottom]) {
    const edge = side === top ? top + areaH : bottom - areaH
    const inX = u > cx - areaW / 2 - w && u < cx + areaW / 2 + w
    const inY = side === top ? v < edge + w && v > top : v > edge - w && v < bottom
    if (inX && inY && (near(u, cx - areaW / 2) || near(u, cx + areaW / 2) || near(v, edge))) {
      return LINE
    }
  }
  return GREEN
}

function render(size, pad) {
  const big = size * SS
  const acc = new Float32Array(size * size * 4)
  for (let y = 0; y < big; y++) {
    for (let x = 0; x < big; x++) {
      const color = pitch((x + 0.5) / big, (y + 0.5) / big, pad)
      const i = (Math.floor(y / SS) * size + Math.floor(x / SS)) * 4
      const [r, g, b] = color ?? GREEN
      acc[i] += r; acc[i + 1] += g; acc[i + 2] += b; acc[i + 3] += 255
    }
  }
  const out = Buffer.alloc(size * size * 4)
  const n = SS * SS
  for (let i = 0; i < out.length; i++) out[i] = Math.round(acc[i] / n)
  return png(size, size, out)
}

mkdirSync('public/icons', { recursive: true })
const files = [
  ['public/icons/icon-192.png', 192, 0.06],
  ['public/icons/icon-512.png', 512, 0.06],
  ['public/icons/icon-512-maskable.png', 512, 0.18],
  ['public/icons/apple-touch-icon.png', 180, 0.06],
]
for (const [path, size, pad] of files) {
  writeFileSync(path, render(size, pad))
  console.log('escrito', path)
}
