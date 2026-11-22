#!/usr/bin/env python3
"""LOS EDIFICIOS HISTÓRICOS QUE OSM NO TIENE, AL MUNDO SIN RECONSTRUIR.

    python3 tools/emit_historic.py            # preview: calcula y cuenta, escribe logs/historic-preview.json
    python3 tools/emit_historic.py --emit     # ESTO ES EL BUILD de estos lugares: escribe src/world2d

Lee `content/world/historic.json`. Cada lugar es un lote en la esquina de dos calles con nombre, y el
marco se mide contra el mundo de HOY, como `world:centro` mide sus bocas: la esquina es donde se cruzan
los bordes de adentro de las dos aceras (eje de cada calle + media calzada + la acera, el mismo cálculo
que sienta una lámpara o un ALTO), `u` corre a lo largo de `front` alejándose de `side` y `v` entra a la
cuadra. Por eso un lote en metros sigue cayendo en su esquina aunque el mundo se reescale.

Lo que escribe `--emit` (la física ve lo que se dibuja):

* la parcela `hist_<id>` en `manifest.parcels`, con el marco del lote (`ang`, `hw`, `hh`): la levanta
  `world-props.json → parcels.byId.hist_<id>.body`, su cuerpo de receta, que el cliente arma al cargar
  —reteñir el edificio cuesta una recarga, no una emisión—;
* las huellas de los tiles que caen en el lote y los árboles, palmas y postes de adentro; y, por su
  nombre, las huellas y los puntos de OSM de `dropNamed` que quedan al lado («Repuestos Acón» es la
  bomba: su huella caía al este, donde están unos techos que no son de ella). El lote no agrega un punto
  propio: la parcela lleva su píldora;
* lo manejable (`drive`) pasa a `boulevard` —transitable y lento, el piso de concreto de una bomba—, y
  cada `mouth` abre la acera hasta el asfalto, que es por donde se entra. Se comprueba que cada boca
  LLEGUE: del asfalto al piso sin una celda de pared en medio.

SE PUEDE REPETIR y da el mismo mundo: la parcela se reemplaza por su id y, antes de estampar, se
deshace lo que la corrida anterior dejó (la parcela guarda sus `drive` y `mouths` en píxeles). Corre
después de `world:centro` en `pnpm world:build`.

Sin `--emit` no toca el mundo: deja en `logs/historic-preview.json` las parcelas que saldrían, para
`tools/shot-historic-preview.mjs` (las mete en `W.PARCELS` del juego corriendo y saca las capturas).
"""
import base64
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from churchill.world.config import WORLD2D_DIR  # noqa: E402
from churchill.world.dto import Manifest  # noqa: E402
from churchill.world.enums import Surface  # noqa: E402

LAND, ROAD, ACERA, BOULEVARD = int(Surface.LAND), int(Surface.ROAD), int(Surface.ACERA), int(Surface.BOULEVARD)
PREFIX = "hist_"
#: Una calle con nombre se busca a lo sumo a esto del punto de anclaje (px): más lejos ya es otra calle.
STREET_REACH = 220
#: El marco es ortogonal y sigue a `front`; si `side` se aparta más que esto de su escuadra, se avisa.
SKEW_WARN_DEG = 6.0


def js_numbers(o):
    """Como los deja `JSON.stringify`, que es como `world:punta`/`world:centro` reescriben el manifest."""
    if isinstance(o, float):
        return int(o) if o.is_integer() else o
    if isinstance(o, dict):
        return {k: js_numbers(v) for k, v in o.items()}
    if isinstance(o, list):
        return [js_numbers(v) for v in o]
    return o


