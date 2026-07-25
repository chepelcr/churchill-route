"""Reading docs/map.osm.

The OsmSource implementation: a streaming ElementTree parse of a 300 MB XML
export, keeping only what the world needs. It is the only code in the project
that knows OSM's shape (nodes / ways / relations, tag dicts), which is what
lets everything downstream work in metres and world px.

Streaming with `iterparse` + `elem.clear()` is not an optimisation here, it is
the difference between building and running out of memory.
"""
import xml.etree.ElementTree as ET

from ..logging import log
from ..util.geometry import poly_centroid, to_m


#: OSM tag keys that make a way or node a POI worth naming on the map
POI_KEYS = ("amenity", "shop", "tourism", "leisure", "office", "healthcare",
            "craft", "historic")

def poi_category(tags):
    """(key, value) of the first POI key on `tags`, or None if it isn't a POI."""
    for k in POI_KEYS:
        if k in tags:
            return k, tags[k]
    return None


def parse_osm(path):
    nodes = {}
    ways = []
    named = []            # (lower_name, (mx,my), tags) for POI resolution
    poi_nodes = []        # (ll, tags) for every NAMED standalone POI node
    rels = []
    keep_keys = {"highway", "building", "natural", "name", "amenity",
                 "man_made", "bridge", "ref", "wetland", "leisure"}
    for ev, el in ET.iterparse(path, events=("end",)):
        if el.tag == "node":
            nid = el.get("id")
            ll = (float(el.get("lat")), float(el.get("lon")))
            nodes[nid] = ll
            tags = None
            for t in el.findall("tag"):
                if t.get("k") == "name" or t.get("k") in ("man_made", "amenity"):
                    if tags is None:
                        tags = {tt.get("k"): tt.get("v") for tt in el.findall("tag")}
            if tags and tags.get("name"):
                named.append((tags["name"].lower(), to_m(*ll), tags))
                if poi_category(tags):
                    poi_nodes.append((ll, tags))
            el.clear()
        elif el.tag == "way":
            tags = {t.get("k"): t.get("v") for t in el.findall("tag")}
            if tags.keys() & keep_keys:
                nds = [n.get("ref") for n in el.findall("nd")]
                ways.append({"id": el.get("id"), "nds": nds, "tags": tags})
            el.clear()
        elif el.tag == "relation":
            tags = {t.get("k"): t.get("v") for t in el.findall("tag")}
            if tags.get("type") == "multipolygon" and tags.get("natural") in ("water", "wetland", "beach"):
                members = [(m.get("ref"), m.get("role")) for m in el.findall("member") if m.get("type") == "way"]
                rels.append({"tags": tags, "members": members})
            el.clear()
    # resolve way coords in meters; register named ways too
    for w in ways:
        pts = [to_m(*nodes[r]) for r in w["nds"] if r in nodes]
        w["pts"] = pts
        nm = w["tags"].get("name")
        if nm and pts:
            named.append((nm.lower(), poly_centroid(pts), w["tags"]))
    return nodes, ways, named, rels, poi_nodes

# ----------------------------------------------------------------- spine ---


class OsmFileRepository:
    """Implements OsmSource over a local .osm export."""

    def __init__(self, path):
        self.path = path

    def load(self):
        return parse_osm(self.path)
