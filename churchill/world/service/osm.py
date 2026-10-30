"""OSM -> the world's own vocabulary.

One function per feature family: roads, rails, buildings, POIs, coastlines and
water/beach areas. Each projects the raw metre coordinates into world px,
simplifies, clips to the canvas, and drops what the map does not want.

What they DON'T do is decide where anything goes: a building comes out at its
true footprint here and is snapped onto the cuadrícula later, by the building
service. Keeping extraction honest is what makes the placement stages
debuggable — if a hotel is in the sea, you know which of the two steps to look
at.

`canvas_w`/`canvas_h` are passed in rather than read as globals because the
world's size is computed from these very ways: the projection has to be set up
before anything can be extracted.
"""
import math
from collections import defaultdict

from ..config import (
    ACERA_CELLS, BUILDING_SCALE, COCAL_END_X, CUAD, DP_BUILDING_PX, DP_COAST_PX,
    DP_ROAD_PX, DROP_ROAD_CLASSES, GRID_CELL, MIN_BUILDING_AREA_PX2,
    ROAD_CLASSES, SERVICE_MIN_PX, road_width_px,
)
from ..logging import log, warn
from ..repository.osm_file import poi_category
from ..util.geometry import (
    clip_poly_to_rect, clip_polyline_to_rect, dist, dp_simplify, poly_area,
    poly_centroid, to_m,
)
from .projection import project_way_pts
from .street import resample_centerline


def extract_roads(sp, ways, canvas_w, canvas_h):
    roads = []
    bridge_way = None
    for w in ways:
        hw = w["tags"].get("highway")
        name = (w["tags"].get("name") or "")
        lname = name.lower()
        is_bridge = "puente colgante mata" in lname
        if not is_bridge and hw not in ROAD_CLASSES:
            continue
        if len(w["pts"]) < 2:
            continue
        cls = "bridge" if is_bridge else hw
        # The beachfront avenue is a principal street driven at full speed —
        # both its western half (Paseo de los Turistas) and its continuation
        # past the kiosks (Paseo León Cortés Castro, OSM-tagged tertiary).
        if "paseo de los turistas" in lname or "paseo león cortés" in lname:
            cls = "primary"
        # Drop minor alleys/paths to unify small cuadras into bigger blocks.
        if cls in DROP_ROAD_CLASSES:
            continue
        pts, _ = project_way_pts(sp, w["pts"])
        # …and so is THE CALLE THAT JOINS THE TWO SPINES. The Paseo runs the
        # south shore and Avenida Centenario runs the middle of town, and they
        # meet nowhere: the Paseo ends at x 21434, the avenida at x 20960. The
        # one street that touches both is Calle 14 (x≈20957) — every trip from
        # the beachfront to the centro goes through it — and OSM has it tertiary,
        # which drew it as a side street and drove it like one. It is the town's
        # last paved calle before the barro of El Cocal, which is exactly why it
        # carries the traffic it does.
        #
        # BY GEOMETRY, NOT BY NAME ALONE. There are three Calle 14s on this map
        # — this one, one in Chacarita (x≈32800) and one in Barranca (x≈42500)
        # — so the test runs AFTER projection and keeps the promotion west of
        # the Angostura. A name match on its own would have made a principal
        # street of two residential calles in towns the player cannot reach.
        if lname.startswith("calle 14") and pts and max(p[0] for p in pts) < COCAL_END_X:
            cls = "primary"
        for piece in clip_polyline_to_rect(pts, canvas_w, canvas_h):
            piece = dp_simplify(piece, DP_ROAD_PX)
            length = sum(dist(piece[i], piece[i + 1]) for i in range(len(piece) - 1))
            if cls == "service" and length < SERVICE_MIN_PX:
                continue
            if length < 8:
                continue
            r = {"cls": cls, "w": road_width_px(cls),
                 "pts": [round(v) for p in piece for v in p]}
            if name:
                r["name"] = name
            # Avenida 2 del Ferrocarril (OSM-misspelled "Farrocarril"): the
            # avenue over the old rail bed — a raised packed-earth (barro)
            # street, rendered as dirt, not asphalt. "rrocarril" matches both
            # the misspelling and any real "…Ferrocarril" way.
            # both in-corridor Ferrocarril avenues (Av. 2 del Farrocarril, and
            # the one near the Cocal) — "rrocarril" catches the OSM misspelling
            if "rrocarril" in lname:
                r["barro"] = 1     # dirt surface
                r["elev"] = 1      # AND the raised avenue (car ramps onto it)
            # WHAT THE MAPPER SAID THE STREET IS MADE OF. It was read as a
            # colour and nothing else until barro and lastre became surface
            # classes of their own; now it decides what the raster stamps, so a
            # calle de barro is slower than the avenida beside it instead of
            # merely browner. Everything not named here is asphalt.
            surface = (w["tags"].get("surface") or "").lower()
            if surface in ("unpaved", "ground", "dirt", "earth", "mud", "soil"):
                r["barro"] = 1
            elif surface in ("gravel", "fine_gravel", "compacted", "pebblestone"):
                r["gravel"] = 1
            if w["tags"].get("ref"):
                r["ref"] = w["tags"]["ref"]
            if w["tags"].get("bridge") == "yes" and cls != "bridge":
                r["bridge"] = 1  # e.g. Río Barranca bridge at El Roble
            roads.append(r)
            if cls == "bridge":
                bridge_way = r
    return roads, bridge_way


