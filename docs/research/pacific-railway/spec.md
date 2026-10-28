# Especificación propuesta — El Tren al Puerto

Estado: investigación, sin implementación. Complementa el diseño de La Ruta del Churchill y no reemplaza sus modos existentes. La evidencia geográfica está en [README.md](README.md).

Esta especificación corresponde a la campaña histórica. El flujo de menú, nivel, tren y resultados ya aloja el MVP previo en `feature/pacific-railway`; el estado implementado y la continuidad con Claude están en [PACIFIC_RAILWAY_HANDOFF.md](../../PACIFIC_RAILWAY_HANDOFF.md).

## Experiencia

Un viaje ferroviario patrimonial por el corredor Pacífico–Puntarenas. El jugador conduce, reconoce estaciones y paisajes, completa nueve etapas y llega al puerto para enlazar con la actividad del churchill. Se conserva la marca aprobada de Pacific Code Labs y el lenguaje visual del juego anfitrión.

Pantallas: entrada del modo, mapa completo con etapas, ficha breve de salida, conducción, pausa/ajustes, checkpoint y resultados. Reutilizar menús, transiciones, idiomas y progreso existentes. El mapa anima el tren siguiendo la geometría real y revela destinos según avance; la animación del mapa no conduce por el jugador.

## Conducción

- Estado inicial detenido. Ningún avance automático por temporizador ni velocidad mínima forzada.
- Móvil: dedo delante del tren aplica tracción; más distancia al vehículo produce más intensidad. Dedo detrás aplica freno con intensidad proporcional. Medir delante/detrás según la tangente orientada de la vía proyectada en pantalla, incluso en curvas; al retirar el dedo, tracción cero. Pausa, pérdida de foco o `pointercancel` liberan todo control.
- Escritorio: flecha derecha/arriba acelera; izquierda/abajo frena. Conflicto simultáneo resuelve a freno. Controles y leyenda localizables.
- El desplazamiento es `s` en metros de arco, con velocidad y aceleración separadas. Cada vagón muestrea `s − separación`; nunca asumir X creciente.
- Frenar permite detenerse. Inercia, resistencia y pendientes pueden modelarse después; no activar autorregulación que sustituya la decisión del jugador. Cualquier ayuda de accesibilidad debe ser explícita.
- Esta ruta recrea un ferrocarril real. Las vueltas verticales del kit creativo de Riel pertenecen al editor libre y no se introducen en las estaciones y vías históricas de este modo.

## Campaña y checkpoints

`data/levels.proposed.json` contiene nueve límites propuestos y referencias a los 21 puntos de investigación. Sus datos no son todavía el formato de niveles ejecutables.

Tipos propuestos: `pass` (cruzar la puerta en el sentido correcto) y `stop` (detener el tren en la zona de andén). El centro, longitud y sentido de cada andén deben comprobarse antes de publicarlo. Las distancias de snap documentan la incertidumbre del punto, no el tamaño del checkpoint.

Cada nivel tiene salida, llegada, checkpoints ordenados por `s`, ficha cultural, escenario y objetivos. Un checkpoint completado guarda nivel, `s`, sentido y composición. Reanudar coloca el tren detenido en una posición válida y visible. Un resultado no puede premiarse dos veces por cargar el mismo guardado.

Dos recorridos: etapas individuales y campaña continua que conserva tren y progreso entre etapas. El ramal hacia el muelle es un epílogo opcional pendiente de confirmar; la llegada base usa el punto cercano al antiguo depósito. Las recompensas son fichas virtuales locales, compatibles con la tienda actual. No se añaden pagos ni servicios externos.

## Terreno y patrimonio

Separar cuatro capas: eje cartográfico, perfil del tablero, suelo y escenografía. Cada puente tiene inicio/fin, apoyos y cauce; cada túnel tiene portales y cobertura. Los soportes se anclan al suelo. No convertir automáticamente una muestra de elevación del valle en una caída del riel.

En los sectores montañosos, representar los ríos dentro de sus cañones, con **peñascos y paredes rocosas altas**, estratos o fracturas sustentados en fotos y vegetación aferrada a las laderas. El Río Grande es la primera escena de referencia; Río Concepción requiere fotos adicionales. Los 12 cruces en `data/river-crossings.json` son anclas cartográficas, no un permiso para poner la misma pared de roca en cada río. Los terrenos costeros y esteros conservan sus pendientes y vegetación propias.

Cada escena de cañón debe declarar `riverSource`, `bridgeSource`, `terrainSource`, `deckProfileSource`, `rockReference` y `verticalExaggeration`. La exageración vertical, si se usa para lectura lateral, es una decisión artística explícita y no cambia las cifras mostradas como reales. El tablero permanece sobre la depresión; el agua ocupa su cota inferior; rocas, terraplenes y pilares contactan con el suelo. Las caras verticales se diseñan desde referencias: un DEM de vista general no basta para generarlas fielmente.

Landmarks con identidad propia: Pacífico, Río Grande, estación de Atenas, Escobal, Quebradas, Orotina, Caldera y terminal de Puntarenas. Cada asset conserva ID estable, fuente, época, vista, detalles visibles y revisión. Cuando falten datos, marcar `research_required` y mantener una maqueta reconocible como provisional.

Las eléctricas tendrán pantógrafo y animación coherente; no reutilizarles humo de vapor. La catenaria, libreas y carteles requieren una época definida. Fichas históricas breves y acreditadas; las fotos actuales de deterioro no obligan a representar abandono en la ficción patrimonial.

## Contrato para agentes

1. Leer esta especificación, `stack.md`, `README.md`, el `AGENTS.md` del repositorio y los catálogos fuente.
2. Elegir un nivel por ID; usar sus límites de arco y los IDs OSM. No corregir coordenadas fuente para acomodar decoración.
3. Conservar `source_point`, coordenada ajustada, distancia de snap y confianza. Elevar ubicaciones pendientes a verificadas únicamente con evidencia enlazada.
4. Declarar aparte cualquier compresión de distancia para la versión arcade; conservar conversión reversible entre metros fuente y metros de juego. La cartografía cenital debe respetar el sistema planar del juego.
5. Mantener geometría, validación y simulación sin DOM para ejecutar comprobaciones en Node/Python.
6. Validar continuidad, sentido, checkpoint dentro del tramo, composición de vagones, cota de tablero y anclaje al suelo. No inventar límites operacionales reales.
7. Antes de integrar, probar entrada, conducción con touch/flechas, parada, pausa, reinicio, resultados, guardado y vuelta a modos existentes en navegador.

## Entrega por etapas

Primero cerrar época y reunir referencias faltantes. Después hacer un corte jugable Pacífico–Belén con dos estaciones y conducción manual. Validarlo contra la dirección artística antes de producir los nueve escenarios. Continuar con Río Grande como prueba de terreno y puente, luego campaña completa y conexión al puerto. Ninguna de estas etapas se considera implementada por la existencia de esta investigación.
