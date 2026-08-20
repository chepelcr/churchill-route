# Auditoría de assets dibujados a mano

Fecha de cierre: **2026-08-17**. Alcance: Canvas2D, catálogos JSON y el editor
privado en `world-editor/`. Esta auditoría reemplaza los estados históricos de
`docs/inventory.md` y del antiguo handoff de escenas de parcela.

La verticalidad se documenta por separado en
[`HANDOFF-verticality-2_5d.md`](HANDOFF-verticality-2_5d.md). Esta entrega
preserva `heightM` y sombra solar donde ya forman parte del contrato —flora,
actores, ferry y edificios genéricos—, pero no implementa todavía las bandas de
altura de las escenas ni la cota/perfiles del terreno.

## Resultado

La migración de **identidad artística** está completa para las familias
dibujadas a mano del mundo:

- la forma, paleta, proporciones, variantes y poses autoradas viven en JSON;
- el juego las ejecuta mediante intérpretes finitos y compartidos;
- el editor modifica el mismo JSON y usa exactamente los pintores del juego;
- las animaciones visuales están descritas junto con el dibujo; el engine sólo
  conserva reloj, navegación, física, clipping, estado y composición;
- no quedan colores autorados dentro de `src/render/`: la prueba elimina
  comentarios y rechaza cualquier hexadecimal o `rgb/rgba` numérico;
- no hay dispatch de apariencia por especie, actor, escena o estructura.

Esto no convierte Canvas en un lenguaje arbitrario guardado en JSON. Cada
familia tiene un vocabulario pequeño, enumerado y validado. Una receta puede
elegir y parametrizar una forma conocida, pero no ejecutar JavaScript.

## Fuente de verdad y cobertura

| Fuente | Cobertura actual | Pintor compartido | Preview del editor |
|---|---:|---|---|
| `vehicles.json` | 9 vehículos | `shapes.js` / `vehicleShapes.js` | sí |
| `world-props.json` | 4 props, 24 hitos, 10 señales y 14 escenas | `shapes.js` + `sceneShapes.js` | sí |
| `flora.json` v2 | 23 especies/registros, 18 formas, 3 mezclas de bosque y 2 de manglar | `floraShapes.js` | species, forms y mixes |
| `actors.json` v2 | 31 actores, 36 formas, 5 estados de moneda y 3 cargas | `actorShapes.js` | actores, formas, variantes, poses y animación |
| `materials.json.structure` | edificio, puente, ferry, berth, deck y caseta de muelle | `structureShapes.js` | sí, sobre fixtures |
| `feriaAssets.json` | 14 juegos/chinamos | `feriaShapes.js` | sí, animado |
| `lights.json` | 4 luminarias y receta de halo | `lights.js` | sí, laboratorio nocturno animado |
| `water.json`, `effects.json`, `hud.json` | recetas de agua, clima, sombras y HUD | `systemShapes.js` + compositores de runtime | sí, laboratorios animados |
| `sprites.json` | imágenes con ancla, alpha, bounds y medidas | `sprite` en `shapes.js` | sí, biblioteca/importador completo |
| `flora.json.plantingSchema/plantingRuns` | 5 formas, 4 alineaciones y 4 corridas publicadas | `plantingShapes.js` + `service/planting.py` | sí, herramienta/inspector semántico |

`world-editor/src/assetPreview.js` es un router de providers, no otro renderer.
Delega a los módulos anteriores, repinta cambios sin guardar y rechaza verbos
desconocidos. El árbol de datos permite editar todos los campos JSON; flora
además ofrece controles semánticos para forma, taxonomía y arquitectura.

Los providers de sistema no vuelven a implementar el arte: agua, efectos,
luces, HUD, clima y geometría llaman los mismos pintores que el juego sobre
fixtures controlables. Los controles de tiempo, marea, intensidad, velocidad y
viewport sólo construyen contexto para esos compositores.

## Auditoría por familia

### Parcelas, hitos y props

Las catorce escenas de `world-props.json` incluyen la catedral, edificio
cívico, escuela, jardín, gasolinera, kiosco, río de parque, faro, espacio verde,
fuente, piscina, estadio, Parque Marino y lote. Las siete escenas que antes
tenían un `drawX` por identidad ahora son `parts + palette + values`.

El intérprete admite un árbol finito de fórmulas y familias para las cuentas
que dependen del marco de la parcela. El faro usa una receta de torre y
escollera; fuente y piscina conservan sus relojes en el engine, pero sus
colores, cantidades, amplitudes y capas están en JSON. Estadio y Parque Marino
mantienen en código únicamente el footprint, clipping y orden de composición;
sus ingredientes artísticos son assets compartidos.

El ancla recordada por el equipo está registrada como
`world-props.json.landmarks.anchor`, con forma, paleta, escala y preview
editables. No depende de un dibujo escondido en `landmarks.js`.

### Flora de Puntarenas

`flora.json` v2 separa taxón, ocurrencia local, origen, hábitat, paleta, altura,
forma y mezcla de plantación. Hay siluetas diferenciadas para pinos/coníferas,
cipreses, cerezos florales, guanacaste, almendro, corteza amarilla, palmas de
fronda y abanico, y mangles con cuatro arquitecturas de raíz.

El catálogo incorpora catorce taxones nativos o regionalmente apropiados y
conserva la evidencia y los pendientes de campo en
[`PUNTARENAS_FLORA_REFERENCE.md`](PUNTARENAS_FLORA_REFERENCE.md). El editor
muestra varios seeds, fases de palma y niveles de marea; placement, culling,
hash y elección determinista de mezcla siguen en el engine.

