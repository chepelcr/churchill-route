# La Punta y el Paseo, como son

> Publicación del 2026-11-14. Imágenes en `img/punta/`, a tamaño de Instagram
> horizontal (1080 × 566), capturadas **en juego**, del mundo construido.
> El prompt para la portada está en `img/punta/PORTADA-prompt.md`.

---

## 📱 WhatsApp / Instagram

🏝️ **La Punta y el Paseo, como son.**

Del Faro al Parque Marino, el frente de mar de Puntarenas está rehecho en *La Ruta del Churchill*:

🗼 El **Faro**, visto desde arriba sobre su plazoleta redonda, y de noche **alumbra la playa** con su haz amarillo.
🌊 La **explanada del Faro**, con sus abanicos y olas, y sus **cinco malecones** saliendo al mar entre playas.
🏊 El **Balneario**, ahora sólo la piscina, con su forma de verdad.
⛴️ La **terminal de ferris** de Paquera y Playa Naranjo, con sus rampas y su escollera.
🎶 La **Concha Acústica** con sus nueve hojas, las letras de **PUNTARENAS** y los **Cañones**.
🍧 Los kioscos de churchill, vigorón y —nuevo— **papi-carne**, sobre el malecón.
🇨🇷 El **Muelle de Cruceros** con su arco y sus banderas.
🐋 El **Parque del Muellero** con sus bancas en esqueleto de ballena, y las pancitas hasta el Parque Marino.

¿Lo reconocen? 👀🏖️

#Puntarenas #CostaRica #LaRutaDelChurchill #PaseoDeLosTuristas #indiegame #pixelart

---

## 📘 Facebook

**La Punta y el Paseo, como son** 🏝️

Durante las últimas semanas rehicimos, sobre imágenes satelitales, todo el frente de mar desde La Punta hasta el Parque Marino. La idea era una sola: que cualquier puntarenense lo reconozca a la primera.

**El Faro y la explanada.** El Faro ya no es un dibujo de perfil: se ve desde arriba, como todo el puerto, sobre su plazoleta redonda. De noche gira y tira su luz sobre la playa. La explanada conserva su piedra gris de siempre y ahora tiene la forma de la de verdad: los abanicos al norte, las olas al sur y los cinco malecones —las áreas de descanso— saliendo al mar, con playa entre uno y otro.

**El Balneario** quedó como lo que importa: la piscina, con su forma de coma, sus zonas y su isla de palmeras.

**La terminal de ferris.** Por la Avenida 3, después de Playa Cocos y Pura Vida, llega la terminal: un patio redondeado con su escollera, y los ferris de Paquera y Playa Naranjo atracados en sus rampas. El Muelle del Faro, con el kiosco Churchill La Punta, se mudó a esa playa.

**El Paseo.** Malecón, verde y playa de punta a punta. En el tramo de los kioscos están la **Concha Acústica** —con sus nueve hojas turquesa sobre el escenario—, las letras de **PUNTARENAS** y **los Cañones**, y en fila los kioscos de churchill, papi-carne y vigorón, con la Capitanía. El **Muelle de Cruceros** tiene su arco de entrada y banderas de Costa Rica a los dos lados.

**El Parque del Muellero.** Al otro lado del muelle: el muro ondulado, las bancas en forma de esqueleto de ballena y las medialunas de piedra, y después las pancitas sobre la playa hasta el parqueo del Parque Marino.

Y para que el puerto respire, en el mapa quedan sólo los edificios con nombre.

Pasen por La Punta en carro y díganos qué falta 🚗🍧

---

## 🧾 Nota larga (post fijado / GitHub)

### Qué cambió

- **El Faro**: vista cenital (cilindro con sus franjas naranja), 1,6 veces más grande, sobre una plazoleta redonda; de noche, dos haces amarillos que giran sobre la playa.
- **La explanada del Faro**: un solo malecón de piedra gris con forma limpia, que sigue la calle desde la Avenida 3, rodea La Punta y baja hasta la quinta área de descanso. Abanicos (con sus dos bancas) al norte, olas al sur, los cinco malecones de OSM como lenguas al mar, playa entre ellos y una escollera continua.
- **El Balneario**: césped en toda la cuadra y la piscina trazada sobre la imagen satelital, con la paleta de las piscinas del Parque Marino.
- **De la explanada a la terminal**: acera angosta con escollera, la playa de Cocos / Pura Vida, el Muelle del Faro con su kiosco, y la terminal de ferris como un patio manejable con bases para sus dos rampas y una sola escollera alrededor.
- **El Paseo de los Turistas**: malecón de baldosa, verde y playa en franjas regulares, unidos a la explanada por una cuña curva; en el tramo de los kioscos, la Concha Acústica, las letras de PUNTARENAS, los Cañones, los kioscos de churchill, papi-carne y vigorón y la Capitanía.
- **El Muelle de Cruceros**: alineado con su calle, del ancho de calle y aceras, con arco de entrada, banderas de Costa Rica entre las luces y su caseta sobre el malecón.
- **El Parque del Muellero**: trazado sobre la imagen satelital — muro ondulado, tres bancas en esqueleto de ballena, aros y medialunas de piedra; después, cuatro pancitas y la pancita grande con el parqueo del Parque Marino, y una sola playa que empalma con la de El Cocal.
- **El camellón del León Cortés**: una franja con una fila de árboles grandes.
- **La feria**: el letrero de los chocones debajo, y el tablado con el mismo margen a los lados.
- **El mapa**: sólo los edificios con nombre.

### Cómo se hizo

Cada lugar se trazó sobre capturas satelitales, georreferenciadas contra el mapa de OSM, y quedó como datos en `content/world/punta.json`. Antes de construir, se revisó en el juego con el mismo pintor del juego. La construcción (`pnpm world:punta`, encadenada en `pnpm world:build`) escribe el mundo y estampa el suelo que el carro maneja.

### Imágenes

`img/punta/01-punta.jpg` … `23-noche.jpg` (los lugares) y `recorrido-01.jpg` … `recorrido-10.jpg` (del Faro al Parque Marino, en orden).
