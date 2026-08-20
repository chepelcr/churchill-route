# Handoff — verticalidad 2.5D: alturas, sombras y cuestas

Fecha: **2026-08-17**. Este contrato se integra con
[`HAND_DRAWN_ASSET_AUDIT.md`](HAND_DRAWN_ASSET_AUDIT.md): toda forma migrada debe
declarar su altura física cuando proyecta sombra, y toda calle/terreno puede
llevar una cota independiente de la forma del asset.

## Decisión central

“Altura” no puede seguir siendo un solo campo ambiguo. Son dos magnitudes:

| Campo | Significado | Ejemplos | Dueño |
|---|---|---|---|
| `heightM` | altura del objeto **sobre su base** | nave 8 m, torre 18 m, pino 12 m | catálogo del asset |
| `zM` / `elevationProfile` | cota de la base **sobre el datum del mundo** | calle a 0 m, terraplén a 1 m, cuesta 0→14 m | mundo/build |

Ambas están en **metros**. Nunca se guarda “7 px de lift” o “3.5 px de sombra”
como altura. La proyección decide cuántos píxeles representan un metro vertical;
el mundo decide la cota y el asset decide cuánto se levanta sobre ella.

En el editor los labels deben decir explícitamente:

- **Altura del objeto (m)** → `heightM`;
- **Cota de la base (m)** → `zM`;
- **Perfil de elevación de la calle** → `elevationProfile`.

El input genérico `Elevation` que existe hoy en el inspector no sirve como
contrato: se guarda en `properties.elevation`, admite 0–20 sin unidad, no tiene
validator y ningún renderer/physics lo consume. Debe retirarse o migrarse según
el tipo de feature, no empezar a usarse con un segundo significado.

## Lo que ya existe y lo que se reemplaza

### Ya existe una base correcta

- `src/render/c2d/shadows.js::sunShadow(heightM)` proyecta una altura en metros
  con el sol continuo y devuelve `{dx, dy, alpha}`.
- `effects.json.sunShadow` concentra alcance, squash y alpha.
- `paintBuilding` usa `buildingHeightM(b)` para que una bodega y una casa no
  proyecten la misma sombra.
- figuras y vehículos ya derivan la sombra de su propia silueta o ancla.

### Los dos atajos que deben desaparecer

1. Las escenas de `world-props.json` todavía llevan rectángulos/elipses pintados
   con `$shadow`. La catedral dice literalmente “el mismo cuerpo corrido +3,+5”.
   Esa sombra no sigue el sol, no conoce metros y no incluye correctamente
   crucero, ábside, cimborrio, torres y cruz.
2. Ferrocarril no tiene elevación real. El builder marca la vía con `elev: 1` por
   nombre; `streets.js` le pinta un stroke desplazado 3.5 px; physics interpola
   `state.elev` hacia 1/0; el jugador sube 7 px. No hay `z`, pendiente, bajada,
   continuidad en cruces ni efecto gravitacional.

## Track A — altura de assets y sombras que siguen la forma

### Schema

Una escena puede declarar una altura por omisión y cada parte/grupo puede
sobrescribirla:

```json
{
  "heightM": 8,
  "shadow": { "alpha": 0.22 },
  "parts": [
    {
      "id": "nave",
      "shape": "roundRect",
      "castsShadow": true,
      "heightM": 8
    },
    {
      "id": "cimborrio",
      "shape": "group",
      "castsShadow": true,
      "heightM": 14,
      "parts": []
    },
    {
      "id": "campanarios",
      "shape": "repeat",
      "castsShadow": true,
      "heightM": 18,
      "parts": []
    }
  ]
}
```

`heightM` se hereda dentro de `group`, `repeat`, `fit`, `scatter` y `orbit`.
`castsShadow` es explícito: pintura en el suelo, rótulos, highlights, líneas de
cancha y agua nunca deben empezar a tirar sombra por accidente. Un grupo caster
usa la unión de sus hijos; no necesita duplicar su contorno.

Campos propuestos:

