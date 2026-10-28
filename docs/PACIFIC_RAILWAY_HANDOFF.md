# Pacific Railway — continuidad con Claude

Fecha: 27 de octubre de 2026, Costa Rica.

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
| Catálogo jugable actual | `src/content/pacific-railway.json` |
| Flujo de pantallas ferroviarias | `src/ui/screens/RailwayMode.jsx` y registro `src/ui/screens.json` |
| Entrada desde menú | `src/ui/screens/TitleScreen.jsx`, `src/ui/App.jsx` |
| Validación del resultado embebido | `src/game/railway.js` |
| Runtime del MVP y assets | `public/pacific-railway/` |
| Referencia de exportación inicial | `public/pacific-railway/provenance.json` |
| Constructor independiente | `railway-builder/`, propio repositorio |

Churchill es la autoridad del runtime desde esta separación. No copiar encima cambios del constructor. La exportación de niveles sigue JSON Schema y el validador semántico; los contratos del kit conservan IDs, pivotes y `kitVersion`. `export-mvp.mjs` en el constructor registra la migración inicial y rechaza destinos existentes.

## MVP actual y siguiente implementación

El nivel jugable trasladado es **Paseo por el valle**, con el kit creativo inicial, tres variantes de tren, terreno apoyado, conducción manual, loop, estrellas, pausa y resultados. La interfaz lo describe como recorrido de prueba. **No representa todavía Pacífico–Belén** ni la campaña histórica.

La investigación reúne aproximadamente 115 km de corredor OSM hasta Puntarenas, 21 checkpoints candidatos, nueve etapas propuestas, elevación del terreno, 12 cruces de río y fotografías acreditadas. El ramal final al muelle y variantes históricas requieren revisión. La continuidad cartográfica no certifica servicio actual.

Siguiente corte: sustituir el recorrido de prueba por el primer tramo Pacífico–Belén, producir una locomotora documentada y escenarios propios, y continuar la campaña real con el mismo flujo de selección. Fijar antes la época editorial y la cámara. El perfil de suelo no es el tablero ferroviario: puentes y túneles necesitan perfil propio. Río Grande es referencia de cañón alto; conservar peñascos, vegetación y río al fondo donde la evidencia lo confirme. Los loops verticales permanecen en el kit creativo, fuera de las vías históricas.

## Comprobaciones

```sh
pnpm test:railway
pnpm validate:railway -- public/pacific-railway/examples/valley-run.json
python3 docs/research/pacific-railway/validate_research.py
python3 -m unittest tests.test_screens tests.test_vocabulary tests.test_i18n
pnpm inventory
pnpm build
pnpm preview --host 127.0.0.1 --port 8799
```

Probar en navegador: menú → nivel → tren → arranque detenido → acelerar → frenar → pausa/reanudar → resultados → repetir → volver a menú. Revisar teclado y gesto táctil delante/detrás, vista horizontal y apoyos en el suelo. Confirmar que Historia, Recorrer y Arcade siguen entrando correctamente. El constructor se prueba por separado con importación/exportación y validación de niveles.

Conservar la marca aprobada de Pacific Code Labs. Leer `AGENTS.md` antes de tocar mundo o módulos. No editar a mano `src/world2d/`: los datos de investigación no reemplazan el pipeline del mundo generado.
