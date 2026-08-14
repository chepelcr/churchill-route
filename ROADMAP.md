# La Ruta del Churchill — Roadmap

Audit date: 2026-07-05, comparing `docs/GAME_DESIGN.md` against the implementation.
The OSM world pipeline (`tools/build_world.py` → `churchill/world/` → `src/world2d/`)
and the three game modes are live; the items below are what remains.

## 🔜 El catálogo de assets — todo el juego en el formato de la feria

El inventario completo está en [`docs/inventory.md`](docs/inventory.md) (auditoría
2026-08-11): qué construye, carga, simula, dibuja y empaqueta el juego hoy, y
dónde el contenido autorado vive todavía como literal de JS o de Python. **Esa
tabla — §12, el registro de migración — es la lista de trabajo; esto es sólo el
orden en que conviene atacarla.**

`src/render/c2d/feriaAssets.json` es la plantilla y ya está en el árbol: 14 tipos
descritos como partes ordenadas con paleta y animación, contra un vocabulario
FINITO de 25 primitivas que sí es código. La prueba para decidir qué migra es la
del propio inventario: *¿esperaría un diseñador poder cambiar esto sin tocar el
motor?* Si sí, es data validada por esquema; si define física, streaming,
colisión o el intérprete, es motor.

**El orden importa y no es libre.** El inventario avisa (§7) que la migración del
render debe coordinarse con [`docs/RESCALE.md`](docs/RESCALE.md) y que **no** se
hagan como limpiezas independientes; y que Pixi **se queda** — el mar del boot es
Pixi vivo, y `scene.js` es material de migración, no prueba de duplicación.

### 1. La deriva ya confirmada (barata, y bloquea lo demás)

No son riesgos teóricos: §13 los verificó contra el manifest publicado.

- [x] **`malecon` no existía como estilo de muelle.** El manifest envía **4**
      piers `style:"malecon"` (las bajadas) y `structures.js` caía a `concrete`:
      se dibujaban como muelle de hormigón con baranda azul y lámparas. Arreglado
      en este commit — el caso exacto que §13.4 predijo.
**Cerrada (2026-08-11) por un vocabulario GENERADO**, no por corregir las copias
a mano — corregirlas es lo que ya se había hecho y es la razón de que divergieran.
`tools/gen_vocabulary.py` (`pnpm vocabulary`) lee `churchill/world/enums/` y
escribe `src/domain/vocabulary.generated.js` + `src/assets/vocabulary.generated.json`;
la generación es de UNA VÍA y los artefactos van al repo, porque el juego compila
con Vite y no puede depender de Python. `tests/test_vocabulary.py` es la
compuerta: 14 aserciones que fallan si un artefacto queda viejo, si el manifest
publicado no coincide clase por clase con el enum, o si un valor emitido no
tiene implementación en el renderer.

- [x] **El vocabulario de superficies ya divergió.** El editor lee ahora
      `vocabulary.generated.json` desde el juego (y **muere al arrancar** si no
      está, en vez de validar contra un vocabulario de tres fases atrás):
      superficies 10 → **11**, estilos de muelle 2 → **5**, `market` en la paleta
      de parcelas, `malecon` en la paleta de tiles (clase 10 se pintaba
      `undefined` — 54 623 celdas de frente de mar dibujadas como nada). El
      `SURFACE_CLASS_NAMES` de `npcs.js` queda sólo como último recurso, ya
      completo. Un test del editor que fijaba `classes.slice(8)` a mano llevaba
      una semana fallando y culpando al MUNDO: ahora compara contra el enum.
- [x] **Enteros de superficie crudos.** Los seis archivos usan `SURFACE.*`; el
      `const CLS_ACERA = 6` local de `flora.js` desapareció, y un test rechaza
      cualquier `surfaceAt(...) === <número>` nuevo.
- [x] **Las tablas de rango de calle no coinciden.** `RENDER_RANK` en el enum →
      `ROAD_RANK` generado, que Canvas consume: `living_street` **no tenía rango**
      y habría caído a `|| 0`, pintada debajo de las calles de servicio —
      latente, porque hoy el mapa no etiqueta ninguna, que es justo la razón por
      la que habría llegado a producción. `MAIN_ROAD` y
      `MAJOR` quedan como **dos** sets con nombre (`TRAFFIC_MAIN`, `YIELDS_TO`) —
      son dos preguntas distintas y el Paseo es la diferencia; un test exige que
      sigan siendo distintos.
- [x] **`Sign.kind` es `str`.** `SignKind` (10 miembros: todo lo que `drawSign`
      dibuja, no sólo lo que el build emite hoy) y `Sign.kind: SignKind` en el
      DTO, así que una errata **falla el build**. Un test exige que cada miembro
      tenga su `case`.
- [x] **`LandmarkType` no tiene `museum` ni `anchor`.** Añadidos; el test exige
      que los 26 tipos tengan despacho en `landmarks.js`.
- [x] **`aceraPx` en desacuerdo.** Un solo fallback, en el accesor que lee el
      manifest (`W.ACERA_PX`, `W.CUAD`). Un test recorre `src/` y falla si
      cualquier otro módulo lee `meta.aceraPx` por su cuenta.
- [x] **`Pier.style`/`surface`/`seaEnd` sin tipo.** `PierStyle`, `SurfaceName`
      (derivado de `Surface`, no re-escrito) y `LineEnd`. `surface` era
      `PathSurface | str`, que aceptaba `"paved"` y cualquier otra cosa.

### 2. P0 — impedir el desajuste data ↔ render

- [x] **Registro canónico de superficies.** Hecho 2026-08-11. La IDENTIDAD (id de
      wire, etiqueta, role sets) se genera desde `enums/surface.py`; las
      PROPIEDADES viven en `src/assets/surfaces.json`, un JSON versionado keyed
      por NOMBRE con `speed` + `day`/`night` por clase. Lo leen los cinco que
      antes tenían su propia copia: `src/game/surfaces.js` (`SURFACE_MUL`),
      `pixi/tileTexture.js`, `world2d/viewer.js`, el `pal` de
      `repository/debug_render.py` y la paleta del editor (vía `/api/surfaces`,
      con validador y entrada en el Data workspace).

      **Dos de las cinco copias estaban mal**, y ninguna se veía en review: el
      render de debug de Python dibujaba el bulevar `#d8d4c8` donde el Canvas, el
      Pixi y el editor dibujaban `#d9d6cd`; y `world2d/viewer.js` conocía **7 de
      11** clases, así que las dos calles sin pavimentar, el bulevar y TODO el
      malecón se pintaban magenta. `tests/test_world_surfaces.py` es la compuerta:
      cada clase con fila completa, colores `#rrggbb`, y un escaneo de `src/` +
      `churchill/` que **rechaza cualquier tabla clase → color** nueva (con el
      lookbehind que hace falta para no confundir `sky1: "#3a4a5e"` de una paleta
      de clima con la clase 1).

      Nota: `tools/debug_map.png` se regenera en el próximo build del mundo, que
      es cuando el bulevar pasa a su color correcto ahí.
- [x] **Capa de enums cerrada.** Hecho 2026-08-13. Los siete que faltaban:
      `StageKind`, `VehicleMedium`, `VehicleKind`, `RendererBackend` en un
      **`enums/game.py`** nuevo (lo que el JUEGO ramifica, no lo que el mundo
      contiene) y `HostKind`, `GeometryKind`, `EditorOperation` en un
      **`enums/editing.py`** nuevo (lo que el EDITOR escribe y el juego lee de
      vuelta — viven acá justamente porque el editor es otro repo). El
      vocabulario generado pasa de 10 a **17** enums; cada uno fue un miembro
      más una línea en `STR_ENUMS`, que es lo que decía la fila.

      `Stage.kind` deja de ser `str`. Era `Field(default="delivery",
      description="delivery | crossing")`: el contrato **documentado sin
      exigirlo**. Como `Manifest.model_validate` corre antes de cada escritura,
      ahora una errata **falla el build**, en vez de producir un nivel que carga,
      se lista, y arranca como reparto sin kiosko del cual repartir.

      17 literales reemplazados en 12 archivos. La compuerta nueva
      (`test_no_runtime_token_is_written_as_a_bare_string`) **cazó uno que se me
      había pasado** — `crossing.js:284` —, que es exactamente para lo que
      existe. **El mundo no cambia y se puede demostrar sin rebuild**: los DTO
      validan el emit pero no lo serializan (`world_json.py` hace `json.dump` de
      dicts), y un `StrEnum` ES su string. 51 tests (antes 45), snapshot de 1001
      archivos byte-idéntico, los cinco smokes en verde.
- [x] **`src/assets/vehicles.json`.** Hecho 2026-08-13. Un vehículo estaba
      repartido en CUATRO archivos que había que editar juntos: los stats en
      `game/vehicles.js`, el precio en `economy.js`, la voz del motor en
      `audio.js`, y el arte como una rama de una cadena `if/else` de 90 líneas
      en `c2d/entities.js`. Ahora es **un registro**, y `vehicles.js` es un
      lector como quedó `surfaces.js`.

      **El arte también** — que era la mitad difícil. Los nueve se re-escribieron
      como `parts` ordenadas en un DSL finito (mismo patrón que
      `feriaAssets.json`): `rect`, `roundRect`, `poly` con tramos cuadráticos,
      `ellipse`, `disc`, `stripes`, `stroke`, `strokeRect`. Las coordenadas son
      `[k, px]` = *k · semieje + px*, que es exactamente la aritmética que el
      arte a mano ya hacía (`-veh.w/2 + 3` es `[-1, 3]`) — por eso se pudo
      transcribir sin mover un pixel.

      **Y LA SOMBRA SALE DE LAS MISMAS PARTES.** `traceVehicleSilhouette` era
      una SEGUNDA cadena `if/else` a mano al lado de la del sprite: una forma
      que puede derivar, y un vehículo podía dibujarse bien y proyectar la
      sombra de otro sin que nada lo dijera. Hoy una parte lleva
      `silhouette: true` y entra en las dos, o `"only"` y entra sólo en el
      contorno — que es lo que necesitan las dos ruedas, porque la sombra de una
      bici es una cápsula alrededor de cuadro Y ciclista, no ninguna pieza
      pintada.

      **Verificado pixel por pixel**: `tools/shot-vehicles.mjs` dibuja los nueve
      con sus dos pintores y `tools/png-diff.mjs` compara. **310 500 pixels,
      cero distintos.** La primera pasada dio 562 con delta de canal 1, todos
      sobre partes `rect`: había cambiado `fillRect` por `beginPath+rect+fill`,
      que no son el mismo rasterizador en coordenadas fraccionarias. El sprite
      usa `fillRect`; la silueta sigue usando `g.rect`, como siempre.

      Queda motor: la física, la síntesis WebAudio y los dos intérpretes.
      `tests/test_vehicles.py` (11 casos) cuida los empalmes — una `shape` que
      nadie implementa se SALTA en silencio, o sea un vehículo al que le falta
      una rueda. Y un medio sin vehículo gratis no se ve feo: deja al jugador
      dentro de una pared en medio del estero.

      Anotado y **no** arreglado: las tres lanchas no tienen voz y caen a la del
      scooter, así que un fuera de borda suena a moto. Es el comportamiento
      publicado; darles voz es un cambio de audio, no una migración.
- [x] **`src/assets/world-props.json`** (landmarks). Hecho 2026-08-13. El
      `switch (lm.type)` de **26 ramas** de llamadas Canvas crudas en
      `c2d/landmarks.js` es ahora un recorrido sobre el catálogo. 23 de los 26
      tipos son data.

      **Tres NO se movieron, y ésa es la línea.** `lighthouse`, `stadium` y un
      `park` marino son ESCENAS, no arte: el faro barre un haz con el reloj, el
      estadio recorta césped y graderías contra una huella que emitió el BUILD,
      y el parque marino rellena un residual multi-anillo con even-odd. La lista
      de §12 de "qué no convertir" son exactamente ésas — un stream de comandos
      Canvas sin restricciones no se vuelve JSON.

      **Y el intérprete quedó UNO** (`c2d/shapes.js`). `paintVehicle` y
      `drawLandmark` resolvían el mismo problema dos veces; ahora comparten la
      tabla de formas y sólo difieren en el MARCO, que lo pone quien llama: un
      vehículo mide en semiejes de su propio cuerpo, un hito en píxeles desde su
      ancla.

      Verificado pixel por pixel con `tools/shot-landmarks.mjs` — **592 800 px,
      cero distintos**, y los vehículos siguen en 310 500 sin cambio después de
      colapsar los intérpretes. **Tres cosas que costaron una medición cada una**:
      (1) la primera hoja salió EN BLANCO las dos veces y el diff dijo
      "IDENTICAL" — el dev server no había levantado los archivos nuevos, así que
      el harness probaba el módulo viejo en ambas corridas; (2) `page.screenshot`
      no sirve acá, porque atar el `ctx` compartido a nuestro canvas también
      apunta el rAF del juego a él y para cuando se toma la captura el puerto
      entero está pintado encima — hay que leer el bitmap en la misma vuelta;
      (3) **el agrupamiento de trazos es contenido, no formato**: juntar el
      vástago, la cruz y los brazos del ancla en un solo `stroke` aclaró cada
      cruce ~30 niveles (384 px), porque dos `stroke()` que se solapan componen
      sus bordes antialiaseados DOS veces y un path unido no.

      `tests/test_world_props.py` (7). **Faltan parcelas y señales** en este
      registro: `PARCEL_FILL` ya vive en `materials.json` y `drawSign` sigue
      siendo un `switch` — es la siguiente pasada de esta misma fila.
- [x] **`src/assets/materials.json`.** Hecho 2026-08-13. Y lo primero fue
      **medir**, porque la fila decía "duplicados entre Canvas, Pixi y editor" y
      eso ya no era cierto: `canvas ∩ pixi = **0**` — el backend de Pixi no tiene
      un solo literal hex desde que lee `surfaces.json`. Lo que quedaba era
      `canvas ∩ editor = **40**`.

      De esos 40, varios sólo COMPARTEN UN NÚMERO: `#e85d75` es la pintura del
      scooter, la cabina de un juego de la feria y el color por defecto de un
      feature del editor. La regla de §13 dice que un número idéntico en dos
      archivos no es automáticamente una constante, así que ésos se quedan donde
      están — juntarlos sólo habría movido el hard-coding de lugar.

      Lo que sí es una familia compartida entró: `parcel` (por `ParcelUse`),
      `green` (por `GreenType`), `pier` (las cinco recetas completas por
      `PierStyle` — no un color: costuras, barandas, lámparas, si el muelle va
      sobre el suelo), `street` (acera, caño, asfalto, paseo, la raya), `structure`
      y `minimap`. **Dos tintas del minimapa ERAN las cubiertas de los muelles**,
      con un comentario que decía de qué archivo las habían copiado; ahora las
      leen.

      **Y la migración encontró una deriva viva**: una región `park` autorada se
      previsualizaba `#5ba362` en el editor y se pintaba `#4f9d5b` en el juego.
      Nadie lo reportaba porque cada lado era coherente consigo mismo.

      Verificado como corresponde a un movimiento de DATOS: comparando las tablas
      viejas (desde git) contra el registro, campo por campo — 14 parcelas, 6
      verdes, 9 presets de terreno, 11 escalares y las 5 recetas de muelle, todo
      idéntico. **Una comparación de pixeles no servía acá**: las tomas del mundo
      tienen mar animado, y el piso de ruido medido con CERO cambios de código es
      2,1 % / 86,4 % / 46,1 %.

      El editor lo consume por `/api/materials` con validador y entrada en el
      Data workspace, igual que `/api/surfaces`. `tests/test_materials.py` (6) +
      `world-editor/tests/materials.test.mjs` (3).
- [x] **`src/assets/water.json`** + registro de dueños. Hecho 2026-08-13. Los
      presets de oleaje por clima, las razones con que se DERIVA la paleta del
      mar, y la dirección del oleaje (en VUELTAS, para que el archivo no lleve un
      literal irracional: 0,125 · TAU **es** π/4 y no un redondeo). Más el
      registro de qué backend dibuja qué familia — Canvas casi todo, Pixi las
      graderías/el túnel y el mar del boot, con la nota de que la escotilla
      `?canvas` obliga a que toda familia de Pixi tenga respaldo en Canvas.

      La paleta de CLIMA (cielo/arena/tierra/tinte) **no** quedó acá sino en
      `materials.json`: no es agua — la leen `ground.js`, `estero.js` y
      `canvas2d.js` — y `water.js` sólo deriva el mar de sus dos canales de agua.
      Verificado por datos: 32 valores de oleaje y 28 canales de clima idénticos.

- [x] **Las ESCENAS dejan de esconder su contenido.** Hecho 2026-08-13, a pedido
      del usuario y con razón: decir "es una escena, se queda en código"
      explicaba por qué no es una lista de partes, pero no **cómo la edita un
      diseñador**. Dentro del faro había colores de piedra, un rango de tamaños,
      tres posiciones de palma, cuántas frondas y cuántas bandas tiene la torre.

      La línea correcta no es *lista-de-partes vs código*: es **números y colores
      vs control de flujo**. Las 13 escenas leen ahora
      `world-props.json` → `scenes`: **las 13 paletas completas**, y en las
      cuatro primeras (faro, espacio verde, fuente, piscina) también las cuentas,
      escalas y proporciones. Conservan sus bucles, sus clamps y su hash
      determinista.

      Lo que sigue fuera de alcance desde el editor es **sólo lo que viene del
      MUNDO** — `lm.rim`, la huella del estadio, el residual del parque marino —
      y eso se edita en la capa de mundo, que es donde corresponde.

      Verificado: parcelas **608 000 px**, hitos **592 800 px**, escenas
      **343 200 px**, cero distintos en las tres, con las hojas pasando la
      compuerta de tinta.

      Queda: los offsets geométricos DENTRO de una receta (dónde cae la puerta de
      una escuela respecto de su pabellón). §13 dice que esos pertenecen al
      registro de forma del asset, no a la capa de enums — moverlos es convertir
      el código de dibujo en JSON con peor sintaxis, así que se hacen cuando esa
      familia tenga su propio DSL de forma, no antes.

