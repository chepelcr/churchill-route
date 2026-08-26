// GEOMETRÍA A MANO, SIN `examples/jsm`.
//
// Las mallas de este mundo son pocas y simples —troncos, copas, postes— y
// three trae primitivas para todas. Lo que NO se puede traer es
// `BufferGeometryUtils.mergeGeometries`, que vive en `examples/jsm`: CLAUDE.md
// lo prohíbe por su nombre porque es donde el bundle DUPLICA de tamaño, y esto
// se descarga en un teléfono.
//
// Así que las formas compuestas se arman acá, a triángulos, con el mismo patrón
// que `massing.js` usa para las huellas. Cada constructora devuelve una
// `BufferGeometry` de UNA UNIDAD —radio 1, altura 1, apoyada en z = 0— y quien
// la instancia la escala. Eso es lo que permite que miles de árboles de veinte
// especies compartan siete mallas.
//
// El eje vertical es Z, no Y: es el sistema en que está el resto de la capa
// (x, -y del mundo, altura en z), y mezclarlos es la clase de error que se ve
// como árboles acostados.

function geometryFrom(THREE, positions) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position",
    new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Un tronco: cono truncado de radio 1 abajo, `topR` arriba, altura 1. */
export function trunkGeometry(THREE, topR = 0.72, sides = 6) {
  const p = [];
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    p.push(c0, s0, 0, c1, s1, 0, c1 * topR, s1 * topR, 1);
    p.push(c0, s0, 0, c1 * topR, s1 * topR, 1, c0 * topR, s0 * topR, 1);
  }
  return geometryFrom(THREE, p);
}

/**
 * Una copa: elipsoide de radio 1 y altura 1, achatado o estirado por quien la
 * escale. Pocos segmentos a propósito — el pueblo está pintado a colores
 * planos y una esfera lisa lo sacaría de su estilo; además se ve desde arriba,
 * donde lo que cuenta es la silueta circular.
 */
export function domeGeometry(THREE, sides = 9, rings = 4, bottom = 0.35) {
  const p = [];
  const at = (i, j) => {
    const a = (i / sides) * Math.PI * 2;
    // de -bottom (bajo el ecuador) a 1 arriba
    const v = j / rings;
    const phi = (v - bottom / (1 + bottom)) * Math.PI;
    const r = Math.cos(phi * 0.5 + Math.PI * 0.0) * 0;
    const t = -bottom + v * (1 + bottom);
    const rr = Math.sqrt(Math.max(0, 1 - t * t));
    return [Math.cos(a) * rr, Math.sin(a) * rr, (t + bottom) / (1 + bottom)];
  };
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < sides; i++) {
      const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
      p.push(...a, ...b, ...d);
      p.push(...a, ...d, ...c);
    }
  }
  return geometryFrom(THREE, p);
}

/** Conos apilados: el pino, y la única forma de este mundo con punta. */
export function tierGeometry(THREE, tiers = 3, sides = 8) {
  const p = [];
  for (let t = 0; t < tiers; t++) {
    const z0 = t / tiers, z1 = (t + 1.35) / tiers;
    const r0 = 1 - t / (tiers + 0.6), r1 = r0 * 0.18;
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
      p.push(Math.cos(a0) * r0, Math.sin(a0) * r0, z0,
             Math.cos(a1) * r0, Math.sin(a1) * r0, z0,
             Math.cos(a1) * r1, Math.sin(a1) * r1, Math.min(1, z1));
      p.push(Math.cos(a0) * r0, Math.sin(a0) * r0, z0,
             Math.cos(a1) * r1, Math.sin(a1) * r1, Math.min(1, z1),
             Math.cos(a0) * r1, Math.sin(a0) * r1, Math.min(1, z1));
    }
  }
  return geometryFrom(THREE, p);
}

/**
 * La corona de una palma: hojas que salen del ápice y CAEN.
 *
 * Es la forma que más importa de todas, porque es la única que desde arriba no
 * se lee como un círculo: una palma vista a plomo es una ESTRELLA, y eso es lo
 * que la distingue de un almendro en el paseo. Cada hoja es un cuarteto de
 * triángulos que se afina hacia la punta y baja en un arco.
 */
export function frondGeometry(THREE, count = 9, droop = 0.55, width = 0.17) {
  const p = [];
  const SEGS = 4;
  for (let f = 0; f < count; f++) {
    const a = (f / count) * Math.PI * 2 + (f % 2) * 0.11;
    const ca = Math.cos(a), sa = Math.sin(a);
    for (let k = 0; k < SEGS; k++) {
      const t0 = k / SEGS, t1 = (k + 1) / SEGS;
      const r0 = t0, r1 = t1;
      // la hoja arranca en el ápice (z = 1) y cae describiendo un arco
      const z0 = 1 - droop * t0 * t0, z1 = 1 - droop * t1 * t1;
      const w0 = width * (1 - t0) * (0.35 + t0), w1 = width * (1 - t1) * (0.35 + t1);
      const nx = -sa, ny = ca;
      p.push(ca * r0 - nx * w0, sa * r0 - ny * w0, z0,
             ca * r0 + nx * w0, sa * r0 + ny * w0, z0,
             ca * r1 + nx * w1, sa * r1 + ny * w1, z1);
      p.push(ca * r0 - nx * w0, sa * r0 - ny * w0, z0,
             ca * r1 + nx * w1, sa * r1 + ny * w1, z1,
             ca * r1 - nx * w1, sa * r1 - ny * w1, z1);
    }
  }
  return geometryFrom(THREE, p);
}

/** Una caja de radio 1 y altura 1 apoyada en z = 0 — postes, cajas, cargas. */
export function boxGeometry(THREE) {
  const p = [];
  const quad = (a, b, c, d) => { p.push(...a, ...b, ...c, ...a, ...c, ...d); };
  const v = (x, y, z) => [x, y, z];
  quad(v(-1, -1, 1), v(1, -1, 1), v(1, 1, 1), v(-1, 1, 1));          // arriba
  quad(v(-1, -1, 0), v(-1, 1, 0), v(1, 1, 0), v(1, -1, 0));          // abajo
  quad(v(-1, -1, 0), v(1, -1, 0), v(1, -1, 1), v(-1, -1, 1));
  quad(v(1, -1, 0), v(1, 1, 0), v(1, 1, 1), v(1, -1, 1));
  quad(v(1, 1, 0), v(-1, 1, 0), v(-1, 1, 1), v(1, 1, 1));
  quad(v(-1, 1, 0), v(-1, -1, 0), v(-1, -1, 1), v(-1, 1, 1));
  return geometryFrom(THREE, p);
}

/** Un disco horizontal de radio 1 a z = 0 — la luminaria vista a plomo. */
export function discGeometry(THREE, sides = 10) {
  const p = [];
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
    p.push(0, 0, 0, Math.cos(a0), Math.sin(a0), 0, Math.cos(a1), Math.sin(a1), 0);
  }
  return geometryFrom(THREE, p);
}