### Actores, objetos móviles y animaciones

`actors.json` v2 contiene peatones/oficios, animales, gaviotas, pelota, tráfico,
tren, barcos, vendedor, monedas, objetivo, carga y encuentros del estero. Sus 36
formas incluyen poses y variantes; las animaciones viajan con el asset mediante
verbos finitos como ciclos de humo, hervor, giro, aleteo, cardumen, abanico de
raíces, remolino y estela.

`entities.js` y `estero.js` conservan rutas, IA, marea, bancos, hitboxes y
estado. La silueta visible se delega a `actorShapes.js`. Por tanto, cambiar una
forma, un color o una fase no requiere abrir esos dos compositores.

### Edificios, puente, muelles y ferries

`materials.json.structure` contiene recetas completas para:

- interior de techo/ventanas de edificio, aplicado dentro del footprint;
- puente, torres, tensores y rótulo;
- deck, pilotes, juntas, lámparas y caseta de muelle;
- terminal y ferry simétrico de doble rampa.

`structureShapes.js` interpreta las recetas y el editor las muestra sobre
fixtures. `structures.js` conserva sólo geometría del mundo, clips, polilíneas
y orden de capas.

Los ferries tienen además una fuente de contenido independiente en
`content/world/ferries.json`. El builder resuelve sus nodos terminales y ways
reales de OSM y emite en el manifest el tramo jugable completo: 1.800 px y 74
puntos por ferry. No finge que los 90 minutos hasta Nicoya caben en el mapa:

| id técnico | destino visible | nombre del buque | operación |
|---|---|---|---|
| `paquera` | Tambor | **Tambor** | doble proa/doble rampa |
| `naranjo` | Playa Naranjo | **San Lucas 3** | doble proa/doble rampa |

El id y las llaves OSM pueden conservar el nombre cartográfico de Paquera sin
forzar ese texto en la presentación. `doubleEnded: true` separa la dirección de
avance sobre la ruta de la orientación física del casco: al volver, el ferry
invierte su movimiento sin girar 180°. La conducta convencional se conserva
para cualquier embarcación futura de una sola proa.

El editor permite modificar destino, rotulación, operación doble, berth,
heading, deck y la línea del tramo; también dibuja ambos extremos equivalentes.

### Altura y sombras: estado exacto

La migración artística no debe confundirse con la implementación completa del
plan 2.5D:

- las 23 especies de flora y los actores visuales declaran `heightM`; sus
  sombras reciben el vector solar común;
- el ferry declara `heightM` y desplaza su receta de sombra con el sol;
- los edificios genéricos proyectan su footprint con una altura inferida;
- las escenas de parcela —incluida la catedral— todavía conservan partes de
  sombra JSON con offsets artísticos. Aún no existen `castsShadow`, herencia de
  `heightM` por grupo ni el mask multipasada de la propuesta.

Por eso el contrato documentado sigue abierto en dos tracks: primero las bandas
de altura/sombra de escenas; después `zM`, perfiles por porción de calle,
interconexión de pendientes y respuesta de velocidad al grado. Ferrocarril aún
no tiene cota real.

## Lo que correctamente queda en código

No es autoría visual y no debe serializarse:

- orden global de composición, streaming, culling y cachés;
- proyección, clipping contra footprints/paths y hit testing;
- física, IA, rutas, sentido de marcha, reloj, marea y clima;
- hashes/seeds deterministas y placement de instancias;
- cálculo matemático de splines, gradientes, interferencia de agua y máscaras,
  siempre consumiendo parámetros y colores de los catálogos.

Los SVG de React, iconos/splash y branding siguen siendo code-native o archivos
de packaging. No son assets del mundo y no se mezclan con este editor.

## Herramientas complementarias: cierre

También quedaron terminadas las superficies especializadas que seguían abiertas:

1. laboratorios animados para agua, clima, luces, efectos de vehículo y HUD;
2. biblioteca/importador de sprites con alpha, bounds, ancla y metros, con la
   misma operación en UI, API, CLI y MCP;
3. esquema, preview, inspector y emisión determinista de líneas/canteros de
   plantación;
4. fixtures de geometría mundial para calles, intersecciones, malecón y terreno.

Lo siguiente ya no pertenece a este plan: son las bandas `heightM` y la máscara
solar de escenas, seguidas por `zM`, terreno y perfiles de calles. Siguen
deliberadamente sin implementar y tienen su propio handoff 2.5D.

## Gates permanentes

Toda familia nueva debe mantener:

- schema/version y validación de verbos, referencias y colores;
- la misma fuente JSON para juego y editor;
- preview delegado al pintor real, incluyendo cambios sin guardar;
- ninguna rama del renderer por identidad artística;
- fixture visual antes/después para una transcripción y revisión explícita para
  un rediseño;
- `pnpm test`, builds, inventario, snapshot cuando corresponda y smoke real.

El loop de desarrollo usa un único `pnpm dev` persistente con HMR. Los cambios
de módulos cliente y JSON no lo reinician. Sólo un cambio al backend del editor
en `vite.config.js`/`configureServer` requiere un reinicio gracioso del proceso
`:8740`; borrar `node_modules/.vite` queda reservado para una corrupción del
optimizador reproducida, no para el ciclo normal de edición.