- [ ] **LO QUE NO ES ARTE SINO MUNDO: las líneas de siembra y el verde.**
      Pedido explícito del usuario, y hoy NO es editable. Distinguir tres capas:
      - **la especie y su dibujo** — ya es data (`flora.json`): se puede cambiar
        qué palma, qué copa, qué paleta;
      - **el árbol individual** — ya es un feature en el editor (`tile.trees` /
        `tile.palms` se indexan), así que se puede mover u ocultar UNO;
      - **la LÍNEA como objeto** — no existe. La mediana de palmas del Paseo y
        la franja de árboles de León Cortés se DERIVAN en el build
        (`build_stage.py`): los tramos salen de `paseo_median_runs` sobre las
        calles que se llaman como el Paseo, y la franja va de la esquina de la
        primera cuadra (medida, no autorada) hasta 3 cuadras antes de la calle
        del muelle. Eso sobrevive un reescalado, que es su virtud, pero significa
        que nadie puede decir "extendé las palmas 200 m más al este".

      **SON DOS MECANISMOS DISTINTOS, y al jugador le parecen lo mismo.** Esto
      importa para lo que "incluir el Cocal" significa:

      | | Paseo / León Cortés | Cocal (avenida dividida) | Ferrocarril |
      |---|---|---|---|
      | dónde va | por el **medio** | por el **medio** | **al hombro NORTE**, corrida del eje |
      | qué emite | `stamp_paseo_median` → franja estampada + polilíneas en `tile.medians` | árboles sueltos | árboles sueltos |
      | suelo verde | **sí** (`materials.median`) | **no** | **no** |
      | colisión | **sí**, `CLS_ACERA` más ancho de lo dibujado | **no** | **no**, a propósito: la avenida de barro queda manejable |
      | huecos | dashes alineados a las bocacalles | continuo | **sí**, en cada cruce (`_near_crossing`) |
      | escala del árbol | — | hash de posición | `rng()` |
      | visible al editor | ahora, `median_<hash>` | ya, `tree_<hash>` | ya, `tree_<hash>` |

      Son **tres** mecanismos, no dos, y al jugador le parecen lo mismo. El del
      Ferrocarril ni siquiera va por el medio: se calcula la normal a la línea de
      centro, se desplaza `w/2 + 0.6·CUAD` y se fuerza al lado norte.

      Así que "darle suelo verde al Cocal (o al Ferrocarril)" **no es hacerlos
      editables**: es un CAMBIO DE COMPORTAMIENTO —pasan a estorbar al carro, y
      en el Ferrocarril eso está explícitamente descartado hoy— y por eso es una
      decisión aparte, no un efecto colateral de la migración. El esquema de
      abajo lo cubre con `blocks`.

      **Y el del Ferrocarril tenía un ancla muerta** (2026-08-13): un
      `FERRO_TREE_X0 = 6892` con un comentario prometiendo que la línea empezaba
      ahí. Ancla de la era del corredor, igual que la que tenía la mediana del
      Cocal sembrando cero. Medido: la ruta elevada va de x 26 200 a 57 648, así
      que la guarda **no podía dispararse nunca** y recortaba 0 puntos.
      Eliminada — no mueve un árbol, pero era un número que parecía una decisión
      y no lo era.

      **Segundo paso hecho (2026-08-13): LAS CUATRO LÍNEAS SON UN FEATURE.**
      Cada árbol o palma de una siembra derivada lleva ahora `line` — el nombre
      de la corrida a la que pertenece — y el editor emite **una fuente por
      corrida** (`planting_ferrocarril`, `planting_paseo_median`,
      `planting_leon_cortes`, `planting_cocal_median`) con su conteo y su
      centro, además de los árboles sueltos que ya indexaba.

      Ésa es toda la diferencia entre una línea que se puede editar y ~100
      registros anónimos: el editor deriva el id de un árbol de su geometría, así
      que sin `line` se podía ocultar UN árbol del hombro del Ferrocarril, nunca
      el hombro. El campo va sólo en las corridas derivadas; la siembra de patio
      no pertenece a ninguna y no lo lleva.

      **Primer paso hecho (2026-08-13): la mediana ya es DIRECCIONABLE.** El
      editor no la veía en absoluto — a diferencia de los muelles, que son
      globales y llevan id, la mediana se emite POR TILE y sin identidad (20
      tramos en 4 tiles), así que nada podía nombrar uno para ocultarlo o
      moverlo. Ahora se indexa con el mismo hash de contenido que ya usan los
      árboles y las calles: para un feature emitido y sin nombre, **la geometría
      ES la identidad**. Se puede ocultar y referenciar; todavía no alargar.

      **EL ESQUEMA DE UNA SIEMBRA — decidido con el usuario, aún sin
      implementar.** Una siembra no es una polilínea: es una FORMA con una
      ALINEACIÓN, y las dos son autoradas por separado.

      | campo | valores | qué decide |
      |---|---|---|
      | `form` | `strip`, `disc`, `triangle`, `square`, `free` | el contorno del cantero — una isleta puede ser un disco (rotonda), un triángulo (la cuña donde se cruzan dos calles), un cuadrado, una tira con ancho, o un polígono dibujado a mano |
      | `align` | `street`, `horizontal`, `vertical`, `free` | **cómo se orienta**: siguiendo la línea de centro de una calle nombrada, a los ejes, o exactamente como se dibujó |
      | `width` | metros | el ancho de la tira (`form: strip`) |
      | `mix` | clave de `flora.json` | qué se siembra |
      | `blocks` | bool | si estampa muro (`CLS_ACERA`) o sólo se dibuja — la mediana del Paseo SÍ, un cantero de adorno no |

      `align: "street"` es el que conserva lo bueno de hoy: la mediana sigue la
      curva real de la avenida y sobrevive un reescalado. Los otros tres son los
      que hoy no existen. Y el par forma/alineación es lo que evita el error de
      modelar esto como "una polilínea con ancho", que no puede expresar una
      rotonda ni una cuña.

      Falta para cerrarla: que el build CONSUMA una siembra autorada en vez de
      derivar las suyas (depende de la fila de `content.py` → JSON), y que el
      editor tenga la herramienta de dibujo con las cinco formas.

      **Las cuatro siembras derivadas que tienen que pasar por ese esquema** —
      son las que hoy están escritas a mano en `build_stage.py`: la mediana de
      palmas del Paseo de los Turistas (`paseo_median_runs`), la franja de
      árboles de León Cortés (`continuous_runs`, desde una esquina de cuadra
      MEDIDA hasta 3 cuadras antes de la calle del muelle), la línea del
      Ferrocarril, y la mediana de la avenida dividida del Cocal (Avenida 1 ×
      Avenida Alberto Echandi Montero, donde las dos calzadas se solapan en x).
      Las cuatro dejan de ser código y pasan a ser registros; la derivación
      geométrica se queda como el modo `align: "street"`, que es lo bueno que
      tienen hoy.

      Mismo patrón para el VERDE: hoy `manifest.greens` sale de `detect_blocks`,
      así que se puede pintar una región autorada encima pero no cambiar qué
      manzana el build considera verde.

### 3. P1 / P2 — la superficie de autoría

Detalle y autoría propuesta por fila: `docs/inventory.md` §12. Cada una es el
mismo movimiento que ya se hizo cuatro veces (superficies, vehículos,
materiales, hitos): sacar el CONTENIDO a un registro versionado, dejar en el
motor la física, el intérprete y las transiciones de estado.

- [x] **Terminar `world-props.json`: parcelas y señales.** Hecho 2026-08-13.
      El `switch (s.kind)` de **10 casos** de `drawSign` (`c2d/streets.js`) es
      ahora un recorrido sobre `signs`: los diez son data, incluidos el ALTO
      (octágono del Manual Centroamericano), la zebra, el tope y la banca del
      malecón. Lo que se quedó en el archivo es lo único que un catálogo no
      puede decir: **EL MARCO**. Seis de los diez se dibujan DENTRO de una
      rotación por el ángulo que el mundo midió contra el cordón, y la parada da
      media vuelta más cuando la calzada le queda del otro lado.

      **En parcelas la respuesta honesta fue que casi nada es arte.** De once
      cosas que `drawParcels` despacha por uso, **tres** lo son y se movieron —
      la parroquia (`props.churchLot`), la Virgen (`props.statue`) y la paradita
      (`props.parada`) — y **siete se quedan en código porque son ESCENAS**: la
      catedral, la Casa de la Cultura, las escuelas/kinders/campus, las
      gasolineras, el kiosco de parque, el río y el arbolado se dimensionan a sí
      mismos desde los semiejes de su propia parcela, con topes y conteos
      (`Math.max(3, Math.round(h / 12))` columnas, cancha marcada sólo
      `if (L > 70 && ph > 22)`, un pabellón por cada 46 px de frente, un scatter
      sobre hash de posición). Meterlas en JSON sería meter aritmética y
      condicionales en JSON, o sea un lenguaje de programación peor: es la misma
      línea que dejó el faro, el estadio y el parque marino donde están. Lo que
      sí pasó a data es **el despacho**: qué uso dibuja su propio edificio, con
      qué palabra y qué tinta lleva su pastilla, y las tres paletas de escuela.

      **Dos cosas se dibujaban DOS VECES** y ahora son una: la parroquia (el arte
      del landmark `church` y el edificio de la parcela `church`, en dos archivos
      distintos) y la caseta de bus (`drawParada` en gfx.js, llamada desde las
      dos listas de paradas). El intérprete estrena una parte `prop` que
      **inyecta** las partes de otro registro en el orden y el marco de quien
      llama, así que compartir no es volver a dibujar.

      **Verificado pixel por pixel en CUATRO hojas** (`tools/shot-signs.mjs` y
      `tools/shot-parcels.mjs` son nuevos; cada seña se dibuja derecha y girada,
      y **toda** parcela de la hoja va girada, porque la cuadrícula no es
      cuadrada a la pantalla): señales **198 000 px**, parcelas **608 000 px**,
      hitos **592 800 px**, vehículos **310 500 px** — **1 709 300 pixels, cero
      distintos**.

      **Tres mediciones costaron una corrida cada una.** (1) Un ancho es una
      DIFERENCIA, no una posición: `PATHS.rect`/`roundRect` usaban `X(p.w)`, que
      en el marco de un vehículo (origen en su centro) es correcto y en el de un
      prop (desplazamiento desde un ancla del mundo) da `ancla + w` — una cabeza
      de semáforo de 4 px dibujada del tamaño de la manzana, 11 531 px. (2) El
      `roundRect` nativo del Canvas y la composición de cuatro `arcTo` de gfx.js
      **no son el mismo rasterizador**: 11 px a un nivel de canal en las
      esquinas de esa misma cabeza. `PATHS.roundRect` pasa a los `arcTo`, que es
      la forma con la que se dibujó todo lo redondo de este juego. (3) **Las
      hojas de arte tenían una carrera con las tipografías**: se dibujaban en
      `domcontentloaded`, antes de que llegaran los woff2 propios, así que el
      lado que perdía la carrera medía sus pastillas en el monospace de
      respaldo — 5 724 px de "el arte se movió" que eran un Vite frío. Los
      cuatro harnesses esperan ahora a `document.fonts`.

      `tests/test_world_props.py` pasa de 7 a **19** casos (78 en total, antes
      70) y la cobertura de `SignKind` se muda ahí desde `test_vocabulary.py`,
      donde exigía un `case` que ya no existe.
- [x] **`churchill/world/content.py` → `content/world/*.json`.** Hecho
      2026-08-14, y era la fila de MÁS RIESGO del registro. `content.py` pasa de
      **472 líneas de literales a 133 de CARGADOR**: 38 hitos, 24 clientes, 8
      etapas, 12 distritos, 16 atracciones, las sondas y las paletas son data en
      seis archivos.

      **La compuerta fue un rebuild completo: 33 minutos, `1001 archivos
      byte-idénticos`**, sin un solo `WARN` nuevo (quedan los dos de siempre —
      una sonda de mar que da tierra y el canal de la lancha que se cierra en 18
      muestras). Antes de eso, una comparación profunda contra los literales de
      git: **19 tablas, 156 registros, idénticos en VALOR Y TIPO**.

      Lo que el cargador sigue haciendo, y por qué no es "un json.load": **las
      TUPLAS**. Una coordenada es tupla en este builder y JSON no tiene. La
      regla que no es obvia es `calles`, que es un **PAR DE LISTAS** (los
      nombres candidatos de cada una de las dos calles que limitan una manzana),
      así que "una lista cuyo primer elemento es una lista se queda lista" la
      rompe: lo que hace tupla acá es la ARIDAD, no el contenido. Y la clave
      aplica sólo en SU nivel — pasarla hacia adentro convertía también las dos
      listas.
- [x] **`src/game/economy.js` → `src/content/economy.json`.** Hecho 2026-08-14.
      Tasas de ganancia, las dos escaleras de mejora, los boosts, las pinturas y
      los packs de monedas. La BILLETERA se queda: acreditar, gastar, y sobre
      todo `ensureEconomy`, que es una MIGRACIÓN de saves viejos y equivocarse
      ahí le borra las monedas a alguien. Verificado campo por campo contra los
      literales. La prueba cubre lo que un humano no ve: que una escalera tenga
      **un nivel más que precios** (el nivel 0 es "ninguno", y de a uno menos la
      tienda vende un nivel que no hace nada) y que un `productId` de Play sea
      válido — **eso es plata de verdad**, y un id que no calza con la consola
      cobra y no acredita.
- [x] **`src/game/audio.js` → `src/assets/audio.json`.** Hecho 2026-08-14, y
      resultó más grande que una migración.

      **NO HABÍA MEZCLA.** Había exactamente UN nodo de ganancia en todo el
      juego —el master— así que mezclar no era algo que se pudiera hacer mal,
      era algo que no se podía hacer: el ambiente no se podía bajar respecto a
      los efectos. Ahora hay cuatro buses (`sfx`, `engine`, `ambience`,
      `music`), todos a 1.0, porque una ganancia de 1 en serie es
      aritméticamente transparente y el balance de hoy es el balance del que se
      escribió el archivo.

      **Y LOS SONIDOS AHORA SE PUEDEN EXPORTAR.** `renderOffline` vuelve a
      correr cualquier receta dentro de un `OfflineAudioContext` y devuelve el
      PCM; `pnpm audio:render` los escribe como **WAV** para un trailer o un
      video. El juego sigue sin un solo archivo de audio —la banda sonora
      completa cuesta cero bytes de descarga— pero ahora se puede sacar.

      Eso resolvió de paso el único vacío de verificación que quedaba en el
      repo: **el audio no tenía equivalente del diff de píxeles**. Ahora sí, y
      la lección se repitió: un **sha256 del PCM NO SIRVE** — renderizando la
      MISMA receta dos veces en la misma página, `coin` difiere 7,5e-9 y `horn`
      6,0e-8, porque los osciladores band-limited de WebAudio no son
      reproducibles al último bit. La huella es una **envolvente de 64 baldes
      RMS**, cuatro órdenes de magnitud arriba de ese ruido, y está PROBADO que
      caza un cambio real: 1,5 % de ganancia en un paso de una receta la mueve.
      **Las diez recetas: idénticas.**

      Dos recetas se quedan en código y el registro dice por qué: la `horn`
      recorre una tabla de intervalos doblando cada nota con una gemela desafinada
      0,6 % para que el par BATA —ese batido es lo que hace que suene a aire y no
      a un bajo— y `combo` es función de la racha.
- [ ] **`src/content/simulation.json`**: perfiles de población, tablas de
      encuentro, presets de bus/ferry/travesía/día/clima/marea desde `spawns.js`,
      `buses.js`, `crossing.js`, `daynight.js`, `tides.js`. El avance de
      entidades y la colisión se quedan.
- [ ] **`src/content/progression.json`**: grafo del tutorial, metas, grafo de
      desbloqueos, defaults de modo desde `tutorial.js`, `progress.js`,
      `modes.js`. Las transiciones de estado y la persistencia se quedan.
- [x] **Los efectos del vehículo son un repertorio.** Hecho 2026-08-14, a raíz
      de la pregunta "¿cómo están mapeadas las animaciones de los vehículos?".
      La respuesta honesta era: **no lo estaban**. `vehicles.json` era geometría
      estática y TODO el movimiento estaba soldado en `drawPlayer` como
      `if (afloat)` — la estela, los remolinos de giro, la sombra, la escora del
      casco y el viento de velocidad. Una lancha creada en el editor recibía el
      tratamiento de un carro y no había forma de decir otra cosa.

      Ahora `src/assets/effects.json` es el repertorio: **el algoritmo es del
      motor, la SELECCIÓN y cada número son del vehículo**. Se elige del
      repositorio (`turnWind` para el carro, `wake` y `heel` para la lancha) y se
      afina. El **orden de pintado es del REGISTRO, no de cada vehículo** — los
      remolinos y la estela van primero y la sombra encima —, porque eso es una
      propiedad de los efectos y no del barco.

      **El viento de velocidad no lo teníamos ni ubicado.** Lo notó el usuario
      manejando: 12 rayas blancas por el borde derecho de la pantalla arriba de
      240 px/s, al final de `render()`, sin nombre ni comentario. Es el único
      efecto en espacio de PANTALLA. Se documentaron sus dos rarezas de siempre
      sin cambiarlas: es un umbral y no una rampa, y se re-aleatoriza cada cuadro
      contra el borde derecho apunte la nave a donde apunte.

      También: `DELIVERY_BAG_MOUNTS` —cuatro puntos de anclaje por vehículo que
      seguían en el renderer— pasó a los registros de cada vehículo, y
      `drawCarriedCargo` dejó de ramificar por el NOMBRE del vehículo, que era
      el último lugar del renderer que conocía uno por nombre. Y `shapes.js`
      aprendió los cuatro verbos de movimiento de la feria (`spin`, `bob`,
      `swing`, `pump`): **el carrusel llevaba desde siempre siendo más editable
      que el carro del jugador**.

      Probado en **cinco hojas sintéticas: 2 043 700 píxeles, cero distintos**
      (`tools/shot-effects.mjs` es nuevo — las otras cuatro hojas dibujan el
      CUERPO y no podían ver ninguno de estos efectos). 14 pruebas nuevas, entre
      ellas la que no se puede ver en revisión: **todo parámetro que un pintor
      LEE tiene que estar definido**, porque si falta es `undefined`, o sea
      `NaN`, o sea que el efecto no dibuja nada y nadie se entera.
- [ ] **El renderer, módulo por módulo** — `docs/inventory.md` §14, medido
      2026-08-14 al preguntarse si *todo* Canvas2D puede ser data. Respuesta:
      **casi todo el ARTE sí, el COMPOSITOR no**, y son cuatro registros más, no
      una reescritura. 7 000 líneas, ~420 colores literales, de los cuales 418
      están en nueve módulos de arte y los dos núcleos que nunca deben ser data
      (el compositor y el intérprete) tienen **cero**. Lo que falta: el arte de
      NPCs y tráfico (`entities.js`, 107), el HUD (67), los ocho encuentros del
      estero (53), y el campo ferial más el malecón (78).
- [ ] **`src/assets/hud.json`** (P2): presets de layout/estilo del HUD y los
      materiales del minimapa (`c2d/hud.js`, 718 líneas). Las tintas del
      minimapa que eran cubiertas de muelle ya se fueron a `materials.json`.
- [ ] **Darle esquema a la feria.** `feriaAssets.json` es hoy la plantilla y es el
      único catálogo **sin** validador: falta DTO/versión y preview en el editor.
      Ahora comparte vocabulario de formas con `vehicles.json` y
      `world-props.json`, así que el validador puede ser el mismo.
- [ ] **Constantes de PWA/ads/IAP/URL de contenido** (P2) → config de build con
      defaults de producción versionados. La lógica del service worker y las
      llamadas de compra/anuncio se quedan.

**Fuera de alcance, decidido**: la estructura JSX de las pantallas a un esquema
de slots. Cambiar React legible por un lenguaje de layout casero es un mal
negocio, y el propio §12 duda de esa fila.

**Pero la parte de esa frase que decía que los tokens "ya le dan al editor
autoría real sobre las pantallas" era FALSA, y medirla costó dos minutos**
(2026-08-14): `src/styles.css` tiene **183 colores literales contra 34 usos de
`var()`** —o sea que el editor alcanza como un 16 % del color de la hoja— y
**`--warm` y `--kola` no se usan en NINGÚN lado de `src/`**: el formulario del
editor ofrece ocho perillas de paleta y dos no están conectadas a nada. Más 22
`@keyframes`, 61 declaraciones de tipografía, 49 radios y 18 sombras que no son
direccionables. Eso no es el esquema JSX descartado; es terminar la capa de
tokens para que los tokens lleguen de verdad a la hoja de estilos.

- [x] **Barrido completo de `styles.css` a tokens.** Hecho 2026-08-14. De **9
      tokens a 66**, y **cero literales de color o de tipografía fuera de
      `:root`** — antes eran 183 colores contra 34 `var()`.

      **Tres clases de token, y la diferencia importa.** Un COLOR (`--gold`) es
      un valor terminado. Un CANAL (`--fg-rgb`, `--surface-oklch`) es un color
      SIN su alfa, para los muchos lugares que quieren un color a doce
      opacidades: una hairline al 0,12 y un relleno al 0,06 son un color y dos
      decisiones locales, así que el alfa se queda en la regla que lo eligió —
      trece tokens para trece alfas de blanco sería un archivo peor, no uno más
      editable. Y una PILA (`--font-display`) es una lista de tipografías.

      **`--warm` y `--kola` se BORRARON.** Seguían sin un solo `var()` en todo
      `src/`: dos de las nueve perillas que el formulario ofrecía no estaban
      conectadas a nada. Una perilla que no cambia nada es peor que una que
      falta —quien la mueve concluye que el tema está roto—, y ahora hay una
      prueba que rechaza la siguiente.

      **La compuerta NO es un diff de píxeles**: tres de estas pantallas animan,
      así que un bitmap mide un cronómetro. Se compara el ESTILO CALCULADO de
      cada elemento (`tools/shot-styles.mjs`), que es exactamente lo que un
      barrido de tokens puede romper — un `var()` que no resuelve deja la
      declaración *inválida en tiempo de valor calculado* y la propiedad cae a
      su valor inicial, o sea texto negro sobre panel oscuro, sin un solo error
      en consola. **327 elementos, 6 pantallas y toda clase de la hoja:
      idénticos.**

      Dos cosas que costaron una corrida: `animation-play-state: paused` NO
      alcanza (congela cada elemento donde le tocó, y eso depende de cuánto
      tardó el bundle), y desde que Chrome tiene anidamiento CSS **toda**
      `CSSStyleRule` trae un `cssRules` vacío, así que un recorrido
      "si tiene cssRules, recursá" se salta la hoja entera y devuelve cero.
