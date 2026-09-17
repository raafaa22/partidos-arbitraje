# Partidos arbitraje

PWA para llevar la cuenta de los partidos arbitrados y del dinero que queda por
cobrar. Lee las designaciones del Comité de Árbitros directamente del correo,
saca el importe del PDF adjunto y lleva la suma de lo pendiente.

Funciona sin servidor: el navegador habla con Gmail y guarda todo en el propio
dispositivo. No hay base de datos, no hay backend y no cuesta nada.

## Cómo funciona

1. **Login** con Google, solo con permiso de lectura de Gmail (`gmail.readonly`).
2. **Búsqueda** de los correos del comité que contienen
   *"Le ha sido asignada la siguiente designación"* o
   *"Su designación ha sido cambiada"*.
3. **Lectura del PDF adjunto** con pdf.js, dentro del navegador: partido,
   fecha, equipos, competición, campo, localidad e importe.
4. **El correo completa lo que falte.**
5. **Resolución del estado final** de cada designación a partir de todos sus
   correos.
6. **Guardado local** de los partidos y de las marcas de cobrado.

### Por qué el PDF manda sobre el correo

El correo llega unas veces en texto plano y otras en HTML. Al convertir el HTML
a texto se pierden los saltos de línea y todos los campos quedan pegados en un
párrafo, así que un analizador apoyado en `Etiqueta: valor` por líneas devuelve
todo vacío: partidos sin equipos, sin localidad y sin fecha.

El PDF siempre viene con la misma forma y cuenta el partido en prosa:

```
Con fecha 05-09-2026 a las 20:00, APELLIDOS, NOMBRE actuará como ARBITRO
entre los equipos MARTOS y APEDEM de la AMISTOSO MARTOS JUVENIL.
El partido tendrá lugar en el campo Martos - CIUDAD DE MARTOS ESTADIO
MUNICIPAL de Martos.
```

De ahí salen todos los campos (`src/parse/designation.ts`). Dos detalles que
parecen tonterías y no lo son: el nombre del campo lleva su propio *"de"*
dentro (*CIUDAD **DE** MARTOS*), así que el corte con la localidad se hace por
el **último**; y los equipos llevan puntos dentro (*C.D. TUGIA*), así que no
vale cortar por puntuación.

El analizador del correo se mantiene como respaldo, y aguanta CRLF, espacios
duros y el caso del HTML aplanado.

### El importe: cuidado con qué "Total" se coge

El impreso de la RFAF trae tres páginas y dos totales distintos:

| Página | Qué es | Ejemplo |
|---|---|---|
| Designación de ARBITRO | lo que cobra el árbitro | **19,00 €** |
| Liquidación \<club\> | lo que paga el club al trío arbitral | 41,00 € |
| Liquidación gastos partido | formulario en blanco | — |

La app busca la página que encabeza *"Designación de …"* y coge el `Total` de
esa página. Si cogiera el total más alto sumaría los 22 € de los asistentes.

Si en algún PDF no encuentra esa página, se queda con el **menor** de los
totales y lo dice en el detalle del partido, para que se pueda comprobar.

### El estado final de cada designación

El comité manda varios correos sobre el mismo partido, todos con el mismo número
de designación:

- *"Le ha sido asignada la siguiente designación:"* — la asignación inicial.
- *"Su designación ha sido cambiada:"* — un cambio de asistente, de hora, de campo.
- *"Su designación ha sido cancelada:"* — el partido no se arbitra.

Todos llevan el mismo cuerpo, con los mismos campos: lo único que cambia es la
frase de arriba. La búsqueda en Gmail pide la segunda mitad por su tronco común,
`"Su designación ha sido"`, en vez de enumerar los finales, para que entren
también las anulaciones y cualquier aviso que el comité redacte mañana de otra
forma. El filtro fino se hace después sobre el texto.

Una búsqueda que se queda corta es un fallo silencioso: el correo no llega, y un
partido cancelado sigue contando como dinero pendiente para siempre. Por eso
`tests/busqueda.test.mjs` comprueba que las frases que se saben reconocer y las
que se piden a Gmail son las mismas. Y las búsquedas que fueron el valor por
defecto en versiones anteriores se sustituyen por la actual al cargar los
ajustes (`OLD_DEFAULT_QUERIES`), porque si no, quien ya tuviera una guardada se
quedaría con ella para siempre.

