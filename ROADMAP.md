# La Ruta del Churchill — trabajo abierto

**Sólo lo que falta.** Todo lo hecho está en `docs/ROADMAP-ARCHIVE.md` (el
registro de planificación, con el porqué de cada decisión) y en
`docs/changelog/YYYY-MM-DD.md` (las notas de entrega, listas para publicar).

Este archivo llegó a 2 400 líneas y el 2026-08-14 se podó: varias de sus
secciones más viejas afirmaban cosas que habían dejado de ser ciertas —que no
había audio, que toda la interfaz estaba en español duro, que el mapa 2-D estaba
pendiente, que había 770 edificios— y un roadmap que miente es peor que ninguno.
**Cada afirmación se verificó contra el árbol antes de tocarla**; las que se
cayeron están al final, listadas en vez de borradas en silencio.

---

## 1. El mundo — decisiones que esperan al usuario

- [x] ~~**El reescalado: elegir el encuadre EN UN TELÉFONO.**~~ **Cerrado el
      2026-08-27 en p = 3.125** (`ARCADE_STREET_MUL` 1,856). El encuadre se deja
      en 160 m, así que la vista en metros no cambia en ninguna pantalla y lo
      que encoge es el carro: 10,4 m → 8,3, o sea 57 → 46 px de pantalla en
      teléfono. Las doce clases de vía conservan su ancho pintado AL PÍXEL —la
      restricción siempre fue en píxeles— y la calle encoge en metros, 16,4 →
      13,1, que es el suelo que la manzana recupera (+8,9 % en la cuadra del
      Mercado). La retícula del ráster no se mueve: 19 850 × 12 445 celdas en
      1 000 tiles, mismo suelo a la misma resolución.

      Los pasos 3-5 fueron con él: `GRID_CELL` y `CUAD` se derivan solos desde
      el paso 0, las velocidades subieron por 1,25 (px/s), los relojes de etapa
      **se conservan por construcción** —distancias y velocidades escalan
      juntas— y el substepping de física entró en la misma tanda.

      Y hubo un cuarto paso que `RESCALE.md` no podía prever: **deshacer el
      campo de dilatación**, que era exactamente la proyección no uniforme
      contra la que ese documento advierte. Medido en la ventana del centro,
      el reescalado le gana de frente: **31 `ghost` sin campo a 2,5, 26 con
      campo, 21 con el reescalado** — más edificios encajados y las calles
      rectas.

- [x] ~~**La gradería: los otros tres lados, y por dónde se entra.**~~
      **Cerrado el 2026-08-23.** Lito Pérez emite cuatro bandas de 12 px con las
      bocas libres en las esquinas y colisión SÓLO bajo esas bandas
      (`3 029 celdas manejables / 365 bajo gradería`); los cuadriláteros viajan
      en el landmark, así que el arte y la colisión no pueden derivar. La sombra
      dejó de ser el `quad(-3,0,0,0)` fijo y sigue al sol, con `dy < 0` forzado
      para que caiga al norte: offsets medidos **(9,30, −3,41), (0, −0,92),
      (−9,30, −3,41), (−9,04, −4,23) px**. `smoke:standshadow` nuevo. El
      validador del editor acepta `sides` plural o `side` legado y rechaza
      duplicados y mezclas. Las Playitas conserva su lado único, que es lo que
      prueba que el camino de compatibilidad sigue vivo.

      Sigue abierta la pregunta de diseño: si una plaza de barrio lleva el mismo
      asset a menor escala o uno propio.

- [ ] **Torres de luz en las canchas de barrio.** Los dos estadios ya las
      tienen (`blocks.json` → el bloque, cuatro en las esquinas del
      `footprint`). Lo abierto es el resto: una cancha de barrio es una
      PARCELA, no un estadio —no tiene `footprint`, tiene `hw`/`hh` y un `ang`—
      así que darle torres es decidir si una parcela `field`/`plaza` las lleva
      por defecto y a qué escala.

- [ ] **La ruta del bus: hoy es voraz, no un camino.** Desde el 2026-08-15 un
      bus se fija la próxima parada y resuelve cada cruce hacia ella, que ya se
      lee como una ruta. Pero **no hay búsqueda de camino** y es a propósito:
      el cliente no tiene el grafo de calles, sólo los tramos del tile que
      mira. Si un destino queda detrás de una manzana el bus da vueltas hasta
      encontrarlo. Cerrar esto de verdad pide líneas de bus AUTORADAS (una
      secuencia de paradas por ruta), que es un archivo nuevo y no un algoritmo.