- [ ] **Las pantallas y las traducciones** (pedido 2026-08-14). Los tokens ya
      llegan a todo el color; falta la ESTRUCTURA. Hoy el editor autora
      `src/i18n/<lang>.json` y los overrides de copy, pero no puede agregar una
      pantalla ni reordenar la que hay. Antes de tocar JSX conviene medir qué
      parte es de verdad estructura y qué parte es copy — es la misma pregunta
      que §14 acaba de contestar para el renderer, y ahí la respuesta fue
      "cuatro registros, no una reescritura".

### 4. El reescalado

[`docs/RESCALE.md`](docs/RESCALE.md) lo mapea completo. El paso 0 (retirar la
cuadrícula como unidad de PANTALLA) deja el mundo byte-idéntico y es el que
conviene hacer antes de mover arte, para no re-medir dos veces.

- [x] **`BLOCK_MIN_CUADS = 6` rechazaba manzanas reales.** Hecho 2026-08-11 y,
      como decía la nota, **sin** el reescalado. Ahora es `BLOCK_MIN_M = 32`:
      **416 → 599 cuadras**, 566 → **383** verdes, y las 1 126 cuñas pavimentadas
      **sin cambio** — las 183 que se movieron salieron todas de las verdes, o
      sea de manzanas a las que no se les ponía ni una casa. `SLIVER_MAX_CUADS`
      pasa a `SLIVER_MAX_M2 = 1600.0` (idéntico). Sigue pendiente la definición
      **topológica** de manzana (cara del grafo de ejes), que es la pregunta
      correcta; el docstring de `detect_blocks` dice por qué el tamaño no lo es.
- [x] **Los blobs rurales ya no se rellenan de casas: son MONTE.** Hecho
      2026-08-12. 55 cuadras sobre 32 ha (el 95 % de todo el suelo de cuadra, la
      mayor de 270 M px²) se marcan `cuadra.wood` y el render las siembra —
      `service/woods.py` + `paintWoods`. **No pueden ser árboles emitidos**: ese
      suelo pide entre 300 000 y 950 000 y el mundo entero pesa 16,7 MB, así que
      el build dice sólo *esto es monte, de este tipo* (55 registros) y el
      lattice se recorre sobre el RECTÁNGULO VISIBLE — un bosque de 270 M px²
      cuesta las mismas ~60 candidatas por frame que uno chico. La contención es
      `surfaceAt === LAND`: una consulta de tile, más barata y más correcta que
      un punto-en-polígono de 6 392 vértices. Qué bosque lo decide la distancia
      MEDIDA al agua real (`manifest.hills` es un telón pintado, no elevación).
      Y el `decorate` deja de sembrar sus árboles de patio ahí, así que el mundo
      emite MENOS árboles que antes.
- [x] **El tope de edificios ya no ata, y el acantilado del este desapareció.**
      Hecho 2026-08-13. Con el monte fuera de `synth_buildings`, la demanda real
      del PUEBLO es **44 479** contra un tope de 80 000: los 193 271 de la
      medición anterior eran, enteros, las bandas de fachada de los 55 blobs
      rurales. El presupuesto deja de agotarse, así que el corte oeste→este ya no
      corta nada:

      | al este de x 68 000 | antes | ahora |
      |---|---:|---:|
      | edificios | 302 | **11 537** |

      Los pueblos de verdad de allá — el racimo de 56 en x 69–70 k incluido — por
      fin tienen vecinos. El total baja 80 894 → 45 218 porque esos 36 000 eran
      fachada rural que ahora es bosque, y el mundo pesa **16 481 → 12 980 KB**.
      El tope sigue siendo una carrera oeste→este por construcción; simplemente
      dejó de importar, y queda anotado por si el pueblo crece.
- [x] ~~**Los blobs rurales se rellenan como si fueran manzanas, y el tope lo
      tapaba.**~~ Cerrado por las dos filas de arriba. MEDIDO (2026-08-11) poniendo `SYNTH_MAX_TOTAL` en no-vinculante:
      el mapa pide **193 271** huellas, 2,4× las 80 000 de hoy. Ese número **no
      es un objetivo de densidad, es la evidencia de otro bug** — y desmiente la
      estimación de ~114 000 que estaba escrita aquí antes de medir.

      Lo que pasa de verdad: las huellas sintetizadas del mundo publicado **se
      cortan en seco en x ≈ 68 000** (1 198 por cada 1 000 px justo al oeste,
      **220 en los 12 000 px al este**), porque el presupuesto se gasta de oeste a
      este con un `return` en seco y simplemente se acaba. Así que los pueblos de
      verdad de allá — entre ellos un racimo de **56 edificios mapeados en
      x 69–70 k** — están sin vecinos. Subir el tope no arregla eso: **alfombraría
      4,8 km de costa rural**, porque entre las "cuadras" del este hay blobs de
      tierra de **339 MILLONES de px²** cuya sola banda de fachada pide decenas de
      miles de lotes. Un blob así no es una manzana — es exactamente lo que dice
      el docstring de `detect_blocks`: el umbral de TAMAÑO es la pregunta
      equivocada, y la respuesta es la definición topológica (`docs/RESCALE.md`).

      Tres cosas que arreglar, en este orden: (1) que un blob rural deje de
      contar como cuadra edificable; (2) que el presupuesto deje de gastarse por
      orden geográfico con un corte en seco — reparte o cuota por lugar, no una
      carrera oeste→este; (3) sólo entonces elegir el número. Pre-existe a
      `BLOCK_MIN_M`: la barra vieja de 48 m también truncaba en 80 000, y estos
      blobs inscriben 6x6 de sobra.
- [x] **Las parcelas se sentaban por la MANZANA más cercana, no por el asiento.**
      Arreglado 2026-08-11. Se entró a arreglar un templo 878 px peor sentado y
      resultó que había parcelas desplazadas por KILÓMETROS: una iglesia a
      10 538 px de su propio contorno mapeado, una gasolinera a 8 694, un parque a
      6 584, un jardín de niños a 5 874. La manzana se elegía por la celda más
      cercana y se comprometía con ella, pero el lote se encaja en el único
      rectángulo libre más grande de esa manzana — que en un bloque grande queda
      al otro extremo. Ahora se puntúa el ASIENTO: de cerca a lejos, con corte por
      cota demostrable. **Media 147 → 54 px** sobre las 430 parcelas con vía de
      OSM, peor caso **10 538 → 1 152 px**; 19 mejores y 6 un poco peores de las
      27 que se movieron (reclaman celdas en secuencia).
- [x] **Paso 0: retirar la cuadrícula como unidad de PANTALLA.** Hecho
      2026-08-14, y el mundo salió **byte-idéntico** (`1001 archivos`), que era
      justamente el punto de hacerlo antes de tocar la escala.

      Todo lo que dos runtimes tienen que medir igual vive en
      **`src/assets/world-units.json`, EN METROS**, y de ahí derivan sus píxeles
      el builder (`px(m)` en `config.py`) y el juego (`src/domain/units.js`).
      Hoy cada metro cae exacto en el entero que estaba escrito a mano — eso es
      lo que se prueba, y lo que hace que el paso no mueva nada.

      **La cuadrícula dejó de ser una decisión de pantalla.** El encuadre era
      `CUADS_PER_VIEW · CUAD`: la retícula con la que el BUILDER busca manzanas
      y corta lotes decidía cuánto veía el jugador, así que reescalar la
      retícula le reescalaba la vista a todo el mundo sin que nadie lo hubiera
      elegido. Ahora la cámara encuadra **160 m de suelo**.

      **Y el piso del zoom era el que de verdad decidía.** El `2.2` pelado de
      `computeZoom` manda en toda pantalla de menos de 880 px CSS — o sea, todo
      teléfono en horizontal — y es una MAGNIFICACIÓN, así que tiene que BAJAR
      cuando el mundo gana píxeles por metro; subirlo, que es lo intuitivo,
      recorta un teléfono de 145 m de vista a 57. Escrito como **px de pantalla
      por METRO** (5,5) ya no se puede equivocar, y hay un test por cada lado.
      No existe un `MAX_VIEW_M` fijo que anotar: la vista que ese piso permite
      es `wCss / 5,5` metros, o sea que depende de la pantalla — el nombre que
      esta fila pedía habría escondido eso.

      **Comprobado contra la fórmula vieja en once anchos** (320…3840, incluido
      el cruce exacto en 880): **idéntica en todos**.

      Y de paso las cuatro contratos numéricas que §13 pedía separar: la
      **lancha** resultó ser una CUARTA copia del contrato del ferry (un
      `(86, 34)` / `dockS 20` escondido en `service/lancha.py`, que encontró el
      test del ferry); el `default=[124, 46]` del DTO se fue, porque un default
      de esquema sólo puede tapar a un productor que dejó de emitir; `pitch` y
      `tangentSpan` del canal ya no están escritos dos veces; y **el reloj**:
      `180` significaba dos cosas (Arcade y el largo por defecto de una etapa) y
      `999` significaba "sin reloj" — Recorrer lo descontaba y lo volvía a poner
      en 999, una cinta de correr sin espectador, porque el HUD ahí no muestra
      cronómetro. Una corrida tiene reloj o no lo tiene (`UNTIMED`), y el HUD
      pregunta eso en vez de recitar nombres de modo.

## ✅ El malecón llega a la acera, el Paseo tiene feria, y la Travesía es un nivel (2026-08-11)

- [x] **El malecón es uno solo y pegado a la acera.** La sonda caminaba 30 m más
      allá del cordón y la distancia real cordón→arena tiene **mediana 94 px**
      sobre 1 589 secciones: **el 7 %** alcanzaba a ver la arena. A 70 m, con
      enlace de 60 m sobre el solar. **7 bandas → 6, y las 6 llegan a la calzada**
      (eran 2; cuatro no tocaban nada — 6 746 celdas inalcanzables).
- [x] **El malecón ya no es transitable.** Bajadas re-estampadas `ROAD`, campo
      ferial con entrada, y `stamp_pad` atraviesa la clase 10 — `c3` quedaba
      parada sobre un muro y la compuerta lo cazó (`46/47 POIs`).
- [x] **La plazoleta del faro** se cierra contra su cordón y se dibuja con el
      empedrado del malecón en gris. La línea amarilla era `CLS_LAND`, no arena.
- [x] **Los kioscos del Paseo** en su ancla de OSM con calle auxiliar; techo
      mapeado duplicado eliminado.
- [x] **La feria**: un campo de barro frente a La Takería, 12 juegos + 3 chinamos,
      y el arte en `feriaAssets.json`.
- [x] **La Travesía**: ruta por la cresta del agua + canal dragado + canal
      **medido** (`Channel`), casco propio (`boat.js`), y la marea dejó de cerrar
      el canal dibujado. **Boyas en tierra: 91/196 → 2/122, cero en portones.**

Pendiente de este bloque:

- [ ] **Las 2 boyas que quedan en tierra.** El render las suprime (`buoyWet`) y
      `smoke:crossing` sostiene la línea dura en los portones con un presupuesto
      de 5 % para las simples. Es un paracaídas, no el arreglo.
- [ ] **`smoke_sea` falla dos aserciones de pescadores** — verificado que falla
      igual en `HEAD`, anterior a este trabajo.

## ✅ El Mercado Municipal ocupa su manzana (2026-08-07)

Un sitio de OSM cuyo contorno **es** una manzana ahora se arma como los estadios:
la cuadra es su suelo (`"cuadra": True`, `FieldService._manzana_ground`).

- [x] **El Mercado existe.** Centroide a **1.7 px** de la vía de OSM proyectada,
      rumbos a ~1° de la cuadrícula real, los 4 vértices mapeados, **99.4 % land**
      bajo la parcela (3 celdas de calle + 1 de acera = cuantización del ráster).
- [x] **El delantal ya no parte la manzana.** El apron de `stamp_pad` bajo el
      propio punto del Mercado se reclama a tierra: red manejable 90.4 %,
      **47/47 POIs ok**, 267 celdas menos (exactamente el delantal).
- [x] **Landmark ↔ sitio unidos** (`osmRef == "way/<id>"`), rótulo re-anclado al
      centro de la parcela.

Pendiente, y **no** lo arregla este cambio (ver `docs/RESCALE.md`):

- [x] **`BLOCK_MIN_CUADS = 6` rechazaba manzanas reales.** Arreglado 2026-08-11
      expresándola en metros (`BLOCK_MIN_M = 32`), independiente del reescalado
      como decía esta nota. Detalle y censo medido en §4 de arriba.
- [ ] **El reescalado del mundo** — `docs/RESCALE.md` lo mapea completo: por qué
      ninguna proyección lo arregla (el carro mide 7.6 m de ancho), las tres
      variantes con sus números medidos, el piso de zoom que en teléfono decide
      el encuadre en lugar de `CUADS_PER_VIEW`, y retirar la cuadrícula como
      unidad de PANTALLA (paso 0, deja el mundo byte-idéntico).

## ✅ El malecón del Paseo de los Turistas (2026-08-06)

La franja de arena entre la calle y la playa pasa a ser **superficie propia**
(`Surface.MALECON`, clase 10): baldosa transitable pero lenta, con su arboleda,
sus bancas, su feria y su gente. Cierra además cuatro cosas que el reescalado
1.6 → 2.0 había dejado rotas en silencio.

- [x] **Veinte metros ganados al mar** (`reclaim_shore`), sólo en el frente de
      los dos paseos: la playa pasa de 88-150 px a 128-190. Acotada por corredor
      (a lo ancho del mapa duplicaba la arena del mundo) y por un rayo que se
      niega a cerrar un canal.
- [x] **Las aceras se leen limpias**: las parcelas se pintan ANTES de la banda
      de acera, y la que tiene tierra donde mudarse se re-encaja dentro de ella
      (`PARCEL_ACERA_MAX`) — como mejora, nunca como motivo de borrado.
- [x] **El Lito Pérez tiene acera**: el anillo del estadio de cuadra completa
      pasa a la profundidad de una MANZANA (12 px, no los 8 de una parcela) y se
      dibuja después de la banda de la calle, no antes. Es la única acera que
      ese bloque tiene.
- [x] **El malecón** (`churchill/world/service/malecon.py`). Ancho en METROS,
      con veto de la arena (siempre sobrevive playa del lado del mar), sólo
      convierte `CLS_BEACH`, reserva los sitios de OSM que ya están al frente
      (parques, canchas) y abre entradas en los huecos del camellón. Emite
      `manifest.malecon` (contornos del ráster + el ángulo del Paseo).
- [x] **Ningún kiosco dentro del mar.** `nudge_off_water` +
      `KIOSK_WATER_CLEAR_PX`, aplicado tras el reasiento y verificado en
      `finish.verify` — lo que tiene que librar el agua es el DIBUJO del
      chinamo (32 px + sombra), no su ancla.
- [x] **Se acabó el asfalto sobre la arena.** Los kioscos del Paseo se paran en
      el malecón; las bajadas del muelle quedan como único acceso marcado a la
      playa, pavimentadas como paseo (`style="malecon"`).
- [x] **Un solo color de arena.** `sand_outlines` traza la playa del ráster
      terminado: lo dibujado es exactamente lo que uno pisa.
- [x] **La plazoleta del Faro llega a la calle** — las bolsas de arena
      encerradas se pavimentan con la explanada.
- [x] **El Parque del Muellero existe** (`trace: True`, como Mora y Cañas).
- [x] **Vida**: `playero`, `jugador` (con mejenga y bola) y `paseante`.
- [x] **Feria**: carrusel, rueda de Chicago, chocones, tómbola y **DJ Urtech**
      frente a La Takería, con música procedimental cuya DISTANCIA ES UN FILTRO.

### ✅ Las manzanas como recipientes (2026-08-06, segunda pasada)

- [x] **Reescalado 2.0 → 2.5 px/m** con `ARCADE_STREET_MUL` 2.9 → 2.32: cada
      calle conserva su ancho EXACTO en pantalla y todo lo medido en metros
      crece. Lo que el corredor le quita a cada manzana baja de 12.8 m a 9.5.
- [x] **`fit_manzana_contents`**: las huellas de cada manzana se ajustan EN
      GRUPO a su propia tierra, dentro del anillo de acera. 228 encajadas,
      mediana 0.78 sobre 26 manzanas. 130 de 60 304 celdas con nombre tocan
      calle o acera (3 calzada). 413 edificios conservan su contorno real.
- [x] **Toda ancla es geo**, y una cuadra hecha a mano que resuelve a nada
      REPRUEBA el build — así no se vuelve a perder el centro cívico en
      silencio.
- [x] Relojes de etapa escalados con el mundo.

### 🔜 Lo que sigue en el malecón

- [ ] Son 7 bandas y sólo 2 tocan la calzada. Las otras 5 son tramos del frente
      de León Cortés separados por el muelle y sus aprons; falta decidir si se
      les abre entrada o si se dejan como frente peatonal.
- [ ] El malecón se corta entre el Faro y x≈15500 porque entre el Paseo y la
      arena hay solares mapeados hasta la punta. Falta decidir si el paseo
      peatonal sigue por detrás de ellos o si termina honestamente ahí.
- [ ] Las atracciones no bloquean (la banda mide 60 px y es el único camino a
      los kioscos del Paseo). Si alguna vez la banda se ensancha, valdría
      estamparlas como el camellón.
- [ ] Quedan 36 parcelas pisando >25 % de acera — las capillas, escuelas y
      gasolineras mapeadas que no tienen tierra propia. Se ven bien porque la
      acera se pinta encima, pero el lote sigue estando ahí.

## 🔜 La Travesía del Estero — un NIVEL, no un minijuego

Diseño cerrado 2026-08-01. La lancha a Pitahaya ya cruza sola (19 waypoints
derivados del agua, 6.92 km, 74 s). Hoy la travesía es tiempo muerto: uno se
estaciona y espera. Se convierte en **un nivel propio**, para que el juego
principal no se vuelva repetitivo.

**Dónde vive.** Sólo en **Recorrer** y en su entrada de menú. En Historia y en
Arcade la lancha se queda amarrada — un `state.mode === "explore"` en el
abordaje, nada más.

**No hay transformación.** Uno se sube CON el carro, como al ferry de Paquera:
el carro va en cubierta y uno toma el timón. Abordar ya es consentimiento
(estacionarse y sostener la posición 7 s), así que no hace falta ningún modal;
zarpar automáticamente al tocar el muelle sería una trampa.

**Recorrer y Nivel se diferencian en el timón:**

| | Recorrer | Nivel |
|---|---|---|
| entrada | abordar en el muelle | menú de niveles / minijuegos |
| timón | libre: se puede virar a media travesía y volver a amarrar | una sola dirección |
| golpes | cuestan tiempo | **barra de daño: tres golpes y al agua** |
| final | cualquiera de las dos orillas | llegada, con tiempo + peces |

### 1. El canal se lee en el agua — boyas + corriente

- [x] **Boyas rojas y verdes** por toda la ruta, rojo a babor y verde a
      estribor, cada ~300 px y más juntas en las curvas. Se derivan de la
      polilínea de la lancha EN EL CLIENTE (no hacen falta datos nuevos: la ruta
      ya está en `manifest.ferries[].route`), cabecean, y de noche parpadean.
- [x] **Redibujadas en planta** (2026-08-04): estaban dibujadas de PERFIL —
      un mástil y una lámpara subiendo por la pantalla— dentro de un juego
      cenital, que es por lo que se leían como un asset ajeno. Ahora llevan la
      sombra, el anillo de espuma y el borde oscuro del resto del agua, y el
      tope dice la forma además del color (cuadro a babor, círculo a estribor).
- [x] **Corriente**: el agua DENTRO del canal se dibuja más calma y un tono más
      clara, con estelas corriendo a lo largo de la ruta. El canal se lee de
      cerca (boyas) y de lejos (agua).
- [x] Nada de flecha en el HUD: el estero son 7 km de agua abierta y la
      navegación tiene que ser diegética.

### 2. Los obstáculos — cada uno con su conducta

- [x] **Pangas de pescadores** con NPC pescador a bordo (tipo `fisher` en
      `npcTypes.json`, movimiento `stationary`). Golpe = empujón y **un punto de
      daño**. Se **mueven** cruzando el canal como la lancha del balneario: un
      obstáculo fondeado se aprende una vez, uno que trabaja hay que leerlo.
