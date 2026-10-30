# Pacific Railway — continuidad con Claude

Fecha: 30 de octubre de 2026, Costa Rica. (Primera versión: 27 de octubre.)

## Rama y repositorios

- Juego: `chepelcr/churchill-route`, rama **`feature/pacific-railway`**, creada desde `world-2d` (`79c56c7753eb48d716392ee3c4c254bbe8100108`).
- Constructor: `chepelcr/roller-coaster`, rama `main`, checkout local `railway-builder/`. Carpeta ignorada por el padre; sin gitlink ni submódulo, igual que `world-editor/`.
- El juego se publica en **el mismo sitio de La Ruta del Churchill**. No necesita el constructor para instalar, compilar ni jugar. La rama feature no está en el trigger automático de Pages; conserva el despliegue existente hasta integrar el trabajo.
- La ruta antigua `/Users/jcampos/Desktop/dev/roller-coaster` conserva un enlace local de compatibilidad. No forma parte de los clones en la nube.

```sh
git clone --branch feature/pacific-railway https://github.com/chepelcr/churchill-route.git
cd churchill-route
pnpm install --frozen-lockfile
pnpm dev
# Opcional, solo para editar niveles con la herramienta privada:
git clone https://github.com/chepelcr/roller-coaster.git railway-builder
cd railway-builder
npm ci
npm run dev
```

## Estado al 30 de octubre

El modo **ya no corre en un `iframe`**. La partida vive dentro del juego —mismo
paquete, mismo intérprete de arte, mismo registro de pantallas— y el recorrido
de prueba *Paseo por el valle* fue sustituido por el **primer tramo real:
Estación del Pacífico → San Antonio de Belén (km 0–14,34)**, con el perfil del
terreno tomado de la investigación. El runtime anterior se retiró del paquete
publicado; queda en el commit `7a1a153` y su contrato de kit en
`docs/research/pacific-railway/legacy-kit/`.

Decisiones tomadas en este corte, que esta nota deja por escrito:

* **Los rizos verticales SÍ van sobre el corredor real**, a pedido de dirección.
  Esta nota decía antes lo contrario. Se resolvió declarándolos: viven en
  `loops` del nivel, nunca en `structures`, llevan su nota de licencia (que una
  prueba exige) y el HUD los anuncia como vía de fantasía. Su gravedad es propia
  y está declarada en el registro con la medición que la justifica.
* **La época es un baño sobre el cuadro terminado**, no un segundo juego de
  paletas: `railway-art.json → eras`. `moderno` no cuesta nada; `sepia` y
  `nocturno` están listos y se activan con una llave del nivel. El Río Grande de
  la postal de 1910 es el candidato natural.
* **El arte es dibujo propio sobre fotografías de referencia** aportadas por el
  autor (María Cecilia, N.º 55, Apolo 2400, 200-3122, las tres estaciones y el
  puente del Río Grande). No se redistribuye ninguna imagen; cada máquina nombra
  su referencia en `fiche`.
* **La cámara y la escala viven en `railway-sim.json → view`** y `pxPerM` es el
  único convertidor del modo.

## Flujo integrado incluido

Menú principal → **Tren al Puerto** → selección del nivel → selección del tren → partida → resultados → repetir / niveles / menú. El jugador permanece en Churchill. Las pantallas de selección y resultados usan los componentes visuales del juego anfitrión. La partida usa el runtime inicial de Riel dentro de un iframe del mismo origen: permite preservar el MVP mientras se adapta el motor sin duplicar la carga de todo el juego.

La pantalla `UI_SCREEN.RAILWAY` pausa la simulación de ciudad. Al salir se desmonta la partida y vuelve al menú normal. El progreso ferroviario se guarda aparte en `churchill.railway.v1`; no mezcla fichas de prueba con la economía del juego principal.

En la integración, el runtime arranca directamente en el tren seleccionado; omite su menú, garaje, tienda y resultados independientes. La pausa sigue dentro de la partida. Volver al menú desde la pausa regresa al selector de niveles del anfitrión. Los mensajes de salida y finalización comprueban origen, ventana emisora y datos numéricos antes de aceptar resultados.

