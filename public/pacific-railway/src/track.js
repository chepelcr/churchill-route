export const KIT_VERSION = '1.0.0';
export const PIECES = {
  straight: { name: 'Recta', category: 'flat', dy: 0, start: 0, end: 0, control: [] },
  'flat-to-up': { name: 'Entrada a subida', category: 'curve', dy: -64, start: 0, end: -0.5, control: [[128, 0]] },
  'slope-up': { name: 'Diagonal de subida', category: 'slope', dy: -128, start: -0.5, end: -0.5, control: [] },
  'up-to-flat': { name: 'Salida de subida', category: 'curve', dy: -64, start: -0.5, end: 0, control: [[128, -64]] },
  'flat-to-down': { name: 'Entrada a bajada', category: 'curve', dy: 64, start: 0, end: 0.5, control: [[128, 0]] },
  'slope-down': { name: 'Diagonal de bajada', category: 'slope', dy: 128, start: 0.5, end: 0.5, control: [] },
  'down-to-flat': { name: 'Salida de bajada', category: 'curve', dy: 64, start: 0.5, end: 0, control: [[128, 64]] },
  crest: { name: 'Cima', category: 'curve', dy: 0, start: -0.5, end: 0.5, control: [[128, -64]] },
  valley: { name: 'Valle', category: 'curve', dy: 0, start: 0.5, end: -0.5, control: [[128, 64]] },
  station: { name: 'Estación', category: 'special', dy: 0, start: 0, end: 0, control: [] },
  brake: { name: 'Frenos', category: 'special', dy: 0, start: 0, end: 0, control: [] },
  'chain-up': { name: 'Subida con cadena', category: 'special', dy: -128, start: -0.5, end: -0.5, control: [] },
  'loop-small': { name: 'Loop pequeño', category: 'loop', dy: 0, start: 0, end: 0, control: [], diameter: 256, advance: 384 },
  'loop-medium': { name: 'Loop mediano', category: 'loop', dy: 0, start: 0, end: 0, control: [], diameter: 512, advance: 640 },
  'loop-large': { name: 'Loop grande', category: 'loop', dy: 0, start: 0, end: 0, control: [], diameter: 768, advance: 896 }
};

export function pointAt(piece, t) {
  const p = typeof piece === 'string' ? PIECES[piece] : piece;
  if (p.diameter) {
    const radius=p.diameter/2, lead=radius+64, arc=2*Math.PI*radius, total=lead*2+arc, d=t*total;
    if(d<=lead)return {x:d,y:0,slope:0,angle:0};
    if(d>=lead+arc)return {x:lead+(d-lead-arc),y:0,slope:0,angle:-2*Math.PI};
    const turn=(d-lead)/radius,theta=Math.PI/2-turn;
    return {x:lead+radius*Math.cos(theta),y:-radius+radius*Math.sin(theta),slope:Math.tan(-turn),angle:-turn};
  }
  if (!p.control.length) return { x: 256 * t, y: p.dy * t, slope: p.dy / 256 };
  const [cx, cy] = p.control[0], u = 1 - t;
  return { x: 2 * u * t * cx + t * t * 256, y: 2 * u * t * cy + t * t * p.dy,
    slope: (2 * u * cy + 2 * t * (p.dy - cy)) / (2 * u * cx + 2 * t * (256 - cx)) };
}

export function pathData(id) {
  const p = PIECES[id];
  if(p.diameter){const r=p.diameter/2,c=r+64;return `M0 0 H${c} A${r} ${r} 0 1 0 ${c} ${-p.diameter} A${r} ${r} 0 1 0 ${c} 0 H${p.advance}`;}
  return p.control.length ? `M0 0 Q${p.control[0].join(' ')} 256 ${p.dy}` : `M0 0 L256 ${p.dy}`;
}

