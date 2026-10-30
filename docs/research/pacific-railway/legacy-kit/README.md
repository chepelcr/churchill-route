# El kit del MVP anterior — archivo

El primer prototipo jugable del modo tren (**Riel**, *Paseo por el valle*) vivía
en `public/pacific-railway/` como una aplicación aparte, embebida en el juego por
un `iframe` del mismo origen y comunicada por `postMessage`. Fue lo correcto
mientras se decidía el motor; dejó de serlo cuando el modo pasó a correr dentro
del juego, con el mismo intérprete de arte y el mismo registro de pantallas.

**El runtime se retiró del paquete publicado el 2026-10-28.** No se perdió: vive
entero en el commit `7a1a153` de `feature/pacific-railway`, y el constructor
sigue siendo su propio repositorio (`chepelcr/roller-coaster`, checkout local
`railway-builder/`). Lo que se conserva aquí es el CONTRATO, que es lo único que
otro repositorio necesita leer:

| archivo | qué es |
|---|---|
| `level.schema.json` | el JSON Schema de un nivel del kit creativo v1.0.0 |
| `valley-run.json` | el nivel de ejemplo que el MVP traía, válido contra ese schema |
| `validate_railway_level.mjs` | el validador semántico que lo acompañaba |
| `provenance.json` | la referencia de la exportación inicial |

## Qué cambió para el constructor

El juego ya no consume este formato. Un nivel del Tren al Puerto hoy es un
registro de `src/content/railway/levels/`, y su diferencia de fondo con el kit
viejo no es de sintaxis sino de qué describe:

* el kit v1 autoraba una **lista de piezas** (`straight`, `slope-up`,
  `loop-large`) y el recorrido salía de encadenarlas;
* un nivel de hoy autora un **tramo del corredor real** —kilómetros de OSM,
  perfil del DEM, estaciones, puentes y ríos con su fuente— y las piezas de
  fantasía que quedan (los rizos) van aparte y declaradas como licencia.

Los rizos del kit sobreviven como `loops` del nivel, con su radio en metros en
`src/assets/railway-sim.json`. Lo que no sobrevive es la idea de un recorrido
hecho SÓLO de piezas: el nivel 1 es un lugar, no un circuito.
