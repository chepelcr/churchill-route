// Opt-in Three backend for the staged elevation milestones.
//
// `three=empty` keeps D1's transparent proof layer, `three=terrain` keeps D2's
// elevation hillshade, and `three=shadows` adds D3's single terrain shadow map.
// The non-empty modes stay in a transparent CSS-multiply layer: no frame ever
// crosses back from WebGL into Canvas2D.
import EFFECTS from "../../assets/effects.json" with { type: "json" };
import { WORLD2D as W } from "../../world2d/index.js";
import { sunDirection3 } from "../sun.js";
import { lean as cameraLean, setLean } from "../lean.js";
import { LAYER, owns } from "../migrated.js";
import { renderMassing, setupMassing, teardownMassing } from "./massing.js";
import {
  clearTerrainCanvas, setTerrainCanvas, setTerrainFrameActive, setTerrainFrameReady,
} from "../terrainComposite.js";

const MIN_TILE_RANGE_M = 8;
const MIN_SLOPE = 0.15;
const SHADOW = EFFECTS.terrainShadow;
const HILLSHADE_LIGHT = (() => {
  const x = -0.58, y = 0.38, z = 0.72;
  const n = Math.hypot(x, y, z);
  return Object.freeze({ x: x / n, y: y / n, z: z / n });
})();

let THREE = null;
let renderer = null;
let scene = null;
let camera3 = null;
let terrainMaterial = null;
let shadowMaterial = null;
let shadowLight = null;
let receiverGeometry = null;
let receiverMesh = null;
let canvas = null;
let mainCanvas = null;
let setupPromise = null;
let sizeKey = "";
let mode = "empty";
let shadowSignature = "";

// GPU buffers follow WORLD2D residency, not the visible rectangle. A tile may
// leave the current shadow volume without being disposed, then be reused when
// the camera nudges back over the boundary.
const terrainTiles = new Map();

const diagnostics = {
  ready: false,
  mode: null,
  residentTiles: 0,
  meshTiles: 0,
  geometryTiles: 0,
  shadowMeshTiles: 0,
  casterCount: 0,
  receiverCount: 0,
  lightCount: 0,
  shadowMapSize: 0,
  shadowTexelM: 0,
  sharedGeometry: true,
  geometryTriangles: 0,
  triangles: 0,
  shadowActive: false,
  shadowMapUpdates: 0,
  shadowMapUpdated: false,
};

function publishDiagnostics() {
  if (typeof window !== "undefined") window.__threeTerrain = diagnostics;
}

export function setupThree(canvas2d, options = {}) {
  if (setupPromise) return setupPromise;
  mode = ["empty", "terrain", "shadows", "world"].includes(options.mode)
    ? options.mode : "empty";
  if (options.lean !== undefined) setLean(options.lean);
  mainCanvas = canvas2d;
  diagnostics.mode = mode;
  publishDiagnostics();

  canvas = document.createElement("canvas");
  canvas.id = mode === "empty" ? "three-canvas" : "three-terrain-source";
  canvas.dataset.ready = "false";
  canvas.dataset.stage = mode;
  canvas.setAttribute("aria-hidden", "true");

  if (mode === "empty") {
    canvas.style.cssText = "position:fixed;inset:0;pointer-events:none;";
    mainCanvas.parentNode.insertBefore(canvas, mainCanvas.nextSibling);
  } else {
    setTerrainCanvas(canvas, mainCanvas);
  }

  setupPromise = (async () => {
    // Deliberately dynamic: ordinary ?render=2d never downloads Three.
    THREE = await import("three");
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,
      premultipliedAlpha: true,
      powerPreference: "high-performance",
    });
    renderer.setClearColor(0x000000, 0);
    scene = new THREE.Scene();
    camera3 = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20000);
    if (mode !== "empty") terrainMaterial = makeTerrainMaterial();
    if (castsTerrainShadows()) setupShadowScene();
    // EL VOLUMEN DEL PUEBLO, en su propio lienzo. Va aparte del terreno porque
    // compone distinto: el terreno MULTIPLICA (oscurece el arte que Canvas ya
    // pintó) y el volumen REEMPLAZA. Un lienzo no puede hacer las dos cosas.
    //
    // Se monta por MODO y no por propiedad: cuando esto corre, Canvas sigue
    // siendo el dueño a propósito (ver `Renderer.js`) y preguntar por la
    // propiedad acá dejaría la capa sin montar para siempre. Quien pregunta
    // por el dueño es el DIBUJO, cuadro a cuadro, que es donde la anulación
    // `?own=buildings:canvas` tiene que poder morder.
    if (mode === "world") setupMassing(THREE, mainCanvas, canvas);
    canvas.dataset.threeRevision = THREE.REVISION;
    canvas.dataset.ready = "true";
    diagnostics.ready = true;
  })().catch((error) => {
    if (mode !== "empty") clearTerrainCanvas();
    teardownMassing();
    canvas?.remove();
    THREE = renderer = scene = camera3 = terrainMaterial = shadowMaterial = null;
    shadowLight = receiverGeometry = receiverMesh = canvas = mainCanvas = null;
    setupPromise = null;
    diagnostics.ready = false;
    throw error;
  });
  return setupPromise;
}

