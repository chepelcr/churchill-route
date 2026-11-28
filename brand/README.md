# Manual de marca · La Ruta del Churchill

Sistema v1 · 27 de noviembre de 2026

## 1. Personalidad y dirección

La Ruta del Churchill es un arcade de entregas en Puntarenas, Costa Rica. El viaje entre el Paseo, el Faro, los muelles y los barrios tiene la energía de una carrera corta y el humor de un paseo por el Puerto. Las palabras al jugador usan voseo. El Churchill, el mar y el atardecer dan las formas y los colores que se repiten entre una partida y un reel.

La dirección conserva las letras Bungee del menú, el emblema del Faro y el Churchill y el degradado de atardecer. El azul de la carga y las olas del cierre dan continuidad al agua del juego. Los fondos editoriales parten del material real del Puerto o de capturas de sus escenarios, como La Punta y el Paseo. La identidad de Pacific Code Labs aparece como firma de estudio, con su arte aprobado y su tratamiento en reverso.

## 2. Auditoría y procedencia

| Pieza revisada | Hallazgo y decisión |
| --- | --- |
| Menú y arranque del juego `7d6007fb` | El título del menú ya era Bungee de atardecer. La segunda fase de arranque mostraba una ilustración que incluía una representación distinta del título. El menú y la carga comparten ahora el mismo componente y el mismo nombre. |
| Marca del juego | El PNG de 1024 × 1024 con el Faro y el Churchill es el emblema instalado. El tráiler usaba un PNG con el mismo SHA-256. El antiguo `assets/icon.svg` muestra otro dibujo del vaso, archivado como referencia. Los iconos de instalación ya existentes conservan su puesto. |
| Firma de Pacific Code Labs | El PNG del juego coincide byte por byte con el reverso 2× aprobado por el estudio. El WebP de arranque recorta el margen transparente de ese mismo arte y reduce la región visible de 962 × 384 a 481 × 192. |
| Tráiler `a7bb315` | Los cortes horizontal y vertical repetían títulos, paleta, fuentes y PNG de ambas marcas. Ahora generan esos recursos desde el juego. Las animaciones GSAP siguen perteneciendo a cada corte. |
| Reel 03 | El corte local previo usaba un rombo. El respaldo `85f736b` contiene la edición de 37 s, con ACON, la feria, la radio y la carga del ferry. Su proyecto editable en el tráiler consume el título del juego, la firma vigente y las fuentes de la biblioteca. |
| Documentando El Cocal | La fuente reconstruía ambas marcas con capas locales. El arranque consume el reverso vigente del estudio y el cierre consume la firma del juego. Las fotos, la transición de agua y la mezcla original llegaron en el respaldo actualizado `85f736b`. |
| Kit de Instagram | El catálogo y el CSV de procedencia identifican capturas y copias de noviembre. El sitio editorial usa el mismo PNG de 192 px de instalación. El respaldo preserva las ediciones originales del kit y la biblioteca actualiza las exportaciones nuevas. |

Las huellas completas, dimensiones, nombres de exportación y rutas se registran en [identity.json](identity.json). Las marcas base conservan la condición de arte vigente por su uso en el juego y el tráiler. La guía distingue ese antecedente de una aprobación nueva del dueño.

## 3. Marca y variantes

| Configuración | Uso | Tamaño y espacio |
| --- | --- | --- |
| Título en dos líneas | Arranque, menú y apertura de video. `LA RUTA DEL` encima de `CHURCHILL`, centrado. | Bungee desde 24 CSS px en el juego. Separá el título de otros textos o bordes por al menos un cuarto de su altura visible. |
| Título en una línea | Cierre horizontal cuando el ancho permite leer el nombre completo. | Conservá el espacio de seguridad del título en dos líneas. Si el nombre pierde tamaño, usá la variante apilada. |
| Emblema cuadrado | Favicon, icono de app, perfil y firma compacta. | Proporción 1:1. A 16 px se reconoce la silueta. Usá 32 px o más para distinguir el Faro y el vaso, y 96 px para apreciar el detalle. |
| Firma compacta | Vaso más nombre en una línea, para identificadores de reels o cierres estrechos. | Usá una única copia del vaso y dejá aire lateral de al menos un cuarto del lado del icono. En vertical de 1080 px, la firma del reel usa icono de 49 px y texto de 27 px. |
| Título a una tinta | Lectura sobre fondos muy claros u oscuros, usando la misma composición tipográfica. | `brand-title--plain` con `--lrc-light-ink` sobre crema o `--lrc-text` sobre azul de puerto. El icono de app permanece a color. |
| Pacific Code Labs en reverso | Primera fase del arranque y crédito de estudio en video. | Recurso 1050 × 440, relación 105:44, con un mínimo visual de 48 px de alto. Importá el arte completo y mantené espacio libre alrededor. |

