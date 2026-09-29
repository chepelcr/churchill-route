// LA COTA DEL SUELO PARA LO QUE SE PARA EN ÉL.
//
// Mientras el suelo lo pinte Canvas, el suelo es PLANO en pantalla: la ladera
// del cerro se dibuja en planta y sólo se sombrea (`c2d/relief.js`). Una casa
// apoyada en `groundZAt` se levantaría de su propia huella pintada — a 200 m
// de cota, decenas de píxeles. Así que hoy toda base va a h = 0, y el día que
// el terreno sea una malla de three esta función pasa a leer `W.groundZAt` y
// todo lo que se para en el suelo sube con él, sin tocar a nadie más.
export function groundBase(_x, _y) { return 0; }
