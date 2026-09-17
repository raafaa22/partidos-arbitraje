/**
 * Lo que le falta a los iPhone que no están al día.
 *
 * pdf.js usa APIs recientes y en iOS TODOS los navegadores (Chrome incluido)
 * corren sobre el motor de Safari, asi que la version del sistema manda: un
 * iPhone sin actualizar tumba la lectura de PDF con un "undefined is not a
 * function" que no dice de que.
 */

interface Resolvers<T> {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
}

export function installPolyfills(): void {
  // Safari 17.4+ / iOS 17.4+. Se mira sin tipos: el proyecto compila contra
  // ES2022, donde este metodo todavia no existe.
  const PromiseCtor = Promise as unknown as { withResolvers?: unknown }
  if (typeof PromiseCtor.withResolvers !== 'function') {
    Object.defineProperty(Promise, 'withResolvers', {
      configurable: true,
      writable: true,
      value: function withResolvers<T>(): Resolvers<T> {
        let resolve!: Resolvers<T>['resolve']
        let reject!: Resolvers<T>['reject']
        const promise = new Promise<T>((res, rej) => {
          resolve = res
          reject = rej
        })
        return { promise, resolve, reject }
      },
    })
  }

  // Safari 15.4+. pdf.js lo usa para pasar datos al worker.
  if (typeof globalThis.structuredClone !== 'function') {
    Object.defineProperty(globalThis, 'structuredClone', {
      configurable: true,
      writable: true,
      // Sirve para lo que pide pdf.js: datos planos, sin ciclos ni funciones.
      value: (value: unknown) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value))),
    })
  }

  // Safari 16.4+. Sin esto, .at(-1) revienta al recorrer paginas.
  if (typeof Array.prototype.at !== 'function') {
    Object.defineProperty(Array.prototype, 'at', {
      configurable: true,
      writable: true,
      value: function at(this: unknown[], index: number) {
        const i = Math.trunc(index) || 0
        return this[i < 0 ? this.length + i : i]
      },
    })
  }
}