- `heightM`: plano superior que proyecta esa silueta, relativo a la base;
- `castsShadow: true`: incluye la forma en el mask;
- `receivesShadow: false`: sólo para casos que físicamente no reciben sombras,
  como halos/UI; por omisión el mundo sí recibe;
- `shadow.alpha`: fuerza propia del material, multiplicada por el alpha solar;
- `shadow.softness`: posterior, sólo si ambos backends pueden sostenerlo.

No se agrega un `shadowDx`/`shadowDy` por asset: la dirección pertenece al sol.

### Dos pasadas, una sola silueta

`paintParts` no debe pedir otra lista de partes para la sombra. El painter de
escena hace:

1. **Shadow-mask pass**: recorre las mismas partes, sólo las marcadas caster;
   para cada banda de `heightM`, desplaza la silueta con `sunShadow(heightM)`.
2. Todas las bandas se unen en un mask opaco. Las zonas solapadas no se vuelven
   más negras por estar cubiertas por la nave y el cimborrio a la vez.
3. Se compone una sola tinta con `shadow.alpha × solar.alpha` sobre el suelo.
4. **Art pass**: pinta las partes normalmente.

Así la sombra de un `roundRect`, `disc`, `poly`, `sprite`, `group` o `repeat`
sale de la misma geometría que se ve. Para una escena girada, el vector solar se
convierte del mundo al frame local antes de desplazar el mask; de lo contrario
la sombra giraría con la manzana, que sería físicamente incorrecto.

### Catedral: primeras bandas

Los valores definitivos son autoría visual, pero el modelo necesita desde el
inicio bandas distintas:

| Parte | Banda inicial a revisar |
|---|---:|
| atrio/gradas | 0.3–0.6 m |
| nave + ábside | 7–9 m |
| crucero | 9–11 m |
| cimborrio | 13–15 m |
| campanarios | 17–20 m |
| cruz | plano superior de la torre/cimborrio que la sostiene |

El objetivo no es convertir el asset en un modelo 3-D exacto. Es hacer que la
lectura top-down responda a “esto es más alto” de manera coherente y sutil.

### Otros assets

- flora v2: cada especie lleva `heightM`; `trunkH` puede seguir siendo una
  proporción artística, pero deja de fingir que es altura física;
- lights: altura del poste en metros controla su sombra y la posición semántica
  del halo; los offsets de partes siguen siendo dibujo;
- actors: altura de figura por familia/pose;
- props/escenas: alturas por grupo;
- sprites: `heightM` independiente de `hM`, porque el alto de la imagen no es
  necesariamente el alto del edificio;
- edificios genéricos: `heightM` authored gana sobre `buildingHeightM`; la
  inferencia queda como fallback visible en el editor.

## Track B0 — LA FUENTE, que es la parte con la trampa adentro

Este contrato decía «un import futuro de DEM genera los mismos controles» y con
esa línea daba por resuelto lo único que no lo estaba. **Medido el 2026-08-19**
sobre el mundo publicado (31,8 × 19,9 km, lon −84,921…−84,631), convirtiendo
transectos con `manifest.meta.geo`:

### Un DEM global INVENTA un cerro en el centro de Puntarenas

Sobre el arenal —x 1 000 a 35 000, o sea el juego entero de hoy— SRTM30m lee 0 m
en todas partes MENOS entre x 20 000 y 26 000, donde salta a **6–8 m**. Mapzen
dice lo mismo (−2 a 9 m). Esa banda es exactamente Carmen, el Paseo, el Centro y
Playitas.

**No es suelo: son techos y árboles.** SRTM y Copernicus son modelos de
SUPERFICIE. El propio nodo de OSM en x 19 082 dice **2,49 m** y Chacarita 3,26 m.
Importar un DEM sin más levantaría el centro ocho metros sobre el faro y pondría
al jugador a subir una cuesta hecha de edificios, justo en la parte más jugada
del mapa. Un DEM se puede usar; lo que no se puede es creerle sobre el arenal.

