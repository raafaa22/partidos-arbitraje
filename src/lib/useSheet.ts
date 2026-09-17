import { useEffect } from 'react'

/**
 * Comportamiento de las hojas modales: se cierran con Escape y bloquean el
 * desplazamiento de la pagina de detras, que en movil se cuela por debajo.
 */
export function useSheet(onClose: () => void): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])
}
