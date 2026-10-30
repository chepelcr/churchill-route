# Verificación — integración inicial

27 de octubre de 2026, Costa Rica. Rama `feature/pacific-railway`.

- Suite de Churchill: **495 pruebas correctas**. El catálogo ferroviario quedó registrado en el generador de inventario.
- Runtime ferroviario: **19 pruebas correctas** de geometría, conducción, controles, terreno y contrato de resultados.
- Constructor: **21 pruebas correctas**, incluyendo bordes del fondo, transparencia y atlas.
- Nivel `valley-run`: validación semántica correcta, 18 piezas y aproximadamente 5.683 px de arco.
- Datos de investigación: 1.761 vértices conectados, 21 checkpoints, nueve etapas propuestas, 11 hashes de fotos, 1.158 muestras del perfil, 4.551 muestras regionales y 12 cruces de río.
- `world_snapshot.py verify`: los **1.001 archivos** del mundo generado permanecen idénticos.
- Build de producción correcto. Mantiene el aviso previo de tamaño de chunks; no hay errores de compilación.

## Navegador real, build de producción

Se comprobó el acceso desde el menú principal, selección de nivel y tres estilos de tren, carga de la partida embebida, arranque a velocidad cero, aceleración con flechas y gesto delantero, frenado trasero a cero, pausa/reanudación, finalización con tres estrellas, resultados de Churchill, repetición y regreso al selector.

Se verificaron también las entradas de Historia, Arcade y Recorrer después de salir del modo ferroviario. No se observaron errores JavaScript en estas comprobaciones.

El encuadre se revisó en escritorio y en 844 × 390 horizontal. Se corrigió el tamaño CSS del canvas: la resolución de rasterización puede ser 2×, pero el tamaño visible sigue siendo 1280 × 720 lógico escalado al contenedor. Así el tren, los rieles y las bases aparecen completos; el suelo permanece en el borde inferior.

El constructor independiente importó un JSON de cinco piezas, validó sus uniones y exportó un archivo que volvió a pasar el validador CLI. Después se restauró el nivel original.

El nivel actual sigue siendo la prueba creativa **Paseo por el valle**. Estas comprobaciones no acreditan todavía una campaña histórica jugable Pacífico–Puntarenas. La investigación y sus incertidumbres están documentadas aparte.