---

## 2. Verticalidad 2.5D del mundo

La migración artística y sus cuatro herramientas complementarias cerraron el
2026-08-17: laboratorios animados, biblioteca/importador de sprites, autoría
semántica de siembras y fixtures de geometría mundial. El cierre está archivado
en `docs/ROADMAP-ARCHIVE.md` y auditado en
`docs/HAND_DRAWN_ASSET_AUDIT.md`. No se inició elevación en ese bloque.

Flora, actores y ferry ya declaran `heightM`; los edificios infieren altura y
esas familias desplazan sus sombras con el sol. Éste es ahora el siguiente plan,
descrito por `docs/HANDOFF-verticality-2_5d.md`:

- [x] ~~**Bandas de altura de escenas.**~~ **Hecho el 2026-08-20.**
      `heightM`/`castsShadow` se heredan por parts/groups y `paintParts` hace una
      primera pasada sobre las mismas partes, con el sol entrando por el frame.
      La catedral fue el fixture —nave 8 m, crucero 8, cimborrio 14, campanarios
      18— y se retiró su `$shadow`, más las de civicBuilding, school, fuel,
      kiosco, parkRiver y lote. Siete hojas de arte salieron idénticas y
      `pnpm smoke:sceneshadows` mide que la sombra barre 50 px en el día.

- [x] ~~**La fuente: las curvas de nivel del IGN.**~~ **Hecha el 2026-08-20.**
      `content/world/contours.json`: 16 499 curvas del WFS de SNIT, commiteadas
      como `docs/map.osm`. **Hacen falta LOS DOS juegos** — `curvas_1000` (2 m)
      hace honesto el arenal pero es cartografía urbana y no cubre Alto Cascabel
      ni Juanilama; `curvas_5000` (50 m) es el nacional y sí. Un DEM global habría
      levantado Carmen/Paseo/Centro/Playitas 6–8 m de TECHOS.

- [x] ~~**Canal de elevación del terreno.**~~ **Hecho el 2026-08-20.**
      `service/elevation.py` → campo a 80 px, `(cuenta:uint8, valor:uint16 LE)`
      propio, emitido sólo donde el tile no es plano; `groundZAt`/`groundGradeAt`
      en el cliente, bilineales. No se renumeró ninguna clase de superficie.

- [ ] **Perfiles por porciones de calle.** Autorizar tramos `flat`, `slope` y
      transiciones por arclength: cuesta → recta alta → bajada → recta baja. Los
      extremos compartidos deben resolver la misma cota y las intersecciones
      deben generar una transición alcanzable hacia la calle conectada.

- [ ] **Editor de perfiles.** Vista lateral y mapa enlazados, handles de cota,
      pendiente en %, validación de saltos/pendiente máxima y herramientas para
      empatar otra porción. Ferrocarril será el primer caso real que sustituya
      su lift visual actual.

- [x] ~~**Física por pendiente.**~~ **Hecha, y este archivo no se había
      enterado** (verificado el 2026-08-23 contra el árbol). No salió de un
      perfil autorado sino del campo de cota del IGN: `physics.js:729` persigue
      `W.groundGradeAt` proyectado sobre el RUMBO del vehículo, y `:427` / `:493`
      lo pagan en aceleración Y en techo (`simulation.json` → `grade`:
      `accelPerGrade -1.8`, `topPerGrade -0.9`, con topes porque el campo es
      interpolado). Colisión y navegación siguen en planta, como decía la fila.

- [ ] **NADIE DIBUJA LA COTA.** El campo se emite, la física lo corre y el único
      consumidor VISUAL es el charco de la tormenta (`c2d/downpour.js:94-106`).
      `state.zM` se escribe y no lo lee nadie. Esto es lo que el 2026-08-23 pasó
      a ser la capa three.js — ver §6.

- [x] ~~**`groundZAt` da un escalón en cada borde de tile.**~~ **Cerrado el
      2026-08-23.** `zSampleAt(gcx, gcy)` consulta la retícula GLOBAL y la
      bilineal puede tomar sus cuatro esquinas de tiles vecinos. La regresión
      primero reprodujo **23,00 m** de salto; después midió 678 bordes
      residentes con máximo **0,0057 m**. `smoke:grade` conserva además la
      prueba física: cuesta abajo sigue siendo 3,58× más rápido que cuesta arriba.