- [x] Una sola panga en todo el puerto: se sacó el casco de `drawBoat` a
      `traceHull`/`paintHull` y el estero dejó de tener su propio bote dibujado
      aparte.
- [x] **Bancos de peces** — cardumen bajo el agua. NO son daño: son la razón
      para salirse de la línea.
- [x] **Hordas de gaviotas** — tapan la vista un instante. `state.gullBlind`
      llevaba desde que se escribió sin que NADIE lo dibujara; ahora se ve.
- [x] **Raíces de mangle** pegadas a la orilla: cobran cortar la curva por
      dentro. **Un punto de daño.**
- [x] **Remolinos en toda travesía**, no sólo en tormenta — era el único
      obstáculo con un verbo distinto (jala) y faltaba del nivel normal. Ahora
      además TUERCE el rumbo: `_crossing.spin` se calculaba y nadie lo leía.
- [x] **Tres golpes y se hunde**: vuelta a la última boya-compuerta. En Recorrer
      el golpe sólo cuesta tiempo.

### 2b. Se maneja la lancha (2026-08-04)

- [x] **La lancha es un VEHÍCULO**, no una plataforma con el carro encima:
      `medium: "water"` en `vehicles.js` y el colisionador se invierte — el agua
      es el suelo y todo lo demás es pared. Tres cascos comprables (Panga de
      trabajo gratis, Lancha taxi ₡600, Deslizador ₡1400) con los mismos
      swatches de pintura que los carros.
- [x] **Se acabó el riel.** `crossing.js` dejó de manejar el bote: ahora
      `projectToRoute` recupera dónde va uno sobre la ruta, y de ahí salen el
      avance, las compuertas, la meta y el "vas al revés".
- [x] **Compuertas cronometradas**: cada 4 pares de boyas es una compuerta —
      +6 s y punto de control. No costó geometría nueva, las boyas ya venían de
      a dos.
- [x] **EL NIVEL SE PODÍA PERDER PERO NO GANAR.** `endCrossing("landed")`
      escribía `_crossing.done` y **nadie lo leía**: el único `state.won` del
      juego estaba en `delivery.js` y s8 no tiene entregas. Llegar a Pitahaya y
      hundirse eran el mismo final. Arreglado, con récord de tiempo y de peces.

### 3. El manglar: el estero deja de tener playa

- [x] **Sin línea de arena en el estero.** `beach_fringe` ya distingue el mar
      abierto del estuario. Nada en el OSM dice cuál agua es cuál, así que se
      DERIVA de la forma de la tierra: la lengüeta se traza (columnas con agua a
      los dos lados, encadenadas mientras la costa del Pacífico se mueve poco, y
      gana la cadena más larga — 19.7 km contra 1.6 km del segundo, así que no
      es una decisión reñida). Desde ahí se camina al norte: agua es estuario, y
      una tira de tierra angosta es una isla dentro de él, no la otra orilla.
      `topY[col]` NO servía: a esa altura la primera tierra de la columna es el
      continente, a 11 km.
- [x] **Mangles en toda la ribera** — **1225 registros** repartidos en 24 tiles
      (antes había 66, alrededor del estuario de Mata de Limón, y **no llegaban
      a ningún lado**: el manifest los emitía vacíos y ningún renderer los
      dibujaba). Se leen POR TILE, como los árboles y las palmeras.
- [x] **Raíces sobre el agua**: el mangle se dibuja parado sobre sus raíces
      zancudas, con el barro descubierto en bajamar y sumergido en pleamar.
- [x] Cambio de ráster: rebuild + `world_snapshot.py save` en el mismo commit.

### 4. Entrada de menú

- [x] ~~Sección de Minijuegos/Niveles~~ — **descartado por decisión de diseño
      (2026-08-05)**. La Travesía es una ETAPA de Historia, la número 8, y se
      entra por el mismo carrusel que las otras siete. Una pantalla aparte para
      un solo nivel era un menú buscándose contenido.
- [x] Copy en `src/i18n/<lang>.json` — nada de texto suelto en JSX. Incluye el
      `s8` que le faltaba a `stages.json`: en inglés se veía el brief en
      español.
- [x] Récords (mejor tiempo, peces) en `progress.js`, junto a los de etapas, y
      mostrados en la pantalla de resultados — que además deja de reportar
      "0/0 entregas" y "×1 combo" después de cruzar 7 km de estero.

## ✅ Parcelas diagonales + porterías centradas (2026-07-29)

- [x] Los contornos derivados del ráster conservan sus celdas exactas para
      colisión/ocupación, pero el vector emitido une directamente los extremos
      de una diagonal. Catedral, parques y estructuras cívicas ya no muestran
      escaleritas de 4 px.
- [x] Parque Mora y Cañas conserva el contorno seguro de su cuadra en vez del
      rectángulo inscrito: vuelve a la esquina oeste y sigue el borde diagonal
      norte sin pintar sobre la calle.
- [x] Porterías centradas en los extremos oeste/este de Lito Pérez y Las
      Playitas; Plaza Deportes El Carmen usa norte/sur. Boca y fondo escalan con
      el lado corto de cada cancha, así que la plaza chica lleva porterías
      proporcionalmente menores.

## ✅ La ciudad real: parques, escuelas e iglesias desde OSM (2026-07-27)

Publicación: [La ciudad de verdad](docs/changelog/2026-07-27-parcelas.md).

**Se acabaron los parques inventados**
- [x] Eliminado el esparcido de **16 cuadras verdes sintéticas** (`park_syn_*`,
      todas con el nombre "Parque") en `seat_town_kiosks`. Era un relleno de
      antes de que existiera el sistema de parcelas, y es lo que se veía.
- [x] Los verdes que sí venían de un lugar real —Parque Marino, Parque El Cocal,
      Balneario— siguen igual: los pinta la pasada de landmarks.

**`extract_sites` — el SUELO que ocupa un lugar** (`service/osm.py`)
- [x] Hermana de `extract_buildings`: las **áreas cerradas** de OSM que son
      suelo, no edificio. Seis familias en orden, gana la primera:
      `worship` / `kinder` / `school` / `campus` / `pitch` / `park`.
- [x] Solo **vías cerradas** (una vía abierta es una cerca), ordenadas **por id
      de OSM**: el orden del emit no puede depender del orden del archivo.
- [x] Un *jardín de niños* o un *CEN-CINAI* etiquetado `amenity=school` se
      reclasifica **por su nombre** — es un patio con aulas, no una escuela.
- [x] `landuse` entra en `keep_keys` del parser.

**`place_osm_sites` — de un contorno de OSM a una parcela** (`service/field.py`)
- [x] El caso general de lo que `place_parcels` hace a mano. Celdas bajo el
      contorno → **solo las que son suelo de cuadra** (`LAND`/`ACERA`), que es
      lo que mantiene la parcela fuera de la calzada y le hace seguir exacta una
      avenida diagonal.
- [x] El suelo ya repartido gana, medido **celda por celda** (no por CUAD: a
      20 px dos sitios a lado y lado de la misma calle comparten celda, y la
      Iglesia de Las Playitas salía "reclamada" por el estadio de enfrente).
- [x] **Anillo de acera graduado** (5 → 2 → 1 → 0 celdas): una parte hecha a
      mano es un cuarto de manzana y aguanta 20 px por lado; una capilla de
      33x40 px no. Medido contra el **componente conexo más grande** — una
      erosión no solo encoge un lote, lo parte, y `outline_poly` se queda con el
      lazo más grande.
- [x] El ángulo sale de la **calle más cercana** (`StreetIndex.angle_at`),
      plegado a la familia de las avenidas (-45°, 45°]. Nunca de un ajuste de
      las celdas de la propia parcela.
- [x] Una cancha chiquita **ya no borra su barrio**: un sitio marca su cuadra
      verde (sin casas sintéticas) solo si ocupa ≥60 % de ella.
- [x] Los que no entran quedan en el log con la razón y los números, uno por
      línea. Un lote de mentira en media calle es peor que no tenerlo.

**Las parcelas, trazadas como pedazos de cuadra**
- [x] Una parcela de OSM es ahora un **RECTÁNGULO en el marco de su manzana**,
      como las partes del bloque de la Catedral. El trazado del contorno daba
      manchones: 257 de 377 con más de 8 vértices, 109 con menos del 60 % de
      relleno. Las **380 son de 4 vértices**, y el manifest baja a 574 KB.
- [x] El rectángulo se ajusta por **percentil**, no por mín/máx: un brazo
      delgado del contorno del mapeador estiraba el lote entero sobre la calle,
      y un encogido iterativo se comía un campus de 883 celdas hasta 12x10 px.
- [x] **Las aceras volvieron**: 42 parcelas no tenían ninguna. El criterio ya no
      es cuánta ÁREA sobrevive a la erosión —un rectángulo erosionado por sus
      cuatro lados pierde legítimamente la mayor parte de un lote chico— sino si
      lo que queda sigue siendo un lote. Las degradadas pasaron de 169 a 90.
- [x] `hw`/`hh` (medias extensiones sobre `ang`) viajan en cada parcela y en los
      dos estadios: todo lo que se dibuja encima se medía del bbox alineado a la
      pantalla, que en una parcela girada es más grande que la parcela.

**Se fueron los rectángulos blancos vacíos**
- [x] `drawSchool` trazaba un `strokeRect` blanco como "patio" en las 85
      escuelas. Un patio es suelo, no un contorno.
- [x] `paintField` pintaba marcas de fútbol en las 79 canchas — **27 miden menos
      de 60 px de lado corto y 21 son de basket**. Ahora hay **dibujo por
      deporte** (`sport` desde OSM) y **nivel de detalle**: el basket con su
      llave, círculo y aros sobre concreto; el fútbol con lo suyo; y la cancha
      muy chica con gramado y kerb, sin marcas que no caben.

**Partido en la cancha, y el gol paga**
- [x] **Jugadores en vez de hinchada** en toda cancha con deporte y espacio, los
      dos estadios incluidos: dos equipos con portero, una bola que se dribla,
      se tira a la esquina y rebota en las bandas.
- [x] La **lluvia de monedas sale del gol**, no de un reloj. Se mantiene todo lo
      que la hacía premio y no salario (tope repartido, desvanecido, guardia de
      footprint, enfriamiento).
- [x] **El carro juega**: empuja la bola con la fuerza de su velocidad y los
      jugadores se apartan. Se puede anotar manejando.
- [x] **Cada cuánto se anota es una perilla**, no una propiedad emergente: una
      cancha mide 60 px y el Lito Pérez 210, y con los mismos números una
      anotaba cada 6 s y otra nunca. El portero ataja todo hasta que se cumple
      el reloj; el siguiente ataque entra.
- [x] `src/game/match.js` no importa nada (como `vehicles.js`), así que
      `tools/match_check.mjs` lo corre **bajo Node contra las canchas reales**:
      la bola nunca sale del gramado, las 58 jugables anotan cada 26–60 s y el
      carro puede anotar. Es la prueba que si no habría que hacer a ojo.

**Iglesias y escuelas dibujadas como lo que son**
- [x] Una vía de `place_of_worship` **es** el edificio: su footprint se quita
      (como `clear_buildings` en la manzana civil) y la parcela dibuja la
      silueta — nave, campanario, aguja y cruz, en el ángulo de su cuadra.
- [x] Tres usos nuevos en `ParcelUse`: `school`, `kinder`, `campus`, con su
      color de patio en `PARCEL_FILL` y `drawSchool` en `drawParcels` —
      pabellón contra el fondo del lote, puertas de las aulas en fila, patio con
      su cancha y el asta de la bandera. `campus` reparte hasta 4 pabellones.
- [x] **Un solo nombre por lugar**: donde la parcela lleva pastilla se quita el
      punto de POI duplicado. Los parques conservan el suyo (van sin pastilla a
      propósito, para no tapar el arbolado).
- [x] Minimapa: las parcelas `park`/`garden` salen en verde oscuro junto a las
      canchas en verde claro.

## ✅ El puerto a su tamaño: cuadras grandes, esquinas y ruta urbana (2026-07-27)

Publicación: [El puerto, a su tamaño](docs/changelog/2026-07-27-calles.md).

**El mundo creció, las calles no**
- [x] `PLANAR_PX_PER_M` 1.6 → **2.0** y `ARCADE_STREET_MUL` 3.2 → **2.56**. Los
      dos se mueven juntos: el ancho pintado es
      `ROAD_WIDTH_M · ARCADE_STREET_MUL · PLANAR_PX_PER_M`, así que la calle
      queda idéntica en px y la CUADRA crece un 25 %. A 1.6/3.2 una calle de
      7 m se pintaba 22 m de asfalto y se comía los edificios de al lado (al
      Parque Marino, los suyos propios).
- [x] **187 → 244 cuadras**, **263 → 308** edificios de OSM conservados a su
      contorno real, **78 → 63** descartados por caer sobre la calzada,
      **380 → 423** sitios de OSM como parcela.
- [x] Las manzanas hechas a mano se resuelven en fracciones de su propio
      rectángulo, así que escalaron solas: Parroquia de El Carmen 56x24 →
      **80x48**, Catedral 80x56 → **112x76**, Casa de la Cultura 88x44 →
      **116x60**.
- [x] Los tramos de búsqueda de `StreetIndex` pasaron de **px a METROS**
      (`STREET_SPAN_M` y compañía). Eran constantes ajustadas a 1.6 px/m y al
      reescalar quedaron cortas sin avisar — la Calle 6 a 744 px de Las
      Playitas, apenas fuera de un tramo de 700, tumbó el estadio a su
      rectángulo de respaldo.

**El bug que la compuerta encontró**
- [x] `seat_town_kiosks` buscaba la calle **después** de estampar el parqueo del
      propio kiosco, así que se encontraba a sí mismo: conector de 4 px y
      parqueo de isla rodeado de acera. **Cinco de los catorce kioscos de
      pueblo** venían así y solo jugaban de casualidad; Kiosco Playitas dejó de
      tocar su calle al crecer la cuadra y la compuerta lo cazó. La calle se
      busca ahora **antes**, con alcance en cuadrículas. **49/49 POIs**.

**Las esquinas doblan** (`churchill/world/service/kerb.py`, nuevo)
- [x] El render pinta por tile y nunca ve un cruce, así que las esquinas las
      resuelve el build: **cada vértice es candidato**, no solo las puntas —
      un cruce en OSM es un nodo compartido y solo a veces una punta. Indexando
      puntas salían 759 cruces; indexando vértices salen **1759**.
- [x] El **hueco entre dos direcciones consecutivas** es el filtro: ~180° es una
      calle que sigue de largo, ~0° la misma vía repetida. Una T saca dos
      esquinas, no tres.
- [x] El punto es **dónde se cruzan los bordes exteriores de las dos aceras**,
      resuelto como dos rectas (correcto para una avenida diagonal), y el radio
      se recorta a la acera más angosta. **3626 esquinas**, emitidas por tile.

**El caño**
- [x] La franja exterior de la acera en concreto más oscuro (3.2 px por lado),
      pintada entre el casing y el asfalto con tapas rectas — **se corta en la
      esquina**, como el de verdad en el tragante.

**La ruta urbana** (`src/game/buses.js`, nuevo)
- [x] `seat_bus_stops` sienta las **87/87 paradas** en la acera de su calle y
      las orienta con el cordón; la caseta se dibuja en el marco de la CALLE.
- [x] El bus frena, se detiene 2.6–4.4 s, **baja 0–2 pasajeros y sube a los que
      esperaban**. Sigue viviendo en `traffic` (mismo vehículo, misma red vial);
      lo nuevo es lo que pasa en el cordón. Dos buses cerca de la cámara es un
      **piso**, no un dado al 9 %.
- [x] Los pasajeros son peatones normales: al bajarse, `joinTheSidewalk` los
      entrega al andar rail-bound de siempre. Cuánta gente espera sale de las
      coordenadas de la parada, no de un dado.

**Las calles más anchas, pagadas con la acera**
- [x] `ARCADE_STREET_MUL` **2.56 → 2.9** (una calle de 7 m: 36 → **41 px**) y
      `ACERA_CELLS` **5 → 4 celdas** (20 → 16 px). El corredor baja de 76 a
      73 px y la parte que es ASFALTO sube del **47 % al 56 %**.
- [x] 3.1 fue un paso de más: a 43 px la calzada dejó sin sitio a 254 edificios
      con nombre, que perdieron su contorno real contra el ajustador.

**Los edificios ya no se paran encima de la acera**
- [x] Medido antes de tocar nada: **245 de 306 edificios con nombre** estaban
      dibujados mayormente sobre su propia acera, 93 % la tocaban.
- [x] `_poly_on_road` solo probaba la CALZADA — un contorno que pisaba solo la
      acera se guardaba tal cual. Y la acera medía **diez metros** a esta
      escala, tallados hacia adentro de la cuadra.
- [x] Ahora el edificio se **empuja** recto hacia atrás por la normal de la
      calle más cercana (`StreetIndex.nearest_normal`, nuevo), hasta 40 px, y
      conserva su contorno real. Solo el que no encuentra sitio cae al ajustador.

**El faro no es un destino**
- [x] La compuerta probaba el faro, parado en su propia explanada peatonal sin
      apron manejable; pasaba solo porque el alcance es `ACERA_CELLS + 1`.
      `lighthouse` y `beachsign` entran en `NO_PAD_LM`, que es lo que el
      docstring de `finish.py` decía desde siempre.

**La esquina que se redondea es la del carro**
- [x] La primera versión resolvía el cruce de los **bordes exteriores de las
      aceras** — la esquina de la manzana — así que curvaba la esquina de atrás
      y dejaba en ángulo recto el cordón que el carro recorta.
- [x] El punto es ahora donde se cruzan **los dos CORDONES**, y lo dibujado es un
      **filete tangente**, no un disco: un disco se abultaría hacia la manzana,
      que es lo contrario de una esquina redondeada. El build emite las dos
      direcciones de calle porque el render las necesita.
- [x] El **caño** dobla con ella (mismo filete, un canal más ancho, debajo del
      de asfalto) y se ve más: `#807e77` a 4 px.

**Una parada es una parada**
- [x] Había dos dibujos del mismo objeto — la del bloque cívico y las 87 de OSM.
      Las dos usan ahora `drawParada` en `gfx.js`; lo único que difiere es el
      tamaño, porque solo el bloque cívico trae uno.

**Las canchas vuelven al gentío (revertido el partido)**
- [x] El partido —dos equipos, portero, bola, gol con lluvia de monedas— se
      revirtió por pedido: los jugadores no se veían bien en juego y el gentío
      que había antes se leía mejor. `src/game/match.js` y
      `tools/match_check.mjs` salen; queda en el historial por si vuelve.
- [x] La lluvia de monedas vuelve al **reloj**: parqueá en una cancha y la
      hinchada tira su ráfaga de plata, una cada `ACOIN_RAIN_COOLDOWN`.
- [x] **Cuánta gente es función de la cancha**, no una constante: una de barrio
      mide 60 px y el Lito Pérez 210, y doce personas es un tumulto en la
      primera y nada en el segundo. `crowdSize` da una persona por caja de
      `FAN_GAP`.
- [x] **La separación se aplica DOS veces**, y una no alcanza: `fieldPoint`
      rechaza un lugar a menos de `FAN_GAP` de un vecino (bajando el margen
      antes que dejar la cancha vacía) y `advanceFieldPed` separa cada cuadro a
      los que se encimaron — son caminatas al azar sobre una misma cancha, así
      que por bien puestos que estén se van a encontrar.


**Y de paso**
- [x] Los **ALTO** ya no caen sobre el asfalto: la separación se mide desde la
      calzada (la que cruza y la propia), no con un número plano de 18 px que el
      Paseo de los Turistas —71 px de ancho— se tragaba.
- [x] La **Escuela de Biología Marina de la UNA** mira al oeste de su calle.

## ✅ La cuadra de la Catedral + tres arreglos de juego (2026-07-25)

Publicación: [La cuadra de la Catedral](docs/changelog/2026-07-25-catedral.md).


**La manzana civil, repartida a mano** (`centro` en `place_parcels`)
- [x] Calle 7 → Bulevar de la Casa de la Cultura, Avenida 1 → Avenida
      Centenario: una sola manzana (Calle 5 solo existe al sur de Centenario),
      cortada 3x3 en el marco de sus propias calles (-5.6°).
