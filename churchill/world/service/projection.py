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