// `world` is `shadows` plus the lean: the terrain pipeline is the same one D3
// proved, so it is asked by CAPABILITY rather than re-listed at each branch.
// A mode added to one of these lists and forgotten in the other is how a
// shadow map silently stops being allocated.
function castsTerrainShadows() {
  return mode === "shadows" || mode === "world";
}

function makeTerrainMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uMinSlope: { value: MIN_SLOPE },
    },
    vertexShader: `
      attribute float hill;
      attribute float slope;
      varying float vHill;
      varying float vSlope;
      void main() {
        vHill = hill;
        vSlope = slope;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform float uMinSlope;
      varying float vHill;
      varying float vSlope;
      void main() {
        if (vSlope < uMinSlope) discard;
        float magnitude = smoothstep(0.0, 0.42, abs(vHill));
        bool lit = vHill >= 0.0;
        // CSS multiply cannot brighten. A lit face is the local reference and
        // an unlit one darkens progressively without repainting the palette.
        vec3 tint = lit ? vec3(0.78, 0.76, 0.70) : vec3(0.12, 0.18, 0.20);
        float alpha = lit ? mix(0.015, 0.055, magnitude)
                          : mix(0.045, 0.22, magnitude);
        gl_FragColor = vec4(tint, alpha);
      }
    `,
  });
}

function setupShadowScene() {
  renderer.shadowMap.enabled = true;
  // PCFSoftShadowMap's radius behavior is deprecated in current Three. One
  // 1024-square PCF map is the deliberately bounded D3 budget.
  renderer.shadowMap.type = THREE.PCFShadowMap;
  shadowLight = new THREE.DirectionalLight(0xffffff, 1);
  shadowLight.castShadow = true;
  shadowLight.shadow.mapSize.set(SHADOW.mapSize, SHADOW.mapSize);
  shadowLight.shadow.bias = SHADOW.bias;
  shadowLight.shadow.normalBias = SHADOW.normalBiasM * W.PX_PER_M;
  shadowLight.shadow.radius = SHADOW.radius;
  // A world-space height field and sun do not change merely because another
  // game frame elapsed. The fitted volume below is quantised and marks this
  // map dirty only when its coverage, solar ray, or caster set changes.
  shadowLight.shadow.autoUpdate = false;
  shadowLight.shadow.needsUpdate = true;
  scene.add(shadowLight);
  scene.add(shadowLight.target);

  shadowMaterial = new THREE.ShadowMaterial({
    color: 0x000000,
    opacity: 0,
    depthTest: true,
    depthWrite: true,
    side: THREE.DoubleSide,
    toneMapped: false,
  });

  // Flat z slabs are intentionally omitted from the streamed elevation seam.
  // One local receiver covers the current caster volume instead of fabricating
  // a mesh per absent slab. Elevated receivers depth-reject it under hills.
  receiverGeometry = new THREE.PlaneGeometry(1, 1);
  receiverMesh = new THREE.Mesh(receiverGeometry, shadowMaterial);
  receiverMesh.receiveShadow = true;
  receiverMesh.castShadow = false;
  receiverMesh.renderOrder = 2;
  receiverMesh.visible = false;
  scene.add(receiverMesh);

  diagnostics.lightCount = 1;
  diagnostics.shadowMapSize = SHADOW.mapSize;
}