def extract_rails(sp, ways, canvas_w, canvas_h):
    """The old Ferrocarril al Pacífico line (mostly OSM `disused:railway=rail`)
    that ran out the Puntarenas spit. Purely decorative — projected polylines
    emitted as `rails`, drawn as a sleeper-and-track bed by the renderer."""
    rails = []
    for w in ways:
        t = w["tags"]
        is_rail = (t.get("railway") == "rail" or t.get("disused:railway") == "rail"
                   or t.get("abandoned:railway") == "rail"
                   or "ferrocarril al pac" in (t.get("name") or "").lower())
        if not is_rail:
            continue
        if len(w["pts"]) < 2:
            continue
        pts, _ = project_way_pts(sp, w["pts"])
        for piece in clip_polyline_to_rect(pts, canvas_w, canvas_h):
            piece = dp_simplify(piece, DP_ROAD_PX)
            if len(piece) < 2:
                continue
            if sum(dist(piece[i], piece[i + 1]) for i in range(len(piece) - 1)) < 24:
                continue
            rails.append({"pts": [round(v) for p in piece for v in p]})
    return rails


def propagate_barro_to_crossings(roads, reach=1.2 * CUAD):
    """The dirt continues onto the calles that cross the elevated Ferrocarril
    avenue — flag them `barro` too (dirt surface) but NOT `elev`: they stay at
    ground level and ramp up to the raised avenue. Sourced only from the raised
    avenue (`elev`), with both lines densified so a crossing is never missed
    between sparse polyline vertices. Principal avenues are excluded, so their
    asphalt (and their intersections) stay paved."""
    ax0 = ay0 = 1e9; ax1 = ay1 = -1e9
    elev_pts = []
    for r in roads:
        if not r.get("elev"):
            continue
        for (_, x, y) in resample_centerline(r["pts"], 5):
            elev_pts.append((x, y))
            ax0, ay0, ax1, ay1 = min(ax0, x), min(ay0, y), max(ax1, x), max(ay1, y)
    if not elev_pts:
        return
    rr = reach * reach
    KEEP_ASPHALT = {"trunk", "trunk_link", "primary", "primary_link", "paseo", "bridge"}
    n = 0
    for r in roads:
        if r.get("barro") or r.get("cls") in KEEP_ASPHALT:
            continue
        xs, ys = r["pts"][0::2], r["pts"][1::2]
        if max(xs) < ax0 - reach or min(xs) > ax1 + reach or \
           max(ys) < ay0 - reach or min(ys) > ay1 + reach:
            continue
        cand = [(x, y) for (_, x, y) in resample_centerline(r["pts"], 6)]
        if any((px - ox) ** 2 + (py - oy) ** 2 < rr
               for px, py in cand for ox, oy in elev_pts):
            r["barro"] = 1
            n += 1
    log("barro", f"+{n} cross streets flagged barro (cross the Ferrocarril avenue)")


