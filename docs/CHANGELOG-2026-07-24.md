# La Ruta del Churchill — ¡Puntarenas de verdad! 🇨🇷

Publicación lista para copiar. Tres largos distintos según la red.

---

## 📱 WhatsApp / Instagram (corto)

> 🍧 **La Ruta del Churchill** — update grande
>
> Ahora el mapa **es Puntarenas de verdad**: 1160 negocios reales salidos de
> OpenStreetMap, con su nombre puesto sobre el mapa. El Hotel El Turista, la
> Soda La Esquina, el Banco Popular, la Terminal de Quepos… y 308 edificios
> conservan la forma real que tienen en la calle.
>
> Se sumaron la **Parroquia Nuestra Señora de El Carmen** con su jardín y la
> **Plaza Deportes El Carmen**, el Estadio Lito Pérez y la **Plaza Las
> Playitas** quedaron sobre su manzana real, el Parque Marino tiene sus
> edificios y sus tanques bien puestos… y el carro por fin **se desliza**
> contra la acera en vez de quedarse pegado.
>
> 🎮 https://churchill.jcampos.dev · ¡Pura vida!

---

## 📘 Facebook (medio)

> 🍧 **La Ruta del Churchill — update de "Puntarenas real"**
>
> El juego siempre tuvo el trazado del puerto… pero los edificios eran cajitas
> anónimas. Eso se acabó:
>
> 🏪 **1160 lugares reales** sacados del mapa abierto de Puntarenas, con nombre:
> hoteles, sodas, bancos, iglesias, escuelas, terminales de bus. Se pueden
> apagar desde Ajustes si preferís el mapa limpio.
> 🏛️ **308 edificios con su huella real** — la forma que de verdad tienen en la
> manzana, no un rectángulo.
> ⛪ **Parroquia Nuestra Señora de El Carmen** con su jardín, y la **Plaza
> Deportes El Carmen** al lado, cada una en su pedazo de cuadra.
> 🐠 **Parque Marino del Pacífico**: sus edificios reales y los 5 tanques
> colocados sin montarse en la acera.
> ⚽ **Estadio Lito Pérez** y **Plaza Las Playitas** sobre su cuadra real. La
> plaza llega hasta la línea de playa, con marcas de fútbol alineadas al ángulo
> real de la manzana… y ya no se puede manejar sobre el mar.
> 🏊 **Balneario**: los bañistas se quedan en el agua y ya nadie flota.
> 🚗 **Manejo**: colisiones rehechas de raíz. Se acabó que las ruedas del tuk-tuk
> se enganchen en el cordón, y el carro se desliza a lo largo de la acera —igual
> que en el muelle— en vez de frenar en seco.
> ⚙️ **Ajustes** con velocidad, **zoom configurable** y todo agrupado; pantalla
> de "qué es este modo" para Recorrer y Arcade.
>
> 🎮 Jugalo gratis: https://churchill.jcampos.dev
> 📲 También hay APK para Android.
>
> #Puntarenas #CostaRica #PuraVida #Churchill #IndieGame #GameDev

---

## 🧾 Changelog completo (para el post fijado / GitHub)

### Puntarenas real
- 1160 POIs con nombre extraídos del OSM (amenity / shop / tourism / leisure /
  office / healthcare / craft / historic), deduplicados por nombre + cuadrícula.
- 308 edificios con nombre conservan su huella OSM real en vez de encajarse en
  la cuadrícula. Los 137 que se montaban sobre una calle vuelven al encaje.
- Rótulos en juego con interruptor **Nombres de negocios** en Ajustes, y un
  overlay de depuración por categoría para validar posiciones.
- Parque Marino del Pacífico: cuadra limpia de edificios genéricos, sus 4
  edificios OSM con huella real, y 5 tanques libres de acera y de edificio.

### Parcelas — mapear la ciudad por pedazos
- Una cuadra se puede partir en **N×M** con pesos, y cada parte toma `col`/`row`
  como entero o rango, así que no todas miden lo mismo: El Carmen es una columna
  de dos (iglesia sobre jardín) al lado de una que abarca ambas filas (la plaza).
- El corte se hace en el **marco propio de la cuadra**: Las Playitas está a 37°,
  y un corte a eje de pantalla en un bloque inclinado da cuñas, no mitades.
- Para bloques que una grilla no puede cortar (Parque Marino llena 32% de su
  bbox, el Balneario 46% — son cintas, no cuadras) las parcelas se derivan de
  las huellas de edificio que ya están ahí.
- Usos: iglesia, jardín (con árboles), cancha/plaza, lote.

### Patrocinio
- Cada parcela emite un **slot**: el rect donde un patrocinador pinta su arte.
  El mundo manda posición y tamaño, así que nada puede tapar una calle ni
  comerse la cuadra.
- **16 espacios patrocinables**, incluidos el centro del Estadio Lito Pérez y de
  la Plaza Las Playitas — el escudo de un club va ahí con una línea de
  configuración, sin recompilar.

### Estadios y plazas
- La cuadra se traza con flood fill + erosión, y solo se vuelven manejables las
  celdas trazadas: **el mar al norte de Las Playitas vuelve a ser pared**.
- Plaza Las Playitas: sin graderías ni aceras, llega hasta la playa, con marcas
  de fútbol rotadas al eje real de la manzana.
- Las marcas se ajustan al tamaño de la cancha: la chica lleva el juego limpio
  (línea de banda, medio campo, círculo) y la grande añade áreas y penales.
- Lluvia de monedas dentro de la cancha (tope ₡300 por tanda, se desvanecen a
  los 11s, 20s de espera) y hinchada que salta y levanta los brazos.

### Manejo — colisiones rehechas
- El cuerpo es una **cápsula** y cada celda-pared un AABB. El contacto es
  exacto: punto más cercano, normal y profundidad; se empuja por la normal, se
  remide y se repite tomando el contacto más profundo.
- Esto reemplaza heurísticas que no podían funcionar: la caja orientada
  enganchaba sus esquinas en el cordón, y **sumar** las paredes cercanas para
  sacar una normal se cancela en un corredor (agua a los dos lados del muelle),
  lo que hacía que el Muelle de Cruceros (vertical) se sintiera bien y el del
  Faro (45°) y toda acera diagonal se sintieran pegajosos.
- Con contacto, el empuje se redirige a lo largo del cordón y el agarre se
  relaja: mantener el dedo contra una pared te hace manejar por ella.

### Interfaz
- Intro de lore no saltable; pantalla previa al tutorial con velocidad + zoom.
- Zoom configurable (60–140%); Ajustes agrupado en JUEGO / APLICACIÓN / CUENTA.
- Pantalla de modo para Recorrer y Arcade, con el modo como título.
- Sonido propio al recoger monedas; rótulos de área semitransparentes y chicos
  para no tapar el dibujo que nombran.

### Interno
- `canvas2d.js` (2230 líneas) partido en 10 módulos bajo `src/render/c2d/`, con
  `canvas2d.js` reducido a un compositor de ~200 líneas.
- Eliminado el pintor de corredor muerto: 12 drawers sin llamadas desde que el
  mundo es planar (~380 líneas, incluidas dos copias del mismo pase).
