"""EL SUELO DE UNA MANZANA, autorado.

Las 976 cuadras que el build deriva no tenían color propio. El interior de toda
manzana es UN relleno global por clima sobre 27 siluetas de isla
(`drawLandBase`), así que no había forma de decir "ésta es distinta" — y el
pintor que SÍ sabe hacerlo por instancia, `drawSurfaceStyleGround`, existe desde
que hay editor y llega vacío al mundo publicado, porque sólo lo llenaba un patch.

Este paso lo llena desde `content/world/blocks.json`.

**LA DIRECCIÓN ES UN PUNTO GEO, NUNCA UN ID.** El id de una cuadra es
`"cuadra_" + hash(contorno)` y su nombre es posicional (`Cuadra 1`, `Cuadra 2`):
un edificio nuevo, una acera más ancha o un reescalado cambian el contorno,
cambian el id, y el override autorado se despega **en silencio**. Un punto
adentro de la manzana sobrevive todo eso, y es además la regla que este mundo ya
tiene escrita para cualquier ancla.

Y por eso un ancla que no cae en ninguna cuadra **hace fallar el build**: el
modo de fallo que se está evitando es exactamente el que se lleva cosas sin
avisar.
"""
from ..enums import Surface
from ..logging import log, warn
from ..util.geometry import point_in_poly


def _rings(cuadra):
    poly = cuadra.get("poly") or []
    return [(poly[i], poly[i + 1]) for i in range(0, len(poly), 2)]


def apply_manzana_styles(ctx, styles, project_ll):
    """Resolve each authored style onto the cuadra that contains its anchor.

    Emits `ctx.surface_styles` records in EXACTLY the shape the editor patch
    already produces, so the two feed one painter rather than two.
    """
    if not styles:
        return
    hit = 0
    for style in styles:
        anchor = style.get("at")
        if not anchor or len(anchor) != 2:
            ctx.failures.append(f"manzana style with no geo anchor: {style}")
            continue
        x, y = project_ll(*anchor)
        found = next((c for c in ctx.cuadras if point_in_poly((x, y), _rings(c))), None)
        if found is None:
            # NOT a warning. A style whose anchor missed is a manzana the author
            # meant to change and did not, and the only sign would be that the
            # world looks the way it always did.
            ctx.failures.append(
                f"manzana style at {anchor} ({round(x)},{round(y)}) is inside no cuadra")
            continue
        acera = style.get("acera") or {}
        surface = style.get("surface")
        record = {
            "id": f"style_{found['id']}",
            "pts": list(found["poly"]),
            "surfaceClass": surface,
            "groundPreset": found.get("groundPreset", "cuadra"),
            "groundColor": style.get("ground"),
            "aceraColor": acera.get("color"),
            "aceraWidthCells": int(acera.get("cells") or 0),
            "collisionMode": "auto",
        }
        ctx.surface_styles.append(record)
        # A surface class is a GAMEPLAY change, not a paint one: it decides what
        # you can drive on. Stamping it here — before `verify` — is what lets the
        # drivable-network gate catch a manzana turned into a wall.
        if surface:
            cls = Surface[str(surface).upper()]
            for col, row in _cuadra_cells(ctx, found):
                ctx.raster.set(col, row, cls)
        hit += 1
        log("manzana", f"{style.get('name') or found['id']} styled"
            f"{' + surface ' + str(surface) if surface else ''}"
            f" (ground {style.get('ground') or '—'}, acera {acera.get('color') or '—'})")
    log("manzana", f"{hit}/{len(styles)} authored manzana styles resolved")


def _cuadra_cells(ctx, cuadra):
    """The raster cells inside a cuadra's traced ring."""
    ring = _rings(cuadra)
    cell = ctx.raster.cell
    x0 = min(p[0] for p in ring); x1 = max(p[0] for p in ring)
    y0 = min(p[1] for p in ring); y1 = max(p[1] for p in ring)
    for col in range(int(x0 // cell), int(x1 // cell) + 1):
        for row in range(int(y0 // cell), int(y1 // cell) + 1):
            px, py = (col + 0.5) * cell, (row + 0.5) * cell
            if point_in_poly((px, py), ring) and ctx.raster.in_bounds(col, row):
                yield col, row