def barro_leon_continuation(roads):
    """Paseo León Cortés (principal) ends at the Parque Marino corner where the
    barro Ferrocarril avenue begins; its continuation east is that dirt route, not
    the principal. Anchored to the Ferrocarril avenue's west end (the `elev`
    roads) so it works in BOTH the corridor and the planar projection — flag the
    León piece(s) that run east past that handoff as a narrow barro street."""
    ferro_xs = [x for r in roads if r.get("elev") for x in r["pts"][0::2]]
    if not ferro_xs:
        return                                    # no Ferrocarril avenue in region
    handoff = min(ferro_xs)
    n = 0
    for r in roads:
        if "león cortés" not in (r.get("name") or "").lower():
            continue
        xs = r["pts"][0::2]
        if max(xs) > handoff + CUAD and min(xs) >= handoff - 3 * CUAD:
            r["barro"] = 1
            r["w"] = road_width_px("residential")
            r["cls"] = "residential"
            n += 1
    log("roads", f"León Cortés continuation past the Ferrocarril handoff -> barro: {n} piece(s)")


def extract_buildings(sp, ways, roads, canvas_w, canvas_h):
    # road segments for overlap testing (subdivided, with per-class half width)
    segs = []
    for r in roads:
        p = r["pts"]
        hw = max(4.0, r["w"] / 2 + ACERA_CELLS * GRID_CELL - 2)  # clear road + acera
        for i in range(0, len(p) - 2, 2):
            segs.append((p[i], p[i + 1], p[i + 2], p[i + 3], hw))
    cellmap = defaultdict(list)
    CS = 64
    for idx, s in enumerate(segs):
        x0, y0, x1, y1 = s[0], s[1], s[2], s[3]
        for cx in range(int(min(x0, x1)) // CS, int(max(x0, x1)) // CS + 1):
            for cy in range(int(min(y0, y1)) // CS, int(max(y0, y1)) // CS + 1):
                cellmap[(cx, cy)].append(idx)

    def nearest_road(px, py):
        """(gap, hw, qx, qy) for the road segment whose buffer the point is
        deepest inside / closest to; checks the 3x3 cell neighborhood."""
        best = None
        c0, r0 = int(px) // CS, int(py) // CS
        for dc in (-1, 0, 1):
            for dr in (-1, 0, 1):
                for idx in cellmap.get((c0 + dc, r0 + dr), ()):
                    x0, y0, x1, y1, hw = segs[idx]
                    dx, dy = x1 - x0, y1 - y0
                    L2 = dx * dx + dy * dy
                    t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((px - x0) * dx + (py - y0) * dy) / L2))
                    qx, qy = x0 + t * dx, y0 + t * dy
                    d = math.hypot(px - qx, py - qy)
                    if best is None or d - hw < best[0]:
                        best = (d - hw, hw, qx, qy, d)
        return best

    def near_road(px, py):
        b = nearest_road(px, py)
        return b is not None and b[0] <= 0

    out = []
    dropped_road, dropped_small, dropped_road_named = 0, 0, 0
    for w in ways:
        if "building" not in w["tags"] or len(w["pts"]) < 4:
            continue
        pts, _ = project_way_pts(sp, w["pts"])
        if dist(pts[0], pts[-1]) < 1e-6:
            pts = pts[:-1]
        pts = clip_poly_to_rect(pts, canvas_w, canvas_h)
        if len(pts) < 3:
            continue
        pts = dp_simplify(pts + [pts[0]], DP_BUILDING_PX)[:-1]
        if len(pts) < 3 or abs(poly_area(pts)) < MIN_BUILDING_AREA_PX2:
            dropped_small += 1
            continue
        # Buildings line the streets: push the footprint out of any widened
        # road corridor (like a house set back from the curb), then shrink
        # step-by-step until it fits its block.
        cx, cy = poly_centroid(pts)
        ok = True
        for _ in range(4):
            b = nearest_road(cx, cy)
            if b is None or b[0] > 2:
                break
            gap, hw, qx, qy, d = b
            if d < 1e-6:
                ok = False
                break
            ux, uy = (cx - qx) / d, (cy - qy) / d
            shift = (hw + 4 - d)
            cx, cy = cx + ux * shift, cy + uy * shift
            pts = [(px + ux * shift, py + uy * shift) for px, py in pts]
        # A NAMED footprint is never dropped here. This is the EARLIEST of the
        # three places one could die, and the most invisible: it happens before
        # `name` is even assigned below, before the landmark join, and before
        # the push/reseat chain — so nothing downstream could report it, and
        # nothing downstream could rescue it either. An anonymous shed on the
        # roadway is noise and still goes; a named place is the reason this
        # extractor keeps outlines at all, so it is handed on and the chain in
        # `build_stage` decides where it stands (or keeps it as a `ghost`).
        if not ok or near_road(cx, cy):
            if not w["tags"].get("name"):
                dropped_road += 1
                continue
            dropped_road_named += 1
        # Raw record only: the footprint is snapped to whole cuadrículas later
        # (snap_osm_buildings), once the cuadra blocks are known. Target size
        # comes from the pushed-out footprint's AABB × BUILDING_SCALE. `pts` is
        # kept so a site that must read as ITSELF (the Parque Marino aquarium)
        # can be emitted at its true shape instead of snapped to the lattice.
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        rec = {"cx": cx, "cy": cy,
               "w": (max(xs) - min(xs)) * BUILDING_SCALE,
               "h": (max(ys) - min(ys)) * BUILDING_SCALE,
               "id": int(w["id"]), "pts": pts}
        # Source identity survives placement. Most buildings only need their
        # outline, but feature complexes such as Parque Marino must distinguish
        # a train-station footprint from an anonymous shed and keep any future
        # OSM proper name without relying on unstable enumeration order.
        rec["building"] = w["tags"].get("building")
        for source_key in ("name", "operator", "brand"):
            if w["tags"].get(source_key):
                rec[f"osm_{source_key}"] = w["tags"][source_key]
        # A building that IS a named place (Hotel Tioga, Súper Salinas, the
        # church…) keeps its real outline — snapping it to the cuadrícula turns
        # a landmark you can recognise into one more anonymous pastel box.
        # THE NAME IS ENOUGH. This used to also require a POI category, which
        # quietly split the mapper's named buildings in two: a `tourism=hotel`
        # kept its outline while a plain `building=yes` carrying the same kind
        # of name — a taller, a bar, an antigua fábrica — went to the snapper as
        # an anonymous box and could be deleted outright. OSM has 635 named
        # buildings in this window and only a fraction carry a category; a name
        # a surveyor bothered to write down IS the signal.
        if w["tags"].get("name"):
            rec["name"] = w["tags"]["name"]
            cat = poi_category(w["tags"])
            if cat:
                rec["cat"] = f"{cat[0]}={cat[1]}"
        out.append(rec)
    log("buildings", f"{len(out)} raw OSM footprints, dropped {dropped_road} on-road, "
        f"{dropped_small} tiny"
        + (f"; {dropped_road_named} NAMED ones on-road were kept for the push chain"
           if dropped_road_named else ""))
    return out