function heightRange(tile) {
  let minH = Infinity, maxH = -Infinity;
  for (const h of tile.heightsM) {
    if (h < minH) minH = h;
    if (h > maxH) maxH = h;
  }
  return { minH, maxH };
}

function makeTerrainGeometry(tile) {
  const { segments, side, size, heightsM } = tile;
  const count = side * side;
  const positions = new Float32Array(count * 3);
  const hill = new Float32Array(count);
  const slope = new Float32Array(count);
  const stepPx = size / segments;
  const stepM = stepPx / W.PX_PER_M;

  const at = (col, row) => heightsM[
    Math.max(0, Math.min(segments, row)) * side
      + Math.max(0, Math.min(segments, col))
  ];
  for (let row = 0; row < side; row++) {
    for (let col = 0; col < side; col++) {
      const i = row * side + col;
      const o = i * 3;
      const left = Math.max(0, col - 1), right = Math.min(segments, col + 1);
      const up = Math.max(0, row - 1), down = Math.min(segments, row + 1);
      const dzdx = (at(right, row) - at(left, row)) / ((right - left || 1) * stepM);
      const dzdyDown = (at(col, down) - at(col, up)) / ((down - up || 1) * stepM);
      const grade = Math.hypot(dzdx, dzdyDown);
      // Three's +Y is world north (-Canvas Y). For z=f(x,yThree), the upward
      // surface normal is (-dz/dx, -dz/dyThree, 1) = (-dx, +dyDown, 1).
      const nx = -dzdx, ny = dzdyDown, nz = 1;
      const nn = Math.hypot(nx, ny, nz);
      const lambert = (
        nx * HILLSHADE_LIGHT.x + ny * HILLSHADE_LIGHT.y + nz * HILLSHADE_LIGHT.z
      ) / nn;

      positions[o] = col * stepPx;
      positions[o + 1] = -row * stepPx;
      positions[o + 2] = heightsM[i] * W.PX_PER_M;
      hill[i] = lambert - HILLSHADE_LIGHT.z;
      slope[i] = grade;
    }
  }

  const indices = new Uint16Array(segments * segments * 6);
  let o = 0;
  for (let row = 0; row < segments; row++) {
    for (let col = 0; col < segments; col++) {
      const a = row * side + col, b = a + 1;
      const c = a + side, d = c + 1;
      indices[o++] = a; indices[o++] = c; indices[o++] = b;
      indices[o++] = b; indices[o++] = c; indices[o++] = d;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("hill", new THREE.BufferAttribute(hill, 1));
  geometry.setAttribute("slope", new THREE.BufferAttribute(slope, 1));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  // Shadow normalBias is measured along this normal. Without the attribute
  // Three receives a zero normal and the 1024² map self-shadows every triangle
  // into a fine grid — both ugly and a false source of measured dark energy.
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function makeTerrainEntry(tile) {
  const { minH, maxH } = heightRange(tile);
  const relief = maxH - minH > MIN_TILE_RANGE_M;
  // D2 never allocates the harmless 0–4 m survey slabs it suppresses. D3 does:
  // a high plateau may have little local range while still casting a shadow.
  if (!relief && !castsTerrainShadows()) {
    return { geometry: null, hillMesh: null, shadowMesh: null,
      x: tile.x, y: tile.y, minH, maxH, triangles: 0 };
  }

  const geometry = makeTerrainGeometry(tile);
  let hillMesh = null;
  if (relief) {
    hillMesh = new THREE.Mesh(geometry, terrainMaterial);
    hillMesh.position.set(tile.x, -tile.y, 0);
    hillMesh.frustumCulled = true;
    hillMesh.renderOrder = 0;
    scene.add(hillMesh);
  }

  let shadowMesh = null;
  if (castsTerrainShadows()) {
    shadowMesh = new THREE.Mesh(geometry, shadowMaterial);
    shadowMesh.position.set(tile.x, -tile.y, 0);
    shadowMesh.frustumCulled = true;
    shadowMesh.receiveShadow = true;
    shadowMesh.castShadow = maxH > SHADOW.flatCasterMaxM;
    shadowMesh.renderOrder = 1;
    shadowMesh.visible = false;
    scene.add(shadowMesh);
  }
  return {
    geometry, hillMesh, shadowMesh,
    x: tile.x, y: tile.y, minH, maxH,
    triangles: tile.segments * tile.segments * 2,
  };
}

function syncTerrain(records) {
  const activeKeys = new Set(records.map((tile) => tile.key));
  for (const entry of terrainTiles.values()) {
    if (entry.hillMesh) entry.hillMesh.visible = false;
    if (entry.shadowMesh) entry.shadowMesh.visible = false;
  }
  for (const tile of records) {
    let entry = terrainTiles.get(tile.key);
    if (!entry) {
      entry = makeTerrainEntry(tile);
      terrainTiles.set(tile.key, entry);
    }
    if (entry.hillMesh) entry.hillMesh.visible = true;
  }

  // WORLD2D owns residency. Dispose one shared geometry only after its source
  // tile leaves that cache; the two draw meshes never duplicate its buffers.
  for (const [key, entry] of terrainTiles) {
    if (W.tileResident(entry.x + 1, entry.y + 1)) continue;
    if (entry.hillMesh) scene.remove(entry.hillMesh);
    if (entry.shadowMesh) scene.remove(entry.shadowMesh);
    entry.geometry?.dispose();
    terrainTiles.delete(key);
    activeKeys.delete(key);
  }

  diagnostics.residentTiles = records.length;
  diagnostics.meshTiles = [...terrainTiles.values()]
    .filter((entry) => entry.hillMesh).length;
  diagnostics.geometryTiles = [...terrainTiles.values()]
    .filter((entry) => entry.geometry).length;
  return activeKeys;
}

function canvasViewFromThree(bounds) {
  return { x0: bounds.x0, x1: bounds.x1, y0: -bounds.y1, y1: -bounds.y0 };
}

function shadowVolume(frame, direction, guard) {
  const receiver = {
    x0: frame.view.x0,
    x1: frame.view.x1,
    y0: -frame.view.y1,
    y1: -frame.view.y0,
  };
  const maxHpx = SHADOW.maxCasterHeightM * W.PX_PER_M;
  // A point p+h casts at p-d.xy/d.z*h. Casters capable of reaching the
  // receiver therefore live upstream at receiver+d.xy/d.z*h.
  const sx = direction.x / direction.z * maxHpx;
  const sy = direction.y / direction.z * maxHpx;
  return {
    receiver,
    caster: {
      x0: receiver.x0 + Math.min(0, sx) - guard,
      x1: receiver.x1 + Math.max(0, sx) + guard,
      y0: receiver.y0 + Math.min(0, sy) - guard,
      y1: receiver.y1 + Math.max(0, sy) + guard,
    },
    maxHpx,
  };
}

function recordsForShadow(frame, direction) {
  // THE MANIFEST PUBLISHES THE LATTICE, so the caster box is sized right on the
  // first frame. There used to be a fallback here for snapshots emitted before
  // that field existed: guess one whole tile, fetch, then re-fit from the first
  // resident slab. It cost two volume fits and a double query on every frame it
  // fired, and it fired for the whole session on an old manifest — the one case
  // it was meant to help. `elevSamplesPerTile` has shipped since 2026-08-20;
  // `tests/test_elevation.py` pins that emit writes it.
  const guard = W.TILE_PX / W.META.elevSamplesPerTile;
  const volume = shadowVolume(frame, direction, guard);
  const records = W.residentElevationTiles(canvasViewFromThree(volume.caster));
  return { records, volume, cellPx: guard };
}

function quantizeShadowDirection(direction) {
  // One ratio quantum displaces the highest permitted caster by <1 world px.
  // That is below the fitted map's measured texel while avoiding a new tuning
  // knob and preventing the ten-minute solar clock from dirtying every frame.
  const qxIndex = Math.round(direction.x / direction.z * SHADOW.mapSize);
  const qyIndex = Math.round(direction.y / direction.z * SHADOW.mapSize);
  const qx = qxIndex / SHADOW.mapSize;
  const qy = qyIndex / SHADOW.mapSize;
  const invLength = 1 / Math.hypot(qx, qy, 1);
  return {
    ...direction,
    x: qx * invLength,
    y: qy * invLength,
    z: invLength,
    shadowKey: `${qxIndex},${qyIndex}`,
  };
}

function alignShadowBounds(bounds, cellPx) {
  // Elevation samples are the natural stability grid: fitting outwards never
  // clips the exact receiver/caster AABB, and a car can move within a sample
  // cell without forcing a million-pixel depth repaint.
  return {
    x0: Math.floor(bounds.x0 / cellPx) * cellPx,
    x1: Math.ceil(bounds.x1 / cellPx) * cellPx,
    y0: Math.floor(bounds.y0 / cellPx) * cellPx,
    y1: Math.ceil(bounds.y1 / cellPx) * cellPx,
  };
}

function fitShadowCamera(direction, bounds, maxHpx, signature) {
  diagnostics.shadowMapUpdated = false;
  if (signature === shadowSignature) return;
  shadowSignature = signature;
  const center = new THREE.Vector3(
    (bounds.x0 + bounds.x1) / 2,
    (bounds.y0 + bounds.y1) / 2,
    maxHpx / 2,
  );
  const span = Math.hypot(bounds.x1 - bounds.x0, bounds.y1 - bounds.y0, maxHpx);
  const distance = Math.max(5000, span * 2 + 1000);
  shadowLight.target.position.copy(center);
  shadowLight.position.set(
    center.x + direction.x * distance,
    center.y + direction.y * distance,
    center.z + direction.z * distance,
  );
  shadowLight.target.updateMatrixWorld(true);
  shadowLight.updateMatrixWorld(true);
  shadowLight.shadow.updateMatrices(shadowLight);

  const shadowCamera = shadowLight.shadow.camera;
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minDistance = Infinity, maxDistance = -Infinity;
  const point = new THREE.Vector3();
  for (const x of [bounds.x0, bounds.x1]) {
    for (const y of [bounds.y0, bounds.y1]) {
      for (const z of [0, maxHpx]) {
        point.set(x, y, z).applyMatrix4(shadowCamera.matrixWorldInverse);
        minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
        minDistance = Math.min(minDistance, -point.z);
        maxDistance = Math.max(maxDistance, -point.z);
      }
    }
  }

  const rawSpanX = Math.max(1, maxX - minX);
  const rawSpanY = Math.max(1, maxY - minY);
  const guardX = rawSpanX / SHADOW.mapSize;
  const guardY = rawSpanY / SHADOW.mapSize;
  const halfX = rawSpanX / 2 + guardX;
  const halfY = rawSpanY / 2 + guardY;
  const texelX = halfX * 2 / SHADOW.mapSize;
  const texelY = halfY * 2 / SHADOW.mapSize;
  const centerX = Math.round(((minX + maxX) / 2) / texelX) * texelX;
  const centerY = Math.round(((minY + maxY) / 2) / texelY) * texelY;
  const depthGuard = Math.max(1, guardX, guardY);
  shadowCamera.left = centerX - halfX;
  shadowCamera.right = centerX + halfX;
  shadowCamera.bottom = centerY - halfY;
  shadowCamera.top = centerY + halfY;
  shadowCamera.near = Math.max(0.1, minDistance - depthGuard);
  shadowCamera.far = Math.max(shadowCamera.near + 1, maxDistance + depthGuard);
  shadowCamera.updateProjectionMatrix();
  shadowLight.shadow.updateMatrices(shadowLight);
  shadowLight.shadow.needsUpdate = true;
  diagnostics.shadowMapUpdates++;
  diagnostics.shadowMapUpdated = true;

  diagnostics.shadowTexelM = Math.max(texelX, texelY) / W.PX_PER_M;
  diagnostics.shadowFrustum = {
    widthPx: halfX * 2,
    heightPx: halfY * 2,
    near: shadowCamera.near,
    far: shadowCamera.far,
  };
}

function applyShadows(frame, direction, records, volume, cellPx, activeKeys) {
  diagnostics.shadowMapUpdated = false;
  const activeEntries = records.map((tile) => terrainTiles.get(tile.key)).filter(Boolean);
  const casterEntries = activeEntries.filter((entry) => (
    entry.shadowMesh && entry.maxH > SHADOW.flatCasterMaxM
  ));
  const featureEnabled = window.__perfFlags?.terrainShadows !== false;
  const active = featureEnabled && casterEntries.length > 0;

  for (const [key, entry] of terrainTiles) {
    if (!entry.shadowMesh) continue;
    entry.shadowMesh.visible = active && activeKeys.has(key);
    entry.shadowMesh.castShadow = active && entry.maxH > SHADOW.flatCasterMaxM;
  }
  renderer.shadowMap.enabled = active;
  shadowLight.visible = active;
  receiverMesh.visible = active;
  diagnostics.casterCount = casterEntries.length;
  diagnostics.shadowMeshTiles = active ? activeEntries.length : 0;
  diagnostics.receiverCount = active ? 1 : 0;
  diagnostics.shadowActive = active;
  diagnostics.geometryTriangles = activeEntries.reduce(
    (sum, entry) => sum + entry.triangles, 0,
  );
  diagnostics.sharedGeometry = activeEntries.every((entry) => (
    !entry.geometry
    || entry.shadowMesh?.geometry === entry.geometry
      && (!entry.hillMesh || entry.hillMesh.geometry === entry.geometry)
  ));
  diagnostics.residentMaxHeightM = activeEntries.reduce(
    (highest, entry) => Math.max(highest, entry.maxH), 0,
  );

  if (!active) return;
  if (diagnostics.residentMaxHeightM > SHADOW.maxCasterHeightM) {
    throw new RangeError(
      `terrain shadow caster ${diagnostics.residentMaxHeightM.toFixed(1)}m exceeds `
      + `${SHADOW.maxCasterHeightM}m contract`,
    );
  }
  shadowMaterial.opacity = SHADOW.opacity * direction.shadowAlpha;
  receiverMesh.position.set(
    (volume.caster.x0 + volume.caster.x1) / 2,
    (volume.caster.y0 + volume.caster.y1) / 2,
    -SHADOW.receiverBelowM * W.PX_PER_M,
  );
  receiverMesh.scale.set(
    volume.caster.x1 - volume.caster.x0,
    volume.caster.y1 - volume.caster.y0,
    1,
  );
  const fitBounds = alignShadowBounds(volume.caster, cellPx);
  const casterKey = casterEntries
    .map((entry) => `${entry.x},${entry.y},${entry.maxH}`)
    .sort().join(";");
  const signature = [
    direction.shadowKey,
    fitBounds.x0, fitBounds.x1, fitBounds.y0, fitBounds.y1,
    casterKey,
  ].join("|");
  fitShadowCamera(direction, fitBounds, volume.maxHpx, signature);
}

function applyCamera(frame) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const nextSize = `${frame.viewportWidth}x${frame.viewportHeight}@${dpr}`;
  if (nextSize !== sizeKey) {
    renderer.setPixelRatio(dpr);
    renderer.setSize(frame.viewportWidth, frame.viewportHeight, false);
    sizeKey = nextSize;
  }

  // LA INCLINACIÓN COMPENSADA — el suelo se queda en planta y sólo la altura
  // se levanta. Es lo que deja el volante intacto, y sale de una línea:
  //
  //   camera_y = Y·cos φ + Z·sin φ      una ortográfica inclinada
  //   ÷ cos φ  = Y      + Z·tan φ       …con el suelo devuelto a su sitio
  //
  // La división es exactamente encoger el alto del frustum por `cos φ`. El
  // suelo (Z = 0) mapea IGUAL que en planta, así que registra al píxel con el
  // Canvas de abajo; lo que tiene altura sube `tan φ`. Y como sólo se toca el
  // alto del encuadre, la PROFUNDIDAD sigue siendo la de la cámara de verdad:
  // las oclusiones son reales y no un orden de pintor.
  const phi = cameraLean();
  const k = Math.cos(phi);
  camera3.left = -frame.worldWidth / 2;
  camera3.right = frame.worldWidth / 2;
  camera3.top = frame.worldHeight / 2 * k;
  camera3.bottom = -frame.worldHeight / 2 * k;
  // El eje: la cámara se levanta hacia el pie de la pantalla y su «arriba»
  // gana componente Z, que es lo que hace subir lo alto. A φ = 0 esto colapsa
  // término a término en la posición cenital que D1-D3 probaron.
  const groundUpX = -Math.sin(frame.rotation), groundUpY = Math.cos(frame.rotation);
  const sinPhi = Math.sin(phi), distance = 10000;
  camera3.position.set(
    frame.x - groundUpX * distance * sinPhi,
    -frame.y - groundUpY * distance * sinPhi,
    distance * k,
  );
  camera3.up.set(groundUpX * k, groundUpY * k, sinPhi);
  camera3.lookAt(frame.x, -frame.y, 0);
  camera3.updateProjectionMatrix();
}

export function renderThree(_tSeconds, sharedCamera) {
  if (!renderer || !sharedCamera) return;
  const measured = mode !== "empty";
  const started = measured ? performance.now() : 0;
  applyCamera(sharedCamera);

  let visibleHillTriangles = 0;
  if (mode === "terrain") {
    const records = W.residentElevationTiles(sharedCamera.view);
    syncTerrain(records);
    visibleHillTriangles = records.reduce((sum, tile) => {
      const entry = terrainTiles.get(tile.key);
      return sum + (entry?.hillMesh ? entry.triangles : 0);
    }, 0);
  } else if (castsTerrainShadows()) {
    const direction = quantizeShadowDirection(sunDirection3());
    const { records, volume, cellPx } = recordsForShadow(sharedCamera, direction);
    const activeKeys = syncTerrain(records);
    visibleHillTriangles = records.reduce((sum, tile) => {
      if (tile.x > sharedCamera.view.x1 || tile.x + tile.size < sharedCamera.view.x0
          || tile.y > sharedCamera.view.y1 || tile.y + tile.size < sharedCamera.view.y0) return sum;
      const entry = terrainTiles.get(tile.key);
      return sum + (entry?.hillMesh ? entry.triangles : 0);
    }, 0);
    applyShadows(sharedCamera, direction, records, volume, cellPx, activeKeys);
  }

  renderer.render(scene, camera3);
  // La misma cámara para las dos capas: es un portador de matrices, así que
  // compartirla es lo que GARANTIZA que el terreno y el pueblo estén
  // registrados entre sí y con el Canvas de abajo.
  if (owns(LAYER.THREE, "buildings")) renderMassing(sharedCamera, camera3);
  diagnostics.triangles = renderer.info.render.triangles;
  if (measured) {
    const elapsed = performance.now() - started;
    diagnostics.cpuLastMs = elapsed;
    if (window.__prof) {
      window.__prof.terrain3d = (window.__prof.terrain3d || 0) + elapsed;
      window.__prof.terrain3dFrames = (window.__prof.terrain3dFrames || 0) + 1;
    }
    if (Array.isArray(window.__terrainRenderSamples)) window.__terrainRenderSamples.push(elapsed);
    const compositorEnabled = window.__perfFlags?.terrainComposite !== false;
    const frameHasPixels = castsTerrainShadows() && window.__perfFlags?.terrainShadows !== false
      ? diagnostics.shadowActive : visibleHillTriangles > 0;
    setTerrainFrameActive(frameHasPixels && compositorEnabled);
    setTerrainFrameReady(true);
  }
}