---

## 3. Las pantallas

- [x] ~~**Las doce que faltan.**~~ **Cerrado el 2026-08-28**: las DIECISÉIS
      pantallas se arman desde `src/ui/screens.json`. `over` y `title` fueron
      las dos primeras, `realmpick` y `passage` nacieron ahí, y las doce
      restantes se migraron de una tirada.

      Lo que NO entró está decidido y no pendiente: el agua del arranque, la
      fila de herramientas de la portada, las flechas de la carrusela, las
      pestañas de la tienda y el paso de diapositiva del intro son el MARCO —
      están en todos los renders de su pantalla y no hay ninguna decisión por
      pantalla en ellos.

      Y salió una prueba que faltaba. `tests/test_screens.py` comprueba que los
      ids del registro y los componentes coinciden, que ningún `when` está sin
      proveer y que el registro no lleva maquetado — pero **no puede ver si la
      pantalla sigue DIBUJANDO**. En esta misma migración la tienda quedó en
      blanco por un `import Slots` que faltaba, y `pnpm build` y las 472 pruebas
      pasaron igual. `pnpm smoke:screens` recorre las quince pantallas
      alcanzables y exige que sus bloques estén en el DOM; la decimosexta la
      cubre `smoke:passage`.

---

## 4. El mundo: medido y sin cerrar

- [x] ~~**EL NORTE NO SE CONECTA POR TIERRA.**~~ **Cerrado el 2026-08-28.** Se
      autoró el empalme en geo (`geography.json` -> `roadLinks`, motor en
      `service/roadlink.py`) y el mundo se reconstruyó: **69 -> 68 componentes**,
      con la que queda en 4 391 519 celdas = 4 228 466 + 162 945 + las 108 del
      corredor. NO se escribió una regla general, y está medido por qué: hay
      1 568 extremos libres y 128 pares a menos de 100 px, de los que sólo 9
      comparten nombre — y las dos puntas de la Calle del Arreo son anónimas, así
      que una regla o se pierde la que importa o suelda las 128.
      `finish.verify` exige ahora que las puntas queden en la componente que
      alcanza el spawn: la invariante de alcanzabilidad que no existía.

- [x] ~~**EL ESTERO SE ABRE.**~~ **Implementado el 2026-08-23.** El usuario pidió
      «un estero completamente abierto y manejable, pero **con las boyas** de la
      Travesía para que el nivel se pueda jugar», así que las boyas se quedaron
      y pasaron a ser un CAMPO DE REGATA sobre agua abierta: se fue la pintura
      de pasillo (banda, límites, estrías) y `laneAt` quedó topado a 190 px.

      El dragado se borró y la cuenca se INUNDA en `rasterise_surface`, antes de
      `trace_land_contours` — `basin opened 17 743 LAND cells to WATER`, con un
      borde de manglar de 40 px conservado y las celdas reclamadas por calles,
      sitios, POIs y anclas autoradas respetadas. Ninguna boya ni portón quedó
      en seco (antes: 82 de 170 sobre tierra firme).

      **Y destapó dos cosas que llevaban tiempo escondidas**, las dos cerradas:

      * `measure_channel` suavizaba el CENTRO del canal y podía sacarlo del agua
        en una curva. La estación informaba entonces media caña 0 —con toda
        honestidad— y el carril desaparecía donde el estero mide 200 px. Ahora
        una estación conserva el centro suavizado sólo mientras le deje tanta
        agua como su propia medición ya ofrecía. Medido: **min 0 → 36 px, 120
        estaciones mejoradas, 0 empeoradas**.
      * `trace_land_contours` guardaba las aristas de frontera en un diccionario
        `inicio -> fin`, así que un pellizco diagonal pisaba una arista y el lazo
        entero se descartaba **en silencio**. Bastó uno para borrar el lazo de
        24 200 vértices que es toda la tierra firme más el arenal: los patios de
        El Cocal se dibujaban como mar. Ahora es un multimapa y una cadena que no
        cierra se avisa. Medido sobre un fixture de dos bloques que se tocan por
        una esquina, el código viejo daba **0 lazos y 17 cadenas descartadas**.