Para video usá las variantes apilada o compacta según el cuadro. Sobre material luminoso, ubicá la marca en una zona uniforme o agregá un velo azul oscuro detrás. Para impresión a una tinta usá el nombre tipográfico. Un símbolo monocromático independiente, un nuevo lockup y portadas de plataforma son piezas nuevas que pasan por revisión individual conforme al workflow de identidad.

**Aplicaciones correctas.** Proporciones originales, vaso legible, color a partir de los tokens y firma de estudio con su margen.

**Errores frecuentes.** Estirar el vaso para llenar un rectángulo, recortar la pajilla, pegar la firma sobre luces o texto del HUD y reutilizar el título incrustado en la ilustración de carga.

## 4. Paleta

Los tokens exportan variables `--lrc-*`. Los valores efectivos del editor que corresponden a esta paleta se sincronizan por `gameTheme`. Los siguientes grupos describen los colores de producto y video. Los acabados de escenarios y vehículos se rigen por sus propias recetas de arte.

| Tokens | Aplicación |
| --- | --- |
| `harbor`, `harbor-light`, `ocean` | Fondo del puerto, superficie elevada y velo de video. |
| `page`, `ink`, `plum` | Fondo profundo, texto oscuro y panel violeta. |
| `cream`, `foam` | Texto principal y secundario sobre fondos oscuros. Crema también funciona como fondo claro con tinta. |
| `lemon`, `coral`, `magenta` | Inicio, medio y cierre del degradado del título. |
| `gold`, `amber`, `sand` | Acción destacada, progreso, foco y aviso cálido. |
| `mint`, `sky`, `ice` | Éxito, bordes de interfaz e información. |
| `rose`, `action-coral`, `hull`, `funnel` | Urgencia, botón de acción alterno y colores del ferry. |

La [tabla de colores](COLORES.md) da los valores HEX y RGB. Los pares de lectura de los temas claro y oscuro se validan al generar los recursos. Oro con tinta se usa en acciones destacadas. La urgencia del cronómetro también se anuncia por el pulso y la lectura del tiempo. Los estados conservan texto, icono o contorno reconocibles.

## 5. Tipografía

| Familia | Jerarquía |
| --- | --- |
| **Bungee 400** | Título del juego y golpes de apertura, nombres de modos y lugares, valores principales del HUD, titulares de menú y de pausa. |
| **Space Grotesk 400–700** | Indicaciones, mensajes de interacción, diálogos, cuerpo de las publicaciones, subtítulos de reel y llamado a jugar. |
| **JetBrains Mono 400–700** | Controles, etiquetas del HUD, carga, contadores, ubicación y la firma compacta. |

El menú usa el tamaño que permita el ancho de pantalla y el HUD conserva sus escalas de lectura durante la conducción. En un reel de 1080 px empezá por 27–36 px para identificadores o subtítulos y por 80–96 px para golpes de título. Revisá el recorte en el teléfono y reservá espacio para los controles de la plataforma. Los archivos WOFF2 vienen de las dependencias Fontsource fijadas por el lockfile del juego. Las tres licencias SIL OFL están en [licenses/](licenses/).

## 6. Lenguaje gráfico e interfaz

- **Iconos.** Usá los trazos redondeados de [Icon.jsx](../src/ui/Icon.jsx) en herramientas e interacción. El emblema del juego usa el PNG vigente del Faro y el vaso. Es un arte raster transparente de 1024 × 1024.
- **Paneles.** Los botones de modos, tarjetas del HUD y diálogos usan crema y aguamarina con texto verde profundo. El fondo conserva la orientación espacial cuando el mundo está visible.
- **Controles.** Acción principal en oro o coral con tinta. Acción secundaria sobre aguamarina pálida. Los modos y botones usan un contorno verde para el foco. Los pedales conservan su área activa.
- **Profundidad.** Los paneles y controles usan bordes finos y superficies planas. El título de menú es de una tinta. Los filtros de cada toma pertenecen a su edición.
- **Motivos.** El agua del arranque usa el trazo ondulado de Pixi. Los cierres admiten una banda inferior de olas, con la línea de horizonte y los planos reconocibles libres. La iluminación marina y los materiales de calles, aceras y muelles siguen viniendo del render del juego.

