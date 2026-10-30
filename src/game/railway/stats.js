// LAS CUATRO BARRAS — motor, velocidad, freno y combustible.
//
// Es el modelo de Hill Climb y lo es a propósito: cuatro escaleras cortas, un
// coste creciente y UNA fórmula para todas. Lo que se guardó por escrito es
// cuál es la fórmula y dónde vive, porque la alternativa —cada mejora con su
// efecto a mano— es como se termina con una barra que no hace nada y nadie se
// da cuenta.
//
//   stat = base · (1 + perLevel · nivel)
//
// **PERO EL TOPE ES DE LA MÁQUINA, no de la escalera** (`caps` en el tren). Con
// un tope común las seis convergían a la misma máquina: subir las cuatro barras
// al cinco borraba el carácter de cada una y la última comprada era
// estrictamente mejor, que es la forma más cara de no tener elección. La María
// Cecilia llega al cinco en motor y en combustible y se queda en dos de
// velocidad —es una máquina de 1898—; la AEG es al revés. Lo que cambia es
// hasta dónde llega cada barra, nunca lo que cuesta un escalón.
//
// La escalera dice QUÉ campos toca (`affects`), así que agregar una mejora es
// una fila del registro y no una rama aquí. Un `affects` que nombre un campo
// que la máquina no tiene es deriva y `tests/test_railway_content.py` lo falla:
// una barra que sube y no mueve nada se ve exactamente igual que una barra
// equilibrada.
//
// `burnEfficiency` es el único campo que se lee DIVIDIENDO (más eficiencia =
// menos consumo), y por eso está en `affects` de la misma barra que el depósito:
// subir "combustible" tiene que valer tanto para quien gasta como para quien
// carga poco.

/** Las estadísticas de una máquina con sus mejoras aplicadas. */
export function trainStats(train, upgrades = {}, catalog) {
  const stats = { ...train.stats };
  for (const ladder of catalog.upgrades.ladders) {
    const level = clampLevel(upgrades[ladder.id], catalog, capOf(train, ladder, catalog));
    if (!level) continue;
    const factor = 1 + ladder.perLevel * level;
    for (const field of ladder.affects) {
      if (!Object.hasOwn(stats, field)) {
        throw new Error(`upgrade "${ladder.id}" affects unknown stat "${field}"`);
      }
      stats[field] *= factor;
    }
  }
  return stats;
}

/** Hasta dónde llega ESTA máquina en ESTA barra. Sin `caps` el tope es el de la
 *  escalera, así que un tren viejo del catálogo sigue funcionando igual. */
export function capOf(train, ladder, catalog) {
  const cap = train?.caps?.[ladder.id];
  const max = catalog.upgrades.maxLevel;
  if (!Number.isFinite(cap)) return max;
  return Math.max(0, Math.min(max, Math.floor(cap)));
}

/** El nivel guardado, acotado: un save viejo —o uno de cuando la máquina llegaba
 *  más arriba— no puede pedir un escalón que ya no existe. */
export function clampLevel(value, catalog, cap) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const top = Number.isFinite(cap) ? cap : catalog.upgrades.maxLevel;
  return Math.max(0, Math.min(top, Math.floor(n)));
}

/** Lo que cuesta el SIGUIENTE escalón de una barra, o null si está al tope. */
export function upgradeCost(ladder, level, catalog, cap) {
  const top = Number.isFinite(cap) ? cap : catalog.upgrades.maxLevel;
  const at = clampLevel(level, catalog, top);
  if (at >= top) return null;
  return ladder.costs[at];
}

/** La barra como la dibuja el taller: nivel, tope DE ESTA MÁQUINA, coste y el
 *  salto que paga. `max` es el tope de la escalera y `cap` el de la máquina, y
 *  los dos se dibujan: una barra con dos casillas apagadas al final dice «hasta
 *  acá llega ésta» mejor que cualquier rótulo. */
export function ladderView(ladder, upgrades, train, catalog) {
  const cap = capOf(train, ladder, catalog);
  const level = clampLevel(upgrades?.[ladder.id], catalog, cap);
  const cost = upgradeCost(ladder, level, catalog, cap);
  return {
    id: ladder.id,
    nameKey: ladder.nameKey,
    descKey: ladder.descKey,
    icon: ladder.icon,
    level,
    cap,
    max: catalog.upgrades.maxLevel,
    cost,
    fraction: cap ? level / cap : 0,
    gain: cost === null ? 0 : ladder.perLevel,
    affects: ladder.affects,
    sample: ladder.affects.map((field) => ({ field, value: train.stats[field] })),
  };
}

/** El convoy: la locomotora y sus coches, con la posición de cada uno medida
 *  hacia atrás desde el enganche delantero. El hueco entre topes es parte del
 *  largo del coche, así que no hay una constante de separación que se despegue
 *  del arte. */
export function buildConsist(train, art, gapM = 0.9) {
  let back = 0;
  return train.consist.map((car, i) => {
    const record = art.stock[car.art];
    if (!record) throw new Error(`unknown railway stock "${car.art}"`);
    const lengthM = car.lengthM ?? record.lengthM;
    const centre = back + lengthM / 2;
    back += lengthM + gapM;
    return { ...car, index: i, art: car.art, record, lengthM, offsetM: centre };
  });
}

/** El largo total del convoy — lo que la cámara tiene que dejar en cuadro. */
export function consistLengthM(consist) {
  if (!consist.length) return 0;
  const last = consist.at(-1);
  return last.offsetM + last.lengthM / 2;
}