- [x] ~~**EL COCAL: calles sí, manzanas no.**~~ **Cerrado el 2026-08-23.** La
      causa no era el veto por huella de OSM sino la clasificación `green` de
      `detect_blocks`: una cuadra que no inscribe su cuadrado se marcaba verde y
      `synth_buildings` se saltaba TODA la síntesis en ella. El rescate ahora
      recibe el borde este del distrito `cocal` autorado en vez del viejo límite
      Carmen/Faro. Medido sobre el mundo emitido, edificios por tile:
      `13_7` 131 → **190**, `14_7` 101 → **180**, `15_7` 13 → **75**,
      `17_7` 0 → **19** — por encima incluso de antes de la dilatación. 64
      cuadras en el distrito, una sola marcada bosque.

- [x] ~~**EL FERROCARRIL VA ENCIMA DE LA CALLE.**~~ **Cerrado el 2026-08-23.**
      Hay `content/world/railway.json` (registro v1, en el inventario, con
      validador estricto de nombres/metros en el editor) y un servicio de
      alineación que corre justo después de `extract_rails`, así que todo
      consumidor río abajo ve la geometría ya corrida. La `Calle del
      Ferrocarril` resultó ser un ramal N–S de ~75 m: la continuidad real la dan
      `Avenida del Ferrocarril` y `Avenida Alberto Echandi Montero`. Barrido de
      las 23 piezas emitidas: **9 alineadas**, 6 698/6 886 muestras comprobadas,
      **hombro sobre calzada 0/0**, errores entre-ejes/punto-medio **0/0**,
      `alignment_failures=[]`. Verificado además a ojo en El Cocal: la vía corre
      por el hombro, fuera del asfalto. Queda una brecha real de OSM de 53,1 m
      que no se une, y el par del Cocal se autoró con 14 m de tolerancia porque
      los ejes quedan a 8,5–11,9 m.

- [ ] **`smoke_sea` falla dos aserciones de pescadores** — verificado que falla
      por el harness, no por el mundo.
- [x] ~~**El Muelle de Cruceros no lo tocan las calles del frente.**~~
      **Medido el 2026-08-20 y cerrado sin tocar nada**: la cubierta inunda hacia
      una componente manejable que va del faro a El Cocal — no está aislada. Su
      RAÍZ está en la línea de agua (20 px a cada lado es arena y mar), así que no
      hay calles del frente que enlazar y el acceso por el norte es el correcto.
      Se escribió un portón que cruzara el paseo, se midió que no tenía a qué
      llegar, y se revirtió.

- [x] ~~**El malecón: 6 bandas, y no todas tocan la calzada.**~~ **Hecho el
      2026-08-20.** Se pavimenta EN UNA SOLA CORRIDA desde el cordón hacia el
      mar, sin tope de distancia: el guardia es la CLASE, no los píxeles. El tope
      de 150 px protegía manzanas que hacia el mar NO EXISTEN — medido, lo que
      separaba el cordón del malecón era acera y arena. Ahora **4 bandas y las 4
      alcanzan la calzada**, 1 281 cortes desde el cordón.
- [ ] **El malecón se corta entre el Faro y x≈15500** — entre el Paseo y la
      arena hay solar que la sonda no cruza a ese ancho.
- [x] ~~**Las atracciones no bloquean.**~~ **Hecho el 2026-08-20, y su premisa
      era falsa.** Los dos kioscos del Paseo están sobre sus PROPIOS pads de
      calle (172 y 108 px), no sobre la banda de 60 del malecón. Y la solución no
      necesitó medir nada: una atracción NO SE ESTAMPA, así que la compuerta de
      red ni la ve — el estorbo es del cliente. Ver `smoke:feria`.
- [x] ~~**El Parque del Muellero no existía**~~ **(2026-08-20).** Salía a 252x96
      px de una huella de 1 336x463 —el 4 %— con el rótulo flotando fuera. Su
      suelo es MALECÓN y ARENA, no tierra, y encima se lo sentaba «dentro de su
      manzana», que una cinta del frente marítimo no tiene. `shore` en
      `site-decor.json`; ahora 904x316 px con su contorno diagonal.

- [ ] **36 parcelas pisan >25 % de acera** — capillas, escuelas y gasolineras
      cuyo lote no se puede re-encajar sin perderlo.
