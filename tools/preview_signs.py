#!/usr/bin/env python3
"""LAS SEÑALES, ANTES DE PAGAR LA RECONSTRUCCIÓN.

    python3 tools/preview_signs.py [salida.json]   # -> logs/signs-preview.json
    python3 tools/preview_signs.py --emit          # …y lo escribe en manifest.signs

Corre la cadena DE VERDAD de las señales —`build_signs` (las de OSM, los ALTOs
derivados, VELOCIDAD, UNA VÍA, NO HAY PASO, PARADA, NO ESTACIONAR), luego
`settle_altos` (el ALTO a la esquina y su zebra) y `clear_the_roadway`— encima
del mundo YA EMITIDO. Las calles salen del OSM con la proyección del builder
(son las mismas que `extract_world` le pasa a `build_signs`); la superficie
terminada, de los tiles publicados, que SON el ráster que el build midió. Un
minuto en vez de cincuenta.

Las bancas del malecón no son de esta cadena —las siembra `decorate`—, así que
se conservan del manifest tal como están, en el mismo lugar de la lista que el
build les da.

`--emit` reescribe SÓLO `manifest.signs` (con el mismo validador que el build);
después va `python3 tools/world_snapshot.py save` en el mismo commit, como con
cualquier cambio intencional del mundo. Sin `--emit` no toca el mundo emitido, y
`tools/shot-signs-preview.mjs` toma el JSON, lo mete en `W.SIGNS` del juego
corriendo y saca las capturas.

La primera línea que imprime es la prueba de que es la misma cadena: con el
código del último build, el resultado tiene que ser IDÉNTICO al manifest.
"""
import json
import os
import sys
import time
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "tools"))

from churchill.world.config import OSM_PATH  # noqa: E402
from churchill.world.content import ROAD_LINK_DEFS  # noqa: E402
from churchill.world.dto import Manifest  # noqa: E402
from churchill.world.enums import SignKind  # noqa: E402
from churchill.world.pipeline.finish import clear_the_roadway, settle_altos  # noqa: E402
from churchill.world.repository.osm_file import OsmFileRepository  # noqa: E402
from churchill.world.service.osm import (  # noqa: E402
    barro_leon_continuation, extract_roads, propagate_barro_to_crossings,
)
from churchill.world.service.projection import planar_setup  # noqa: E402
from churchill.world.service.roadlink import link_roads  # noqa: E402
from churchill.world.service.signs import build_signs  # noqa: E402
from churchill.world.util.geometry import to_m  # noqa: E402
from preview_feria import WORLD, EmittedRaster  # noqa: E402


class Raster(EmittedRaster):
    def at_px(self, x, y):
        return self.at(*self.cell_of(x, y))

    def all_roads(self):
        """Las calles TERMINADAS (las que `clear_the_roadway` ve en el build), sin repetir."""
        m = self.manifest["meta"]
        return self.features("roads", 0, 0, m["W"] - 1, m["H"] - 1)


def extract_signs():
    """Lo que `extract_world` hace hasta `build_signs`, ni un paso más."""
    nodes, ways, named, relations, poi_nodes, sign_nodes = OsmFileRepository(OSM_PATH).load()
    sp, dims = planar_setup(ways)
    roads, _bridge = extract_roads(sp, ways, dims.w, dims.h)
    barro_leon_continuation(roads)
    propagate_barro_to_crossings(roads)
    link_roads(roads, lambda lat, lon: sp.project(to_m(lat, lon))[:2], ROAD_LINK_DEFS)
    return build_signs(sp, sign_nodes, roads, dims.w, dims.h), dims


def crowd(man):
    """Las parcelas que `settle_altos` mira para tender zebras, como las vio el build.

    `world:centro` corre DESPUÉS del build y quita del manifest las parcelas que el centro cívico
    reemplaza (`centro.json → drop.parcels`): el Parque Mora y Cañas y la manzana de la Catedral
    dejan de ser parcelas y pasan a ser `manifest.centro.places`. El build las vio como parque e
    iglesia; sin devolverlas, el preview perdería las zebras de la esquina de la Catedral."""
    out = list(man.get("parcels", []))
    for p in (man.get("centro") or {}).get("places", []):
        out.append({"use": "church" if p["id"] == "catedral" else "park",
                    "cx": (p["x0"] + p["x1"]) / 2, "cy": (p["y0"] + p["y1"]) / 2})
    return out


def js_numbers(o):
    """Como los deja `JSON.stringify`: el manifest lo reescriben en Node `world:punta`/`world:centro`,
    así que un 26.0 publicado es 26 y un -0.0 es 0. Escribirlos de otro modo sería ruido en el diff."""
    if isinstance(o, float):
        return int(o) if o.is_integer() else o
    if isinstance(o, dict):
        return {k: js_numbers(v) for k, v in o.items()}
    if isinstance(o, list):
        return [js_numbers(v) for v in o]
    return o


def main():
    emit = "--emit" in sys.argv
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    t0 = time.time()
    raster = Raster()
    man = raster.manifest
    signs, dims = extract_signs()
    if (dims.w, dims.h) != (man["meta"]["W"], man["meta"]["H"]):
        sys.exit(f"[signs-preview] el OSM proyecta {dims.w}x{dims.h} y el mundo emitido mide "
                 f"{man['meta']['W']}x{man['meta']['H']}: no es el mismo mundo, hay que reconstruir")
    # las bancas del malecón: las agrega `decorate` DESPUÉS de `build_signs`, en este orden
    signs += [s for s in man["signs"] if s["kind"] == SignKind.BANCA]
    signs = settle_altos(raster, signs, crowd(man))
    signs = clear_the_roadway(raster, signs, raster.all_roads())
    signs = js_numbers(json.loads(json.dumps(signs)))   # los SignKind como el build los serializa
    old = man["signs"]
    same = signs == old
    key = lambda s: json.dumps(s, sort_keys=True)
    ks, ko = {key(t) for t in signs}, {key(t) for t in old}
    gone = Counter(s["kind"] for s in old if key(s) not in ks)
    new = Counter(s["kind"] for s in signs if key(s) not in ko)
    print(f"[signs-preview] {len(signs)} señales en {time.time() - t0:.0f}s — "
          + ("IDÉNTICAS al manifest" if same else
             f"distintas del manifest: salen {dict(gone)}, entran {dict(new)}"))
    path = args[0] if args else os.path.join(ROOT, "logs", "signs-preview.json")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump({"signs": signs, "old": old}, open(path, "w"), ensure_ascii=False)
    print(f"[signs-preview] -> {os.path.relpath(path, ROOT)}")
    if emit and not same:
        man["signs"] = signs
        Manifest.model_validate(man)
        with open(os.path.join(WORLD, "manifest.json"), "w", encoding="utf-8") as f:
            json.dump(man, f, ensure_ascii=False, separators=(",", ":"))
        print("[signs-preview] manifest.signs escrito — falta `python3 tools/world_snapshot.py save`")
    return 0


if __name__ == "__main__":
    sys.exit(main())