## 7. Movimiento y aplicaciones

El arranque muestra el reverso de Pacific Code Labs durante 2,4 s, luego el emblema junto al nombre del juego y el ferry durante 2,6 s. El barco y la barra comparten retraso, duración y avance lineal. El balanceo del casco sigue el oleaje. El título entra en 600 ms y el fundido al menú dura 500 ms. La preferencia de movimiento reducido quita la entrada del título, el balanceo y la aparición decorativa de los indicadores. La barra y el ferry muestran el progreso juntos.

La portada, los modos, el HUD, las indicaciones, la pausa y los resultados comparten la jerarquía y los tokens del juego. Las pantallas siguen leyendo su registro de slots y los ajustes del editor. En video, `BrandReveal` y `BrandWaves` leen el cuadro y los fps de Remotion para permitir la búsqueda directa de un fotograma. La duración, los cortes, la música y el relato se definen en cada composición.

Las [capturas de verificación](examples/README.md) muestran la aplicación real en el arranque, la interfaz y el material audiovisual.

## 8. Biblioteca y actualización

| Ubicación | Contenido |
| --- | --- |
| `brand/identity.json` y `assets/icon.png` | Nombre exacto, dimensiones, huellas y arte oficial. |
| `brand/tokens.json`, `components.css` y `brand.css` | Paleta, tipografía, forma, movimiento y CSS generado para el juego y campañas. |
| `brand/remotion.jsx`, `Ferry.jsx` y `ocean.jsx` | Título, marcas, subtítulo, entrada animada, barco, transiciones de agua y enlace de cierre. |
| `src/ui/BrandTitle.jsx` y `src/styles.css` | Consumo en el juego, con integración al tema del editor y soporte para títulos personalizados. |
| `brand/export.mjs` | Validación de hashes, contraste y derivados. Genera [la lámina local](variants.html) y exporta arte, fuentes, licencias, CSS y componentes. |
| `docs/publications/Kit_Instagram_Churchill/` | Referencias del kit en el checkout editorial. La biblioteca genera los recursos de marca para las siguientes piezas. |
| `trailer/` | Repositorio del tráiler y del montaje documental. `CHURCHILL_GAME_ROOT` permite usar dos checkouts independientes. |

1. Al ajustar colores o tipografía, editá [tokens.json](tokens.json) y ejecutá `node brand/export.mjs`. Este comando actualiza el CSS compartido y los defaults de tema vinculados al juego. Si se cambia una familia, actualizá las dependencias Fontsource, sus imports y el archivo OFL.
2. Si se aprueba una revisión del arte, registrá la ruta, hash y dimensiones en [identity.json](identity.json). Si cambia la firma del estudio, regenerá también su WebP recortado para el arranque y registrá su huella. Conservá la procedencia anterior y verificá la proporción a tamaño real.
3. Ejecutá `pnpm brand:check` y `pnpm build`. Si cambia un módulo, actualizá el inventario con `pnpm inventory`.
4. Para el tráiler, arrancá `npm run dev`, `npm run check` o `npm run render` desde su repositorio. Para los reels, arrancá `npm run studio` o `npm run render` desde cada composición. Los preparativos generan el directorio de marca en cada ejecución. Para un paquete editorial independiente usá `node brand/export.mjs --out ruta/de/salida` y abrí `variants.html` en el navegador.
5. Para una pieza de Instagram, partí de una toma del juego o del banco editorial, ubicá una firma o título en un área tranquila y comprobá tamaño, contraste y espacio de seguridad en el recorte final. El texto de publicación acompaña a la pieza en una sola versión para Facebook e Instagram, según el [formato editorial](../docs/publications/README.md).

Una revisión de portada, un símbolo a una tinta o un nuevo dibujo se presenta primero como prueba de esa pieza. El registro de marca conserva el archivo revisado, versión, huella, fuente y aprobación correspondiente.