- [ ] **El Faro "vacío"**: el debug map muestra que el barrio SÍ tiene manzanas;
      en juego se ve pelado.
- [ ] **Route 27 / borde de Caldera** — las calles se cortan a pique en el borde
      este. Falta un tratamiento de fuga ("A SAN JOSÉ →").
- [ ] **Intersecciones con nombre** — el cruce de El Roble y la Angostura
      podrían llevar rótulo como Caldera Bulevar.
- [ ] **El puente de Mata de Limón**: 96 px de vano. Era ~55, y la razón que
      daba este archivo —"lo comprime el x-warp"— ya no existe (la proyección
      corridor se borró el 2026-07-25). Si sigue leyéndose corto es una decisión
      de escala, no un artefacto.

---

## 4b. El aspecto: tapete de ciudad CON profundidad

Plan en `docs/investigacion-2d-avanzado.md`, con la premisa corregida: **el
render cuesta 1,24 ms de un cuadro de 16,7**, así que el salto a WebGL que ese
documento propone resuelve un problema que no existe. Canvas2D se queda y lo que
faltaban eran las técnicas.

- [x] ~~**Fase 1 — el suelo vuelve a ser lugares.**~~ 2026-08-28: `c2d/noise.js`
      (ruido de valor sobre el `hash01` que ya existía), `c2d/curves.js`
      (redondeo por esquina — NO Chaikin, que encoge el polígono y abre las
      costuras) y `c2d/districts.js` (El Cocal arenal, el Centro cal y zinc, el
      Paseo pasteles de balneario).
- [x] ~~**Fase 2 — el pueblo gana volumen.**~~ 2026-08-28: paredes por paralaje
      con la rotación gratis, sombra como barrido en vez de copia despegada, y
      orden de pintado por distancia radial. Falta escoger `cameraHeightM` con
      el ojo: `logs/depth-{150,80,45}m.png`.
- [x] ~~**Fase 1b — materiales: patrones y textura.**~~ 2026-08-28:
      `c2d/materials.js` + `materials.json -> textures`. La tinta va aparte del
      color (el clima lo mezcla cada cuadro, así que un patrón con fondo no se
      podría cachear) y **son DOS caminos, no uno**: `speckle`/`hatch` en
      mosaico para lo que no cubre la pantalla, `scatter` sembrado sobre el
      rectángulo visible para lo que sí — un relleno con patrón cuesta ~10 ns
      por píxel y la tierra sola pasaba el cuadro de 17,3 a 32,9 ms. Y la
      paleta pasó de pastel a **color vivo**: 51 valores escritos a mano, con
      diez de las once hojas de arte IDÉNTICAS como prueba de que no se derramó.
- [ ] **Fase 3 — el mundo bajo un cielo.** Sombras de nubes en `multiply` a
      media resolución, atadas a `stormLevel()` y a la hora. **Ojo con lo que ya
      está medido**: una capa que cubre la pantalla NO puede ser un relleno con
      patrón ni un `fill` por cuadro — mismo presupuesto que la tierra, mismo
      camino (capa a media resolución reusada entre cuadros, como
      `nightlights.js`).
- [ ] **El relieve del terreno.** `residentElevationTiles` está construido desde
      hace tiempo y **no lo consume nadie**, y la ranura
      `effects.json -> terrainShadow` está documentada en CLAUDE.md y nunca se
      escribió. Ojo con el dato: la cota es del IGN y el arenal es plano de
      verdad, así que sólo se notará tierra adentro — hay que decirlo o parecerá
      que no funciona.
- [ ] **El grano de la acera, apagado y con su número.** `textures.acera` está
      en el registro con `"off": true`: su banda se traza por calle con
      `ancho + 2·acera`, así que se repinta en cada cruce — 2,7 ms de un cuadro
      de 17,3, más que ninguna otra textura, por una franja que casi no se ve.
      Si alguna vez el trazado de la acera deja de solaparse consigo mismo,
      encenderla es quitar una línea.
- [ ] **Dos archivos que este trabajo dejó grandes.** `systemShapes.js` (669) y
      `streets.js` (649) siguen enteros; el plan preveía sacarles
      `paintRoadNetwork` y el suelo de parcelas a sus propios módulos, y no hizo
      falta para lo de arriba. `hud.js` (781) y `landmarks.js` (672) van después.