Al este, en cambio, el relieve es de verdad: x 50 000 a 79 000 (Barranca →
Esparza) barre de 0 a 212 m con estructura real, y OSM trae los picos en cuadro
—Cerro San Miguel **414 m**, Juanilama 253, Cerro Barbudal 224, Alto Cascabel
221—. **Esos barrios son jugables**: la valla del MVP se bajó el 2026-08-15.

### La fuente elegida: las curvas de nivel del IGN, por SNIT

`https://geos.snitcr.go.cr/be/IGN_1/wfs` → **`IGN_1:curvas_1000`**, WFS 2.0,
GeoJSON, EPSG:4326, un `LineString` por curva con la propiedad **`elevacion` en
METROS**. Es decir: el control `contour` de este documento (`pts, zM`) ya
existe, publicado, y no hay que traducir nada.

Es la fuente correcta por cuatro razones medidas, no por preferencia:

1. **Es vectorial y bare-earth**, restitución fotogramétrica — no arrastra el
   sesgo de techos que descalifica a los DEM globales;
2. **se generaliza sola donde importa.** Sobre el arenal las únicas curvas que
   trae son **2 m (130), 4 m (54) y 6 m (3)**: intervalo de 2 m donde el terreno
   es sutil. Tierra adentro el intervalo es de 10 m, donde el terreno es
   dramático. Nadie tuvo que pedirlo;
3. **coincide con la verdad conocida** — 2 m en el arenal contra los 2,49 m del
   nodo de OSM, y NINGUNA cúpula de 8 m;
4. **su propia densidad confirma la lectura del mundo**: 14 628 curvas en la caja
   completa, de las cuales **13 828 caen en Barranca+Esparza y sólo 187 en el
   arenal jugable**. La fuente está de acuerdo con que el arenal es plano.

`IGN_5:curvas_5000` es la misma cosa a 50 m de intervalo (1 830 curvas, 0–400 m):
sirve de contraste grueso, no de fuente. `IGN_5_CO:curvas_5000_2017` trae además
`linea_costa_5000`, que vale la pena mirar contra `reclaim_shore`.

**FABDEM está descartado y conviene dejarlo escrito**, porque es justo el arreglo
que uno buscaría —Copernicus con bosques y edificios removidos— y su licencia es
**CC BY-NC-SA 4.0, no comercial**. Este juego se publica con anuncios y compras.
Copernicus GLO-30 (AWS Open Data, sin auth) sí es de uso comercial y queda como
relleno posible entre curvas, nunca como autoridad sobre el arenal.

### La batimetría no entra

GEBCO 2020 mide ~450 m por celda: cruzando el estero devuelve valores de tierra
(0–11 m) y no resuelve un canal que el build ya mide entre 22 y 166 px; el golfo
le sale un −7/−8 m plano. La Travesía ya tiene su calle medida y su marea. La
profundidad no agregaría nada que el jugador sienta.

### Lo que esto obliga

- **Se commitea un extracto recortado**, como `docs/map.osm`, y el build lo lee
  determinísticamente. Un WFS en vivo dentro del build rompería la regla de que
  el mismo insumo da el mismo mundo byte a byte.
- **Los bytes emitidos entran a `world_snapshot.py`** igual que cualquier otro
  archivo del mundo.
- **El arenal se autoriza, no se muestrea.** Aunque esta fuente sea honesta ahí,
  la regla se queda escrita: al oeste de El Cocal la cota es contenido, y sólo al
  este se mezcla con la fuente. Es la misma lógica de `reclaim_shore` —el mundo
  se aparta de la verdad cuando el juego lo pide— y conviene que sea una decisión
  y no un efecto.

---

## Track B — cota del mundo, cuestas y bajadas

### Dos capas, no otro Surface

La elevación es un canal aparte. No se agrega una clase de superficie y no se
renumeran los valores 0–10:

- el grid/RLE actual sigue diciendo agua, carretera, barro, acera…;
- un segundo canal determinista dice `zM`;
- una calle normalmente sigue ese terreno;
- puentes y terraplenes pueden llevar un perfil que se separa del terreno.

