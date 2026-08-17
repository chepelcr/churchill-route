# Handoff — las cinco escenas de parcela que faltan

Rama `world-2d`, repo `/Users/jcampos/Desktop/dev/churchill-route`.
Todo lo de abajo está pusheado hasta `e7a8c90`.

## El trabajo

Pasar a data las **cinco** escenas de parcela que siguen en código, con la receta
ya probada dos veces. **Dos ya están hechas y son el modelo a copiar**:

* `scenes.civicBuilding` (commit `50924b2`) — la simple: un `fit` y un tope.
* `scenes.cathedral` (commit `e7a8c90`) — la difícil: `group`, escalares
  derivados, y la regla de las dos escalas.

Faltan, en orden de dificultad creciente:

| escena | función | lo que la tenía presa |
|---|---|---|
| `parkRiver` | `drawParkRiver` (landmarks.js) | un clamp: `max(7, min(13, hh·0.34))` |
| `kiosco` | `drawKiosco` | un clamp: `max(7, min(15, min(hw,hh)·0.42))`, y todo lo demás es fracción de `r` |
| `fuel` | `drawFuel` | `max(1, min(3, round(cw/16)))` + el cuarto de vuelta por aspecto |
| `garden` | `drawGarden` | `max(3, round((w+h)/26))` + un `clear` que empuja y un `continue` |
| `school` | `drawSchool` | tres cuentas, `if (L > 70 && ph > 22)`, y el cuarto de vuelta |

## La receta, exacta

1. **El llamador queda de una o dos líneas** y sólo hace una cosa: resolver los
   escalares DERIVADOS y llamar a `paintParcelScene(P, "<nombre>", opts)`.
   Está en `src/render/c2d/landmarks.js`; leer su docstring antes de tocar nada.

2. **Qué se queda en código, y no es negociable**: un `min`/`max` entre los DOS
   ejes. `W2 = min(hh, hw·0.62)` de la catedral es el ejemplo — un evaluador de un
   eje no puede verlo, y escribirlo en el JSON sería aritmética en el registro.
   El llamador lo calcula y lo pasa por `opts.hw` / `opts.hh` / `opts.size`, o
   como `opts.vars` si se usa multiplicado.

3. **Los verbos que ya existen** (`SHAPE_NAMES`, 23):
   * `fit` — la cuenta sale de `length ÷ pitch`, con `min`/`max` y `mode:"floor"`.
     Es el que reemplaza todo `round(algo / n)`. Ver `civicBuilding`.
   * `{k, px, min, max}` en cualquier slot — un tope declarado. Reemplaza todo
     `Math.max(3, …)`. `evalOn` en `src/render/vehicleShapes.js`.
   * `group` — un marco anidado con su propio `hw`/`hh`/`s`. Para cuando algo se
     mide en un escalar derivado. Ver el crucero de la catedral.
   * `sprite` — una IMAGEN en vez de dibujo, medida en metros
     (`src/assets/sprites.json`). **Es lo que el dueño pidió para poder poner
     assets propios en lugares concretos**; funciona y está probado, sólo le falta
     que alguien registre imágenes de verdad.

4. **El cuarto de vuelta por aspecto** (`const along = F.hw >= F.hh; if (!along)
   ctx.rotate(PI/2)`) lo hace el llamador con `opts.rotate`, que
   `paintParcelScene` ya acepta. No es una parte, es una condición sobre el marco.

## Las tres trampas que ya pagué — no volver a pagarlas

1. **Un `$name` que no está en la paleta NO LANZA.** Canvas descarta el
   `fillStyle` inválido y sigue pintando con el color ANTERIOR. Escribí
   `$stoneWall` donde la paleta dice `stone` y salieron 7 540 píxeles con la
   silueta correcta y los colores de otra parte, sin un solo error. Ya está
   endurecido: `scenePaint` avisa y devuelve magenta. **Si aparece magenta en una
   hoja, es un nombre de paleta mal escrito.**

2. **`[k, "$var"]` CONCATENA TEXTO.** `px` es un literal. Un valor que mezcla las
   dos escalas entra ya resuelto como un único `$var` en píxeles.

3. **El offset de un `group` va en los evaluadores, no en un `translate`.** Ya
   está así, pero si alguien lo "simplifica" a `ctx.translate`, el diff vuelve a
   dar ~200 píxeles a delta 16: Canvas no rasteriza igual un camino absoluto y el
   mismo camino relativo bajo un `translate` fraccionario.

## La compuerta, para cada escena

```
# el dev server SIEMPRE limpio, o cuatro hojas salen en blanco y tres diffean 6-45%
lsof -ti:8734 | xargs kill -9; rm -rf node_modules/.vite
pnpm dev --port 8734 --strictPort &

node tools/shot-parcels.mjs after.png http://localhost:8734/
node tools/png-diff.mjs <base> after.png diff.png
```

**`shot-parcels` dibuja los 18 usos de parcela, así que TIENE que salir
IDÉNTICA** — es una transcripción, no un rediseño. Si no sale idéntica, el diff
señala la celda. Las dos escenas ya migradas salieron idénticas; no hay razón para
aceptar menos en las cinco que faltan.

Además, por commit: `pnpm test` (349), `pnpm build`,
`python3 tools/world_snapshot.py verify` (1001 byte-idénticos — ninguna de estas
escenas toca el builder, así que si cambia, algo se hizo mal).

Y las otras diez hojas al final: `shot-vehicles` `actors` `landmarks` `signs`
`scenes` `effects` `stands` `lights` `feria` `generators` `sprites`.

## Lo que NO hay que migrar, y por qué

* **`paintBuilding`** (`structures.js`) — su silueta ES geometría del mundo:
  `ctx.clip(path)` sobre el contorno emitido. Sólo la banda del techo y las
  ventanas podrían ser partes, dentro del clip.
* **Las cuatro formas de árbol** — `canopyPath` es una spline por puntos
  perturbados con hash y `scatter` coloca sub-listas, no puede perturbar un
  contorno.
* **`paintHeadlights`** — `createLinearGradient` no tiene verbo. Un gradiente no
  es una forma.
* Los pintores del agua, las capas del minimapa y los compositores. La razón de
  cada uno está escrita en su archivo.