---

## 5. Juego y balance

- [x] ~~**La carga se dibuja por VEHÍCULO, no por comida.**~~ **Cerrado el
      2026-08-23.** Desde ese día el
      producto viaja con el pedido y manda en el reloj, el presupuesto, la barra
      del HUD y lo que dice el cliente. Ahora el vehículo pone el RECIPIENTE
      (`bag`/`cooler`/`freezer`) y el producto pone el contenido (`cup`/`box`/
      `leaf`), incluidas las formas nuevas en `actors.json`. Gate visual:
      **103/607.600 px (0,0170 %)** cambiaron, todos dentro de los cinco ejemplos
      de carga y **0 fuera**.

- [x] ~~**La etiqueta de una frase no llegaba al juego.**~~ **Cerrado el
      2026-08-23, y lo encontró el propio `smoke:product-hud`.** `product` en una
      frase se autora en `customers.json` y **el mundo emitido no lo llevaba**
      —0 de 24 clientes— así que `customerLine` tomaba siempre la rama «esta
      frase sirve para cualquiera» y los repuestos por producto **no se usaron
      nunca**: el HUD decía «¡La mía sin tanto rojo!» —el sirope de cola de un
      churchill— sobre un vigorón en hoja. Se resuelve en el CLIENTE leyendo la
      tabla autorada, porque la etiqueta es una propiedad de la COPIA y no del
      sitio donde para el cliente, y afinarla no puede costar 48 minutos.

      **La lección está en la compuerta, no en el arreglo.** El primer barrido
      que se escribió le pasaba a `customerLine` los registros AUTORADOS —que ya
      traen la etiqueta— y por eso **seguía verde con el arreglo revertido**,
      mientras el HUD decía «Rojito bien fuerte.» sobre un vigorón. El sujeto de
      una prueba así tiene que ser lo que el juego ve (`W.CUSTOMERS`); la
      expectativa es lo que dice el archivo. Corregida, reporta **48 frases sobre
      la comida equivocada** con el arreglo quitado y ninguna con él puesto.

- [ ] **Semántica del turbo** — el GDD dice que X multiplica la velocidad actual
      ×1.35 una vez; la implementación es una rampa continua más un techo de
      velocidad ×1.35. Decidir cuál se quiere y alinear el otro.
- [ ] **Probabilidad de la gaviota** — efectiva ~0,15 %/cuadro (dos tiradas
      anidadas) contra el ~0,5 % del GDD. Decisión de balance.
- [ ] **Freno de mano ×1.35** existe en el código y no en el GDD: documentarlo o
      quitarlo.
- [ ] **Ciudad viva 2** — peatones que reaccionen al pito, ciclistas ocasionales,
      gentío en el Mercado, ventanas que se encienden de noche.

- [x] ~~**EL JUEGO SE PUSO LENTO, Y NO HABÍA CON QUÉ MEDIRLO.**~~ Medido y
      primer arreglo retenido el 2026-08-23. `GameTweaks` muestra mediana/p95/FPS
      sólo mientras el panel está abierto y `smoke:perf` calienta e intercala
      variantes. El sospechoso principal no era el culpable: el minimapa cuesta
      **0,08 ms (~6 %)**. La sonda sí encontró culling sólo en X: 17/18 peatones
      y 3/3 carros que pasaban X estaban fuera de Y. El culling 2-D bajó entidades
      **0,32→0,11 ms** y render **1,34→1,09 ms** (~19 %). Una caché de sombras
      no movió sus 0,19 ms y se revirtió.

---

## 6. Motor

