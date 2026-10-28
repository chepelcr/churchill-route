# Stack e integración propuesta

Estado: propuesta; se conserva el stack actual de Churchill. No introducir un segundo motor por esta investigación.

## Base existente inspeccionada

| Pieza | Ubicación | Uso propuesto |
|---|---|---|
| Vite, React y pnpm | Proyecto anfitrión | Menús, selector, ajustes, pausa, resultados e idiomas compartidos |
| Estado ferroviario | `src/game/state.js` | Separar el tren del jugador de los trenes decorativos |
| Composición sobre polilínea | `src/game/spawns.js`: `railPrep`, `poseTrain` | Reutilizar muestreo y orientación por arco; sustituir avance NPC por entrada manual |
| Dibujo del tren | `src/render/c2d/entities.js`: `drawTrain` | Pintor existente con nuevas variantes verificadas de locomotora y vagones |
| Vías | `src/render/c2d/streets.js`: `paintTileRails` | Aprovechar balasto, traviesas y rieles; completar estructuras y relieve |
| Arte declarativo | `src/assets/actors.json` | Extender el catálogo preservando IDs; humo solo para vapor |
| Ciclo de etapas | `src/game/crossing.js` | Referencia para checkpoints, rescate y resultados; no copiar física de embarcación |
| Transiciones | `src/ui/screens/PassageScreen.jsx` | Reutilizar la oclusión durante carga y transición, adaptada a estaciones/túneles |
| Modos y progreso | `src/game/modes.js`, `src/content/progression.json` | Registrar entrada, desbloqueo, guardado y regreso al juego principal |
| Unidades | `src/domain/units.js`, `src/assets/world-units.json` | Una autoridad para conversión metros/píxeles |

Churchill ya tiene trenes decorativos que avanzan solos y cambian de sentido al llegar al final. Ese comportamiento no satisface la conducción solicitada. La reutilización está en la composición y el dibujo.

## Geografía

Fuente canónica: WGS84 `[lon, lat]`, IDs y versiones OSM. Intercambio: GeoJSON y GPX. El proyecto ya usa proyección **planar** con conversión geo→mundo en el manifiesto. No reintroducir la antigua proyección de corredor eliminada del juego.

La distancia `s` sirve para muestrear el movimiento sobre una vía; no reemplaza la proyección geográfica del mundo. Para una vista lateral, definir una presentación propia del perfil y compartir el mismo `s`.

`churchill/world/service/railway.py` ajusta las vías decorativas al espacio entre calles y sus anchos arcade. Por ello, mantener separadas la geometría GIS original y la geometría de representación. El enlace con la península debe resolver esta diferencia explícitamente. No reemplazar el mundo existente con un mapa regional a mano.

Un corredor de 115 km exige streaming y presupuesto de memoria. Cargar segmentos cercanos al tren, precargar la siguiente estación y usar el mapa simplificado para selección. Conservar landmarks únicos en datos y cachear solo capas estáticas. No generar de entrada una única imagen o canvas de toda la ruta.

## Herramientas de investigación

- Python estándar para grafo, Dijkstra, longitudes haversine, GPX, catálogo y auditoría.
- `osmium`/pyosmium únicamente para extraer el PBF. No es dependencia nueva del cliente.
- HGT Skadi para elevación del terreno. Guardar procedencia por tile; no usar como perfil ferroviario levantado.
- D3 Geo en el mapa exploratorio de la conversación; no implica añadir D3 al juego.
- Fotografías originales como referencias, con autor y licencia individual. Arte final declarativo compatible con los pintores actuales.

## Validación de futura implementación

Aplicar las instrucciones del repositorio. Tras cambios en módulos o mundo: `pnpm inventory`. El mundo generado se modifica desde su pipeline, nunca editando `src/world2d/` a mano. Si cambia intencionalmente, regenerar, actualizar baseline y lotes según `AGENTS.md`.

Además de `pnpm build`, ejecutar el smoke real del proyecto sobre preview y pruebas manuales de teclado/touch, checkpoints y reanudación. Los controles deben seguir funcionando a lo largo de curvas y con el tren orientado hacia la izquierda. Revisar trenes eléctricos sin humo, entrada/salida de puentes y transiciones sin saltos de posición. La investigación actual solo requiere validar datos; no se ha cambiado código del juego.
