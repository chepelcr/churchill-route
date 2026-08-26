// EL ARBOLADO, EN VOLUMEN.
//
// Un almendro deja de ser una mancha verde con un tronquito dibujado de lado y
// pasa a ser un tronco y una copa de verdad, iluminados por el mismo sol que
// los edificios y tirando su propia sombra sobre la acera.
//
// DÓNDE ESTÁ CADA ÁRBOL NO SE DECIDE ACÁ. El monte se computa por cuadro desde
// una retícula global (`forEachWoodTree` en `c2d/flora.js`), la calle se planta
// desde la geometría de la propia calzada y el mundo emite los suyos por tile.
// Esta capa CONSUME esas tres fuentes; escribir un segundo recorrido pondría el
// volumen de un árbol en un sitio distinto de su sombra, y eso no se nota hasta
// que se mira de cerca.
//
// LA FORMA SALE DEL `generator` QUE LA ESPECIE YA DECLARA. `flora.json` tiene
// 23 especies y 18 formas, pero sólo SIETE generadores, y ésa es exactamente la
// agrupación que el volumen necesita: no hace falta inventar un registro nuevo
// ni retipear la lista — que es la deriva que este repo ya pagó tres veces.
//
// Todo es `InstancedMesh`: una malla por (generador, pieza), de modo que mil
// árboles de veinte especies cuestan catorce llamadas de dibujo y no mil.
import FLORA from "../../assets/flora.json" with { type: "json" };
import { WORLD2D as W } from "../../world2d/index.js";
import { resolveFloraMixSpecies } from "../c2d/floraShapes.js";
import {
  domeGeometry, frondGeometry, tierGeometry, trunkGeometry,
} from "./solids.js";

const SPECIES = FLORA.species;
const FORMS = FLORA.forms;
const DEFAULT_SPECIES = FLORA.defaults.treeSpecies;
const DEFAULT_PALM = FLORA.defaults.palmSpecies;

// Cuántos árboles puede haber a la vista. El monte entrega ~60 candidatos por
// cuadro y una manzana arbolada unas decenas; 3 000 es holgura de sobra y el
// buffer se reserva UNA vez — hacerlo crecer a mitad de cuadro es reasignar
// GPU en el peor momento posible.
const CAPACITY = 3000;

// Cada generador -> cómo se para en el espacio. Las proporciones son las que
// hacen que una silueta se distinga de otra VISTA DESDE ARRIBA, que es el único
// ángulo desde el que se mira: una palma tiene que leerse como estrella y un
// almendro como disco, y el resto son matices.
const ARCHETYPES = {
  "crown-stack":      { crown: "dome",  trunk: 0.055, crownH: 0.85, rise: 0.42, flat: 0.72 },
  "tier-stack":       { crown: "tier",  trunk: 0.050, crownH: 1.15, rise: 0.28, flat: 1.00 },
  "column-stack":     { crown: "dome",  trunk: 0.045, crownH: 1.30, rise: 0.22, flat: 1.55 },
  "branch-crown":     { crown: "dome",  trunk: 0.060, crownH: 0.70, rise: 0.55, flat: 0.58 },
  "frond-ring":       { crown: "frond", trunk: 0.042, crownH: 0.95, rise: 0.86, flat: 0.62 },
  "fan-ring":         { crown: "frond", trunk: 0.048, crownH: 0.80, rise: 0.80, flat: 0.52 },
  "tidal-root-crown": { crown: "dome",  trunk: 0.070, crownH: 0.65, rise: 0.30, flat: 0.55 },
};
const FALLBACK_ARCHETYPE = "crown-stack";

let THREE = null;
let group = null;
let parts = null;        // generador -> { trunk: InstancedMesh, crown: InstancedMesh }
let matrix = null;
let color = null;
let counts = null;

function speciesRecord(name) {
  return SPECIES[name] || SPECIES[DEFAULT_SPECIES];
}

/** El generador de una especie, o el de reserva si su forma no lo declara. */
function generatorOf(record) {
  const form = FORMS[record.form];
  const generator = form && form.generator;
  return ARCHETYPES[generator] ? generator : FALLBACK_ARCHETYPE;
}

function makeInstanced(geometry, material, capacity) {
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // El culling por frustum de una malla instanciada usa la esfera de la
  // GEOMETRÍA UNITARIA, que está en el origen: con él encendido el arbolado
  // entero desaparece en cuanto la cámara se aleja del (0,0) del mundo. Se
  // apaga y el recorte lo hace el enumerador, que ya trabaja por rectángulo.
  mesh.frustumCulled = false;
  mesh.count = 0;
  return mesh;
}