Esto permite que una cuesta siga siendo barro o asfalto y conserve velocidad,
grip y roles de colisión.

### Perfil longitudinal de una calle: tramos, no un solo ángulo

Una calle se edita como una secuencia ordenada de **estaciones** sobre su
arclength. Cada estación fija una cota; el tramo entre dos estaciones se deriva
sin guardar dos fuentes de verdad:

- cotas iguales → `recta`/nivelada;
- la segunda cota es mayor → `cuesta` en el sentido original de la calle;
- la segunda cota es menor → `bajada` en ese sentido;
- al recorrerla al revés, cuesta y bajada se invierten automáticamente.

Ejemplo explícito: recta → cuesta → recta → bajada → recta.
Aquí “recta” significa **nivelada en el perfil vertical**; el trazado XY puede
seguir doblando durante cualquiera de esos tramos.

```json
{
  "elevationMode": "terrain-grade",
  "elevationProfile": {
    "interpolation": "linear-with-vertical-curves",
    "anchors": [
      { "u": 0.00, "zM": 0.0,  "transitionM": 0.0 },
      { "u": 0.18, "zM": 0.0,  "transitionM": 6.0 },
      { "u": 0.42, "zM": 12.0, "transitionM": 6.0 },
      { "u": 0.65, "zM": 12.0, "transitionM": 6.0 },
      { "u": 0.82, "zM": 4.0,  "transitionM": 6.0 },
      { "u": 1.00, "zM": 4.0,  "transitionM": 0.0 }
    ]
  }
}
```

`u` es la fracción 0–1 del arclength de la polilínea original. Sobrevive mover
o densificar vértices mejor que guardar índices o píxeles. El validator calcula
la estación derivada `sM`, las distancias reales y la pendiente porcentual de
cada tramo. `transitionM` suaviza el cambio de pendiente alrededor del anchor:
una calle no pasa instantáneamente de 0 % a 10 % como si tuviera una bisagra.

Los nombres `recta`, `cuesta` y `bajada` son labels derivados para el humano,
no valores persistidos. Guardar además `type: "uphill"` permitiría que el tipo
contradijera las cotas. El editor sí presenta una lista como:

```text
0–90 m       recta       0.0 → 0.0 m      0.0 %
90–210 m     cuesta      0.0 → 12.0 m    +10.0 %
210–325 m    recta      12.0 → 12.0 m      0.0 %
325–410 m    bajada     12.0 → 4.0 m      -9.4 %
410–500 m    recta       4.0 → 4.0 m       0.0 %
```

Un anchor puede llevar un `snapRef` estable a junction/terrain control. Nunca
se enlaza a un índice de vértice, porque editar la geometría lo invalidaría.
Los anchors deben estar ordenados y dentro de `u = 0..1`; el solver completa los
extremos desde terreno/junction cuando no están authored, limita solapes de
`transitionM` y reporta grades fuera del rango de la clase de calle.

Modos:

- `follow-terrain`: no impone perfil; toma la cota y gradiente del terreno;
- `terrain-grade`: el perfil de calle es autoridad y una franja `cut/fill`
  mezcla suavemente esa rasante con el terreno vecino; es la calle de montaña;
- `embankment`: la calle se separa del terreno con taludes laterales;
  Ferrocarril empieza aquí, con un plateau cercano a 1 m y rampas explícitas;
- `bridge`: deck separado; permite agua u otra calle por debajo y exige clearance;
- sin modo/perfil, por compatibilidad: equivale a `follow-terrain` y hoy toma
  `groundZAt(x,y) = 0 m`.

“Quitar altura” es borrar el perfil/override para volver a seguir el terreno, o
poner los anchors a la cota del entorno. No se conserva un booleano muerto.

### Terreno: lo que convierte la rasante en una montaña

Perfiles de calles sin terreno sólo crearían plataformas y terraplenes sobre un
mundo plano. El **ground editor** necesita una autoridad semántica independiente
que el builder convierta de forma determinista en el campo `zM`:

| Control | Uso | Campos mínimos |
|---|---|---|
| `elevation-point` | cumbre, loma o depresión local | `x/y, zM, radiusM, falloff` |
| `contour` | curva de nivel real trazada/importada | `pts, zM` |
| `ridge` / `breakline` | cresta, borde o cambio fuerte de pendiente | `pts, zM` o cotas por nodo |
| `plateau` | explanada, pueblo, cancha o pad de edificio | `poly, zM, blendM` |

El pincel del editor puede sentirse libre, pero persiste estos controles —no un
blob opaco por celda— para que el resultado sea editable, validable y
determinista. Un import futuro de DEM genera los mismos controles/campo y luego
puede corregirse a mano; no introduce un segundo runtime.

Las carreteras coordinan con el terreno así:

- `follow-terrain` sólo muestra la sección que ya existe en el suelo;
- `terrain-grade` corta o rellena un corredor de ancho configurable y lo mezcla
  hacia el terreno con `blendM`;
- `embankment` conserva la rasante por encima y genera taludes;
- `bridge` conserva la rasante/deck y no modifica el terreno inferior.

Parcelas y edificios pueden declarar un `plateau`/pad o aceptar la pendiente.
El validator avisa si una huella que necesita piso nivelado cruza demasiado
desnivel; no aplana manzanas silenciosamente.

### Builder y wire format

1. El editor exporta profiles y anchors semánticos en el patch.
2. El builder los aplica **antes** de rasterizar superficies.
3. Una etapa de elevación construye un campo determinista de terreno y perfiles
   de road/deck, conservando IDs de calle antes de partirlos por tiles.
4. Los tiles emiten elevación sólo donde no es cero, cuantizada con una unidad
   documentada (por ejemplo decímetros) y RLE propio. La decisión exacta se mide
   contra tamaño/precisión; no se mezcla con el RLE de Surface.
5. Cada road piece no plano lleva suficientes muestras para interpolar `zM` y
   grade a lo largo de su centerline.
6. `world_snapshot.py` cubre los nuevos bytes igual que cualquier otro archivo
   emitido.

El mundo debe exponer:

```text
groundZAt(x, y) -> zM
roadPoseAt(x, y) -> { roadId, zM, grade, tangent, mode, layer }
surfacePoseAt(x, y) -> { surface, zM, gradient }
```

`onElevated()` desaparece cuando todos sus consumidores usan una pose real.

### Junctions y el tramo de interconexión

Ésta es la compuerta que impide authoring imposible:

- cada junction a nivel tiene una **cota compartida**. Todos los perfiles que
  llegan allí hacen snap a ese mismo `zM`, incluso cuando la conexión cae en un
  `u` interior y no en un extremo de la calle;
- entre el último anchor libre de cada calle y el junction, el editor muestra
  un **tramo de interconexión**. Cambiar la cota del junction recalcula su grade
  y su curva vertical para alcanzar la otra calle de forma continua;
- si el tramo requerido queda demasiado corto/empinado, el editor no hace clamp
  silencioso: ofrece alargar la transición, mover el anchor, cambiar la cota del
  junction o convertir el cruce en puente;
- dos líneas que se cruzan con cotas distintas sólo pueden hacerlo con una
  relación explícita `gradeSeparated`/`bridge`; el raster 2-D no debe conectarlas;
- bridge/roof valida clearance contra lo que pasa debajo;
- una pendiente por encima del límite de su clase da error o warning visible;
  los límites son config del mundo, no números escondidos en la UI;
- los knots se interpolan con curva determinista suave para que no aparezca una
  esquina vertical al pasar de 4 % a −6 %.

### Física

El primer reemplazo funcional es:

```text
state.elev (lerp 0/1) -> state.zM + state.grade
W.onElevated()        -> W.roadPoseAt()/surfacePoseAt()
```

Todos los actores apoyados en el suelo toman su cota de la misma consulta. La
proyección visual del jugador, su sombra, carga, tráfico y NPCs usa `zM`; no sólo
el player.

Para que la cuesta sea “de verdad”, se calcula la pendiente firmada en la
dirección actual del vehículo:

```text
gradeAlong = dot(surfaceGradient, vehicleHeading)   # dz / ds
aGrade     = -gravityScale * gradeAlong
```

El mismo tramo resta aceleración al subir y la suma al bajar sin guardar un
sentido especial en el mapa. `gravityScale` es una afinación arcade, mientras
que `gradeAlong` sigue siendo geométricamente real. Torque, grip, freno, límite
de RPM/velocidad y resistencia evitan aceleración infinita cuesta abajo. Las
curvas verticales evitan un golpe de velocidad al cruzar entre tramos.

El HUD de debug muestra `zM`, `grade %`, nombre del tramo y velocidad vertical.
El gate físico recorre el mismo fixture en ambos sentidos y comprueba que los
resultados sean inversos: lento cuesta arriba, rápido cuesta abajo.

La colisión sigue en XY. `zM/layer` sólo decide si dos ocupantes que se cruzan en
planta realmente están en el mismo nivel.

### Render sutil, no una deformación isométrica

La proyección vertical vive en un solo helper/config:

```text
projectHeight(x, y, zM) -> { x, y - zM * verticalPxPerM }
```

`verticalPxPerM` es exageración artística del renderer, no escala geográfica.
Reemplaza los 7 px escritos en `drawPlayer`/Pixi. Debe ser editable en el
laboratorio 2.5D, con un default que conserve el aspecto inicial del
Ferrocarril durante la transcripción.

Para que la península siga fiel en planta:

- una cuesta `terrain-grade` se lee principalmente por hillshade, bandas suaves de
  pendiente, movimiento/physics y sombras; no se retuerce el trazado XY;
- un `embankment` añade caras/taludes y su sombra real;
- un `bridge` dibuja deck y caras a su `zM`, dejando visible la capa inferior;
- assets usan `baseZ + heightM`; su sombra se proyecta sobre el receiver, no
  sobre una supuesta cota cero global.

Una futura malla Pixi puede usar el mismo campo `zM`; no se crea otro catálogo
para WebGL.

## Editor

### Asset preview

Toda tarjeta de asset/scene gana:

- input **Altura del objeto (m)** por escena y por grupo caster;
- badges de height sobre layers/parts;
- toggle “mostrar mask de sombra”;
- slider de hora/sol con presets mediodía, tarde y atardecer;
- vista suelo claro/oscuro;
- warning si existe un `$shadow` manual en una escena height-aware;
- bounding box de arte y de sombra, para detectar invasión de calle/parcela.

La catedral es el fixture de aceptación: cambiar la altura de un campanario debe
mover sólo su sombra, y el contorno debe seguir exactamente sus partes.

### Road elevation profile editor

Al seleccionar una calle aparece una tarjeta propia, no el input genérico. La
vista de planta y el perfil longitudinal permanecen enlazados:

- gráfico longitudinal distancia vs `zM`;
- agregar/eliminar/arrastrar anchors y partir/eliminar/aplanar un tramo;
- lista de tramos derivados con tipo, longitud, cotas y grade;
- tabla numérica con `u`, `sM`, cota, transición y pendiente siguiente;
- selector `follow-terrain / terrain-grade / embankment / bridge`;
- colores de grade y warnings en el gráfico;
- flechas subida/bajada y cotas sobre el mapa;
- vista de sección/cross-section y toggle 2.5D/hillshade;
- junction seleccionado con su cota común y cada connection portion;
- snap de anchor a junction/control de terreno;
- acción “aplanar/seguir terreno” para quitar el override;
- acción “ajustar perfil al terreno” que crea anchors editables, no un vínculo
  oculto a las muestras actuales;
- undo/redo y preview sin rebuild de la curva, seguido del build para aceptar el
  canal emitido.

UI, HTTP API, CLI y MCP exponen la misma operación: set/remove profile, add/move
anchor, set mode y consultar warnings. Un agente debe poder pedir la elevación y
pendiente en cualquier `u`, no sólo escribir el JSON entero.

### Ground editor

