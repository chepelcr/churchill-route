"""Geo -> world px.

The projection is PLANAR and exactly linear: world px = (metres − origin) ·
px_per_m, with metres coming from the local equirectangular `to_m()`. That
linearity is worth protecting — it is what lets the manifest ship a four-number
geo→world affine (`meta.geo`) so a CLIENT can place remote content from real
lat/lon without any of this code.

The `project()/project_m()` shape (returning a 4-tuple with a hint and a
distance) is inherited from the corridor-unroll projection this replaced, where
projecting a point meant searching along a spine. Here nothing needs a hint, so
the extra slots are constant — kept because every caller passes and unpacks them.
"""
import math

from ..config import CUAD, GRID_CELL, PLANAR_BBOX, PLANAR_PX_PER_M
from ..context import WorldDims
from ..logging import log
from ..util.geometry import to_m


class PlanarProjection:
    """`p_m` is (mx, my) metres from to_m(); world px = (m − min) · px_per_m."""

    def __init__(self, min_mx, min_my, px_per_m):
        self.min_mx, self.min_my = min_mx, min_my
        self.px_per_m = px_per_m
        self.total = 0.0          # legacy: the corridor's spine arclength

    def to_px(self, mx, my):
        return ((mx - self.min_mx) * self.px_per_m,
                (my - self.min_my) * self.px_per_m)

    def project_m(self, p_m, hint=None, window=80):
        return p_m[0], p_m[1], 0

    def project(self, p_m, hint=None):
        x, y = self.to_px(p_m[0], p_m[1])
        return x, y, 0, 0.0


def project_way_pts(sp, pts):
    """A whole way from metres to px, plus the largest offset seen."""
    out, hint, dmax = [], None, 0.0
    for p in pts:
        x, y, hint, d = sp.project(p, hint)
        out.append((x, y))
        dmax = max(dmax, abs(d))
    return out, dmax


def planar_setup(ways, *, bbox=PLANAR_BBOX, ppm=PLANAR_PX_PER_M):
    """Bounds -> (PlanarProjection, WorldDims), from the OSM ways in metres.

    The world's SIZE comes out of here, so nothing before this point can know
    it — which is why the dims are returned and passed rather than published as
    globals. `bbox` ("lon0,lat0,lon1,lat1") clips the region: docs/map.osm spans
    ~85x92 km of stray inland highways and distant villages, and projecting it
    whole gives a 1.2-billion-cell, 99.96%-water world. A smaller bbox is also
    how you get a fast smoke build.
    """
    clip = None
    if bbox:
        lo0, la0, lo1, la1 = (float(v) for v in bbox.split(","))
        (a0, b0), (a1, b1) = to_m(la0, lo0), to_m(la1, lo1)
        clip = (min(a0, a1), min(b0, b1), max(a0, a1), max(b0, b1))
        # Drop ways entirely outside the clip so stray inland geometry never
        # inflates the bounds, gets rasterised at the world edge, or pollutes
        # edge tiles. A way with ANY point inside (or crossing) the clip stays.
        m = 300.0                                    # keep a small crossing margin
        inside = lambda p: (clip[0] - m <= p[0] <= clip[2] + m and
                            clip[1] - m <= p[1] <= clip[3] + m)
        kept = [w for w in ways if any(inside(p) for p in w["pts"])]
        dropped = len(ways) - len(kept)
        ways[:] = kept
        if dropped:
            log("planar", f"dropped {dropped} ways entirely outside the clip bbox")
    mxs, mys = [], []
    for w in ways:
        for (mx, my) in w["pts"]:
            if clip and not (clip[0] <= mx <= clip[2] and clip[1] <= my <= clip[3]):
                continue
            mxs.append(mx); mys.append(my)
    if not mxs:
        raise SystemExit("[planar] no OSM points in bounds")
    pad = 200.0
    min_mx, max_mx = min(mxs) - pad, max(mxs) + pad
    min_my, max_my = min(mys) - pad, max(mys) + pad
    snap = lambda px: int(math.ceil(px / CUAD) * CUAD)
    dims = WorldDims.of(snap((max_mx - min_mx) * ppm), snap((max_my - min_my) * ppm), GRID_CELL)
    log("planar", f"world {dims.w}x{dims.h}px  ppm={ppm}  grid "
          f"{dims.cols}x{dims.rows} = {dims.cells/1e6:.1f}M cells"
          + ("  (bbox clip)" if clip else ""))
    return PlanarProjection(min_mx, min_my, ppm), dims


def world_to_geo(geo, x, y):
    """World px -> (lat, lon), inverting `manifest.meta.geo`.

    The affine is exact (the projection is linear in lon/lat), so this is a
    real inverse, not an approximation — which is what makes it safe for the
    admin tools and, later, for a server matching a business's real address to
    a lote.
    """
    lon = (x - geo["bx"]) / geo["ax"]
    lat = (y - geo["by"]) / geo["ay"]
    return round(lat, 6), round(lon, 6)


def geo_to_world(geo, lat, lon):
    """(lat, lon) -> world px. The direction the CLIENT uses to place remote
    content it was given in real coordinates."""
    return geo["ax"] * lon + geo["bx"], geo["ay"] * lat + geo["by"]