- [ ] **PERSPECTIVA: ABIERTA OTRA VEZ, Y DESDE CERO.** Se construyó y se
      RETIRÓ entera el 2026-08-26, a pedido del usuario. El código vive en el
      tag `3d-attempt-2026-08-26`; esto es lo que costó averiguar, para que la
      próxima no lo vuelva a pagar:

      * **Una ortográfica inclinada SÍ registra con la afín 2-D.** El mapa del
        suelo a la pantalla sigue siendo `ScaleY(cosφ)·Rot(θ)`, así que las
        ~2 500 líneas de dibujo de suelo NO se reescriben. Sólo el levante por
        cota queda fuera de Canvas.
      * **Pero el achatamiento llega al VOLANTE.** `applyTouch` compara un
        ángulo de PANTALLA contra un rumbo de MUNDO. La corrección correcta es
        des-achatar el ÁNGULO y sacar el acelerador de la distancia de pantalla
        CRUDA; des-achatar las dos cosas cambia el tacto y se siente mal.
      * **A 0° no se ve un solo costado** — es geometría, no implementación. Lo
        único que dice que hay volumen es la SOMBRA, y a 10° de latitud el sol
        de mediodía está a 86°: la sombra de un bloque de 16 m mide 2,5 px. Al
        amanecer y al atardecer mide 35.
      * **Un techo a dos aguas visto a plomo se lee como una PIRÁMIDE**, no como
        un techo: cuatro faldones con luz distinta y las limatesas cruzando la
        planta. A 0.34 de la altura el centro salía como un campo de carpas.
      * **El receptor de sombra NO puede ser coplanar con la base** de lo que
        proyecta, o no sale NINGUNA sombra (no ruido: nada). Cuatro centímetros
        abajo alcanzan — es lo que `terrainShadow.receiverBelowM` ya decía.
      * **El mapa de sombras tiene que invalidarse con el conjunto de CASTERS**,
        no sólo con el sol y la cámara: los tiles llegan por streaming.
      * `src/render/camera.js` y `src/render/sun.js` se quedaron: son las
        autoridades únicas de cámara y de sol del juego 2-D, sin three adentro.

- [ ] **Milestone C — backend PixiJS/WebGL** detrás de `src/render/Renderer.js`.
      Sigue abierto y sigue siendo opt-in: hoy Canvas2D pinta el mundo entero y
      una capa Pixi transparente encima lleva lo que Canvas no puede hacer bien.
      El detalle (contenedores por capa, filtros de agua, grading por clima) está
      en el archivo. **Y hoy no dibuja nada**: `_MIGRATED` está vacío.

- [x] ~~**Pixi confundía segundos con milisegundos.**~~ Cerrado el 2026-08-23:
      la conversión de rAF se hace una sola vez y Canvas, Pixi y Three reciben
      `tSeconds`; ola, monedas y rebotes expresan sus ritmos en segundos.
- [ ] **Deuda técnica, ya verificada**: `state.rainT` se escribe y no se lee, y
      `Game.pause()` no lo usa nadie (React maneja la pausa). El resto de esa
      lista vieja ya no era cierto — ver la tabla del final.

---

## 6b. EL CORTE EN DOS REPOSITORIOS

Decidido el 2026-08-17. El juego público queda con **sólo el juego**; el builder
se va con el mapa y el contenido autorado, y **el editor se va con el builder**
porque el editor AUTORA lo que el builder consume: son las dos mitades de una
herramienta, no dos herramientas.

```
churchill-route   (público)   el juego. Consume artefactos publicados.
churchill-world   (privado)   churchill/ + tools/ + docs/map.osm +
                              content/world/ + el editor
```

**El paso habilitante ya está hecho**: `CHURCHILL_GAME_ROOT` — el nombre que el
editor ya usaba, no uno nuevo. La frontera resultó **angosta y medida: ocho
rutas en cuatro archivos**, y `tests/test_game_root.py` la fija, así que una
novena tiene que ser una decisión y no un descuido. Probado de verdad: un build
completo escribiendo en un game root aparte, sin tocar el repo real.

Lo que queda, en orden:

- [ ] **Portar los 21 módulos de prueba que examinan el JUEGO a JS.** Este es el
      trabajo de verdad y la razón por la que el corte no es un `git mv`. De los
      24 módulos de Python, **21 leen `src/`**: no son pruebas del builder, son
      compuertas de deriva entre un registro y su pintor (`actors.json` contra
      `entities.js`, `lights.json` contra `lights.js`). Pertenecen al juego, en
      un repo que no va a tener Python.

      Lo que lo hace posible es justamente el diseño de artefactos publicados:
      hoy esas pruebas importan los enums de Python, y contra el artefacto
      (`vocabulary.generated.json`) la misma aserción se escribe en JS. Sólo 3
      son del builder de verdad: `test_content`, `test_piers`,
      `test_world_editor_patch`.

- [ ] **`src/world2d/` SE QUEDA versionado** en el repo público (decidido): son
      15 MB de mundo generado, y el precio se paga para que un clon del juego
      corra solo. Cada reconstrucción es un diff grande y eso es aceptado.