def extract_pois(sp, ways, poi_nodes, canvas_w, canvas_h):
    """Every NAMED real-world POI (business, church, school, park…) projected to
    world px: {x, y, name, cat}. `cat` is "key=value" from POI_KEYS, so the
    renderer can style or filter by kind. Standalone OSM nodes use their own
    position; POI ways (a shop mapped as its building outline) use the polygon
    centroid. Deduped by (name, 20px cell) — OSM often carries both a building
    way and a point node for the same place."""
    out, seen = [], set()

    def add(name, tags, x, y):
        if not (0 <= x < canvas_w and 0 <= y < canvas_h):
            return
        key = (name.lower(), int(x // CUAD), int(y // CUAD))
        if key in seen:
            return
        seen.add(key)
        k, v = poi_category(tags)
        out.append({"x": round(x), "y": round(y), "name": name, "cat": f"{k}={v}"})

    for (ll, tags) in poi_nodes:
        x, y, _, _ = sp.project(to_m(*ll))
        add(tags["name"], tags, x, y)
    for w in ways:
        tags = w["tags"]
        name = tags.get("name")
        if not name or not poi_category(tags) or len(w["pts"]) < 3:
            continue
        pts, _ = project_way_pts(sp, w["pts"])
        if not pts:
            continue
        cx = sum(p[0] for p in pts) / len(pts)
        cy = sum(p[1] for p in pts) / len(pts)
        add(name, tags, cx, cy)
    by_cat = defaultdict(int)
    for p in out:
        by_cat[p["cat"].split("=")[0]] += 1
    log("pois", f"{len(out)} named real-world POIs: {dict(sorted(by_cat.items()))}")
    return out


#: A jardín de niños or a CEN-CINAI is sometimes tagged `amenity=school` like
#: any other MEP centre (Jardín de Niños Riojalandia is), and it is not one: it
#: is a handful of aulas around a patio, not an escuela. The NAME is what the
#: place is called on its own wall, so it decides.
KINDER_NAMES = ("jardín de niños", "jardin de ninos", "cen-cinai", "cen cinai")
#: OSM area families that become PARCELS — the ground a place occupies, as
#: opposed to a building standing on it. Ordered: the first predicate that
#: matches wins, so a church mapped as `building=church` is worship, not a
#: nameless footprint, and a school with a pitch inside it stays a school.
SITE_KINDS = (
    ("fuel",    lambda t: t.get("amenity") == "fuel"),
    # A MARKETPLACE IS GROUND, not a building with a name on it. The Mercado
    # Municipal is `amenity=marketplace` + `building=yes`, and while it was only
    # the latter it went down the named-building path — where 61 % of its real
    # outline sits on the game's inflated roadway, so it was pushed, failed,
    # snapped, failed, and dropped. It has never been drawn. As a SITE it keeps
    # its own mapped contour, exactly like a church or a cancha.
    ("market",  lambda t: t.get("amenity") == "marketplace"),
    ("worship", lambda t: t.get("amenity") == "place_of_worship"
                or t.get("building") in ("church", "chapel", "cathedral")),
    ("kinder",  lambda t: t.get("amenity") in ("kindergarten", "childcare")
                or (t.get("amenity") == "school"
                    and any(k in t.get("name", "").lower() for k in KINDER_NAMES))),
    ("school",  lambda t: t.get("amenity") == "school"),
    ("campus",  lambda t: t.get("amenity") in ("college", "university")),
    ("pitch",   lambda t: t.get("leisure") in ("pitch", "sports_centre", "recreation_ground")
                or t.get("landuse") == "recreation_ground"),
    ("park",    lambda t: t.get("leisure") in ("park", "garden", "common")
                or t.get("landuse") == "village_green"),
)
#: a site smaller than this is a mapping artifact, not a place you can stand in
MIN_SITE_AREA_PX2 = 400


def site_kind(tags):
    """The site family `tags` belongs to, or None. First match wins."""
    for kind, pred in SITE_KINDS:
        if pred(tags):
            return kind
    return None


def extract_sites(sp, ways, canvas_w, canvas_h):
    """Parks, sports plazas, schools, kindergartens, campuses and churches as
    projected GROUND polygons: {id, kind, name, pts}.

    Sibling of `extract_buildings` and one level below it in ambition: this does
    not decide where anything goes either. It hands the placement stage the real
    OSM outline of each site, and `FieldService.place_osm_sites` intersects that
    with the cuadra the surface pass actually produced.

    Only CLOSED ways qualify — an open way is a fence or a path, not an area —
    and the result is sorted by OSM id so the emit order never depends on
    dict/file ordering. Determinism is the contract.
    """
    out = []
    dropped_open, dropped_small = 0, 0
    for w in ways:
        kind = site_kind(w["tags"])
        if kind is None or len(w["pts"]) < 4:
            continue
        if w["nds"][0] != w["nds"][-1]:
            dropped_open += 1
            continue
        pts, _ = project_way_pts(sp, w["pts"])
        if dist(pts[0], pts[-1]) < 1e-6:
            pts = pts[:-1]
        pts = clip_poly_to_rect(pts, canvas_w, canvas_h)
        if len(pts) < 3:
            continue
        pts = dp_simplify(pts + [pts[0]], DP_BUILDING_PX)[:-1]
        if len(pts) < 3 or abs(poly_area(pts)) < MIN_SITE_AREA_PX2:
            dropped_small += 1
            continue
        # `sport` decides how a cancha is DRAWN — a basketball court is not a
        # small football pitch, and 21 of them were being painted with a halfway
        # line and a centre circle. Normalised to the two the renderer knows.
        sport = (w["tags"].get("sport") or "").split(";")[0].split(",")[0].strip()
        out.append({"id": int(w["id"]), "kind": kind,
                    "name": w["tags"].get("name"), "pts": pts,
                    "sport": sport or None,
                    "cathedral": w["tags"].get("building") == "cathedral"})
    out.sort(key=lambda s: s["id"])
    by_kind = defaultdict(int)
    for s in out:
        by_kind[s["kind"]] += 1
    log("sites", f"{len(out)} OSM ground sites: {dict(sorted(by_kind.items()))} "
        f"(dropped {dropped_open} open ways, {dropped_small} tiny)")
    return out


def extract_coastlines(sp, ways):
    """Stitch natural=coastline ways by endpoint node id, project chains."""
    coast = [w for w in ways if w["tags"].get("natural") == "coastline" and len(w["nds"]) >= 2]
    by_first = defaultdict(list)
    for w in coast:
        by_first[w["nds"][0]].append(w)
    used, chains = set(), []
    for w in coast:
        if w["id"] in used:
            continue
        used.add(w["id"])
        nds = list(w["nds"])
        while True:
            nxt = next((c for c in by_first.get(nds[-1], []) if c["id"] not in used), None)
            if nxt is None:
                break
            used.add(nxt["id"])
            nds.extend(nxt["nds"][1:])
        chains.append(nds)
    return chains  # node-id chains; resolved by caller


def extract_areas(sp, ways, rels, canvas_w, canvas_h):
    beaches, waters = [], []
    ways_by_id = {w["id"]: w for w in ways}
    def add_poly(target, pts_m):
        if len(pts_m) < 3:
            return
        pts, _ = project_way_pts(sp, pts_m)
        pts = clip_poly_to_rect(pts, canvas_w, canvas_h)
        if len(pts) < 3:
            return
        pts = dp_simplify(pts + [pts[0]], DP_COAST_PX)[:-1]
        if len(pts) >= 3:
            target.append([round(v) for p in pts for v in p])

    for w in ways:
        nat = w["tags"].get("natural")
        if nat == "beach":
            add_poly(beaches, w["pts"])
        elif nat == "water" or (nat == "wetland" and w["tags"].get("wetland") == "mangrove"):
            add_poly(waters, w["pts"])
        elif nat == "wetland" and "estero mata" in (w["tags"].get("name") or "").lower():
            add_poly(waters, w["pts"])
    for rel in rels:
        for ref, role in rel["members"]:
            if role != "outer" or ref not in ways_by_id:
                continue
            w = ways_by_id[ref]
            if len(w["pts"]) >= 3:
                if rel["tags"].get("natural") == "beach":
                    add_poly(beaches, w["pts"])
                else:
                    add_poly(waters, w["pts"])
    return beaches, waters

# ------------------------------------------------------------ raster grid ---