def inside(x, y, pts):
    hit, n = False, len(pts)
    j = n - 2
    for i in range(0, n, 2):
        xi, yi, xj, yj = pts[i], pts[i + 1], pts[j], pts[j + 1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            hit = not hit
        j = i
    return hit


def bbox(pts):
    xs, ys = pts[0::2], pts[1::2]
    return min(xs), min(ys), max(xs), max(ys)


class World:
    """El mundo emitido: el manifest y los tiles que se tocan, con su ráster decodificado."""

    def __init__(self):
        self.manifest = json.load(open(os.path.join(WORLD2D_DIR, "manifest.json"), encoding="utf-8"))
        meta = self.manifest["meta"]
        self.tile_px, self.cell, self.ppm = meta["tilePx"], meta["cell"], meta["pxPerMeter"]
        self.acera = meta["aceraPx"]
        self.geo = meta["geo"]
        self.tiles = {}

    def tile(self, key):
        if key not in self.tiles:
            path = os.path.join(WORLD2D_DIR, "tiles", f"{key}.json")
            if not os.path.exists(path):
                self.tiles[key] = None
            else:
                t = json.load(open(path, encoding="utf-8"))
                rle, g = base64.b64decode(t["rle"]), bytearray()
                for k in range(0, len(rle) - 1, 2):
                    g += bytes([rle[k + 1]]) * rle[k]
                self.tiles[key] = {"t": t, "g": g, "dirty": False}
        return self.tiles[key]

    def key(self, x, y):
        return f"{int(x // self.tile_px)}_{int(y // self.tile_px)}"

    def cell_ref(self, x, y):
        T = self.tile(self.key(x, y))
        if T is None:
            return None, None
        t = T["t"]
        c, r = int((x - t["x"]) // self.cell), int((y - t["y"]) // self.cell)
        if not (0 <= c < t["cols"] and 0 <= r < t["rows"]):
            return None, None
        return T, r * t["cols"] + c

    def cls(self, x, y):
        T, i = self.cell_ref(x, y)
        return None if T is None else T["g"][i]

    def put(self, x, y, v):
        T, i = self.cell_ref(x, y)
        if T is not None and T["g"][i] != v:
            T["g"][i] = v
            T["dirty"] = True
            return True
        return False

    def ll(self, lat, lon):
        return self.geo["ax"] * lon + self.geo["bx"], self.geo["ay"] * lat + self.geo["by"]

    def roads_near(self, x, y, reach):
        seen, out = set(), []
        for dc in (-1, 0, 1):
            for dr in (-1, 0, 1):
                T = self.tile(f"{int(x // self.tile_px) + dc}_{int(y // self.tile_px) + dr}")
                for rd in (T["t"].get("roads", []) if T else []):
                    k = json.dumps(rd["pts"])
                    if k not in seen:
                        seen.add(k)
                        out.append(rd)
        return out

    def cells_in(self, pts):
        """los centros de celda dentro de un polígono de mundo"""
        x0, y0, x1, y1 = bbox(pts)
        c = self.cell
        y = math.floor(y0 / c) * c + c / 2
        while y < y1:
            x = math.floor(x0 / c) * c + c / 2
            while x < x1:
                if inside(x, y, pts):
                    yield x, y
                x += c
            y += c


def nearest_on(world, name, x, y):
    """el tramo de la calle `name` más cercano a (x, y): pie, dirección unitaria y medio ancho"""
    best = None
    for rd in world.roads_near(x, y, STREET_REACH):
        if rd.get("name") != name:
            continue
        p = rd["pts"]
        for k in range(0, len(p) - 3, 2):
            ax, ay, bx, by = p[k], p[k + 1], p[k + 2], p[k + 3]
            L2 = (bx - ax) ** 2 + (by - ay) ** 2 or 1
            f = max(0.0, min(1.0, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / L2))
            qx, qy = ax + (bx - ax) * f, ay + (by - ay) * f
            d = math.hypot(x - qx, y - qy)
            if best is None or d < best[0]:
                L = math.sqrt(L2)
                best = (d, qx, qy, (bx - ax) / L, (by - ay) / L, rd["w"] / 2)
    if best is None or best[0] > STREET_REACH:
        raise SystemExit(f"[historic] la calle «{name}» no pasa a menos de {STREET_REACH} px del ancla ({x:.0f}, {y:.0f})")
    return best


def kerb_line(world, street, ax, ay):
    """el borde de adentro de la acera de `street` del lado del ancla: un punto y la dirección"""
    d, qx, qy, tx, ty, hw = street
    nx, ny = -ty, tx
    if (ax - qx) * nx + (ay - qy) * ny < 0:
        nx, ny = -nx, -ny
    off = hw + world.acera
    return (qx + nx * off, qy + ny * off), (tx, ty), (nx, ny)


def intersect(p, d, q, e):
    den = d[0] * e[1] - d[1] * e[0]
    if abs(den) < 1e-6:
        raise SystemExit("[historic] las dos calles del lote corren paralelas: no hay esquina")
    t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den
    return p[0] + d[0] * t, p[1] + d[1] * t


def frame_of(world, P):
    ax, ay = world.ll(*P["anchorLL"])
    front, side = nearest_on(world, P["front"], ax, ay), nearest_on(world, P["side"], ax, ay)
    pf, df, nf = kerb_line(world, front, ax, ay)
    ps, ds, ns = kerb_line(world, side, ax, ay)
    cx, cy = intersect(pf, df, ps, ds)
    # u: a lo largo de `front`, alejándose de `side` (hacia donde queda el ancla); v: hacia adentro de la cuadra
    ux, uy = df
    if (ax - cx) * ux + (ay - cy) * uy < 0:
        ux, uy = -ux, -uy
    vx, vy = -uy, ux
    if (ax - cx) * vx + (ay - cy) * vy < 0:
        raise SystemExit(f"[historic] {P['id']}: el ancla queda del otro lado de «{P['front']}»; `u` y `v` no forman un marco derecho")
    skew = math.degrees(math.acos(max(-1.0, min(1.0, abs(vx * ds[0] + vy * ds[1])))))
    # LA PENDIENTE DE `side` EN EL MARCO: cuántos metros se corre su acera a lo largo de `u` por cada metro
    # que entra en `v`. Calle 4 no llega a escuadra con la avenida (2,8°): un lote rectangular se le metía
    # 1,1 m en la acera al fondo. El lote —y el cuerpo, con la misma pendiente— siguen a las DOS calles
    sx, sy = ds if (ds[0] * vx + ds[1] * vy) > 0 else (-ds[0], -ds[1])
    slope = (sx * ux + sy * uy) / (sx * vx + sy * vy)
    return {"corner": (cx, cy), "u": (ux, uy), "v": (vx, vy), "ang": math.atan2(uy, ux), "skew": skew, "slope": slope}


def at(world, F, u, v):
    """metros del lote → píxeles de mundo: `u` a lo largo de `front`, corrido por la pendiente de `side`"""
    (cx, cy), (ux, uy), (vx, vy), k = F["corner"], F["u"], F["v"], world.ppm
    uu = u + F.get("useSlope", 0.0) * v
    return cx + (ux * uu + vx * v) * k, cy + (uy * uu + vy * v) * k


def lot_pts(world, F, u0, v0, u1, v1):
    out = []
    for u, v in ((u0, v0), (u1, v0), (u1, v1), (u0, v1)):
        x, y = at(world, F, u, v)
        out += [round(x, 1), round(y, 1)]
    return out


def mouth_pts(world, F, P, mo):
    """la boca: de la línea del lote, a través de la acera, hasta un poco dentro del asfalto"""
    reach = (world.acera + 2 * world.cell) / world.ppm          # metros hacia afuera del lote
    a, b = mo["fromM"], mo["toM"]
    if mo["street"] == P["front"]:
        return lot_pts(world, F, a, -reach, b, 0.5)
    if mo["street"] == P["side"]:
        return lot_pts(world, F, -reach, a, 0.5, b)
    raise SystemExit(f"[historic] {P['id']}/{mo['id']}: la boca nombra «{mo['street']}», que no es ni `front` ni `side`")


def main():
    emit = "--emit" in sys.argv
    doc = json.load(open(os.path.join(ROOT, "content", "world", "historic.json"), encoding="utf-8"))
    world = World()
    man = world.manifest
    old = {p["id"]: p for p in man["parcels"] if p["id"].startswith(PREFIX)}
    man["parcels"] = [p for p in man["parcels"] if not p["id"].startswith(PREFIX)]
    counts, parcels, log, drops = {}, [], [], {}
    margin = 4 * world.cell        # hasta dónde se busca una huella o un punto de `dropNamed` alrededor del lote
    bump = lambda k, n=1: counts.__setitem__(k, counts.get(k, 0) + n)

    for P in doc["places"]:
        pid = PREFIX + P["id"]
        if P.get("draft"):
            log.append(f"{pid}: BORRADOR — no se emite todavía")
            continue
        F = frame_of(world, P)
        # la pendiente que el registro declara es la que el cuerpo usa (su generador la lee de ahí): si el
        # mundo ya no la tiene, el cuerpo dejó de calzar con la calle, y eso se dice en vez de pintarse
        if abs(F["slope"] - P.get("sideSlope", 0.0)) > 0.006:
            raise SystemExit(f"[historic] {pid}: «{P['side']}» corre con pendiente {F['slope']:.4f} en el marco del lote y "
                             f"el registro dice {P.get('sideSlope', 0.0)}: actualizá `sideSlope` y regenerá el cuerpo")
        F["useSlope"] = P.get("sideSlope", 0.0)
        LU, LV = P["lotM"]
        lot = lot_pts(world, F, 0, 0, LU, LV)
        x0, y0, x1, y1 = bbox(lot)
        k = world.ppm
        cx, cy = at(world, F, LU / 2, LV / 2)

        # 1) lo que la corrida anterior estampó, de vuelta a como estaba
        prev = old.get(pid) or {}
        for poly in prev.get("drive", []):
            for (x, y) in world.cells_in(poly):
                if world.cls(x, y) == BOULEVARD and world.put(x, y, LAND):
                    bump("deshecho")
        for poly in prev.get("mouths", []):
            for (x, y) in world.cells_in(poly):
                if world.cls(x, y) == BOULEVARD and world.put(x, y, ACERA):
                    bump("deshecho")

        # 2) el lote tiene que ser cuadra: ni calzada ni agua adentro, ni encima de otra parcela
        bad = [(x, y) for (x, y) in world.cells_in(lot) if world.cls(x, y) not in (LAND, ACERA, BOULEVARD)]
        if bad:
            raise SystemExit(f"[historic] {pid}: {len(bad)} celdas del lote son calzada o agua (p. ej. {bad[0]}): "
                             f"`lotM` se sale de la cuadra")
        for q in man["parcels"]:
            if q.get("use") == "patio":
                continue          # el resto de una manzana: lo que queda debajo de un lote nuevo es de él
            if not (x0 < q["x1"] and x1 > q["x0"] and y0 < q["y1"] and y1 > q["y0"]):
                continue
            qp = q.get("poly") or [q["x0"], q["y0"], q["x1"], q["y0"], q["x1"], q["y1"], q["x0"], q["y1"]]
            # se pisan si un vértice de una cae adentro de la otra, o si un centro de celda cae en las dos
            hit = inside(q["cx"], q["cy"], lot) or any(inside(qp[i], qp[i + 1], lot) for i in range(0, len(qp), 2)) \
                or any(inside(lot[i], lot[i + 1], qp) for i in range(0, len(lot), 2)) \
                or any(inside(x, y, qp) for (x, y) in world.cells_in(lot))
            if hit:
                raise SystemExit(f"[historic] {pid}: el lote se monta sobre la parcela «{q['id']}»")

        # 3) lo manejable y las bocas
        drive = [lot_pts(world, F, *d["rectM"]) for d in P.get("drive", [])]
        for poly in drive:
            for (x, y) in world.cells_in(poly):
                c = world.cls(x, y)
                if c in (LAND, ACERA) and world.put(x, y, BOULEVARD):
                    bump(f"{P['id']}: piso manejable")
        mouths = []
        for mo in P.get("mouths", []):
            poly = mouth_pts(world, F, P, mo)
            mouths.append(poly)
            for (x, y) in world.cells_in(poly):
                if world.cls(x, y) in (LAND, ACERA) and world.put(x, y, BOULEVARD):
                    bump(f"{P['id']}: acera abierta")
            # tiene que LLEGAR: del medio de la boca, hacia la calle, todo transitable hasta el asfalto
            a, b = mo["fromM"], mo["toM"]
            m = (a + b) / 2
            if mo["street"] == P["front"]:
                sx, sy, dx, dy = m, 0.4, 0.0, -1.0
            else:
                sx, sy, dx, dy = 0.4, m, -1.0, 0.0
            reached = False
            for step in range(0, 60):
                x, y = at(world, F, sx + dx * step * 0.5, sy + dy * step * 0.5)
                c = world.cls(x, y)
                if c == ROAD:
                    reached = True
                    break
                if c not in (BOULEVARD,):
                    break
            if not reached:
                raise SystemExit(f"[historic] {pid}/{mo['id']}: la boca no llega al asfalto de «{mo['street']}»")

        # 4) lo que estaba parado en el lote: huellas, árboles, palmas y postes
        drop = set(P.get("dropNamed", []))
        drops[pid] = sorted(drop)
        for key in {world.key(x, y) for x in (x0 - margin, x1 + margin) for y in (y0 - margin, y1 + margin)} | {world.key(cx, cy)}:
            T = world.tile(key)
            if T is None:
                continue
            t = T["t"]
            n0 = len(t.get("buildings", []))
            keep = []
            for bld in t.get("buildings", []):
                bx = sum(bld["pts"][0::2]) / (len(bld["pts"]) / 2)
                by = sum(bld["pts"][1::2]) / (len(bld["pts"]) / 2)
                if inside(bx, by, lot) or (bld.get("name") in drop and x0 - margin < bx < x1 + margin and y0 - margin < by < y1 + margin):
                    bump(f"{P['id']}: huellas fuera" + (f" ({bld['name']})" if bld.get("name") else ""))
                    continue
                keep.append(bld)
            if len(keep) != n0:
                t["buildings"] = keep
                T["dirty"] = True
            for kind in ("trees", "palms", "lamps"):
                lst = t.get(kind) or []
                kept = [o for o in lst if not (inside(o["x"], o["y"], lot) and world.cls(o["x"], o["y"]) in (LAND, BOULEVARD))]
                if len(kept) != len(lst):
                    bump(f"{P['id']}: {kind} fuera", len(lst) - len(kept))
                    t[kind] = kept
                    T["dirty"] = True

        # 5) la parcela
        rec = {
            "id": pid, "name": P["name"], "use": P["use"],
            "poly": [round(v) for v in lot], "cx": round(cx), "cy": round(cy),
            "x0": math.floor(x0), "y0": math.floor(y0), "x1": math.ceil(x1), "y1": math.ceil(y1),
            "slot": [round(cx) - 10, round(cy) - 10, 20, 20],
            "ang": round(F["ang"], 4), "hw": round(LU * k / 2, 1), "hh": round(LV * k / 2, 1),
            "historic": P["id"], "slope": P.get("sideSlope", 0.0),
            "drive": [[round(v, 1) for v in poly] for poly in drive],
            "mouths": [[round(v, 1) for v in poly] for poly in mouths],
        }
        parcels.append(rec)
        man["parcels"].append(rec)
        # los puntos de OSM que nombran lo que ahora es el lote salen: los que caen adentro y los de
        # `dropNamed` a su lado (el de «Repuestos Acón» quedaba a 2 px de la esquina). No se agrega uno
        # propio: la parcela lleva su píldora, y un rótulo más sería el mismo nombre dos veces — la regla de
        # toda parcela que se dibuja con nombre
        n_poi = len(man.get("pois", []))
        man["pois"] = [p for p in man.get("pois", []) if not (
            inside(p["x"], p["y"], lot)
            or (p.get("name") in drop and x0 - margin < p["x"] < x1 + margin and y0 - margin < p["y"] < y1 + margin))]
        bump(f"{P['id']}: pois fuera", n_poi - len(man["pois"]))
        log.append(f"{pid}: esquina ({F['corner'][0]:.0f}, {F['corner'][1]:.0f}), {math.degrees(F['ang']):.1f}°, "
                   f"lote {LU} x {LV} m, «{P['side']}» a {F['skew']:.1f}° de su escuadra (pendiente {F['slope']:.4f})"
                   + ("  ← más que SKEW_WARN_DEG" if F["skew"] > SKEW_WARN_DEG else ""))

    man = js_numbers(man)
    Manifest.model_validate(man)
    for line in log:
        print(f"[historic] {line}")
    print(f"[historic] {', '.join(f'{k} {v}' for k, v in counts.items()) or 'nada que cambiar'}")
    if emit:
        with open(os.path.join(WORLD2D_DIR, "manifest.json"), "w", encoding="utf-8") as f:
            json.dump(man, f, ensure_ascii=False, separators=(",", ":"))
        n = 0
        for key, T in world.tiles.items():
            if not T or not T["dirty"]:
                continue
            g, o, i = T["g"], bytearray(), 0
            while i < len(g):
                v, run = g[i], 1
                while i + run < len(g) and g[i + run] == v and run < 255:
                    run += 1
                o += bytes([run, v])
                i += run
            T["t"]["rle"] = base64.b64encode(bytes(o)).decode()
            with open(os.path.join(WORLD2D_DIR, "tiles", f"{key}.json"), "w", encoding="utf-8") as f:
                json.dump(js_numbers(T["t"]), f, ensure_ascii=False, separators=(",", ":"))
            n += 1
        print(f"[historic-emit] manifest + {n} tiles escritos — falta `python3 tools/world_snapshot.py save`")
    else:
        os.makedirs(os.path.join(ROOT, "logs"), exist_ok=True)
        out = os.path.join(ROOT, "logs", "historic-preview.json")
        # `drops`: las huellas y los puntos con nombre que el lote se lleva aunque caigan afuera, para que
        # el preview muestre lo mismo que va a quedar
        json.dump({"parcels": parcels, "drops": drops, "margin": margin}, open(out, "w", encoding="utf-8"), ensure_ascii=False)
        print(f"[historic] preview -> {os.path.relpath(out, ROOT)} (el mundo no se tocó)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