- [ ] **La cirugía**, al final y sólo cuando las pruebas ya no cruzan: mover con
      historia (`git filter-repo` o un subtree), no con `cp`. `docs/map.osm`
      (12 MB) y `content/world/` (72 KB) van al privado; el editor pasa de
      `world-editor/` a `editor/` ahí.

- [ ] **Y una pregunta abierta que el corte hace urgente**: quién OWNS
      `surfaces.json`, `flora.json` y `world-units.json`. Hoy los leen los dos.
      Si el builder los publica como los artefactos del vocabulario, el juego no
      los edita; si los autora el editor, el builder los lee del game root. Las
      dos funcionan — pero hay que escoger una, porque un archivo con dos dueños
      es el patrón que este proyecto lleva dos días desarmando.

---

## 7. Producto

- [ ] **QA en dispositivos reales** (usuario): controles táctiles, coach-marks
      del tutorial, tienda/monedas, iPhone dvh + hint A2HS.
- [ ] **Play Console**: cuenta, productos (`remove_ads` + 3 packs), AdMob real
      (App ID + unidades + consentimiento UMP), URL de política de privacidad,
      ficha, pruebas cerradas 12×14. Checklist en `docs/MONETIZATION.md`.
- [ ] **Merge a `main`** cuando el MVP esté validado (y sacar `world-2d` del
      workflow de deploy al hacerlo).
- [ ] **Post-MVP**: ~~abrir El Cocal→Caldera~~ **(hecho el 2026-08-15: la valla
      se bajó y `mvpLocked` quedó VACÍA, no borrada, para que volver a cerrar un
      barrio siga siendo una fila)**, anillos 2-D de distritos, puente a desnivel
      Barranca/El Roble, backend de contenido (webhook de ko-fi → NPCs, reservas
      de lotes), Tier 4 (kiosco/vehículo brandeado).
- [ ] **Backend real, cuando el volumen lo pida**: API + panel admin. Hoy el
      contenido en vivo es un `content.json` servido del propio dominio, que es
      lo único del juego que no se compila dentro del bundle.

---

## Fuera de alcance, decidido

- **La estructura JSX de las pantallas a un esquema de slots completo.** Cambiar
  React legible por un lenguaje de layout casero es un mal negocio. El registro
  de slots que existe **selecciona y ordena**: no posiciona, no estiliza, no
  anida y no evalúa expresiones, y hay una prueba por cada una de esas cuatro.
- **Reproducir samples de audio dentro del juego.** El sonido es procedural y la
  banda sonora completa cuesta cero bytes de descarga; eso se conserva. Exportar
  a WAV para un trailer ya se puede (`pnpm audio:render`). Meter samples pide un
  presupuesto de descarga que nadie ha decidido, con el mundo ya en 16,7 MB.
- **La proyección corridor-unroll.** Borrada el 2026-07-25. Costaba distancias
  reales, calles rectas y cada gore de intersección hecho a mano. No revivirla.

---

## Lo que se cayó al verificarlo (2026-08-14)

Filas que este archivo llevaba como pendientes y que ya no eran ciertas. Se
listan en vez de borrarlas en silencio, porque el punto es justamente que **una
fila puede pudrirse sin que nadie lo note**:

| decía | está |
|---|---|
| "no music or SFX anywhere in the codebase" | `audio.js`, 628 líneas: 10 recetas, 7 voces continuas, mezclador de 4 buses y exportación a WAV |
| "every UI string is hard-coded Spanish" | 260 llaves, español e inglés completos, cero faltantes |
| "Milestone D — full 2-D map _(pending)_" | 1 000 tiles emitidos; la proyección corridor se borró hace tres semanas |
| "770 buildings placed" | 44 884 |
| "estero north bank — currently plain land" | el manglar se dibuja (`drawMangroves`) |
| "`drawLandmark` has no `default:` case" | tiene cinco |
| "headless harness lives in a session scratchpad" | seis smokes en `tools/`, todos en `package.json` |
| "`state.timeOfDay` is dead" | lo leen `tides.js` y `daynight.js` |
| "zoom: `CUADS_PER_VIEW = 20`, piso 2.2" | la cámara encuadra METROS; el piso es px de pantalla por metro |