export function validateLevel(level) {
  const errors = [];
  if (!level || typeof level !== 'object' || Array.isArray(level)) return ['El nivel debe ser un objeto JSON.'];
  const allowed = ['$schema', 'kitVersion', 'id', 'name', 'description', 'start', 'background', 'train', 'pieces'];
  for (const key of Object.keys(level)) if (!allowed.includes(key)) errors.push(`Propiedad desconocida: ${key}.`);
  if (level.kitVersion !== KIT_VERSION) errors.push(`kitVersion debe ser ${KIT_VERSION}.`);
  if (typeof level.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(level.id)) errors.push('id debe usar minúsculas, números y guiones (1–64 caracteres).');
  if (typeof level.name !== 'string' || !level.name.trim() || level.name.length > 100) errors.push('name debe tener de 1 a 100 caracteres.');
  if (level.description !== undefined && (typeof level.description !== 'string' || level.description.length > 1000)) errors.push('description debe ser texto de hasta 1000 caracteres.');
  if (level.$schema !== undefined && typeof level.$schema !== 'string') errors.push('$schema debe ser texto.');
  if (!level.start || Object.keys(level.start).some(k => !['x','y'].includes(k)) || !['x','y'].every(k => Number.isFinite(level.start[k]) && Math.abs(level.start[k]) <= 100000)) errors.push('start requiere x e y finitos entre -100000 y 100000.');
  if (level.background !== 'alpine-loop') errors.push('background debe ser alpine-loop.');
  if (!level.train || Object.keys(level.train).some(k => !['cars','spacing','skin'].includes(k)) || !Number.isInteger(level.train.cars) || level.train.cars < 3 || level.train.cars > 8 || !Number.isFinite(level.train.spacing) || level.train.spacing < 160 || level.train.spacing > 220 || (level.train.skin!==undefined&&!['classic','mint','midnight'].includes(level.train.skin))) errors.push('train requiere cars entre 3 y 8, spacing entre 160 y 220 y skin classic, mint o midnight.');
  if (!Array.isArray(level.pieces) || level.pieces.length < 3 || level.pieces.length > 400) { errors.push('pieces debe contener entre 3 y 400 piezas.'); return errors; }
  let slope = 0;
  level.pieces.forEach((id, i) => {
    const p = typeof id === 'string' && Object.hasOwn(PIECES,id) ? PIECES[id] : undefined;
    if (!p) { errors.push(`Pieza ${i + 1}: ID desconocido ${JSON.stringify(id)}.`); return; }
    if (p.start !== slope) errors.push(`Pieza ${i + 1} (${id}): entrada ${p.start} incompatible con salida ${slope}.`);
    slope = p.end;
  });
  if (level.pieces[0] !== 'station') errors.push('La primera pieza debe ser station.');
  if (level.pieces.at(-1) !== 'brake') errors.push('La última pieza debe ser brake.');
  if (slope !== 0) errors.push('El recorrido debe terminar horizontal.');
  if (level.train && level.pieces.reduce((n,id)=>n+(PIECES[id]?.advance||256),0) < (level.train.cars - 1) * level.train.spacing + 180) errors.push('El recorrido es demasiado corto para este tren.');
  return errors;
}

export function buildTrack(level) {
  let x = level.start.x, y = level.start.y, distance = 0;
  const samples = [], segments = [];
  for (const [index, id] of level.pieces.entries()) {
    const p = PIECES[id];
    if (!p) throw new Error(`Pieza desconocida: ${id}`);
    segments.push({ id, x, y, index, advance:p.advance||256 });
    const steps=p.diameter?256:64;
    for (let i = index ? 1 : 0; i <= steps; i++) {
      const pt = pointAt(p, i / steps), last = samples.at(-1), px = x + pt.x, py = y + pt.y;
      if (last) distance += Math.hypot(px - last.x, py - last.y);
      samples.push({ x: px, y: py, angle: pt.angle??Math.atan(pt.slope), distance });
    }
    x += p.advance||256; y += p.dy;
  }
  return { segments, samples, length: distance, end: { x, y }, minY: samples.reduce((n,p)=>Math.min(n,p.y),Infinity), maxY: samples.reduce((n,p)=>Math.max(n,p.y),-Infinity) };
}

export function atDistance(track, distance) {
  const points = track.samples, d = Math.max(0, Math.min(distance, track.length));
  let lo = 0, hi = points.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (points[m].distance < d) lo = m + 1; else hi = m; }
  const b = points[lo], a = points[Math.max(0, lo - 1)], t = (d - a.distance) / (b.distance - a.distance || 1);
  const angleDelta=Math.atan2(Math.sin(b.angle-a.angle),Math.cos(b.angle-a.angle));
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle: a.angle + angleDelta * t };
}