## Fuente de verdad

| Contenido | Ubicación |
|---|---|
| Investigación, fuentes y fotos | `docs/research/pacific-railway/README.md` |
| Propuesta de campaña y requisitos | `docs/research/pacific-railway/spec.md`, `stack.md` |
| Ruta OSM, checkpoints, elevación, ríos | `docs/research/pacific-railway/data/` |
| Máquinas, mejoras y economía | `src/content/railway/catalog.json` |
| Tramos del corredor | `src/content/railway/levels/*.json` (perfil: `tools/gen_railway_profile.py`) |
| Arte del modo (todo dibujado) | `src/assets/railway-art.json` |
| Física, rizos, combustible y cámara | `src/assets/railway-sim.json` |
| Modelo (sin DOM) | `src/game/railway/` |
| Pintor | `src/render/railway/` |
| Flujo de pantallas ferroviarias | `src/ui/screens/RailwayMode.jsx` y registro `src/ui/screens.json` |
| Entrada desde menú | `src/ui/screens/TitleScreen.jsx`, `src/ui/App.jsx` |
| Contrato del kit del MVP anterior | `docs/research/pacific-railway/legacy-kit/` |
| Constructor independiente | `railway-builder/`, propio repositorio |

Churchill es la autoridad del runtime desde esta separación. No copiar encima cambios del constructor. La exportación de niveles sigue JSON Schema y el validador semántico; los contratos del kit conservan IDs, pivotes y `kitVersion`. `export-mvp.mjs` en el constructor registra la migración inicial y rechaza destinos existentes.

## Lo jugable y lo siguiente

El nivel jugable es **Pacífico → Belén**, km 0–14,34 del corredor: perfil del
DEM, cinco puentes, cuatro paradas, cinco escenas que se disuelven al avanzar y
tres rizos del kit creativo. Seis máquinas con cuatro barras de mejora, fichas,
bidones de combustible y estrellas por llegar, por tiempo y por monedas.

La investigación reúne aproximadamente 115 km de corredor OSM hasta Puntarenas, 21 checkpoints candidatos, nueve etapas propuestas, elevación del terreno, 12 cruces de río y fotografías acreditadas. El ramal final al muelle y variantes históricas requieren revisión. La continuidad cartográfica no certifica servicio actual.

Siguiente corte: **nivel 2 (Belén → Turrúcares) y nivel 3 (Turrúcares → Atenas)**.
El 3 trae el puente del Río Grande, para el que ya existen la receta de arco y
la escena, y es el candidato a estrenar `era: "sepia"`. Las escenas de Orotina,
Caldera y el estero ya están dibujadas y el selector las pasa como avance de
campaña. Queda pendiente documentar fotográficamente los peñascos del Río
Concepción antes de darles arte propio, y conciliar planos por época antes de
afirmar una longitud histórica única.

## Comprobaciones

```sh
pnpm smoke:railway
pnpm shot:railway                      # contra un servidor FRESCO (./reboot-server.sh 8736)
python3 -m unittest tests.test_railway_content
python3 docs/research/pacific-railway/validate_research.py
python3 -m unittest tests.test_screens tests.test_vocabulary tests.test_i18n
pnpm inventory
pnpm build
pnpm preview --host 127.0.0.1 --port 8799
```

Probar en navegador: menú → nivel → tren → arranque detenido → acelerar → frenar → pausa/reanudar → resultados → repetir → volver a menú. Revisar teclado y gesto táctil delante/detrás, vista horizontal y apoyos en el suelo. Confirmar que Historia, Recorrer y Arcade siguen entrando correctamente. El constructor se prueba por separado con importación/exportación y validación de niveles.

Conservar la marca aprobada de Pacific Code Labs. Leer `AGENTS.md` antes de tocar mundo o módulos. No editar a mano `src/world2d/`: los datos de investigación no reemplazan el pipeline del mundo generado.
