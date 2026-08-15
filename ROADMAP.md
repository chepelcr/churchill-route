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

- [ ] **El reescalado: elegir el encuadre EN UN TELÉFONO.** `docs/RESCALE.md`
      está completo y **los pasos 0 y 2 ya se hicieron** (la cuadrícula dejó de
      ser unidad de pantalla; ninguna medida del mundo queda en px sin una razón
      escrita). Falta el paso 1, que **no es técnico**: es un juicio de feel que
      ninguna medición resuelve — cuánta calle adelante se está dispuesto a
      perder. En teléfono las variantes A y B son indistinguibles, así que la
      decisión es una sola.

      De ella cuelgan los pasos 3-5: cambiar `PLANAR_PX_PER_M` /
      `ARCADE_STREET_MUL` / `GRID_CELL` / `CUAD` **juntos** (cambiar uno solo
      produce un mundo roto), el build de 33 min, re-medir los relojes de etapa
      —la velocidad es px/s, así que una entrega dura otros segundos— y el
      **substepping de física**, que ya es marginal hoy: `physics.js` integra en
      UN paso y a 30 fps el carro avanza 11,7 px por cuadro contra una sonda de
      ~7,6 px.

- [ ] **La graderÍa: los otros tres lados.** Su COLOCACIÓN ya es data desde el
      2026-08-15 — viene con el estadio en `content/world/blocks.json`, y la
      receta (fondo, escalones, rake) sigue en `world-props.json`. Lo que falta
      es una sola cosa concreta: **`side` acepta un lado, no una lista.** Y la
      pregunta de diseño: si una plaza de barrio lleva el mismo asset a menor
      escala o uno propio.

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

## 2. El arte que todavía es código

`docs/inventory.md` §14 tenía la medición completa: ocho familias, ~420
literales de color. **Las ocho cerraron el 2026-08-14** y la fila que sigue
abierta es otra cosa.

Lo que queda en `src/render/c2d/` son **27 literales**, todos dentro de recetas
de dibujo con geometría propia —`drawFaroScene`, `drawPool`, la siembra, y el
gradiente del pozo de luz, que es un degradado y no una paleta— que
§12 nombra explícitamente como lo que NO se convierte: cada una deriva su
tamaño, su conteo de pabellones o su dispersión DESDE la parcela, y expresarlo
sería aritmética en JSON. **Y los dos núcleos siguen en cero**, que es el número
que importa: el compositor y el intérprete de formas no adquirieron un literal
en toda la migración.

- [ ] **Las líneas de siembra, la otra mitad.** El esquema `form` × `align`
      (circular / triangular / cuadrada / libre × horizontal / vertical / libre
      / siguiendo la calle) está escrito y NO implementado: el build deriva sus
      cuatro siembras en vez de consumir una autorada, y el editor no tiene con
      qué dibujarla. **Y una decisión aparte**: darle suelo verde al Cocal o al
      Ferrocarril **no es hacerlos editables**, es un CAMBIO DE COMPORTAMIENTO
      —pasan a estorbar al carro, y en el Ferrocarril eso está explícitamente
      descartado hoy.

---

## 3. Las pantallas

- [ ] **Las trece que faltan.** `over` y `title` se arman desde
      `src/ui/screens.json`; las otras trece siguen tomando sólo su acento y su
      fondo de `applyScreen`. Convertirlas todas de una es donde esto deja de
      ser un registro y pasa a ser una reescritura, así que van de a una y sólo
      cuando haya razón.

---

## 4. El mundo: medido y sin cerrar

- [ ] **2 boyas siguen en tierra** (de 122). El render las suprime (`buoyWet`) y
      `smoke_crossing` las tolera dentro de presupuesto, así que no se ven — pero
      la línea las puso ahí.
- [ ] **`smoke_sea` falla dos aserciones de pescadores** — verificado que falla
      por el harness, no por el mundo.
- [ ] **El malecón: 6 bandas, y no todas tocan la calzada.**
- [ ] **El malecón se corta entre el Faro y x≈15500** — entre el Paseo y la
      arena hay solar que la sonda no cruza a ese ancho.
- [ ] **Las atracciones no bloquean.** La banda mide 60 px y es el único camino
      a los dos kioscos del Paseo, así que un carrusel estampado sacaría un
      destino de la red. Está bien hoy; queda anotado por si cambia el ancho.
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

## 5. Juego y balance

- [ ] **Semántica del turbo** — el GDD dice que X multiplica la velocidad actual
      ×1.35 una vez; la implementación es una rampa continua más un techo de
      velocidad ×1.35. Decidir cuál se quiere y alinear el otro.
- [ ] **Probabilidad de la gaviota** — efectiva ~0,15 %/cuadro (dos tiradas
      anidadas) contra el ~0,5 % del GDD. Decisión de balance.
- [ ] **Freno de mano ×1.35** existe en el código y no en el GDD: documentarlo o
      quitarlo.
- [ ] **Ciudad viva 2** — peatones que reaccionen al pito, ciclistas ocasionales,
      gentío en el Mercado, ventanas que se encienden de noche.

---

## 6. Motor

- [ ] **Milestone C — backend PixiJS/WebGL** detrás de `src/render/Renderer.js`.
      Sigue abierto y sigue siendo opt-in: hoy Canvas2D pinta el mundo entero y
      una capa Pixi transparente encima lleva lo que Canvas no puede hacer bien.
      El detalle (contenedores por capa, filtros de agua, grading por clima) está
      en el archivo.
- [ ] **Deuda técnica, ya verificada**: `state.rainT` se escribe y no se lee, y
      `Game.pause()` no lo usa nadie (React maneja la pausa). El resto de esa
      lista vieja ya no era cierto — ver la tabla del final.

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
