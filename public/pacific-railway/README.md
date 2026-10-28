# Riel — runtime del MVP

Fuente del juego trasladada desde `chepelcr/roller-coaster`. El commit inicial figura en `provenance.json`; a partir de la separación, esta carpeta se mantiene en Churchill.

La web principal sirve estos archivos bajo `/pacific-railway/`. El menú de Churchill abre la partida con `?embedded=1&skin=classic|mint|midnight`, después de seleccionar nivel y tren. Sin ese parámetro se puede comprobar el MVP autónomo con su menú original. El constructor no se entrega aquí.

Entradas: `src/play.js` (arranque), `src/shell.js` (interfaz y eventos), `src/game.js` (simulación pura), `src/track.js` (geometría y validación), `src/controls.js` (touch/teclado), `assets/manifest.json`, `schema/level.schema.json`, `examples/valley-run.json`.

El nivel es una prueba creativa, todavía no el tramo histórico Pacífico–Belén. La integración y el trabajo pendiente se explican en `docs/PACIFIC_RAILWAY_HANDOFF.md` del repositorio. Las fuentes y licencias de assets se conservan en `docs/pacific-railway/ASSETS.md` y `assets/fonts/`.