Todos se importan y después se resuelve el estado final de cada designación
(`src/store/resolve.ts`):

1. **Se agrupan los correos por su número de designación.**
2. **Se apartan las demos.** No deciden nada: son correos de prueba que el
   comité manda sobre designaciones reales. Solo si *todos* los correos del
   grupo son demos se mira uno de ellos.
3. **El correo real más reciente marca el estado final.** Si anula, el partido
   no se arbitra: queda apartado en su pestaña y no cuenta para nada. Si cambia,
   actualiza los datos. Si no hay nada posterior, sigue asignado.
4. **Los datos se completan hacia atrás:** el correo que gana puede venir
   incompleto, y otro del mismo partido tenerlo. Los de anulación no traen PDF,
   así que el importe se busca en los anteriores.
5. **Las marcas de cobrado, de borrado y los importes corregidos a mano se
   arrastran** desde los correos que se descartan.

### El mismo partido con dos números de designación

Las competiciones nacionales las designan **dos federaciones**: la territorial y
la nacional, cada una con su numeración y su formato. El mismo Córdoba CF –
Pozuelo llega como designación `1970459` y como `4114989`:

| | 4114989 | 1970459 |
|---|---|---|
| Competición | SEGUNDA FEDERACIÓN DE FÚTBOL FEMENINO · LIGA - GRUPO 3 | SEGUNDA FEDERACION FEMENINA |
| Equipos | (604001) Córdoba CF | CORDOBA CF |
| Campo | Ciudad Deportiva Córdoba CF campo 1 | Córdoba - CIUDAD DEPORTIVA CORDOBA CF (F11) (N) |

Agrupar por número no las une, así que el partido salía dos veces. Después de
resolver por designación hay una segunda pasada que identifica el partido por
**fecha, hora y equipos**, con los nombres reducidos a lo comparable: fuera los
códigos entre paréntesis, los acentos, la puntuación y las mayúsculas
(`teamKey` y `matchKey` en `src/lib/text.ts`).

Gana la designación que trae el importe, que es la que dice lo que se cobra, y
la otra queda anotada en el detalle. Si falta la fecha o alguno de los equipos
no se junta nada: sin los tres datos no hay forma de afirmar que son el mismo
partido.

Dos cosas que parecen detalles y son las que cuestan dinero:

- **Una demo no puede anular ni pisar un partido real.** Sin el paso 2, una
  cancelación de demostración borraría del total un partido que sí se arbitra, y
  desde la app no habría forma de notarlo: no da error, solo falta dinero.
- **Un cambio sí puede mover el importe.** Normalmente un cambio es de
  asistente o de hora y el dinero no varía, pero si cambia la función (de
  árbitro a asistente) el PDF nuevo trae otra liquidación. Por eso el importe
  sale del correo real más reciente y no se conserva el del primero.

Sin esta resolución, un partido con tres correos sale tres veces en el listado y
su importe se cuenta tres veces.

### Los partidos de demostración

Hacen falta **las dos señales a la vez** para descartar un partido:

**1. La marca de agua del PDF.** Los PDF de prueba llevan *PD4ML DEMO MODE*
escrito en los bordes laterales: es lo que estampa [PD4ML](https://pd4ml.com),
la librería con la que la RFAF genera los PDF, cuando corre sin licencia válida.
El propio PDF lo confirma en un comentario interno de su flujo:
`supplied license 'java:pd4ml.lic...' is invalid`.

Esa marca **no está en el texto de la página**: va en anotaciones
`/Subtype /Watermark`, que `getTextContent()` no devuelve. Buscar la palabra
"demo" en el texto extraído no encuentra absolutamente nada. Lo que sí funciona
es contar las anotaciones, que es el marcador que pone la propia librería:

```js
const annotations = await page.getAnnotations()
watermarks += annotations.filter((a) => a.subtype === 'Watermark').length
```

En las muestras reales, el PDF de prueba trae 8 anotaciones `Watermark` en sus 4
páginas y el válido ninguna.

**2. Que el correo sea de designación cambiada.**

Ninguna de las dos basta por separado: un cambio de designación de verdad trae
un PDF limpio, y un PDF con marca de agua en un correo de asignación normal es
un partido real generado con una licencia caducada.

La búsqueda de "demo" en el texto se mantiene como red de seguridad por si algún
PDF marcara la demo de otra forma. Y cada partido se puede forzar a mano desde
su detalle si la detección se equivoca.

### Desde cuándo se cuenta lo pendiente

Lo anterior a la temporada en curso ya está cobrado, así que esos partidos se
marcan **como cobrados** en vez de tirarlos: siguen consultables y no inflan la
cuenta de lo que queda por cobrar. En Ajustes se fija la fecha de corte (por
defecto el 1 de septiembre de 2026).

El filtro `after:` de Gmail va sobre la fecha del **correo**, que llega días
antes del partido, así que la búsqueda pide mes y medio de margen hacia atrás y
después se decide por la **fecha del partido**. Si no, una designación recibida
en agosto para un partido del 5 de septiembre se perdería.

### Cuotas de Gmail: por qué la primera carga va por tandas

Gmail cobra por petición y corta con `Quota exceeded for quota metric 'Total
Query Cost'` si se le lanzan cientos seguidas. Leer un partido cuesta dos
peticiones (el correo y su PDF), así que una temporada entera de golpe la tumba.

Tres medidas, en `src/gmail/api.ts` y `src/sync.ts`:

1. **Las llamadas van de una en una**, separadas por un hueco mínimo, y ante un
   corte temporal se reintentan espaciándolas cada vez más.
2. **Como mucho 60 correos nuevos por pasada.** Al terminar dice cuántos quedan
   y basta con volver a sincronizar. Solo afecta a la primera carga: después
   llegan dos o tres designaciones por semana.
3. **Un fallo nunca se guarda como partido.** Esto es lo importante: un registro
   guardado deja su id entre los conocidos y ese correo *no se vuelve a intentar
   jamás*, así que un corte temporal se convertiría en un hueco permanente. Los
   correos que fallan simplemente se cuentan y entran en la siguiente pasada.

En uso normal la app no vuelve a descargar nada de lo que ya tiene: solo pide la
lista de ids y baja los correos que no conoce.

### Reanalizar sin volver a descargar

De cada partido se guarda el texto del PDF y del correo (recortado, para no
llenar el almacenamiento del navegador), así que se puede volver a analizar
todo sin tocar la red y respetando lo marcado a mano.

Ocurre **solo** al abrir la app: `DATA_VERSION` en `src/store/db.ts` se sube
cuando cambian las reglas de análisis, y si lo guardado viene de una versión
anterior se reanaliza entero. De paso se tiran los registros vacíos que dejaron
las peticiones fallidas, para que esos correos vuelvan a intentarse. Hace falta porque la sincronización nunca vuelve
a tocar un correo que ya conoce: sin esta migración, los partidos bajados con
las reglas viejas se quedarían mal para siempre.

La resolución del estado final se aplica además en **cada** sincronización,
aunque no llegue ningún correo nuevo.

También está el botón manual en **Ajustes → Reanalizar lo guardado**.

## Puesta en marcha

```bash
npm install
npm run dev
```

### Credenciales de Google

La app trae un Client ID ya configurado. Para usar otro:

1. Proyecto nuevo en [Google Cloud Console](https://console.cloud.google.com).
2. **APIs y servicios → Biblioteca**: habilitar la **Gmail API**.
3. **Pantalla de consentimiento**: tipo *Externo*, en estado **Prueba**, con la
   cuenta de correo añadida como usuario de prueba.
4. **Acceso a los datos**: añadir el permiso
   `https://www.googleapis.com/auth/gmail.readonly`.
5. **Clientes → Crear cliente → Aplicación web**, con estos orígenes
   autorizados de JavaScript:
   - `http://localhost:5173`
   - `https://raafaa22.github.io`
6. Pegar el Client ID en Ajustes, o cambiarlo en `src/store/db.ts`.

La aplicación se queda en estado *Prueba* a propósito: `gmail.readonly` es un
permiso restringido y publicarla exigiría pasar la verificación de Google. En
modo prueba funciona indefinidamente para las cuentas añadidas a mano.

## Comprobar un PDF sin pasar por Gmail

```bash
node scripts/leer-pdf.mjs muestras/designacion.pdf --texto
```

Enseña el texto que extrae la app página a página, el importe que deduce, de
dónde lo ha sacado y si lo considera una demo. Es la forma rápida de ver por qué
un PDF nuevo no cuadra:

```
Páginas:       3
Designación:   1968465
Marcas agua:   0
¿Es demo?:     no, partido real
Motivo:        Partido real: sin marcas de demostración
Importe:       19
Procedencia:   Total de la página de designación (pág. 1): "Total 19,00"
```

Con `--cambiada` simula que el correo era de los de designación cambiada, que es
la segunda condición para considerarlo demo.

Los PDF de muestra no se versionan: llevan nombres, teléfonos y DNI. La carpeta
`muestras/` y cualquier `.pdf` están en el `.gitignore`.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | servidor de desarrollo |
| `npm test` | pruebas del parser de correos y de PDF |
| `npm run build` | compila a `dist/` |
| `npm run icons` | regenera los iconos de la PWA |

## Despliegue

Cada push a `main` lanza el workflow de GitHub Actions, que pasa las pruebas y
publica en GitHub Pages. Hay que activarlo una vez en **Settings → Pages →
Source: GitHub Actions**.

## Por qué hay polyfills (y por qué el worker va envuelto)

En iOS **todos** los navegadores corren sobre el motor de Safari, Chrome
incluido, así que la versión del sistema manda. Y ahí pdf.js se rompe por una
carencia concreta de WebKit:

```js
// pdf.js, getTextContent()
const stream = this.streamTextContent(params)
for await (const chunk of stream) { … }
```

WebKit no implementa `ReadableStream[Symbol.asyncIterator]`, que Chrome y
Firefox sí tienen. Sin él, leer un PDF falla con un `undefined is not a
function` que no dice de qué. `src/lib/polyfills.ts` lo añade recorriendo el
stream con su lector, que es justo lo que haría el iterador.

De paso se cubren `Promise.withResolvers` (iOS 17.4+), `structuredClone`
(15.4+) y `Array.prototype.at` (16.4+), que pdf.js también usa.

**El worker va envuelto** (`src/parse/pdf-worker.ts`) porque tiene su propio
contexto global: lo que se parchea en la página no llega ahí. El envoltorio
pone los parches y después carga el worker de verdad con un import **dinámico**
— uno estático se evaluaría antes que cualquier código del módulo, o sea, sin
los parches puestos.

La compilación genera mapas de código (`build.sourcemap`) y los errores guardan
tipo y origen. Es lo que permitió localizar esto: el mensaje del móvil traía
`index-CQE37LPl.js:18:1056`, y el mapa lo situó en `getTextContent()`.

## Varias cuentas de Google

Los partidos se guardan por cuenta: `pa.matches.v1:<correo>`. Al sincronizar se
pregunta a Gmail de quién es la sesión y, si es otra cuenta, se cambia de cajón.

No es un capricho: sin esto, entrar con un segundo correo añade sus
designaciones a las del primero y el total suma dinero de dos personas
distintas, sin nada que lo delate. Los datos que se guardaron antes de separar
por cuenta pasan a ser de la primera que entra (`adoptLegacyData`).

Para que otra cuenta pueda entrar hay que añadirla como usuario de prueba en
**Google Auth Platform → Público**; si no, Google la rechaza con un "Acceso
bloqueado". Caben 100.

## Privacidad

El token de Google y los partidos se guardan en el `localStorage` del
dispositivo, estos últimos separados por cuenta. Los correos se leen desde el navegador contra la API de Gmail: no
pasan por ningún servidor intermedio. Los PDF descargados no se guardan, solo el
texto que se extrae de ellos.
