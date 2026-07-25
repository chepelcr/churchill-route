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
> Además: el Estadio Lito Pérez y la **Plaza Las Playitas** quedaron trazados
> sobre su manzana real (la plaza ya llega hasta la playa), el Parque Marino
> tiene sus edificios y sus 5 tanques bien puestos, y el carro por fin **se
> desliza** contra la acera en vez de quedarse pegado.
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
> 🐠 **Parque Marino del Pacífico**: sus edificios reales y los 5 tanques
> colocados sin montarse en la acera.
> ⚽ **Estadio Lito Pérez** y **Plaza Las Playitas** dibujados sobre su cuadra
> real. La plaza ahora llega hasta la línea de playa, con marcas de fútbol
> alineadas al ángulo real de la manzana… y ya no se puede manejar sobre el mar.
> 🏊 **Balneario**: los bañistas se quedan en el agua y ya nadie flota.
> 🚗 **Manejo**: colisionador de burbuja (se acabó que las ruedas del tuk-tuk se
> enganchen en el cordón) y el carro se desliza a lo largo de la acera en vez de
> frenar en seco.
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
  la cuadrícula. Los 137 que se montaban sobre una calle vuelven al encaje —
  eso arregla el rectángulo que pisaba las calles auxiliares del Paseo.
- Rótulos en juego a tamaño pequeño, con interruptor **Nombres de negocios** en
  Ajustes, y un overlay de depuración por categoría para validar posiciones.
- Parque Marino del Pacífico: cuadra limpia de edificios genéricos, sus 4
  edificios OSM con huella real, y 5 tanques colocados libres de acera y de
  edificio.

### Estadios y plaza
- La cuadra se traza con *flood fill* + erosión: contorno (cuadra + acera) y
  cancha. Solo se vuelven manejables las celdas trazadas, así que **el mar al
  norte de Las Playitas vuelve a ser pared**.
- **Plaza Las Playitas** (antes "Estadio"): sin graderías, sin aceras — la
  cancha llena la cuadra — llega hasta la línea de playa, y su pared derecha
  sigue la línea de Calle 8 extendida.
- Marcas de fútbol rotadas al eje real de la plaza: áreas, área chica, punto de
  penal, círculo y punto central.
- Estadio Lito Pérez sin graderías.
- El estadio se pinta dentro del pase de aceras, no como capa encima: los
  rótulos de calle vuelven a quedar por arriba.
- Fuera las sombras huérfanas en el centro de la plaza y del balneario.
- Lluvia de monedas dentro de la cuadra del estadio/plaza + hinchada que salta y
  levanta los brazos.

### Balneario
- Los bañistas se contienen con margen de cuerpo: ya no pisan la acera interior.
- Los edificios que flotaban sobre la ensenada tienen banco de arena.

### Manejo
- Colisionador de **burbuja (cápsula)** en vez de caja orientada: una caja
  enganchaba las esquinas en el cordón (las ruedas del tuk-tuk se quedaban
  pegadas). La cápsula además barre más angosto, así que girar en calle angosta
  es más fácil.
- Respuesta doble según la pared: con **una** pared se estima la normal y el
  carro desliza por la tangente, con el empuje redirigido a lo largo del cordón
  y el agarre relajado, para que siga andando. En **corredor** (el muelle con
  agua a los dos lados, una calle angosta) se usa el deslizamiento por ejes de
  siempre, que es lo que hacía que el muelle se sintiera bien.

### Interfaz
- Intro de lore no saltable.
- Pantalla previa al tutorial con velocidad + zoom, avisando que se cambian
  después en Ajustes.
- Zoom configurable (60–140%).
- Ajustes agrupado en JUEGO / APLICACIÓN / CUENTA, con barra de navegación
  opaca (las filas ya no se ven por debajo al hacer scroll).
- Pantalla de modo para Recorrer y Arcade, como el brief de Historia.
- El paso del tutorial sobre el freno describe el alto en seco actual.

### Interno
- `canvas2d.js` (2230 líneas) partido en `src/render/c2d/*` — 10 módulos, con
  `canvas2d.js` reducido a un compositor de ~200 líneas.
- Eliminado el pintor de corredor muerto: 12 drawers sin llamadas desde que el
  mundo es planar (~380 líneas, incluidas dos copias del mismo pase).