La pestaña **Terreno** ofrece punto de cota, curva de nivel, cresta/breakline,
meseta/pad y depresión; selección y edición numérica de sus cotas/radios/blends;
contornos, hillshade y mapa de pendiente; sección transversal; y preview 2.5D.
Al editar una calle puede mostrar a la vez suelo original, rasante y volumen de
cut/fill. Agua/mar conserva su datum y aparece como gate, no como una montaña
moldeable por accidente.

El preview rápido usa exactamente el interpolador/solver compartido. El build
aceptado vuelve a resolver y validar el campo por tiles; nunca se publican bytes
de preview como autoridad.

## Orden de implementación

### V0 — Contrato y fixtures

1. Nombrar `heightM`, `zM`, `elevationProfile`, modos y unidades.
2. Agregar hojas baseline de catedral/school/fuel/kiosco y Ferrocarril.
3. Agregar tests que documenten que `properties.elevation` está muerto y que
   `r.elev` es booleano transitorio.

### V1 — Scene shadows, pixel-identical antes de encenderlas

1. Implementar caster mask en el intérprete compartido.
2. Transcribir primero las sombras actuales con un modo de compatibilidad para
   probar que la silueta sale de las mismas partes.
3. Añadir `heightM` y bandas a las siete escenas migradas.
4. Eliminar sus parts `$shadow` y aceptar la nueva hoja como cambio visual.
5. Integrar controles de height/sol/mask en el editor.

### V2 — Flora y demás familias

La flora v2 del audit adopta `heightM` desde su schema inicial. Actores,
estructuras, luces y sprites entran después, siempre derivando sombra de la forma
ya migrada.

### V3 — Elevation channel + Ferrocarril

0. **Bajar el extracto de `IGN_1:curvas_1000` y commitearlo** (Track B0). Es el
   primer paso porque decide el resto: sin fuente, los pasos 2 y 3 se prueban
   contra terreno inventado, y el arenal —donde está el juego— hay que
   autorizarlo aunque la fuente sea honesta.
1. DTO de anchors/tramos/junctions + validator + patch editor.
2. Controles de terreno, solver determinista y wire separado.
3. `groundZAt`, `roadPoseAt`, continuidad/junction validation.
4. Migrar Ferrocarril de `elev: 1` a `embankment` con perfil 0→~1→0.
5. Reemplazar fixed drop-shadow/player lift por proyección desde `zM`.
6. Hoja y smoke del Ferrocarril, crossings y salida/entrada del terraplén.

### V4 — Cuestas/bajadas authoring + physics

1. Gráfico, lista de tramos y overlays del editor.
2. Authoring recta→cuesta→recta→bajada→recta.
3. Tramos de interconexión y junctions de cota compartida.
4. Puntos/contornos/crestas/mesetas y `terrain-grade` para montañas/barrios.
5. Hillshade, slope heatmap y secciones cut/fill.
6. Gravedad longitudinal y feedback de vehículo en ambos sentidos.
7. Grade-separated crossings/clearance.

## Gates

- Surface 0–10 no cambia de significado ni número.
- Todo valor vertical persistido tiene unidad `M` explícita.
- Ninguna sombra de asset duplica manualmente una silueta.
- La dirección de sombra viene sólo de `sunShadow`.
- Una transcripción se prueba antes de aceptar el rediseño visual.
- Perfiles son deterministas, continuos y validados en junctions.
- Un perfil puede expresar y editar recta→cuesta→recta→bajada→recta sin partir
  la calle XY en cinco features.
- Un fixture une esa calle a otra con cota compartida y transición válida.
- Un fixture de terreno crea loma, depresión y meseta; una calle puede seguirla
  o imponer rasante con cut/fill visible.
- El mismo tramo se prueba en ambos sentidos: uphill reduce y downhill aumenta
  aceleración dentro de límites de vehículo/superficie.
- Canvas/Pixi/editor consumen la misma altura/cota; no guardan copias.
- `pnpm inventory`, tests, build, snapshot y smoke real después de cada módulo.
- El loop usa el dev server HMR persistente; limpiar cache/reiniciar sólo ante
  evidencia de estado stale.