- [x] **Catedral de piedra gris**, 80x56 px — lo más grande que da la manzana —
      en la fila del medio, mirando al este; naves, crucero, cúpula, ábside y
      dos campanarios sobre la fachada del atrio.
- [x] **Bulevar en T**: barra norte-sur de avenida a avenida enfrente de la
      catedral (44x120) + brazo este que termina en el Bulevar de la Casa de la
      Cultura (88x56). Piedra clara con aparejo a soga, **transitable**.
- [x] **Parque del Río** (arroyo en S + puente de piedra) arriba, **Parque de la
      Virgen** (estatua junto a la iglesia) abajo, **parada de bus** sobre la
      Avenida Centenario alineada con la catedral.
- [x] **Casa de la Cultura** al sur y **Biblioteca Pública** al norte del brazo,
      como parcelas `civic` que dibujan su propio edificio.
- [x] `Surface.BOULEVARD` (7) — primera clase de superficie nueva desde que
      existe el ráster. Agregada AL FINAL (el valor es el formato que viaja) y
      espejada en `src/game/surfaces.js`; `DRIVABLE` y `STREET` la incluyen.
- [x] `reclaim`: una cuadra puesta a mano recupera su interior de los aprons de
      POI y del pavimento de *sliver*. Quién decide qué es calle es la **lista
      de calles** (`StreetIndex.on_street`), no un rect con márgenes — así sigue
      exacta una avenida diagonal.
- [x] `clear_buildings`: 13 footprints de OSM quitados de la cuadra (los
      edificios con nombre se conservan siempre, así que quedaban en el parque).

**El minimapa, de calles a mapa**
- [x] **Una tinta, dos pasadas** (contorno de todas las cintas, relleno de
      todas). Pintar por clase dentro de una sola pasada hacía que cada calle
      le mordiera un pedazo a la avenida que cruzaba; la jerarquía la lleva el
      ancho.
- [x] **Mar y tierra**: el mar es el fondo y `landPolys` los contornos encima —
      la composición del mundo, no su inversa (`waters` son las aguas
      INTERIORES, no el golfo). Se reusan los Path2D del render cache: el
      contorno de tierra firme tiene 15152 vértices.
- [x] **Verdes** (parque oscuro / cancha clara, porque a la cancha se entra
      manejando), **muelles** con el material de cada uno, **entraditas de los
      kioscos** y del muelle del Faro, **el bulevar** en piedra clara y la
      **mediana del Paseo** encima del Paseo.

**Los ferris (huevo de pascua)**
- [x] Dos ferris manejables en los atracaderos reales de **Paquera** y **Playa
      Naranjo**, con las rutas `route=ferry` de OSM orientadas y cortadas a un
      tramo corto (~1800 px, ~45 s ida y vuelta). 7 s encima y zarpa; **una vez
      por partida**.
- [x] La cubierta es el **único suelo móvil** del juego: `deckAt()` antes del
      ráster (las barandas salen gratis, el agua alrededor ya es muro),
      `carry()` en posición Y rumbo, y `used` para que no vuelva a salir.
- [x] Rampa pavimentada desde la **popa en reposo** hasta la calle — sin ella la
      arena (muro) dejaba dos ferris visibles e inalcanzables. Emitida además
      como segmento para que se dibuje, no como mar manejable invisible.
- [x] `deck` y `dockS` viven en el MUNDO: el build necesita los mismos números
      para saber dónde cae la popa, y dos copias se desincronizan en silencio.
- [x] Durante la travesía el churchill no se derrite y el mar suena a tope.

**Tres arreglos de juego**
- [x] El **mapa del menú** recorre una polilínea por el pueblo en vez de una
      recta Faro→Caldera que se salía al golfo.
- [x] La **gente de los estadios** deambula por el gramado con 26 px de despeje
      real al borde, en vez de patrullar el perímetro y leerse como acera.
- [x] La **lluvia de monedas** es una moneda **por aficionado**, de **plata** y
      del mismo valor total: menos monedas, más dispersas, distinguibles de las
      de oro de la calle.

## ✅ Canchas derechas + el builder en capas (2026-07-25)

**Las tres canchas, alineadas con su manzana**
- [x] **El ángulo de una cuadra sale de sus calles**, no de un ajuste sobre sus
      propias celdas: `_street_dir` lee la dirección de la avenida (este) y de
      la calle (sur) junto al bloque, y el corte es **afín** — columnas
      paralelas a las calles, filas paralelas a las avenidas. La cuadrícula de
      El Carmen está 3.5° fuera de escuadra (avenidas -5.4°, calles 82.3°), así
      que unos ejes ortogonales nunca la iban a describir.
- [x] Por qué el ajuste anterior fallaba, escrito en el código para que no
      vuelva: es **degenerado** en un bloque casi cuadrado (`sxx≈syy` lo pega a
      ±45°, la diagonal contraria) y solo devuelve ejes ortogonales. Ajustar el
      polígono trazado es peor todavía: sus vértices son escalones de 4px, y la
      Plaza El Carmen daba **-67°**.
- [x] Cada parcela emite su ángulo (`ang`) al manifest, y todo lo que se dibuja
      encima gira con él: césped y marcas, la parroquia, los árboles del jardín,
      la placa del patrocinador.
- [x] **Una sola línea de cal**: la línea de banda ES el borde de la cuadra,
      dibujado una vez. Antes había dos bordes blancos y el de adentro tenía la
      forma equivocada. Las demás marcas se dibujan a extensión completa y las
      recorta el contorno.
- [x] **Aceras direccionales**: el anillo se forma solo en el borde que da a una
      calle. Las Playitas sigue saliendo a la arena por el norte; la plaza de El
      Carmen sigue pegada a la parroquia por el oeste.
- [x] La acera de una cancha es de **8px, no 20**: solo tiene que parar las
      líneas antes del asfalto. Lito Pérez 116x60 → **144x88**, Las Playitas
      176x144 → **184x160**, El Carmen 60x48 → **76x76**.
- [x] La Plaza Deportes El Carmen usa **el mismo pintor de cancha que los
      estadios** (`paintField`): una plaza nueva hereda césped, franjas y marcas
      sin copiar código.

**El builder, en capas (`churchill/`)**
- [x] Borrada la **proyección corridor-unroll** entera (espina, x-warp, islas de
      cruce a mano, emisor `data.js`) y `src/world/`. `pnpm world:build`
      construye el mundo que se juega: le faltaba `--planar`, así que
      reconstruía el viejo.
- [x] `tools/build_world.py`: **4379 → 19 líneas**. El build es
      `churchill/world/pipeline/runner.py` y se lee como su lista de etapas.
- [x] Capas: `enums` (el valor ES el formato de cable), `config`, `content`,
      `context`, `dto` (Pydantic v2), `util`, `repository` (Protocols),
      `service` (10 módulos), `pipeline`. **41 módulos, 5748 líneas.**
- [x] `tools/world_snapshot.py` es el contrato: **salida byte a byte idéntica**
      (417 archivos) en cada paso, más el log del build idéntico carácter por
      carácter. 28 builds de verificación, cero deriva.
- [x] Fuera los restos del corredor en el manifest emitido: `meta.crossExag` y
      `meta.spineLenM` (nadie los leía) — cambio de mundo intencional, con el
      digest re-guardado en el mismo commit.

**Encontrado por el camino (bugs reales, no del refactor)**
- [x] `inventory.json` se generaba de `src/world/data.js`, que el juego ya no
      leía: describía un mundo que nadie jugaba (178 calles). Ahora lee el
      manifest + los tiles: **2150 calles, 80310 edificios, 16 parcelas**.
- [x] `docs/lotes_catalog.json` estaba viejo desde el 16 de julio: listaba **47
      locales patrocinables que ya no existen** y le faltaban **149**.
      Regenerado (811). Ninguno estaba reclamado, así que no se rompió nada.
- [x] `NameError` esperando en el puente sintetizado (`ROAD_WIDTH_PX` borrado
      con los tiers del corredor); solo corre si falta el puente en el OSM.
- [x] Al escribir los modelos contra el mundo real: `landmark.spawn` no es una
      bandera sino el punto de aparición `[x,y]` pegado a calle, y
      `kioskPath.surface` es `"paved"`/`"sand"`, no un entero.

## ✅ Parcelas + patrocinio + colisiones correctas (2026-07-24 d)

**Parcelas — el nuevo primitivo del mundo**
- [x] Una cuadra se puede partir en **N×M** con pesos, y cada parte declara
      `col`/`row` como entero o rango `[desde, hasta]`, así que no todas tienen
      que medir lo mismo (El Carmen: una columna de dos —iglesia sobre jardín—
      al lado de una columna que abarca las dos filas con la plaza). Esa es la
      forma que permite mapear comercios de distintos tamaños en una cuadra.
- [x] El corte se calcula en el **marco propio de la cuadra** (eje principal):
      Las Playitas está a 37°, y un corte a eje de pantalla en un bloque
      inclinado da cuñas, no mitades.
- [x] La **erosión es del BLOQUE, no de cada parte**: el anillo de acera rodea
      la cuadra, no cada pedazo. Al erosionar por parte también se metía 20px
      desde las líneas internas de corte —que no son calles— y en un bloque
      chico quedaban tiras de 4px. `aceras: True` ahora significa "respetá el
      anillo de la cuadra".
- [x] Guarda: una parte que sale casi vacía **avisa y se descarta** en vez de
      emitir una tira en plena calle.
- [x] Modo **`from: features`** para bloques que una grilla no puede cortar. Al
      medirlos: Parque Marino llena **32%** de su bbox y el Balneario **46%** —
      son cintas, no cuadras; cuartearlos reparte pedazos que son calle o agua.
      Sus parcelas reales son lo que ya está parado ahí, así que se deriva una
      por huella de edificio (6 y 5).
- [x] Usos: `church` (Parroquia N.S. de El Carmen), `garden` (jardín con árboles
      en hash determinista), `stadium`/`plaza`, `lot`.

**Patrocinio**
- [x] Cada parcela emite un **`slot`**: el rect donde un `lote` remoto pinta su
      arte. El MUNDO manda la posición y el tamaño, así que nada que mande un
      patrocinador puede tapar una calle ni comerse la cuadra — huella real en
      vez del pin flotante que tenían los lotes.
- [x] **16 espacios patrocinables** donde había 0: 3 canchas, 1 iglesia, 1
      jardín, 11 lotes de edificio (con nombres reales del OSM).
- [x] Lito Pérez y Las Playitas entran como parcelas de **cuadra completa**
      (`whole: true`) con el slot al centro de la cancha — el escudo de un club
      va ahí con una línea en `content.json`, sin rebuild.

**Colisiones — reescritas con el método correcto**
- [x] Se descubrió por los datos: el Muelle de Cruceros es `{x:15641, y0:10126,
      y1:10756}` (vertical perfecto) y el del Faro va (12020,10080)→(12160,9940),
      **45°**. Sumar las direcciones de las paredes cercanas para sacar una
      normal SE CANCELA en un corredor, así que caía a un deslizamiento por ejes
      —correcto para el vertical, incorrecto para el diagonal y para toda acera
      diagonal. Ningún umbral separa esos dos casos: el método estaba mal, no
      mal calibrado.
- [x] Ahora: **cápsula contra AABB de celda por profundidad de penetración**.
      Se clampea el centro en la caja para el punto más cercano `q`, de ahí
      salen `n = normalizar(c-q)` y `profundidad = r-|c-q|`; se empuja por la
      normal, se remide y se repite 4× tomando el contacto más profundo.
      Verificado aparte: pared a la izquierda → n=(1,0); pared diagonal →
      n=(0.45,-0.89); corredor → 6.00 contra 4.00, **gana la más cercana, no se
      cancela**. Paredes a eje, diagonales, corredores y esquinas internas pasan
      a ser un solo cálculo.

## ✅ Puntarenas real + refactor del render + feel de colisión (2026-07-24 c)

**Render modularizado**
- [x] `src/render/canvas2d.js` (2230 líneas) partido en `src/render/c2d/*`
      (gfx, cache, ground, streets, structures, flora, landmarks, entities,
      hud, world); `canvas2d.js` queda como compositor de ~200 líneas. `gfx.js`
      expone `ctx/canvas/dpr/ZOOM/lastT` como **live bindings** de ESM, así que
      ningún `ctx.fillStyle` cambió.
- [x] Borrado el pintor de corredor MUERTO (12 drawers sin llamadas desde que el
      mundo es planar: `drawLand`, `drawStreets`, `drawBuildings`, `drawPalms`,
      `drawTrees`, `drawRails`, `drawMedians`, `drawIslands`, `drawHills`,
      `drawEstuary`, `drawMangroves`, `drawStreetLabels`) — ~380 líneas y dos
      copias del mismo pase (`drawBuildings` era `paintBuilding` verbatim).

**Puntarenas de verdad**
- [x] `extract_pois` saca **1160 POIs con nombre real** del OSM (amenity/shop/
      tourism/leisure/office/…) a `manifest.pois`, deduplicados por (nombre,
      cuadrícula). Hotel El Turista, Soda La Esquina, Banco Popular, Terminal
      Puntarenas–Quepos, Iglesia Cristiana…
- [x] **308 edificios con nombre conservan su huella OSM real** en vez de
      snapearse a la cuadrícula. Los que se montaban sobre una calle (137)
      vuelven al snapper — eso era el rect sobre las calles auxiliares del Paseo.
- [x] Rótulos en juego a 8px de pantalla + toggle **Nombres de negocios** en
      Ajustes; overlay de debug con punto y color por categoría para validar.
- [x] Parque Marino: `occ` deja la cuadra limpia, sus 4 edificios OSM van con
      huella real y paleta de acuario, y los 5 tanques se colocan por transformada
      de distancia libres de acera y de edificio.

**Estadios / Plaza**
- [x] La cuadra se traza por *flood* + erosión: `outline` (cuadra + acera) y
      `footprint` (la cancha). Solo se estampan CLS_ROAD las celdas trazadas →
      **ya no se maneja sobre el mar** al norte de Las Playitas.
- [x] Las Playitas pasa a **Plaza Las Playitas**: sin gradas, sin aceras (llena
      la cuadra), llega hasta la línea de playa, y su pared derecha sigue la
      LÍNEA de Calle 8 extendida (antes se recortaba contra el cap redondo de la
      calle). Marcas de **fútbol rotadas al eje real de la plaza** (áreas, punto
      de penal, círculo central).
- [x] Lito Pérez sin gradas. El estadio se pinta DENTRO del pase de aceras, no
      como capa encima → los rótulos de calle vuelven a quedar arriba.
- [x] Fuera las sombras huérfanas en el centro de la plaza y del balneario.
- [x] Bañistas del balneario contenidos con margen de cuerpo (ya no pisan la
      acera interior); los edificios que flotaban en la ensenada tienen banco de
      arena.
- [x] Lluvia de monedas dentro de la cuadra del estadio/plaza + hinchada que
      salta y levanta los brazos.

**Colisiones — reescritas con el método correcto**
- [x] El cuerpo es una **cápsula** (dos círculos barridos) y cada celda-pared es
      un AABB de 4px. El contacto círculo↔AABB es exacto y barato: se clampea el
      centro dentro de la caja para hallar el punto más cercano `q`, y de ahí
      salen la normal `(c-q)` y la profundidad `r-|c-q|`. Resolver = empujar por
      la normal esa profundidad y quitar solo la velocidad que entra a la pared.
      Se itera 4 veces tomando el contacto MÁS PROFUNDO, así una esquina interna
      se acomoda sola sin caso especial.
- [x] Esto reemplaza heurísticas que no podían funcionar: la caja orientada
      enganchaba las esquinas en el cordón (las ruedas del tuk-tuk); **sumar las
      direcciones** de las paredes cercanas para sacar una normal SE CANCELA en
      un corredor (agua a los dos lados de un muelle, aceras a los dos lados de
      una calle); y la prueba de "¿corredor?" que caía al deslizamiento por ejes
      acertaba en el Muelle de Cruceros (**vertical**) y fallaba en el Muelle del
      Faro (**45°**) y en toda acera diagonal — no hay umbral que distinga esos
      dos casos por magnitud de normal. Tomar **la superficie más cercana** en
      vez de una suma elimina la distinción: pared a eje, diagonal, corredor y
      esquina interna son el mismo cálculo.
- [x] Ya no se revierte la posición ni se acorta el paso ni hay barrido ciego ni
      teletransporte de rescate; el cuerpo simplemente se mueve a la pose legal
      más cercana, que es lo que lo mantiene andando A LO LARGO de la pared.
- [x] Mientras hay contacto, el empuje se redirige a lo largo del cordón y el
      agarre se relaja, para que mantener el dedo contra una pared te haga
      manejar por ella en vez de frenar en seco.

**UI**
- [x] Intro de lore **no saltable**.
- [x] Pantalla previa al tutorial con **velocidad + zoom** y aviso de que se
      cambian después en Ajustes.
- [x] **Zoom configurable** (60–140%) y Ajustes agrupado en JUEGO / APLICACIÓN /
      CUENTA, con la barra de navegación opaca (las filas ya no se ven debajo).
- [x] Pantalla de modo para **Recorrer** y **Arcade**, como el brief de Historia.
- [x] Tutorial: el paso del freno describe el **alto en seco** actual.

## ✅ Estadios: trazado orgánico real + fixes de NPCs/lancha (2026-07-24 b)

- [x] **Ángulos correctos (trazado desde la grilla)**: `place_stadium` resuelve
      el rect por calles y traza la cuadra como la región LAND+ACERA dentro del
      rect, acotada por las calles (`_outline_poly`) → el contorno sigue los
      ángulos reales del grid (diagonal), no un rect a eje. Funciona aunque la
      cuadra sea chica (la acera de 20px se la comería para bloque). Se estampa
      el rect `CLS_ROAD` (manejable/enterable). Lito Pérez y Las Playitas quedan
      en su ubicación correcta (14332 / 16185).
- [x] **Las Playitas: sin gradas + reubicado**: entre Avenida 1 y Avenida
      Centenario (al norte de Av1 es playa/mar). `stands=False` → cancha verde
      lisa, sin graderías.
- [x] **Color-switch, no doble dibujo**: la cancha usa el green tipo `stadium`
      (ahora dilata como parque, sin franja de arena); las graderías (solo Lito
      Pérez) recolorean el anillo de acera en el pase de landmarks.
- [x] **NPCs del estadio visibles (bug)**: los `fan` se creaban en (0,0) y el
      `topUp(pedestrians)` los borraba por "far" antes de posicionarlos; ahora
      nacen ya sobre el anillo (`ringPoint`).
- [x] **Bañistas contenidos**: nadan solo sobre agua real (`surfaceAt===0`), no
      la bbox → ya no se salen a la calle en las esquinas.
- [x] **Lancha visible**: se dibuja después del `drawWorld2D` (sobre el agua del
      balneario), antes la tapaba el relleno de agua interior.

## ✅ Estadios orgánicos (graderías desde la acera) + ajustes de mundo (2026-07-24)

- [x] **Estadio orgánico, sin rect flotante**: `place_stadium` ahora arma el
      bloque como un polígono que sigue la grilla real. Las Playitas usa un
      `quad` DIAGONAL (líneas de Calle 6/8 + Avenida 1 vía `_street_line`/
      `_iline`), extendido al norte → encaja en la manzana sin montarse sobre
      las calles. La cancha (`draw_poly`, inset del asfalto) es lo que se pinta;
      el quad exterior se estampa `CLS_ROAD` (manejable, sin colisión, se puede
      entrar). Recorte de calles interiores por polígono (`_clip_roads_poly`).
- [x] **Graderías = la acera real**: `drawStadium` pinta una banda gris oscuro
      con línea de grada (dos tonos) sobre el anillo de acera del bloque, en el
      pase de landmarks (después de las aceras) → recolorea la acera de verdad,
      siguiendo el contorno orgánico. Césped verde tipo parque + líneas blancas
      dentro. Flag `lm.stands` por estadio.
- [x] **NPCs de estadio contenidos en las graderías**: peatones `kind:"fan"`
      patrullan el perímetro del footprint (`advanceRingPed`, `su`/`sdir` sobre
      arclength) — no pisan la cancha ni deambulan la ciudad. Campo `kind` para
      tipos de NPC (ciudad / fan / futuro swimmer/vendedor).
- [x] **Árboles de parque hacia el borde**: en `drawGreenSpace` los árboles
      forman anillo perimetral, ya no se amontonan sobre la fuente central.