export function setupTrees(three, scene) {
  THREE = three;
  matrix = new THREE.Matrix4();
  color = new THREE.Color();
  group = new THREE.Group();
  scene.add(group);

  const material = new THREE.MeshLambertMaterial({ flatShading: true });
  const trunkGeo = trunkGeometry(THREE);
  const crowns = {
    dome: domeGeometry(THREE),
    tier: tierGeometry(THREE),
    frond: frondGeometry(THREE),
  };

  parts = {};
  counts = {};
  for (const name of Object.keys(ARCHETYPES)) {
    const spec = ARCHETYPES[name];
    const trunk = makeInstanced(trunkGeo, material, CAPACITY);
    const crown = makeInstanced(crowns[spec.crown], material, CAPACITY);
    group.add(trunk); group.add(crown);
    parts[name] = { trunk, crown };
    counts[name] = 0;
  }
  return true;
}

/** Empieza un cuadro: todo a cero, se vuelve a llenar desde los enumeradores. */
export function beginTreeFrame() {
  if (!parts) return;
  for (const name of Object.keys(counts)) counts[name] = 0;
}

/**
 * Un árbol. `k` es la especie (vacío = almendro), `s` la escala de instancia.
 *
 * `seed` decide QUÉ tono del follaje le toca, y tiene que venir de la POSICIÓN
 * y no de un contador: si dependiera del orden en que se enumeran, un árbol
 * cambiaría de color al entrar otro en cuadro.
 */
export function addTree(x, y, k, s = 1, palm = false) {
  if (!parts) return;
  const record = speciesRecord(k || (palm ? DEFAULT_PALM : DEFAULT_SPECIES));
  const name = generatorOf(record);
  const spec = ARCHETYPES[name];
  const slot = counts[name];
  if (slot >= CAPACITY) return;

  const scale = s || 1;
  const heightPx = (record.heightM || 8) * W.PX_PER_M * scale;
  const crownR = (record.r || 10) * scale;
  const trunkTop = heightPx * spec.rise;
  const crownH = crownR * 2 * spec.flat * spec.crownH;

  const { trunk, crown } = parts[name];
  const trunkR = Math.max(0.6, heightPx * spec.trunk);
  matrix.makeScale(trunkR, trunkR, Math.max(1, trunkTop + crownH * 0.18));
  matrix.setPosition(x, -y, 0);
  trunk.setMatrixAt(slot, matrix);
  color.set(record.trunk || "#6a4426");
  trunk.setColorAt(slot, color);

  matrix.makeScale(crownR, crownR, crownH);
  matrix.setPosition(x, -y, trunkTop);
  crown.setMatrixAt(slot, matrix);
  // DESDE ARRIBA SE VE LA PARTE DE ARRIBA, y la paleta de una especie va de
  // oscuro a claro precisamente porque el pintor plano apila los tiers en ese
  // orden y deja el más claro encima. Tomar un tono al azar de los cuatro deja
  // la mitad del arbolado con el verde de SOTOBOSQUE en la copa, y el monte
  // sale negro. Se toma de la mitad clara, con variación para que un bosque no
  // sea un solo verde.
  const canopy = record.canopy || ["#358a4d"];
  const pick = Math.abs(Math.floor(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453));
  const top = canopy.length - 1;
  color.set(canopy[Math.max(0, top - (pick % 2))]);
  crown.setColorAt(slot, color);

  counts[name] = slot + 1;
}

/** Cierra el cuadro: publica las cuentas y marca los buffers. */
export function endTreeFrame() {
  if (!parts) return 0;
  let total = 0;
  for (const name of Object.keys(parts)) {
    const { trunk, crown } = parts[name];
    const n = counts[name];
    trunk.count = n; crown.count = n;
    if (n) {
      trunk.instanceMatrix.needsUpdate = true;
      crown.instanceMatrix.needsUpdate = true;
      if (trunk.instanceColor) trunk.instanceColor.needsUpdate = true;
      if (crown.instanceColor) crown.instanceColor.needsUpdate = true;
    }
    total += n;
  }
  return total;
}

export function teardownTrees() {
  if (!group) return;
  for (const name of Object.keys(parts || {})) {
    for (const mesh of Object.values(parts[name])) {
      mesh.geometry.dispose();
      mesh.material.dispose?.();
      group.remove(mesh);
    }
  }
  group.parent?.remove(group);
  THREE = group = parts = matrix = color = counts = null;
}

export { resolveFloraMixSpecies };
