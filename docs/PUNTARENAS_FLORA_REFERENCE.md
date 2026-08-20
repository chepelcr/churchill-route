# Referencia de flora para Puntarenas

Fecha de corte: **2026-08-17**. Esta referencia decide qué puede llamarse
“nativo”, qué sólo está documentado en la ciudad y cómo se distribuye cada
familia en el juego. La autoridad ejecutable es
`src/assets/flora.json`; este documento explica la evidencia y sus límites.

## Regla principal

**Presente en Puntarenas no significa nativo de Costa Rica.** El inventario del
eje urbano iglesia–Parque Victoria–bulevar identifica al almendro de playa como
predominante y registra cedro amargo, higuerón, caña fístula y palma de abanico.
Sin embargo, Kew clasifica `Terminalia catappa`, `Cassia fistula` y
`Licuala grandis` como introducidas en Costa Rica o nativas de otras regiones.
Por eso el catálogo mantiene dos ejes separados: `occurrence` y `origin`.

Fuentes directas:

- [Inventario del eje urbano de Puntarenas](https://repositoriotec.tec.ac.cr/server/api/core/bitstreams/d736ba39-acf3-4c12-ad44-08d6371ee851/content)
- [Kew: Terminalia catappa](https://powo.science.kew.org/taxon/171034-1)
- [Kew: Cassia fistula](https://powo.science.kew.org/taxon/urn%3Alsid%3Aipni.org%3Anames%3A484507-1)
- [Kew: Licuala grandis](https://powo.science.kew.org/taxon/urn%3Alsid%3Aipni.org%3Anames%3A667880-1)

## Catálogo implementado

| Asset JSON | Taxón | Origen | Evidencia / zona | Lectura visual editable |
|---|---|---|---|---|
| `almendro` | *Terminalia catappa* | introducido | observado y predominante en el centro | copa baja, ancha y estratificada horizontalmente |
| `cedro_amargo` | *Cedrela odorata* | nativo | observado en el centro | tronco alto, copa abierta y asimétrica |
| `higueron` | *Ficus* sp. | sin resolver a especie | observado en el centro | copa grande, densa y redondeada |
| `cana_fistula` | *Cassia fistula* | introducido | observado en el centro | copa abierta y floración amarilla |
| `palma_abanico` | *Licuala grandis* | introducido | observada en el centro | hojas de abanico; no reutiliza frondas de cocotero |
| `guanacaste` | *Enterolobium cyclocarpum* | nativo | observado junto al manglar de Mata de Limón y en Miramar | sombrilla muy ancha y aplanada |
| `cortez` | *Handroanthus ochraceus* | nativo | bosque seco/transición regional | copa redondeada de floración amarilla |
| `roble_sabana` | *Tabebuia rosea* | nativo | observado junto al manglar de Mata de Limón | floración rosada nativa; sustituye al cerezo en mezclas naturales |
| `indio_desnudo` | *Bursera simaruba* | nativo | observado en Mata de Limón y Tivives | ramificación abierta con tronco cobrizo visible |
| `tempisque` | *Sideroxylon capiri* | nativo | documentado en Tivives / faja costera de Puntarenas | copa densa y redondeada |
| `madrono` | *Calycophyllum candidissimum* | nativo | inventariado en el bosque transicional de Miramar | tronco claro alto y copa compacta |

La condición `seco` no es un taxón: representa un árbol caducifolio sin follaje
durante la estación seca. `pino`, `cipres`, `cerezo` y la `palma` de fronda
histórica se conservan como assets manuales con taxón pendiente; no participan
en mezclas ecológicas nativas.

Referencias de distribución:

- [Mata de Limón: estructura del manglar y flora asociada](https://www.revistas.una.ac.cr/index.php/revmar/article/view/16894)
- [SINAC: diagnóstico de la Zona Protectora Tivives](https://www.sinac.go.cr/ES/planmanejo/Plan%20Manejo%20ACOPAC/ZP%20Tivives%20%282018%29/Diagnostico%20Tivives%20final.pdf)
- [SINAC: flora de bosque seco deciduo y semideciduo del Pacífico](https://www.sinac.go.cr/ES/ac/act/pnmlb/Paginas/default.aspx)
- [Bosque de transición de Miramar, Puntarenas](https://repositoriotec.tec.ac.cr/server/api/core/bitstreams/0da1fa99-4e8d-4956-928e-e7c22c1917b3/content)
- [Kew: Cedrela odorata](https://powo.science.kew.org/taxon/urn%3Alsid%3Aipni.org%3Anames%3A51010-2)
- [Kew: Enterolobium cyclocarpum](https://powo.science.kew.org/taxon/urn%3Alsid%3Aipni.org%3Anames%3A1037928-2)
- [Kew: Handroanthus ochraceus](https://powo.science.kew.org/taxon/117333-2)
- [Kew: Tabebuia rosea](https://powo.science.kew.org/taxon/111027-1)
- [Kew: Bursera simaruba](https://powo.science.kew.org/taxon/127217-1)
- [Kew: Sideroxylon capiri](https://powo.science.kew.org/taxon/urn%3Alsid%3Aipni.org%3Anames%3A789590-1)
- [Kew: Calycophyllum candidissimum](https://powo.science.kew.org/taxon/urn%3Alsid%3Aipni.org%3Anames%3A745241-1)

## Manglar: especies y zonificación

Mata de Limón, junto a Caldera y dentro de la ruta del juego, encontró seis de
las siete especies nucleares de manglar de Costa Rica; *Avicennia germinans*
tuvo el mayor índice de importancia y apareció en cinco de seis parcelas. El
mismo estudio registró como flora asociada al roble de sabana, indio desnudo,
guanacaste y cedro amargo. Chacarita documenta cinco especies directamente:
*Rhizophora mangle*,
*R. racemosa*, *Laguncularia racemosa*, *Avicennia germinans* y
*Pelliciera rhizophorae*. El estudio de Morales, en el Golfo de Nicoya, también
registra *Avicennia bicolor* y cita *Conocarpus erectus* para el golfo. Morales
describe a `Rhizophora` dominando bordes costeros y canales, mientras
`Avicennia` y `Laguncularia` forman parches interiores; además, la altura media
puede bajar aproximadamente de 8 m en el borde a 2 m en el interior.

- [Manglar de Mata de Limón, Puntarenas](https://www.revistas.una.ac.cr/index.php/revmar/article/view/16894)
- [Manglar de Chacarita, Puntarenas](https://www.scielo.sa.cr/scielo.php?pid=S2215-34702024000100098&script=sci_arttext)
- [Manglar de Morales, Golfo de Nicoya](https://www.scielo.sa.cr/scielo.php?pid=S0034-77442025000200006&script=sci_arttext)

El juego implementa dos mezclas:

- `mangroveMixes.channel_edge`: es la única usada hoy, porque el builder sólo
  emite puntos sobre la línea de agua. Favorece `Rhizophora` y
  `mangle_pinuela`; sus pesos son una decisión artística guiada por evidencia,
  no una estimación estadística del inventario.
- `mangroveMixes.interior`: queda editable y previsualizable para cuando el
  mundo emita polígonos interiores; favorece `Avicennia` y `Laguncularia`.

Las formas tampoco se mezclan: `Rhizophora` usa raíces zancudas, `Avicennia`
neumatóforos, `Pelliciera` contrafuertes, y `Laguncularia`/`Conocarpus` un collar
basal compacto. La marea sigue siendo estado del engine; arquitectura, medidas,
capas y tintas son JSON.

## Mezclas del mundo

| Mezcla | Uso | Patrón implementado |
|---|---|---|
| `mixes.seco` | bosque seco del Pacífico | nativos de bosque seco + condición caducifolia |
| `mixes.monte` | transición baja | broadleaf nativo; sin almendro urbano ni ornamentales |
| `mixes.altura` | laderas/Miramar detrás del puerto | transición nativa, no un bosque inventado de pino/ciprés |
| `plantings.parque` | parques, patios y plazas urbanas | paleta observada: almendro predominante, cedro, higuerón y caña fístula |
| `plantings.barro` | Ferrocarril/Cocal | especies nativas de bosque seco |

Los bosques continúan siendo áreas + mezclas deterministas; no se serializan
cientos de miles de árboles. La selección ponderada se comparte entre juego y
preview, y un id explícito desconocido lanza error en vez de convertirse
silenciosamente en almendro.

## Pendientes de verificación de campo

El patrón ya es mucho más honesto, pero no sustituye un censo georreferenciado.
Antes de colocar individuos concretos conviene confirmar con fotos o recorrido:

- el taxón de las palmas de fronda existentes en paseo y medianas;
- la especie exacta de cada higuerón (`Ficus` sp. es el límite de la fuente);
- individuos puntuales de pochote, laurel, guapinol, carao y ron-ron;
- el límite espacial entre manglar de canal e interior.

Hasta entonces esos nombres no deben inferirse de OpenStreetMap: el archivo
actual casi no contiene etiquetas de especie. Un asset nuevo entra primero al
catálogo con fuente, origen, hábitat y forma; sólo después entra a una mezcla o
a coordenada del mundo.