- [x] **Casa de la Cultura = el museo**: se eliminó el landmark `museo`
      (mismo edificio). `_nudge_off_acera` ahora corre para TODOS los landmarks
      de edificio (`BUILDING_LM`, no solo cívicos) y busca la mayor holgura de
      tierra disponible (±16→±8 px) — reubica los que caían sobre acera/calle;
      los muelles/faro/marina/playa se dejan intactos.
- [x] **Palmeras del Paseo centradas**: se planta la palmera 4px al norte para
      que el tronco quede sobre la isla (compensa el ancla base de `paintPalm`).
- [x] **Balneario = ensenada de mar**: la cuadra del Balneario se vuelve agua
      abierta (`CLS_WATER` + su contorno a `waters` → efecto de mar vivo,
      `paintWaterBody`). Sin gráfico de piscina (`case "pool"` solo rotula), sin
      edificios (`occ`). Adentro nadan bañistas (`kind:"swimmer"`,
      `advanceSwimmer`, rebote en la bbox) y navega una lancha de recreo
      (`b.balneario`, contenida en el loop de botes). `W.BALNEARIO` (bbox).

## ✅ Estadios manejables en la grilla de calles + feel de colisión + coins en todo modo (2026-07-23)

- [x] **Colores por vehículo (fix)**: el Shop abre en el carro correcto vía
      deep-link `ctx {tab, veh}` desde el picker; `equipColor(veh,id)` ya era
      por-vehículo, faltaba que el Shop no cayera a `"scooter"` fijo.
- [x] **Colisión acolchada (colchón)**: `physics.js` — al chocar cuadra/acera
      se conserva la tangente y se amortigua la normal (`cushion`, rebote ×1.1)
      en vez de frenón seco; esquina de frente conserva ~0.72 de velocidad. Se
      acabó el temblor/rebote contra la pared.
- [x] **Esquinas de acera redondeadas**: discos color acera (radio `w/2+ACERA_PX`)
      en los extremos de cada tramo, en el pase de banda de acera (antes del
      casing/asfalto), en `paintRoads` y el renderer global — las esquinas de
      cruce ya no son ángulos rectos.
- [x] **Coins en TODOS los modos**: `maintainArcadeCoins` se llama siempre
      (Historia/Arcade/Recorrer/tutorial). Como solo aparecen en clase 3/5,
      caen dentro del césped manejable del estadio sin código extra. Se quitó
      el bloque la-ola/`stadiumCoins` (dependía del estadio amurallado).
- [x] **Dos estadios MANEJABLES ubicados por calles**: `place_stadium(spec)`
      resuelve el rect desde nombres de calle/avenida OSM (promedio de muestras
      cerca del ancla, con lista de candidatos: la central es "Avenida
      Centenario" y algunas calles llevan sufijo). Lito Pérez = Calle 15 José
      Joaquín Escalante–Calle 17 × Avenida Centenario–2 (tamaño real, ~carmen);
      Las Playitas = Calle 6-8, al norte de Avenida 1, extendido al norte
      (vertical 9×13). Se recorta la calle
      interior, se marca `occ` (sin edificios), se estampa el interior a
      `CLS_ROAD` (manejable, INSET < medio ancho de calle para que conecte),
      y se emite `footprint` (polígono cuad) + un green tipo `stadium`.
      `manifest.stadiums` (array) reemplaza el `stadium` único → `W.STADIUMS`.
- [x] **NPCs de ciudad dentro de los estadios**: `maintainStadiumPeds` itera
      `W.STADIUMS`, siembra peatones normales (mismo modelo/hue) en celdas
      clase 3 del footprint, con leash.
- [x] **Dibujo del estadio**: `drawStadium(lm)` recorta a `lm.footprint`, pinta
      líneas blancas de cancha (media cancha en el eje corto → sirve ancho y
      alto), césped del green `stadium`. Sin capa Pixi de estadio.
- [x] **Spawn de nivel en calle**: build snapea `lm["spawn"]` de cada kiosco a
      la calle manejable más cercana (`_nearest_cell`); `modes.js spawnAtKiosk`
      lo usa. Ya no se aparece en la playa.
- [x] **Balneario como polígono cuad**: `_green_poly(cells, "pool")` (color
      agua, sin dilatación); edificios de la cuadra ya suprimidos por `green`.
- [x] **Muelles**: probe casi completo (0.98) al ir sobre el deck (clase 5) para
      no colgar medio carro sobre el agua; el extremo de mar se estampa `w/2`
      más corto para no dejar celdas manejables pasadas del deck dibujado.
- [x] **Medianas (palmeras Paseo + León Cortés)**: el muro se estampa más ancho
      que la curva dibujada (`PASEO_MEDIAN_W + 6`) para que el carro pare en el
      verde y no se meta/atore en el cap redondo del extremo.
- [x] **Línea de árboles del Ferrocarril/Cocal**: guard de clase — no se plantan
      sobre calle/paseo/puente/agua, solo al lado del carril (antes se sentaban
      sobre las calles del Cocal). La mediana del Cocal dividido es corridor-only
      (inerte en planar).

## ✅ Navegación unificada + vehículo por página + parques con contorno real (2026-07-20)

- [x] **Flujo Historia unificado**: la selección de vehículo salió de la
      página de niveles a la MISMA página `vehpick` de Arcade/Recorrer
      (title → niveles → vehículo → brief → jugar). En modo historia el
      picker oculta boosts (el brief los arma) y el reset de progreso vive
      solo en Ajustes.
- [x] **Nav superior consistente** (stage select + vehicle picker): fila
      `shell-nav` fija arriba — atrás izquierda, título centro, contexto
      derecha (pill de modo / botón de Shop con monedas en el picker).
      `FitScale` acepta `pad` para reservar el alto de la nav.
- [x] **Picker**: ¡Vamos! centrado abajo de la card de vehículo; swatches de
      color en columna vertical y card de color angosta (width:auto, sin
      espacio muerto); Shop en la esquina superior derecha.
- [x] **Ajustes**: `page-body scrolly` + `center-stack` (ya no se encima con
      la nav; +14px de aire bajo el header). Pausa: 4 botones apilados en
      columna (el Reiniciar desbordaba la card).
- [x] **Parques con contorno real (adiós "pintura de niño")**: cada cuadra
      verde se emite como UN polígono de contorno trazado a resolución raster
      (4px, sigue el borde interior de la acera y las curvas) en
      `manifest.greens`; el renderer lo rellena y lo dilata 14px con stroke
      del mismo color para meterlo bajo la banda de acera pintada (8px vs
      anillo raster de 20px = se acabó la franja de arena entre césped y
      acera). Los slivers pavimentados YA NO se pintan de verde (eran las
      cuñas parciales); cuadras o todo verde o todo arena. Pintado en
      `drawLandBase` (primer paint, global — sin flash de arena al streamear
      tiles).
- [x] **Kioscos del Paseo a medio camino**: dy 150→80 (mitad entre Paseo y
      arena) + `PINNED_KIOSKS` para que el pase de frontage no los recoloque
      cruzando la calle; su conector puede apuntar al Paseo mismo.
- [x] **Catedral / Casa de la Cultura / Museo en su cuadra**: anclas `ll/near`
      corregidas a los nodos OSM reales (la de cultura apuntaba ~200m SW y
      matcheaba el "Bulevar…"); y `snap_into_block_cell` ahora tiene radio
      máximo (8 cuads) — antes, al no haber bloque edificable cerca (las
      cuadras finas del centro clasifican sliver/green), TELETRANSPORTABA los
      tres al mismo bloque lejano. Catedral oeste (x15034), cultura+museo
      este (x15202/15222), misma fila de cuadra.
- [x] **Estadio: footprint real E-O no-transitable** (posición pendiente de
      coords): pase de estadio re-habilitado — rect 12x9 cuads, calle
      interior clipeada (2 cuadras unificadas), todo CLS_LAND (muro), sin
      túnel/crowd/coins/peds (el crowd Pixi per-frame era el crash que lo
      tenía apagado). Dibujo = el look clásico simple `drawGreenSpace` con
      líneas blancas de cancha, tamaño del footprint; capa Pixi del estadio
      eliminada.

## ✅ Más parques + fuentes + plazas verdes (2026-07-18 PM8)

- [x] **16 parques sintéticos** repartidos por el puerto (antes solo 2 OSM →
      18 total, x400..x47490): se eligen cuadras bien dimensionadas, lejos de
      otros POIs, se marcan `green` (sin edificios) y se agrega un landmark
      `park` con tamaño del bloque → área verde con árboles + **fuente con
      agua viva y sonido**. Gate 43/43.
- [x] **Plazas en verde** (petición): las plazas pavimentadas (que en world-2d
      no se dibujaban y se veían como tierra) ahora se pintan como césped con
      franjas de corte + un árbol en las grandes (`drawPlazaGreen`, sin
      rebuild — el dato ya venía en los tiles).
- [x] **Fix estadio invisible** + iglesia con cruz/campanario + museo con
      fachada de columnas + tags de landmark más grandes (10px).

## ✅ Kioscos alcanzables: fuera de la calzada + sendero de arena en playa (2026-07-18 PM7)

- [x] **Kioscos en media calzada → frontage**: los que quedaban sobre el carril
      (paseo León Cortés nivel-2, faro, play…) se corren a la celda de FRENTE
      de cuadra (land, lado de los edificios — nunca la mediana), y su apron
      los conecta a la calle. Ya no están en medio de la calle.
- [x] **Kioscos de playa alcanzables**: los que estaban en la arena
      (centro, cocal, cocal2 —antes sin calle a <200px—, caldera) reciben un
      **sendero de arena manejable** (`raster_stamp_polyline` CLS_ROAD 1.4·cuad)
      desde la calle más cercana; se emite `manifest.kioskPaths` y se dibuja
      como franja de arena (`drawKioskPaths`). Física de acera respetada en
      todo el mapa (todo lo demás sigue siendo muro). Los 13 kioscos ahora en
      superficie manejable. Gate 43/43.

## ✅ Parques como áreas verdes con fuente + estadio verde no-transitable (2026-07-18 PM6)

- [x] **Parques = áreas verdes**: césped con franjas de corte, anillo de
      árboles y una **fuente central con agua viva** (basin de piedra, pozo
      con ondas animadas, chorro que sube/baja + gotas) — `drawGreenSpace` +
      `drawFountain` en canvas2d.
- [x] **Sonido de agua**: voz `fountainV` (ruido filtrado paso-bajo con LFO
      lento en el corte = burbujeo de agua) que sube al acercarse al parque
      (`sfx.fountain`, más fuerte <60px, se desvanece a 220px).
- [x] **Estadio = área verde NO transitable**: el landmark de estadio ahora
      entra a `BUILDING_LM` → se ancla al interior de una cuadra (land = muro,
      no manejable) y se dibuja como césped con líneas de cancha tenues (sin
      fuente). Se acabó el estadio de arena manejable. Gate 43/43.

## ✅ Peatones rail-bound (como main) + nombres de calle (2026-07-18 PM5)

- [x] **Peatones como el main branch**: modelo RAIL-BOUND — cada peatón atado
      a una calle, camina su arclength a un offset fijo de media-acera y cruza
      con animación (`advancePed` en spawns.js). Ya NO deambulan la superficie
      (advanceOnSurface) por el anillo de acera de la cuadra — se acabó el
      "peatones dentro de la cuadra".
- [x] **Nombres de calle** (regresan del main): pill cada ~900px de arclength
      sobre calles con `name`/`ref`, deduplicado por nombre+celda para no
      apilar copias por-tile (`drawStreetLabels2D` en canvas2d).
- [ ] **Faro "vacío"**: el debug map muestra que el barrio del Faro SÍ tiene
      edificios; la punta oeste es un espigón de arena (real) y el spawn está
      en la plaza del faro (abierta). Pendiente: el usuario confirme
      coordenadas 📍 del punto vacío (posible bug de render/streaming vs.
      centros de bloques grandes solo-frente).

## ✅ Cuadras densas + feel de manejo + escenografía no-manejable (2026-07-18 PM4)

- [x] **Cuadras densas** (centros vacíos): los bloques chicos de pueblo
      (≤120 cuadrículas) se llenan COMPLETOS; los grandes conservan banda de
      frente + patio/parque. Cap 40000→80000 (cubre todo el mapa incl.
      Playitas). Tiles 7.9→11.8 MB (streaming por tile).
- [x] **Museo (y restaurante) dentro de cuadra** + iglesia visible de nuevo
      (piloto Pixi pausado — canvas dibuja todos los landmarks).
- [x] **Paseo verde NO manejable**: parques/piscina ya no reciben apron
      manejable (`NO_PAD_LM`) — se acabó entrar al jardín verde del Paseo.
- [x] **Colisión suave**: el rebote ×-0.45 + shake por-frame contra la pared
      (temblor "bravo") se reemplazó por freno suave (×0.25, sin rebote); el
      shake de impacto solo en golpes rápidos (>150 px/s), escalado.
- [x] **Giro sobre su eje**: al estar casi detenido, el carro pivota en el
      lugar hacia el dedo (turnRate +1.5·veh.turn, se desvanece a ~60 px/s) y
      arranca ya orientado, en vez de arquear manejando.
- [x] **Viento al girar**: rachas en arco alrededor del carro en el sentido
      del giro, opacidad/largo por velocidad angular (`p.av`).
- [x] **Peatones**: clase [6,3] — caminan aceras y cruzan calles como en main
      (el "dentro de la cuadra" era el efecto de centros vacíos, ya llenos).

## ✅ Estadio off + landmarks en cuadras + colisión sellada (2026-07-18 PM3)

- [x] **Estadio desactivado** (crashea al acercarse; probablemente las ~180
      Graphics del público en móvil). `STADIUM_ENABLED=False` en el build →
      `manifest.stadium=null`; el código de estadio queda inerte tras el gate
      `W.STADIUM`. Reactivar = flag + rebuild (y batchear el público antes).
- [x] **Landmarks tipo edificio DENTRO de la cuadra** (la iglesia salía en la
      calle): iglesia, catedral, mercado, súper, hotel, cívico, casa se
      reubican a la celda INTERIOR del bloque más cercano (≥1 cuadrícula de
      cualquier borde → libran la acera) — 7/7 ahora en `land`. Sin apron
      manejable (escenografía) y excluidos del gate de alcance.
- [x] **Colisión "entrar a la cuadra" corregida**: los nudges de desatasco
      (shimmy + depenetración) saltaban hasta 24px a cualquier celda no-muro,
      cruzando la acera. Ahora exigen CENTRO en calle manejable (clase 3/5) a
      corto rango (≤12px); la pose libre solo se graba sobre calle.
- [x] **Migración de landmarks a Pixi — piloto**: iglesia/catedral en la capa
      Pixi (nave + techo + cruz + rótulo), canvas las suprime.

## ✅ Puerto vivo + backend Pixi híbrido (opt-in) + fixes móviles (2026-07-18 PM)

- [x] **Cuadras llenas**: el tope de edificios (8000) se agotaba a mitad de mapa
      dejando cuadras de pura arena → 40000 (531 OSM + 39469 sintetizados en la
      banda de frente, oeste→este, toda la zona MVP cubierta). Gate 56/56 OK.
- [x] **Verde**: 15 817 árboles en los patios interiores de las cuadras y
      parques (densidad acotada en bloques rurales gigantes) + 1 554 palmeras
      cocoteras dispersas por la playa. Tiles totales 7.9 MB.
- [x] **Backend Pixi HÍBRIDO** (`src/render/pixi/scene.js` + adapter):
      Pixi/WebGL dibuja mundo (backdrop, tiles, calles vectoriales con acera,
      edificios, árboles/palmeras) y TODAS las entidades (botes, peatones,
      vendedores, animales, tráfico, trenes, gaviotas, jugador con sprite
      rasterizado de paintVehicle + sombra de silueta); canvas2d queda encima
      en modo overlay (landmarks, muelle/puente, clima, partículas, brújula,
      minimapa, barra de derretido). **Opt-in mientras estabiliza**: `?pixi` o
      localStorage churchill_renderer="pixi". Elementos nuevos → SIEMPRE al
      backend Pixi.
- [x] **Fix dedo fuera de pantalla**: el touchend nunca llegaba al canvas y el
      dedo de manejo quedaba "reclamado" para siempre — ahora se libera a nivel
      window y el touchstart re-reclama ids muertos.
- [x] **Fullscreen al rotar** (web móvil): intento directo en el evento de
      orientación + el siguiente toque lo garantiza (los navegadores piden
      gesto). **Intro/boot caben sin scroll** en teléfonos cortos
      (media query max-height 500px).
- [x] **Balance de renderers (decisión del usuario)**: canvas2d vuelve a
      pintar TODO el mundo painterly + entidades (la belleza original); Pixi
      queda como **capa transparente de landmarks ENCIMA** del canvas
      (pointer-events none): estructuras que canvas no luce — hoy las gradas
      del estadio + el techo del túnel; los demás landmarks migran ahí.
      `?canvas` desactiva la capa (canvas dibuja gradas fallback).
- [x] **Estadio Lito Pérez jugable** (primer landmark en Pixi): cuadra en
      Playitas descubierta desde el grid (el block-detection no la cubría) y
      **expandida artificialmente a mínimo 12×9 cuads** (las calles que la
      expansión traga se recortan de la red vectorial — 3 clipped). Graderías
      = anillo bloqueado; césped MANEJABLE con líneas de cancha (canvas, bajo
      entidades); **túnel de esquina SW bajo las gradas** (techo en la capa
      Pixi superior — el carro desaparece al pasar debajo). Gate 56/56 OK.
- [x] **Fix carro atascado en acera** (tras el fix de doble colisión): el
      snap a la última pose libre restauraba solo x/y — si el ÁNGULO actual
      metía esquinas en la pared, el carro quedaba clavado mitad calle mitad
      acera. Ahora restaura también `freeA` + red de depenetración (nudge en
      8 direcciones, radio 4-24px). Aplica igual a medianas del Paseo y línea
      de árboles León Cortés (son CLS_ACERA — mismo muro).
- [x] **Pixi por DEFECTO** (validación del usuario en web + APK): escape
      `?canvas` / localStorage churchill_renderer="canvas" + fallback
      automático sin WebGL. Boot con **agua Pixi viva** (gradiente navy +
      shimmer sinusoidal, misma receta que drawWaterAll) detrás del logo PCL,
      y el **ferry del muelle** navegando el borde de la barra de carga
      (mismo arte que drawBoat, con bamboleo).

## ✅ Onboarding + pantallas full-screen + colisión sellada (2026-07-18)

- [x] **Secuencia de arranque estilo Hill Climb** (`src/ui/screens/BootScreen.jsx`,
      cada arranque): logo Pacific Code Labs sobre azul marino (fade) → pantalla
      de carga con el arte de La Ruta del Churchill + barra dorada (tap salta).
      Mientras corre, el attract mode ya streamea el mundo, así que la barra
      cubre carga real. Después: menú (o intro de lore → tutorial en el primer
      arranque). Assets en `public/branding/` (precacheados, SW `churchill-v6`).
- [x] **Ícono APK con fondo transparente** (el usuario borró el BG): nueva
      fuente `assets/icon.png` 1024² con alfa (arte redondo faro+churchill),
      `capacitor-assets generate --android` con fondo adaptativo `#0b1a2e` —
      100 recursos regenerados (mipmaps + splash).

- [x] **Intro de lore al primer arranque** (`src/ui/screens/IntroScreen.jsx`):
      3 diapositivas (el churchill, el sol porteño, tu misión) sobre el mundo
      attract → directo al tutorial → al completar, al menú principal (ya no
      pasa por resultados). La última diapositiva lleva la única línea de
      apoyo ("el ❤ del menú te espera") — no intrusiva, decisión del usuario.
- [x] **Tutorial sin velo gris**: se quitó `.tut-veil` y la sombra de 9999px
      del spotlight; queda el anillo pulsante + flecha + panel inferior.
- [x] **Pantallas full-screen** al estilo Ajustes/Tienda (`.page-card`):
      Título, Resultados y Agradecimientos (con `.page-body.scrolly` +
      `.center-stack` para centrar-o-scrollear).
- [x] **Colisión acera SELLADA**: girar ya no puede meter las esquinas dentro
      de la pared (guard que revierte el ángulo) — era el hueco que dejaba
      atravesar la cuadra al pegarle dos veces al mismo punto; red extra:
      snap a la última pose libre (<60px) en vez del fallback "drive out".
- [x] **Vehículos 0.85× extra** (total ~0.72 del original) + hitbox tráfico
      14/10; sombra de silueta también en los previews de tienda/menús
      (`VehiclePreview.jsx` usaba fillRect).

## ✅ Tráfico continuo + dificultad + game-feel (2026-07-17)

- [x] **Tráfico que recorre el pueblo de verdad**: los carros ya no mueren al
      final de su way OSM (siempre en pantalla con la vista de ~400 px) — hacen
      **hand-off a una calle conectada en la intersección** (endpoints enteros
      exactos, ε=3 px, dedup de copias por tile) y solo hacen U-turn en
      callejones sin salida, como el tren; respawns con distancia mínima 300 px
      (nunca se materializan a la vista); densidad 20 → 14. (`src/game/spawns.js`)
- [x] **Colisión de cuerpo completo**: la pared se sondea con la caja orientada
      del vehículo (4 esquinas a 0.8×) en vez del punto central — se acabó el
      medio carro montado en la acera. (`src/game/physics.js`)
- [x] **Snap-turn móvil**: levantar y volver a poner el dedo abre una ventana
      de 0.6 s con giro completo a baja velocidad y steering más directo; el
      dedo sostenido conserva EXACTAMENTE el feel de drift actual.
      (`src/game/input.js`, `physics.js`)
- [x] **Pase de dificultad** (frustración → paseo): presupuesto de derretido
      `max(28, dist/80)` (antes `max(18, dist/110)`, break-even con manejo
      perfecto); golpe de tráfico = **un solo roll de 35% con 1.5 s de
      i-frames** (antes 12%/frame ≈ drop seguro); roce de edificio 4%→1%/frame;
      esquinazo conserva ~45% del momentum (antes 10%); tormenta wetMul
      0.85→0.92; caja de colisión de tráfico 17/12 acorde al nuevo tamaño.
- [x] **Vehículos ~0.85×** (jugador en `vehicles.js` + tráfico IA en
      `spawns.js`): las calles de 36 px vuelven a sentirse manejables tras el
      zoom-out.
- [x] **`src/render/vehicleShapes.js` — semilla Pixi (Milestone C)**: siluetas
      de vehículos como trazos de path puros (verbos compartidos Canvas2D /
      Pixi 8 Graphics, sin DOM ni fills); hoy dibuja la **sombra del jugador
      con la forma real del cuerpo** (cápsula bici, gota tuktuk, casco kart) en
      canvas2d; el backend Pixi la adopta al portar vehículos.

## ✅ Game-feel + mobile + APK pass — done 2026-07-10/11

- [x] **Separator final fix** (Calle 21 zone): removed the 2A tree-line
      conversion — Avenida 2A is a normal drivable street again and the
      **palm median runs inline through the whole Paseo de los Turistas**;
      León Cortés tree strip starts at the first cuadra corner (curve stays
      drivable); `connect_leon_calle20()` extends the paseo tip so Calle 20
      T-junctions instead of dying on sand. (`tools/build_world.py`)
- [x] **Text pass**: removed every "mae"; humanized the telegraphic stage
      briefs, customer lines and mode tips; player-facing wording is now
      **"nivel" + "completá"** (was "etapa"/"limpiá") across title, HUD,
      brief, results, barriers.
- [x] **Mobile controls fix**: touch steering was dead on the first
      fullscreen entry — mode starts replaced `state.cam`, wiping the
      renderer-published `zoom/vw/vh`. Now the cam is mutated in place,
      `setupCanvas` re-runs resize on `fullscreenchange`, and `applyTouchAim`
      falls back to window size instead of bailing.
- [x] **Pause button** (⏸) + mute (🔊) in the HUD; auto-pause when the tab/app
      backgrounds. Touch players can finally pause.
- [x] **Attract-mode menus**: the live world (sunset, traffic, gulls, boats)
      drifts behind the title + level select instead of a flat gradient
      (`src/game/attract.js`, `advanceEntities(dt, withPlayer)` extracted from
      `physics.update`); animated screen transitions; keyboard + gamepad menu
      navigation (`useMenuNav`); scrollbars/`confirm()` dialog removed.
- [x] **Procedural WebAudio SFX** (`src/game/audio.js`, no asset files):
      engine hum + drift, pickup/delivery/perfect/combo/melt-fail, menu blips;
      **per-vehicle engine voices** (bici freewheel → turbo kart saw); mute
      persisted to localStorage.
- [x] **Level select redesign**: Geometry-Dash-style **carousel** — one big
      readable level card with prev/next arrows + dots — beside a separate
      **vehicle card** with a live in-game sprite preview (`paintVehicle`
      exposed via the Renderer seam) and stat bars. Title screen's intro moved
      behind an ⓘ toggle so mode buttons stay above the fold on mobile.
- [x] **Self-hosted fonts** (`@fontsource`): Google Fonts links removed, game
      renders fully offline; SW cache → `churchill-v3`.
- [x] **Android APK (Capacitor)**: committed `android/` Gradle project
      (`dev.jcampos.churchill`), landscape + sticky-immersive, SW/immersive
      skipped in the WebView; new churchill-glass icon + splash. Release
      signing via a persistent keystore (secrets), and the **Pages deploy
      workflow now builds a signed APK published at `/churchill.apk`** on every
      push to `main`.

## 🚧 Modernization initiative (2026-07-06) — beautify, modularize, tool-up

Goal: match the reference art (`how-look-puntarenas/…hhm9…png`), fix the small/
uneven cuadras, and make the codebase maintainable. Guided by
`docs/Librería Gráfica para Juego 2D (1).md` (concludes PixiJS/WebGL).
Full plan lives in the approved plan file; status tracked here.

- [x] **Milestone A — Tooling foundation** _(done 2026-07-06)_
  - [x] pnpm + Vite build (npm React, drop CDN + in-browser Babel); scripts
        `dev`/`build`/`preview`/`inventory`/`world:build`; `dist/` for Pages.
  - [x] Split monolithic `engine.js`/`world.js`/`ui.jsx`/`tweaks-panel.jsx` into
        ES modules: `src/game`, `src/world`, `src/render` (Renderer seam →
        Canvas2D backend), `src/ui` (App + screen components + tweaks).
  - [x] `pnpm inventory` → `inventory.json` (element catalogs + world counts +
        `src/` module map) so elements are trackable without reading all code.
  - [x] Deploy workflow builds with pnpm and publishes `dist/`; `public/sw.js`
        rewritten for Vite hashed assets; `build_world.py` emits ESM data.
  - [x] Verified: builds clean, runs under Vite with zero console errors,
        deterministic `world:build` reproduces identical data.
- [x] **Milestone B — Cuadras, Paseo avenue & relaxed driving** _(done 2026-07-06)_
  - [x] Unify cuadras: drop minor alleys/paths (service/pedestrian) so blocks
        read bigger/explorable; main grid + intersections + El Roble bridge +
        splits kept. Synth buildings only on cuadra land (never aceras/streets);
        interiors may stay open (frontage band).
  - [x] Paseo de los Turistas → principal street with a dashed **palm median**
        (solid blocking separator + periodic crossing gaps).
  - [x] Engine feel: zoom 2.4→3.2; slower higher-grip vehicles + slower traffic
        (relaxed cruise); pedestrians walk aceras + cross streets; vendor carts
        back on the Paseo aceras; smoother cuadra/building/traffic/water bumps.
  - [x] Feel iteration (2026-07-07): wider "giant" streets; zoom →5.5; **aceras
        non-drivable** (drive only the streets, slide along curbs); no parked
        cars; bigger vehicles/traffic; **planted green Paseo median** (emitted
        geometry + render); buildings never overlap street/acera; drivable POI
        aprons. Map deformed wider (CROSS_EXAG 1.95, canvas 8800×1640). Verified
        all 24 POIs reachable (97.6% connectivity).
- [x] **Milestone B★ — Cuadrícula standardization** _(done 2026-07-10)_ —
      make cuadra/street sizes uniform and identical across devices by laying
      the city on a tile grid (a *cuadrícula* = one tile). Spec:
  - **Cuadrícula unit** `CUAD` px, emitted in `meta.cuad`; everything is a
    whole number of cuadrículas.
  - **Streets**: secondary = **4 cuadrículas** (2 per lane); principal = **6
    cuadrículas** (3 per drive side).
  - **Cuadras (blocks)**: minimum **6×6 cuadrículas** of buildable land **+ 1
    cuadrícula of acera on every side** (so ≥8×8 footprint). A block **grows to
    fit the summatory of its buildings' sizes** — buildings may differ in size
    (each a whole number of cuadrículas), and the cuadra's dimensions are the
    sum of its lots (+ gaps + the acera ring), snapped to the grid, never below
    the 6×6 minimum.
  - **Keep all OSM streets** (faithful map): the grid standardizes sizes by
    **snapping streets/blocks to the cuadrícula**, not by dropping streets.
  - **Shapes preserved**: blocks are built from cuadrícula cells but keep
    organic shapes where the network makes them — squares, triangles,
    trapeziums, rounds, and L-shapes (e.g. the L-cuadra at El Faro).
  - **Buildings snap to the cuadrícula** inside each block, inset by the acera
    ring, so they never overlap aceras or streets and read uniform.
  - **Device standardization**: at most **12 cuadrículas per view**; the engine
    computes a **responsive zoom** = `viewportWidth / (cuadsPerView × CUAD)` so
    every device shows the same amount of city (nice, surprising exploration).
  - Care at **intersections** (grid-align crossings; don't orphan blocks).
  - Steps: (1) emit `meta.cuad`/`cuadsPerView` + responsive zoom [done first];
    (2) quantize acera to 1 cuadrícula + grid-snap building lots; (3) prune/snap
    the road network to enforce min 6×6 blocks while preserving shapes; (4)
    regen, verify connectivity + look, tune.
  - **Shipped 2026-07-10** (decisions: keep OSM centerlines, quantize widths
    only; undersized blocks pave to plaza; width tiers principal/standard/minor
    = 6/4/2 CUAD): streets 120/80/40px + 1-CUAD aceras; **3× world scale**
    (26400×4920 — at the old scale the corridors consumed the centro; 44 real
    cuadras + 243 plazas + 122 green strips now); `detect_blocks()` three-way
    classification preserves organic shapes; all 8000 buildings are whole-CUAD
    rects placed inside one block each (overlap impossible by construction);
    zoom = width/(12·CUAD), floor 3.5, no upper clamp; **build gate** fails on
    any unreachable POI (flood-fill from spawn) + prints the block census.
    Gate also fixed two pre-existing unreachable POIs (parquemar, matalimon).
  - Follow-ups: **feel pass for the 3× world** — vehicle speeds/timers tuned
    for longer trips, sprite scale vs 120px streets, traffic/ped spawn pitch;
    `tools/headless-check.js` is stale (pre-Milestone-A file layout) — the
    Python build gate replaces it for world checks.
- [ ] **Milestone C — PixiJS / WebGL render backend** behind `src/render/Renderer.js`
  - [ ] `PIXI.Application({ resolution: dpr, autoDensity })`, `NEAREST` scale +
        CSS `image-rendering`, integer-multiple camera (kills jitter).
  - [ ] Layered containers (water → land → blocks/roofs → roads → shadows →
        landmarks → entities → weather → overlays); static world cached once.
  - [ ] Water `DisplacementFilter` (+ optional `ReflectionFilter`); per-weather
        `ColorMatrixFilter` grading; normal-map roof/Faro lighting (stretch).
  - [ ] Match reference palette (terracotta/green roofs, turquoise gulf, sand).

- [ ] **Milestone D — Full 2-D real-Puntarenas map (transitable)** _(requirement,
      2026-07-11; depends on Milestone C)_
  **Objective:** the game must be traversable over the *real* Puntarenas, not just
  the unrolled route strip. Today the world is a **corridor-unroll** (`x` =
  arclength along the Faro→Caldera spine, `y` = exaggerated perpendicular offset)
  clipped to a **~900 m half-width corridor** — so ~2,160 of 2,666 OSM streets
  (Barranca, El Roble, Esparza, Chacarita, the north bank, the real *Avenida del
  Ferrocarril*) are omitted **by design**. This milestone replaces that with a
  true planar 2-D map of the whole OSM extent.
  - **Can Pixi do it? Yes — Pixi is the enabler, not the whole job.** WebGL/Pixi
    is what makes a full-town 2-D map viable at 60 fps (thousands of sprites,
    tiled culling, free pan/zoom); the Canvas2D backend can't scale to it. But
    the *heart* of the change is the **world projection**, independent of the
    renderer.
  - **Projection (`tools/build_world.py`)** — swap the corridor-unroll for a
    **planar local projection** (ENU metres / Web-Mercator) of the full OSM
    bounds. Keep it deterministic. Districts become **2-D polygonal regions**
    (not `x`-bands); barriers become region borders.
  - **World data / budget** — a full-town RLE surface grid + all roads/buildings
    will blow the current 2 MB `data.js` budget → **chunk/stream** the world
    (tiled grid + per-tile road/building lists) and load lazily.
  - **Renderer (Pixi, Milestone C seam)** — tiled static-world containers with
    viewport culling; **free 2-D camera** (pan/zoom), route-follow demoted to an
    optional guided-story view; minimap becomes a real 2-D map.
  - **Sim** — physics/collision already grid-based (`surfaceAt`), scales to 2-D;
    `reachablePointNear`, `nearestKiosk`, delivery are already 2-D. Re-anchor
    stages/kiosks/customers to 2-D geo. Traffic/ped spawns per-tile.
  - **Migration path** — land the Pixi backend (C) first, then swap projection +
    world-gen behind the `Renderer.js` seam so Canvas2D/corridor stays runnable
    until D is verified.
  - **Brings in for free:** the real Avenida del Ferrocarril, Cocal-entrance and
    Chacarita/20-Nov street topology (the in-corridor "revoltijo" is partly an
    unroll artifact), and true block shapes — several World-fidelity items below
    fold into this.
  - **PROGRESS (2026-07-12, branch `world-2d`; full log in `docs/WORLD_2D_MIGRATION.md`):**
    - [x] **Phase 1 — planar world build.** `tools/build_world.py --planar` emits a
      streamable tiled world → `src/world2d/manifest.json` + 416 `tiles/<tc>_<tr>.json`
      (26×16 @2000px; world 50820×31860 @1.6px/m, ~160s). Real true-scale Puntarenas
      (spit + Barranca/Esparza + Mata Limón/Caldera), 169 cuadras, all 7 stages, POI
      gate 52/52. Corridor `src/world/data.js` untouched (still the shipped game).
      Big fixes: `map.osm` spans ~85×92 km (clip to a Puntarenas bbox); a land-flooding
      bug (corridor filters gutted 2-D extraction) — fixed via full-coastline + water-poly
      flood barriers seeded only from the open gulf.
    - [x] **Phase 2 — streaming accessor** `src/world2d/index.js` (`WORLD2D`): mirrors the
      `WORLD` API, streams tiles by camera (`ready/update/visibleTiles`), `districtAt` by
      nearest POI-centroid (x-strips can't separate N–S Mata/Caldera). Verified in-browser.
    - [~] **Phase 3/4 groundwork — traversability PROVEN.** Dev smoke viewer
      (`/world2d.html`, not shipped) drives a car with the real physics against
      `WORLD2D.surfaceAt` — 100% on drivable surface, blocked by water/walls, districts
      update. Full 2-D Puntarenas is drivable.
    - [x] **Streets widened** `ARCADE_STREET_MUL 2.2→3.2` (`9be3c59`). Rebuilt (164s);
      gores/cuadras survive (164 cuadras, 92.1% drivable, 52/52 POIs), residential 25→36px,
      corridor median 72px. Re-verified: car drove 411px along-street at full speed.
    - [x] **Phase 3 core — PixiJS/WebGL renderer** (`fa222ef`). `pixi.js` 8.19 +
      `src/render/pixi/` (`World2DRenderer` camera-transformed layered containers, per-tile
      surface `CanvasSource` textures, exact culling via `visibleTiles`) + shared
      `src/world2d/drive.js`. Verified in `/world2d-pixi.html`: renders/drives/zoom-out.
      Not behind the `Renderer.js` seam yet, so the shipped game is unchanged and `pixi.js`
      stays out of the prod bundle.
    - [x] **Pixi whole-map backdrop** (`0fad9f9`) — gap-free extreme zoom-out from the
      manifest `LAND_POLYS/WATERS/BEACHES` polys under the ±3-tile detail window.
    - [x] **Phase 4 — `WORLD2D` wired into the shipped game** (`296a928`): all game modules
      on the streamed 2-D world; water-as-wall physics; camera-local streaming spawns;
      `districtAt(x,y)` everywhere. All three modes run on the 2-D map.
    - [x] **Painterly renderer for the 2-D map** (`d5acc73`): `drawWorld2D` in `canvas2d.js`
      draws the corridor's art style from per-tile vector features (Pixi backend stays
      available behind the seam).
    - [x] **2026-07-16 session — MVP hardening pass:**
      - **Traffic lane-following**: cars ride the road polylines (arclength + right-hand
        lane offset, recycled at piece ends) instead of wandering the surface grid;
        **pedestrians walk aceras only** (class 6, never the road).
      - **Rails + paseo separators restored** in `drawWorld2D` (per-tile `rails`/`medians`
        were emitted but never painted); separator ground narrowed 2 → **½ cuad**
        (`PASEO_MEDIAN_W`).
      - **Camera zoomed out**: `CUADS_PER_VIEW` 12 → 16 (floor 3.5 → 2.6).
      - **Mobile controls v2**: one-finger virtual joystick — angle steers, extension is a
        speed delimiter (`input.limit`), pushing past the rim engages the turbo; ⚡ pedal
        removed, only brake ✋ remains. (Replaces point-to-drive.)
      - **Barrio bounds audited vs OSM place nodes** (`scratchpad/audit_districts.py`
        approach: calibrate lon/lat→x/y from the district edges, project all 141 `place=*`
        nodes): Las Playitas (-84.8274) / El Cocal (-84.8171) bands were swapped one barrio
        east — bounds + POI anchors fixed (kios_play/c11 moved to real Playitas, yatch
        re-tagged cocal, parquemar/c9 → playitas, c12 → Carmen by the ferry — the corrected
        Playitas strip is spread-full, ferry boundary nudged). Known x-band
        limitations documented (paseo↔centro and mata↔caldera stack in 2-D; centroid-based
        `districtAt` handles naming — true polygon rings remain Phase 5).
      - **MVP gate for the Play Store release**: everything east of the playitas|cocal
        boundary (El Cocal, Mata, Caldera + inland barrios) is fenced with a
        "PRÓXIMAMENTE" wall in EVERY mode (`MVP_LOCKED` in `progress.js`); kiosks/customers
        behind the wall are never offered; Historia stages 5–7 show "Próximamente" in the
        level select.

## 🚧 Play-Store readiness pass (2026-07-16 PM) — tutorial, i18n, settings, monetización

- [x] **Tutorial jugable** (`src/game/tutorial.js` + `startTutorial` en modes.js):
      run guiado sin timer en el kiosco del Paseo — 7 pasos (girar, acelerar/
      delimitar velocidad, turbo, freno/drift, recoger, entregar, cierre) con
      instrucciones según plataforma (joystick táctil vs teclado) en un panel
      del HUD; primera entrega = cliente más cercano (`pickCustomerNear`);
      tarjeta "Tutorial" en el título (pulsa en el primer arranque,
      `churchill_tutorial_done_v1`) + replay desde Ajustes.
- [x] **i18n completo es/en** (`src/i18n/index.js`): tabla de strings + store
      suscribible (`useT()`), idioma persistido y auto-detectado; traducidos
      TODOS los textos instructivos (título, modos, HUD, pausa, resultados,
      brief, level select, ajustes, tips de juego, carteles de barrera en el
      canvas, tutorial) + nombres/briefs de niveles (overlay EN por stage id).
      Las frases de clientes quedan en español a propósito (voz porteña).
- [x] **Pantalla de Ajustes** (⚙ en título y pausa): idioma ES/EN, volumen
      (slider + mute, `sfx.setVolume` con gain persistido), "Quitar anuncios"
      (comprar/restaurar), replay del tutorial, borrar progreso, versión.
- [x] **Monetización (scaffolding completo, IDs de prueba)** — ver
      `docs/MONETIZATION.md`: AdMob (`@capacitor-community/admob@8`) con
      interstitial cada 3 partidas + rewarded "Seguir +60s" al perder;
      IAP `remove_ads` (`cordova-plugin-purchase@13`) con entitlement
      persistido; App ID de prueba en el AndroidManifest. Pendiente externo:
      cuenta AdMob + Play Console (producto, 20 testers × 14 días, target 34).

## 🔮 Server-side (futuro — decidido 2026-07-16, sin código aún)

**CLIENTE YA CABLEADO (2026-07-16, ver `docs/REMOTE_CONTENT.md`):** la app
carga `https://churchill.jcampos.dev/content.json` (hoy = archivo estático
`public/content.json`; mañana = API real en la misma URL y mismo esquema, sin
tocar la app). `src/content/remote.js`: caché localStorage TTL 6h + fallback
empacado — 100% jugable offline.

- [x] **NPCs del servidor** — si `content.npcs` no está vacío REEMPLAZA el
      pool de clientes (regla: a largo plazo todos los NPCs vienen del
      server); posiciones por lat/lon reales proyectadas con `meta.geo` del
      manifest (`WORLD2D.geoToWorld`), distrito por `districtAt`, línea ≤26.
- [x] **Lotes patrocinados** — `tools/gen_lotes.py` → `docs/lotes_catalog.json`
      (709 parcelas candidatas con id estable + lat/lon en el área MVP); el
      cliente pinta los lotes reclamados de `content.lotes` como valla o
      frente de local con la marca. Alta de un negocio = 1 entrada JSON.
- [x] **Página de agradecimientos** — `SupportersScreen` (❤ en el título +
      Ajustes), tiers 1–4 del plan de funding, botón ko-fi de `content.meta`.
- [ ] **Backend real (cuando el volumen lo pida):** API + panel admin con
      moderación, reservas de lotes con vigencia, y sync de supporters desde
      ko-fi; sirve el MISMO `content.json`. Validación IAP podría vivir ahí.

## ✅ Polish pass post-tienda (2026-07-16 PM3)

- [x] **Muelle de Cruceros restaurado**: `drawPier`/`drawBridge` no se llamaban
      en el render painterly (deck manejable pero invisible) + el ancla planar
      usaba el nudge dx:680 de corredor → re-anclado al extremo sur de la
      Calle Central real (`planar_muelle_axis`), junto a la entrada este del
      Paseo. Gate 56/56.
- [x] **Población como el original**: los peatones se generan A LO LARGO de las
      calles en la media-acera (el muestreo aleatorio casi nunca caía en la
      franja) — tráfico 20 / peatones 64 cerca de cámara.
- [x] **Tienda estable + carrusel**: tarjeta de ancho/alto fijos entre tabs;
      vehículos en carrusel centrado (flechas + dots) en vez de grilla.
- [x] **Ícono redondo SOLO para el APK** (`how-look-puntarenas/Diseño sin
      título (3).png`); favicon/PWA conservan el arte cuadrado neón.
- [x] **Tutorial coach-marks**: velo gris translúcido + spotlight pulsante
      sobre el control requerido (joystick/freno/brújula/barra de hielo) con
      flecha; demo animada del dedo-acelerador en móvil (mano que se aleja del
      carro); en PC teclas animadas (WASD/W/X/ESPACIO) — mapeo por plataforma.
      Tutorial ahora es un pill 🎓 en la barra del título (no una tarjeta de
      modo); fila del título en flex (el ⓘ ya no traslapa el pill).
- [x] **Zoom −1 paso más**: el framing ahora vive en el RENDERER
      (`CUADS_PER_VIEW = 20` en canvas2d, piso 2.2; `meta.cuadsPerView` queda
      como referencia) — se ve más calle adelante al manejar.

### 🔜 Trabajo restante (estado al 2026-07-16)
- [ ] **QA en dispositivos** (usuario): joystick v3 + acelerador por distancia,
      tutorial coach-marks, tienda/monedas, iPhone dvh + hint A2HS.
- [ ] **Play Console**: cuenta, productos (remove_ads + 3 packs), AdMob real
      (App ID + unidades + UMP consent), política de privacidad URL, ficha,
      pruebas cerradas 12×14 — checklist completo en `docs/MONETIZATION.md`.
- [ ] **Merge a main** cuando el MVP esté validado (quitar world-2d del
      workflow de deploy al hacerlo).
- [ ] **Post-MVP**: abrir El Cocal→Caldera (quitar `MVP_LOCKED`), anillos 2-D
      de distritos (mata/caldera y paseo/centro se traslapan en x), puente a
      desnivel Barranca/El Roble, backend de contenido (ko-fi webhook → NPCs,
      reservas de lotes), Tier 4 (kiosco/vehículo brandeado).

## ✅ Economía + Tienda + fixes móviles (2026-07-16 PM2)

- [x] **Monedas Churchill** (`src/game/economy.js`): +3/entrega (+2 perfecta),
      duplicador por rewarded ad en resultados; catálogo data-driven —
      vehículos (cart 350/pickup 900/turbo 1500; bici+scooter+tuktuk gratis),
      mejoras cooler/turbotank (3 niveles), boosts icepack/headstart por
      corrida, 6 colores equipables por vehículo. Persistido en progress con
      migración silenciosa.
- [x] **Tienda** (🛒 en el título, con saldo): tabs Vehículos/Mejoras/Boosts/
      Colores + packs de monedas IAP (coins_500/2000/4000, consumibles) —
      ver tabla en `docs/MONETIZATION.md`.
- [x] **Selector de vehículo para Arcade/Recorrer** (overlay pre-partida con
      boosts armables); Historia mantiene su tarjeta (chips 🔒 para los no
      comprados).
- [x] **Menús scale-to-fit** (`FitScale.jsx`): las tarjetas se escalan enteras
      al viewport — sin scroll ("sensación web") en pantallas chicas; arregla
      además el traslape del selector de niveles.
- [x] **Controles táctiles v3**: joystick FIJO abajo-izquierda (solo
      dirección) + acelerador con el otro dedo por distancia al carro (lejos
      = rápido, muy lejos = turbo); ✋ freno. Tutorial actualizado.
- [x] **iPhone web**: layout 100dvh + aviso "Agregar a pantalla de inicio"
      (Safari no tiene fullscreen API; la PWA instalada sí es fullscreen).

## ✅ City-feel + mobile pass — done 2026-07-10

- [x] **Beachfront avenue separators (final layout, user-iterated)**:
  - Paseo de los Turistas keeps its classic **palm median** — dashes with
    crossing gaps aligned to the coming streets (`paseo_median_runs`).
  - Two **continuous tree lines** (no gaps): the 3-carril merge stretch
    (Avenida 2A's middle carril replaced along its exact curve,
    `extract_treelines`) and the kiosks street (Paseo León Cortés, promoted
    to principal; its dual-carriageway twin deduped) up to the muelle.
  - Beyond the muelle street: normal streets, no separators. Beach palms
    are a separate system and were never touched.
- [x] **Muelle de Cruceros** moved to its real spot: the end of Calle Central
      beside the kioscos; the entrance tail keeps only its LEFT carril
      (2 CUAD) flush with the pier centerline (`narrow_muelle_approach`).
- [x] **La Punta layout** per `how-look-puntarenas/faro.jpg`: lighthouse on
      the rocky tip outside the road loop; **Balneario Municipal** pool added
      inside the loop (new `pool` landmark type with lagoon render).
- [x] **HUD minimap fixed** (still used the pre-OSM world's centerY=700 /
      320px half-span — silhouette collapsed after the 3× scale).
- [x] **Mobile overhaul**: point-to-drive touch controls (hold a finger where
      you want to go; brake ✋ + turbo ⚡ pedals; multi-touch, safe-area
      insets), fullscreen + landscape lock on play (`src/ui/immersive.js`),
      CSS rotate-overlay for portrait, orientation-aware canvas resize.
- [x] **Objective compass** pinned top-center of the screen (rotating arrow +
      distance in meters) replacing the easily-lost in-world arrow; **camera
      hard clamp** — the vehicle can never leave the middle of the screen
      (lookahead now scales with the real view instead of a fixed 70px).

## ✅ Fixed during this audit

- [x] Story-mode deliveries now extend the timer (+10 s / +5 s) as the GDD specifies — previously only Arcade/Recorrer got extensions.
- [x] Recorrer barrier signs now show the correct required stage (stage whose clear unlocks the district) instead of the district's array index.
- [x] `bridge=yes` OSM segments (Río Barranca at El Roble, estero arms on Vía 23) get a concrete deck render + bridge surface class.
- [x] Muelle pier connected to the street grid (drivable network 99% reachable from spawn; the unreachable 1% is canvas-clipped fragments at the top edge outside the play area).

## ✅ City-feel pass — done 2026-07-05 PM

- [x] **Vehicle sprites per type** — bikes (bici/scooter) render as two-wheeler with rider + helmet; cars keep the body/roof/windshield box. Stretch remains: distinct silhouettes per car (tuktuk 3-wheel, pickup bed, cart canopy).
- [x] **More zoom** — engine `ZOOM` 1.8 → 2.4, street-level city driving.
- [x] **Aceras** — surface class 6: 8px sidewalk fringe on all roads in the grid + concrete band render (w+16) + 0.62 traction; synthesized houses front the acera leaving ~6px of visible sidewalk.
- [x] **Solid cuadras** — class-1 land is now a wall with slide-along-edges physics. Drivable: streets/aceras/beach/paseo/bridges/pier + plaza pads stamped under every kiosk, customer, and the Faro plaza. Verified: all 6 kiosks + 18 customers reachable from spawn through the drivable network (97.9% connectivity, pier included).
- [x] **Waiting customer figure** — the active delivery target now renders as a waving person on a concrete pad with a pulse ring (was an invisible point + arrow).
- [x] **Alive city** — pedestrians walk the aceras of every local street (240 cap, Paseo stays densest), ~220 parked cars along curbs (kept clear of kiosks), vendor carts with swaying parasols on the Paseo and beside every kiosk, 14 stray dogs/cats that amble across streets and pause.
- [x] **Vehicle + traffic variations** — player: bici (thin frame + rear cooler box), scooter (deck + leg shield), tuktuk (teardrop 3-wheeler with canopy), cart (striped canopy + freezer lid), pickup (cab + open bed with cooler), turbo (exposed-wheel kart with spoiler). Traffic on main roads mixes cars, box trucks (15%), and orange buses (9%, slower, window rows).
- [ ] Alive city 2: peds react to horn, occasional cyclists, market crowd at the Mercado, night windows lighting up.
- Note: Chrome fully suspends requestAnimationFrame for hidden/occluded windows — game and screenshots pause; not a bug (verified `document.visibilityState === "hidden"` during every observed "freeze").

## 🎯 Gameplay gaps vs the GDD

- [ ] **Audio** — no music or SFX anywhere in the codebase (no `Audio`/`AudioContext` usage). Needs: engine SFX (pickup, deliver, drop, splash, combo), ambient loop, weather layer.
- [ ] **Turbo boost semantics** — GDD says X multiplies current velocity ×1.35 one-shot; implementation is a continuous ramp (`vx *= 1 + 0.7·dt`) plus a ×1.35 speed-cap raise. Decide which feel is wanted and align GDD or code.
- [ ] **Seagull drop chance** — effective ~0.15%/frame (two nested rolls) vs GDD's ~0.5%/frame. Balance decision.
- [ ] **i18n / English mode** — target audience includes international tourists but every UI string is hard-coded Spanish. Needs a string table + language toggle.
- [ ] **Handbrake turn boost** (×1.35 while braking) exists in code but not in the GDD — document or remove.

## 🗺️ World / map roadmap

- [ ] **Mata de Limón bridge span** — the marquee suspension bridge is only ~55 px long because the coast leg is compressed by the x-warp. Add a local scale boost around the estero so stage 6's crossing feels substantial.
- [ ] **Route 27 / Caldera edge** — roads clip abruptly at the canvas east edge; add a stylized "A SAN JOSÉ →" vanishing treatment.
- [ ] **Building density pass 2** — 770 buildings placed; blocks in Barranca/El Roble (north bank) and rural coast are still sparse. Raise synth caps / add second-row placement for deep blocks.
- [ ] **Estero de Puntarenas north bank** — mangrove/wetland texture band along the estero side of the spit (currently plain land).
- [ ] **Named intersections** — El Roble junction and the Angostura narrows could carry signage landmarks like Caldera Bulevar does.

### 🛠️ World-fidelity pass (2026-07-11, from playtest feedback)

- [ ] **Ferrocarril avenue** (barro/dirt street) — _in progress_
  - [x] **Barro rendering machinery** — a `barro` road flag (set in the world
        build) renders a raised packed-earth surface: drop-shadow bank (~1 m
        lift), dirt shoulders, no lane markings, sunlit curb highlight
        (`drawStreets` in `canvas2d.js`).
  - [x] **Correct barro avenue = Avenida 2 del Ferrocarril** (OSM-misspelled
        "Farrocarril", x≈5568–8359) — flagged `barro` (match "rrocarril").
        (Was wrongly Avenida Centenario; now un-flagged.) Paseo León Cortés
        ends at x≈5565, right where the barro avenue begins.
  - [x] **Tree line** on the north shoulder of Av. 2 del Ferrocarril
        (x≈6892→end), separating it from Av. Alberto Echandi Montero;
        decorative + gapped at cross streets (67 trees).
  - [x] **Elevation ramp** — the raised barro avenue: `WORLD.onBarro()` +
        `state.elev` lerp + `drawPlayer` lift so the car climbs on / ramps off
        at intersections.
  - [x] **Rail line rendered** — `extract_rails()` + `drawRails()` draw the
        disused Ferrocarril al Pacífico (ballast + ties + steel rails) where it
        crosses the corridor (5 pieces, x≈5278–24433).
  - [x] **El Ancla monument** at the Cocal-split island (xy 8139,2379) via a new
        `xy` landmark-placement option (direct world coords off the 📍 overlay).
  - [ ] **Cocal-split dual carriageway** (x≈8139→11921, the split up to the
        estero): the avenues should be **divided — 2 lanes each side**, not one
        merged slab. Part of the road-stamping / separate-carriageway work
        below; folds into **Milestone D**.
  - [ ] **Real OSM "Avenida del Ferrocarril"** (Barranca) + full off-corridor
        town — arrives with **Milestone D** / full 2-D map.
- [ ] **Road-stamping / cuadra separation** — where OSM roads run close together
      `raster_stamp_polyline` floods the cuadra interior with road, so no solid
      `CLS_LAND` core survives → you can drive through blocks and junctions read
      as one merged slab. Root cause of: collision gaps ("enter cuadras"), the
      **Cocal entrance / CLUB DE LEONES** merge, and the **Chacarita / Barrio 20
      de Noviembre** revoltijo. Fix: guarantee a minimum cuadra core between
      parallel ways; split merged junctions.
- [ ] **Mercado cuadra size** — the Mercado Central block renders as a tiny land
      spot (below `BLOCK_MIN_CUADS`/small OSM footprint); should be a full ≥6×6
      cuadra. Targeted block-classification fix.
- [x] **Delivery targets** — customers were static POIs (same spot every time,
      some stranded on the beach). Now each order snaps to a random reachable
      street point near the customer's anchor (`WORLD.reachablePointNear`).
- [x] **Debug coordinate overlay** — 📍 HUD toggle: world-coordinate grid +
      live `x/y · surface · district` readout (persisted).

## 📔 GDD updates needed (implemented but undocumented)

- [ ] Drivable **Muelle Nacional pier** (guard hut, lamps, blue rails; class-5 surface).
- [ ] **Boats** — ferries + pangas animate offshore.
- [ ] Landmark types `house`, `beachsign`, `sign`, `civic` render but aren't in the GDD type list; data has 30 landmarks, GDD says 29.
- [ ] Camera **ZOOM = 1.8** and the corridor-unroll map projection (world no longer matches the GDD's original synthetic-profile description).

## 🧹 Technical debt

- [ ] Dead state: `state.rainT`, `state.timeOfDay`, `boat.wake`, unused `Game.pause()` API (React drives pause directly).
- [ ] `weatherColors()` allocated per-object per-frame (drawHills/drawLand/drawEstuary) — cache per frame.
- [ ] `drawLandmark` has no `default:` case — a new landmark type would silently render only its shadow.
- [x] Touch controls double-gated — resolved 2026-07-10 (point-to-drive), then
      superseded 2026-07-16: a one-finger virtual joystick (steer + speed
      delimiter + rim-turbo) replaced point-to-drive; only the brake pedal
      remains, gated by the coarse-pointer media query.
- [ ] Headless smoke harness lives in a session scratchpad — move `headless.js` into `tools/` and wire a CI check.

## ✅ Completed 2026-07-05 (was "in progress")

- [x] **Pushed to `main`** and deployed: https://churchill.jcampos.dev (GitHub Pages, build_type=workflow; the first run failed racing the legacy-mode switch — re-dispatch succeeded).
- [x] **Vehicles verified** — all 6 GDD vehicles selectable in the UI (`ui.jsx:94` maps every `Game.VEHICLES` entry) with stats matching the GDD table. Only divergence: turbo boost is a ramp, not a one-shot ×1.35 (tracked above).
- [x] **Customer/delivery spread enforced** — c3 was 64px from kiosk 1 (instant deliveries); the pipeline now guarantees every customer ≥150px from all kiosks and ≥120px from other customers (expanding-ring reposition on land within the customer's district), verified zero violations across all 18.

## 🚀 Deployment

- [x] GitHub Actions → GitHub Pages workflow (`.github/workflows/deploy.yml`), deploys on push to `main`.
- [x] PWA: `manifest.webmanifest` (fullscreen landscape, es, generated churchill-cup icons 192/512) + `sw.js` service worker — network-first for game files (so `world-data.js` never goes stale — covers the cache-busting item), cache fallback offline, cache-first for versioned CDN assets.
- [x] Touch controls CSS fix: hidden by `(pointer: fine)` instead of `min-width: 880px`, so landscape tablets get the joystick/pedals.
- [ ] Mobile QA pass on real devices (iPhone/Android/tablet): touch feel, fullscreen/safe-area, frame rate.
- [ ] Deploy flake: push-triggered `deploy-pages` sometimes fails with GitHub's transient "Deployment failed, try again later" (twice so far); manual re-dispatch always succeeds. Consider a retry step in the workflow.

## 🧰 Toolchain (pnpm + Vite)

The app is a Vite project (ES modules under `src/`, React via `@vitejs/plugin-react`).

```
pnpm install          # deps (Node 20+; pnpm via corepack)
pnpm dev              # HMR dev server (http://localhost:8734)
pnpm build            # -> dist/ (static; what GitHub Pages publishes)
pnpm preview          # serve the production build
pnpm inventory        # regenerate inventory.json (element catalog + module map)
pnpm world:build      # rebuild src/world/data.js from docs/map.osm
```

`inventory.json` (repo root) is the machine-readable index of every game element
(districts, stages, vehicles, landmarks, customers, surfaces) plus world counts
and a map of `src/` modules with their exports — read it instead of the code.
Refresh it with `pnpm inventory` after any world or module change.

Source layout: `src/game/` (state, physics, input, spawns, delivery, modes),
`src/world/` (data + accessor), `src/render/` (Renderer seam → Canvas2D backend;
PixiJS backend lands here in Milestone C), `src/ui/` (React screens + tweaks).

## 🔁 How to regenerate the map (for any tool/session)

```
pnpm world:build      # rebuilds src/world/data.js + tools/debug_map.png + debug_features.svg
pnpm dev              # serve; open http://localhost:8734
```
Knobs at the top of `tools/build_world.py`: `TOWN_FRACTION`, `CROSS_EXAG`, `ROAD_WIDTH_PX`
(6/4/2 CUAD tiers), `CUAD`/`CUADS_PER_VIEW`, `BLOCK_MIN_CUADS`/`SLIVER_MAX_CUADS`,
`SYNTH_MAX_TOTAL`/`FRONTAGE_DEPTH`, `BUILDING_SCALE`, `DISTRICT_BOUNDS_GEO`,
`LANDMARK_DEFS`/`CUSTOMER_DEFS` (geo anchors; build fails listing unresolved POIs —
and on any POI unreachable through the drivable network). Camera zoom is responsive
(`computeZoom` in `src/render/canvas2d.js`, ≤12 cuadrículas per view).
