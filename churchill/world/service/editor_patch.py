"""Semantic world-editor patch -> deterministic world-builder mutations.

The visual editor never rewrites generated tiles.  It exports a small semantic
patch whose source references name features in the generated world.  This
module is the bridge back into the build:

* road edits run before surface rasterisation, so blocks and collision see the
  edited street network;
* placed/vector content runs after the normal generator has finished, so OSM
  placement remains deterministic and an override replaces its final result;
* feature kinds that the runtime does not consume yet are preserved in
  ``manifest.editorFeatures``.  Nothing is silently dropped.

The source-id hashes intentionally mirror ``world-editor/src/main.js``.  They
are content-addressed because old generated roads/buildings did not carry OSM
ids all the way to the emitted tile.  A later schema may emit first-class ids,
but schema v1 patches must remain readable.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
from copy import deepcopy

from ..config import (
    CLS_ACERA, CLS_LAND, CLS_ROAD, CUAD_CELLS, EDITOR_PATCH_PATH, GRID_CELL,
)
from ..enums import Surface
from ..logging import log
from ..util.geometry import point_in_poly
from .block import block_raster_cells, outline_poly


class WorldPatchError(ValueError):
    """The patch cannot be applied without guessing or losing an edit."""


def _base36(value):
    chars = "0123456789abcdefghijklmnopqrstuvwxyz"
    if value == 0:
        return "0"
    out = ""
    while value:
        value, digit = divmod(value, 36)
        out = chars[digit] + out
    return out


def _js_json(value):
    """Compact JSON compatible with JSON.stringify for the v1 hash inputs."""
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def stable_hash(value):
    """FNV-1a/32 used by the editor's ``stableHash`` helper."""
    h = 2166136261
    for char in _js_json(value):
        h ^= ord(char)
        h = (h * 16777619) & 0xFFFFFFFF
    return _base36(h)


def road_source_id(road):
    return "road_" + stable_hash([
        road.get("cls"), road.get("name"), road.get("ref"), road.get("pts"),
    ])


def building_source_id(building):
    return "building_" + stable_hash(building.get("pts") or [])


def tree_source_id(tree, kind="tree"):
    return "tree_" + stable_hash([
        tree.get("x"), tree.get("y"), tree.get("kind") or kind,
    ])


def cuadra_source_id(poly):
    return "cuadra_" + stable_hash(poly)


def build_cuadra_catalog(raster, blocks):
    """Stable selectable polygons for the editor's generated-cuadra layer."""
    cuadras = []
    for block in blocks:
        cells = block_raster_cells(
            raster, block.get("cells") or [], CUAD_CELLS, CLS_LAND)
        poly = outline_poly(cells, GRID_CELL) if cells else None
        if not poly:
            continue
        points = list(zip(poly[0::2], poly[1::2]))
        x0, y0, x1, y1 = _bbox(points)
        cx, cy = _centroid(points)
        cuadras.append({
            "id": cuadra_source_id(poly),
            "name": f"Cuadra {len(cuadras) + 1}",
            "poly": poly,
            "cx": cx, "cy": cy,
            "x0": x0, "y0": y0, "x1": x1, "y1": y1,
            "surfaceClass": "land",
            "groundPreset": "cuadra",
        })
    return cuadras


def _finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) \
        and math.isfinite(value)


def _point(value):
    return isinstance(value, list) and len(value) == 2 and all(_finite(v) for v in value)


def _feature_points(feature):
    geometry = feature["geometry"]
    if geometry["kind"] == "point":
        return [geometry["point"]]
    return geometry["points"]


def _flat(points):
    return [round(value) for point in points for value in point]


def _centroid(points):
    return (
        round(sum(point[0] for point in points) / len(points)),
        round(sum(point[1] for point in points) / len(points)),
    )


def _bbox(points):
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    return round(min(xs)), round(min(ys)), round(max(xs)), round(max(ys))


def _source_ref(feature):
    return (feature.get("properties") or {}).get("sourceRef")


def _source_snapshot(feature):
    return deepcopy((feature.get("properties") or {}).get("sourceSnapshot") or {})


def _style_color(feature, fallback=None):
    return (feature.get("style") or {}).get("color") or fallback


def _district_at(ctx, x, y):
    candidates = [
        district for district in ctx.districts
        if district["x0"] <= x <= district["x1"]
        and district.get("y0", 0) <= y <= district.get("y1", ctx.dims.h)
    ]
    if candidates:
        return min(
            candidates,
            key=lambda district: (district["x1"] - district["x0"])
            * (district.get("y1", ctx.dims.h) - district.get("y0", 0)),
        )["id"]
    return min(
        ctx.districts,
        key=lambda district: abs(x - (district["x0"] + district["x1"]) / 2),
    )["id"]


class WorldPatchSession:
    """Validated patch plus the state required to prove every edit was used."""

    def __init__(self, payload, *, path, dims):
        self.payload = payload
        self.path = path
        self.dims = dims
        self.overrides = list(payload.get("overrides") or [])
        self.additions = list(payload.get("additions") or [])
        self.deletions = list(payload.get("deletions") or [])
        self.applied_overrides = set()
        self.applied_additions = set()
        self.applied_deletions = set()
        self._validate()

    @classmethod
    def discover(cls, dims, explicit_path=None):
        """Load the env-selected patch, or the committed default when present.

        ``CHURCHILL_WORLD_PATCH`` is what the editor's one-click build will use.
        If it is explicitly set, a missing file is fatal.  The default file is
        optional so a clean checkout still builds the unedited OSM world.
        """
        env_path = os.environ.get("CHURCHILL_WORLD_PATCH")
        path = explicit_path or env_path or EDITOR_PATCH_PATH
        required = explicit_path is not None or env_path is not None
        if not os.path.exists(path):
            if required:
                raise WorldPatchError(f"patch file does not exist: {path}")
            return None
        try:
            with open(path, encoding="utf-8") as source:
                payload = json.load(source)
        except (OSError, json.JSONDecodeError) as error:
            raise WorldPatchError(f"cannot read patch {path}: {error}") from error
        session = cls(payload, path=path, dims=dims)
        log("editor", f"loaded schema v1 patch: {len(session.overrides)} overrides, "
            f"{len(session.additions)} additions, {len(session.deletions)} deletions")
        return session

    def _validate(self):
        if not isinstance(self.payload, dict) or self.payload.get("schemaVersion") != 1:
            raise WorldPatchError("patch.schemaVersion must be 1")
        for key in ("overrides", "additions", "deletions"):
            if key in self.payload and not isinstance(self.payload[key], list):
                raise WorldPatchError(f"patch.{key} must be an array")
        if "ui" in self.payload and not isinstance(self.payload["ui"], dict):
            raise WorldPatchError("patch.ui must be an object")

        feature_ids = set()
        source_refs = set()
        for collection, expected_operation in (
                (self.overrides, "modify"), (self.additions, "add")):
            for index, feature in enumerate(collection):
                at = f"{expected_operation}[{index}]"
                if not isinstance(feature, dict):
                    raise WorldPatchError(f"{at} must be an object")
                feature_id = feature.get("id")
                if not isinstance(feature_id, str) or not feature_id:
                    raise WorldPatchError(f"{at}.id must be a non-empty string")
                if feature_id in feature_ids:
                    raise WorldPatchError(f"duplicate feature id: {feature_id}")
                feature_ids.add(feature_id)
                operation = feature.get("operation") or expected_operation
                if operation != expected_operation:
                    raise WorldPatchError(
                        f"{feature_id}: operation must be {expected_operation}")
                if not isinstance(feature.get("type"), str) or not feature["type"]:
                    raise WorldPatchError(f"{feature_id}: missing type")
                self._validate_geometry(feature)
                if expected_operation == "modify":
                    ref = _source_ref(feature)
                    if not isinstance(ref, dict) or not isinstance(ref.get("kind"), str) \
                            or not isinstance(ref.get("id"), str):
                        raise WorldPatchError(
                            f"{feature_id}: source modification is missing sourceRef")
                    key = f"{ref['kind']}:{ref['id']}"
                    if key in source_refs:
                        raise WorldPatchError(f"source is modified more than once: {key}")
                    source_refs.add(key)

        deletion_keys = set()
        for deletion in self.deletions:
            if not isinstance(deletion, str) or ":" not in deletion:
                raise WorldPatchError(
                    f"deletion must be a 'kind:id' string, got {deletion!r}")
            kind, source_id = deletion.split(":", 1)
            if not kind or not source_id:
                raise WorldPatchError(f"invalid deletion source: {deletion!r}")
            if kind == "cuadra":
                raise WorldPatchError(
                    "a cuadra cannot be deleted; assign a replacement surface instead")
            if deletion in deletion_keys:
                raise WorldPatchError(f"duplicate deletion: {deletion}")
            if deletion in source_refs:
                raise WorldPatchError(
                    f"source cannot be modified and deleted: {deletion}")
            deletion_keys.add(deletion)

    def _validate_geometry(self, feature):
        geometry = feature.get("geometry")
        feature_id = feature.get("id", "<unknown>")
        if not isinstance(geometry, dict):
            raise WorldPatchError(f"{feature_id}: missing geometry")
        kind = geometry.get("kind")
        if kind == "point":
            points = [geometry.get("point")]
            if not _point(points[0]):
                raise WorldPatchError(f"{feature_id}: invalid point geometry")
        elif kind in ("line", "polygon"):
            points = geometry.get("points")
            minimum = 2 if kind == "line" else 3
            if not isinstance(points, list) or len(points) < minimum \
                    or not all(_point(point) for point in points):
                raise WorldPatchError(
                    f"{feature_id}: {kind} needs {minimum} valid points")
        else:
            raise WorldPatchError(f"{feature_id}: unsupported geometry kind {kind!r}")
        for x, y in points:
            if x < 0 or y < 0 or x > self.dims.w or y > self.dims.h:
                raise WorldPatchError(
                    f"{feature_id}: point ({x}, {y}) is outside "
                    f"0..{self.dims.w}, 0..{self.dims.h}")

    def _override_for(self, kind):
        return {
            ref["id"]: feature
            for feature in self.overrides
            if (ref := _source_ref(feature))["kind"] == kind
        }

    def _deletions_for(self, kind):
        prefix = kind + ":"
        return {key[len(prefix):]: key for key in self.deletions if key.startswith(prefix)}

    @staticmethod
    def _unique_index(collection, id_for):
        found = {}
        for index, record in enumerate(collection):
            source_id = id_for(record, index)
            found.setdefault(source_id, []).append(index)
        return found

    def _apply_collection(self, collection, *, kind, id_for, replace):
        overrides = self._override_for(kind)
        deletions = self._deletions_for(kind)
        if not overrides and not deletions:
            return
        index = self._unique_index(collection, id_for)
        requested = set(overrides) | set(deletions)
        ambiguous = [source_id for source_id in requested if len(index.get(source_id, [])) > 1]
        if ambiguous:
            raise WorldPatchError(
                f"ambiguous {kind} source reference(s): {', '.join(sorted(ambiguous))}")
        rebuilt = []
        for position, record in enumerate(collection):
            source_id = id_for(record, position)
            if source_id in deletions:
                self.applied_deletions.add(deletions[source_id])
                continue
            feature = overrides.get(source_id)
            if feature:
                rebuilt.append(replace(record, feature))
                self.applied_overrides.add(feature["id"])
            else:
                rebuilt.append(record)
        collection[:] = rebuilt

    def apply_pre_surface(self, ctx):
        """Apply road sources/additions before the raster and blocks exist."""
        self._apply_collection(
            ctx.roads,
            kind="road",
            id_for=lambda road, _index: road_source_id(road),
            replace=self._road_record,
        )
        for feature in self.additions:
            if feature["type"] not in ("road", "boulevard"):
                continue
            if feature["geometry"]["kind"] != "line":
                raise WorldPatchError(
                    f"{feature['id']}: a road addition needs line geometry")
            ctx.roads.append(self._road_record({}, feature))
            self.applied_additions.add(feature["id"])

    def apply_final(self, ctx):
        """Apply every family generated after surface rasterisation."""
        ctx.editor_ui = deepcopy(self.payload.get("ui") or {})
        # A road first seen here was synthesized/stamped by a later stage.  It
        # cannot be moved or deleted safely without restoring its old cells.
        # Phase 2's surface operations provide that explicit replacement.
        unresolved_road_refs = {
            ref["id"] for feature in self.overrides
            if feature["id"] not in self.applied_overrides
            and (ref := _source_ref(feature))["kind"] == "road"
        } | {
            source_id for source_id, key in self._deletions_for("road").items()
            if key not in self.applied_deletions
        }
        if unresolved_road_refs:
            final_road_ids = {road_source_id(road) for road in ctx.roads}
            late = sorted(unresolved_road_refs & final_road_ids)
            if late:
                raise WorldPatchError(
                    "generated road edits require an explicit replacement surface: "
                    + ", ".join(late))

        self._apply_collection(
            ctx.buildings,
            kind="building",
            id_for=lambda building, _index: building_source_id(building),
            replace=self._building_record,
        )
        self._apply_trees(ctx)
        # Stadium ids depend on the unmodified landmark anchors, so stadiums go
        # before landmarks.
        self._apply_collection(
            ctx.stadiums,
            kind="stadium",
            id_for=lambda stadium, index: self._stadium_source_id(ctx, stadium, index),
            replace=self._stadium_record,
        )
        self._apply_collection(
            ctx.parcels,
            kind="parcel",
            id_for=lambda parcel, index: parcel.get("id") or f"parcel_{index}",
            replace=self._parcel_record,
        )
        self._apply_collection(
            ctx.greens,
            kind="green",
            id_for=lambda green, index: (
                "parquemar_green" if green.get("type") == "marine" else f"green_{index}"
            ),
            replace=self._green_record,
        )
        self._apply_collection(
            ctx.cuadras,
            kind="cuadra",
            id_for=lambda cuadra, index: cuadra.get("id") or f"cuadra_{index}",
            replace=self._cuadra_record,
        )
        self._apply_collection(
            ctx.landmarks,
            kind="landmark",
            id_for=lambda landmark, index: landmark.get("id") or f"landmark_{index}",
            replace=self._landmark_record,
        )
        edited_cuadras = {
            record.get("editorId"): record for record in ctx.cuadras
            if record.get("editorId")
        }
        for feature in self.overrides:
            if feature["id"] in edited_cuadras:
                self._apply_surface_feature(ctx, feature)

        for feature in self.additions:
            if feature["id"] in self.applied_additions:
                continue
            feature_type = feature["type"]
            if feature_type == "building":
                ctx.buildings.append(self._building_record({}, feature))
            elif feature_type in ("tree", "tree-line"):
                self._add_tree_feature(ctx, feature)
            elif feature_type == "kiosk":
                ctx.landmarks.append(self._landmark_record({}, feature, ctx=ctx))
            elif feature_type == "parcel":
                ctx.parcels.append(self._parcel_record({}, feature))
            elif feature_type in ("stadium", "pitch"):
                ctx.stadiums.append(self._stadium_record({}, feature))
            elif feature_type in ("park", "marine-park"):
                ctx.greens.append(self._green_record({}, feature))
                self._apply_surface_feature(ctx, feature)
            elif feature_type in ("surface-region", "cuadra", "water", "beach"):
                self._apply_surface_feature(ctx, feature)
            else:
                # Roofs, entrances, lights, water regions and future entity
                # types survive the import even before their runtime catalog
                # exists.  The build manifest is the handoff to those phases.
                ctx.editor_features.append(deepcopy(feature))
            self.applied_additions.add(feature["id"])

        self._finish(ctx)

    def _finish(self, ctx):
        missing_overrides = sorted(
            feature["id"] for feature in self.overrides
            if feature["id"] not in self.applied_overrides)
        missing_deletions = sorted(
            deletion for deletion in self.deletions
            if deletion not in self.applied_deletions)
        missing_additions = sorted(
            feature["id"] for feature in self.additions
            if feature["id"] not in self.applied_additions)
        if missing_overrides or missing_deletions or missing_additions:
            messages = []
            if missing_overrides:
                messages.append("unresolved overrides: " + ", ".join(missing_overrides))
            if missing_deletions:
                messages.append("unresolved deletions: " + ", ".join(missing_deletions))
            if missing_additions:
                messages.append("unapplied additions: " + ", ".join(missing_additions))
            raise WorldPatchError("; ".join(messages))

        with open(self.path, "rb") as source:
            digest = hashlib.sha256(source.read()).hexdigest()
        ctx.editor_patch_meta = {
            "schemaVersion": 1,
            "sha256": digest,
            "overrides": len(self.applied_overrides),
            "additions": len(self.applied_additions),
            "deletions": len(self.applied_deletions),
        }
        log("editor", f"applied {len(self.applied_overrides)} overrides, "
            f"{len(self.applied_additions)} additions, "
            f"{len(self.applied_deletions)} deletions")

    @staticmethod
    def _road_record(source, feature):
        record = deepcopy(source or _source_snapshot(feature))
        properties = feature.get("properties") or {}
        record["pts"] = _flat(_feature_points(feature))
        record["cls"] = properties.get("use") or record.get("cls") or (
            "pedestrian" if feature["type"] == "boulevard" else "residential")
        record["w"] = max(1, round(properties.get("width") or record.get("w") or 28))
        if feature.get("name"):
            record["name"] = feature["name"]
        record["editorId"] = feature["id"]
        return record

    @staticmethod
    def _building_record(source, feature):
        record = deepcopy(source or _source_snapshot(feature))
        properties = feature.get("properties") or {}
        record["pts"] = _flat(_feature_points(feature))
        if feature.get("name"):
            record["name"] = feature["name"]
        if properties.get("use"):
            record["cat"] = properties["use"]
        color = _style_color(feature, record.get("color"))
        if color:
            record["color"] = color
        record["editorId"] = feature["id"]
        return record

    @staticmethod
    def _tree_record(source, feature, default_kind="tree"):
        record = deepcopy(source or _source_snapshot(feature))
        properties = feature.get("properties") or {}
        x, y = _feature_points(feature)[0]
        record["x"], record["y"] = round(x), round(y)
        record["kind"] = properties.get("treeKind") or record.get("kind") or default_kind
        record["s"] = properties.get("width") or record.get("s") or 1
        record["editorId"] = feature["id"]
        return record

    def _apply_trees(self, ctx):
        sources = [
            ("tree", record) for record in ctx.trees
        ] + [
            ("palm", record) for record in ctx.palms
        ]
        overrides = self._override_for("tree")
        deletions = self._deletions_for("tree")
        index = {}
        for position, (default_kind, record) in enumerate(sources):
            source_id = tree_source_id(record, default_kind)
            index.setdefault(source_id, []).append(position)
        requested = set(overrides) | set(deletions)
        ambiguous = [source_id for source_id in requested if len(index.get(source_id, [])) > 1]
        if ambiguous:
            raise WorldPatchError(
                "ambiguous tree source reference(s): " + ", ".join(sorted(ambiguous)))
        trees, palms = [], []
        for default_kind, record in sources:
            source_id = tree_source_id(record, default_kind)
            if source_id in deletions:
                self.applied_deletions.add(deletions[source_id])
                continue
            feature = overrides.get(source_id)
            if feature:
                record = self._tree_record(record, feature, default_kind)
                self.applied_overrides.add(feature["id"])
            kind = record.get("kind") or default_kind
            (palms if kind == "palm" else trees).append(record)
        ctx.trees[:], ctx.palms[:] = trees, palms

    def _add_tree_feature(self, ctx, feature):
        properties = feature.get("properties") or {}
        kind = properties.get("treeKind") or "tree"
        points = _feature_points(feature)
        if feature["geometry"]["kind"] == "line":
            spacing = max(4, float(properties.get("spacing") or 36))
            sampled = []
            for a, b in zip(points, points[1:]):
                dx, dy = b[0] - a[0], b[1] - a[1]
                length = math.hypot(dx, dy)
                count = max(1, int(length // spacing))
                for index in range(count):
                    t = index / count
                    sampled.append([a[0] + dx * t, a[1] + dy * t])
            sampled.append(points[-1])
        else:
            sampled = points
        target = ctx.palms if kind == "palm" else ctx.trees
        for index, point in enumerate(sampled):
            child = deepcopy(feature)
            child["id"] = f"{feature['id']}_{index + 1}"
            child["geometry"] = {"kind": "point", "point": point}
            target.append(self._tree_record({}, child, kind))

    @staticmethod
    def _landmark_record(source, feature, ctx=None):
        record = deepcopy(source or _source_snapshot(feature))
        x, y = _feature_points(feature)[0]
        old_x, old_y = record.get("x", x), record.get("y", y)
        record["id"] = record.get("id") or feature["id"]
        record["name"] = feature.get("name") or record.get("name") or feature["id"]
        record["x"], record["y"] = round(x), round(y)
        if feature["type"] != "custom":
            record["type"] = feature["type"]
        else:
            record["type"] = record.get("type") or "sign"
        if record.get("spawn"):
            record["spawn"] = [
                round(record["spawn"][0] + x - old_x),
                round(record["spawn"][1] + y - old_y),
            ]
        elif record["type"] == "kiosk":
            record["spawn"] = [round(x), round(y)]
        properties = feature.get("properties") or {}
        if properties.get("district"):
            record["district"] = properties["district"]
        elif not record.get("district") and ctx is not None:
            record["district"] = _district_at(ctx, x, y)
        record["editorId"] = feature["id"]
        return record

    @staticmethod
    def _parcel_record(source, feature):
        record = deepcopy(source or _source_snapshot(feature))
        points = _feature_points(feature)
        flat = _flat(points)
        x0, y0, x1, y1 = _bbox(points)
        cx, cy = _centroid(points)
        properties = feature.get("properties") or {}
        record.update({
            "id": record.get("id") or feature["id"],
            "name": feature.get("name") or record.get("name") or feature["id"],
            "use": properties.get("use") or record.get("use") or "lot",
            "poly": flat,
            "cx": cx, "cy": cy,
            "x0": x0, "y0": y0, "x1": x1, "y1": y1,
            "slot": [x0, y0, max(1, x1 - x0), max(1, y1 - y0)],
            "editorId": feature["id"],
        })
        record.pop("polys", None)
        return record

    @staticmethod
    def _stadium_record(source, feature):
        record = deepcopy(source or _source_snapshot(feature))
        points = _feature_points(feature)
        flat = _flat(points)
        x0, y0, x1, y1 = _bbox(points)
        cx, cy = _centroid(points)
        record.update({
            "x0": x0, "y0": y0, "x1": x1, "y1": y1,
            "cx": cx, "cy": cy,
            "outline": flat,
            "footprint": flat,
            "editorId": feature["id"],
        })
        return record

    @staticmethod
    def _green_record(source, feature):
        record = deepcopy(source or _source_snapshot(feature))
        record["pts"] = _flat(_feature_points(feature))
        if feature["type"] != "custom":
            record["type"] = (
                "marine" if feature["type"] == "marine-park"
                else feature["type"])
        record["editorId"] = feature["id"]
        return record

    @staticmethod
    def _cuadra_record(source, feature):
        record = deepcopy(source or _source_snapshot(feature))
        points = _feature_points(feature)
        flat = _flat(points)
        x0, y0, x1, y1 = _bbox(points)
        cx, cy = _centroid(points)
        properties = feature.get("properties") or {}
        record.update({
            "id": record.get("id") or feature["id"],
            "name": feature.get("name") or record.get("name") or feature["id"],
            "poly": flat,
            "cx": cx, "cy": cy,
            "x0": x0, "y0": y0, "x1": x1, "y1": y1,
            "surfaceClass": properties.get("surfaceClass")
                or record.get("surfaceClass") or "land",
            "groundPreset": properties.get("groundPreset")
                or record.get("groundPreset") or "cuadra",
            "editorId": feature["id"],
        })
        return record

    @staticmethod
    def _surface_class(feature):
        properties = feature.get("properties") or {}
        collision = properties.get("collisionMode") or "auto"
        if collision == "solid":
            return Surface.LAND
        if collision == "drivable":
            return Surface.ROAD
        label = properties.get("surfaceClass")
        if not label:
            if feature["type"] == "water" \
                    or properties.get("groundPreset") == "balneario":
                label = "water"
            elif feature["type"] == "beach":
                label = "beach"
            elif feature["type"] in ("park", "marine-park", "cuadra"):
                label = "land"
        if not label:
            return None
        try:
            return Surface[label.upper()]
        except KeyError as error:
            allowed = ", ".join(surface.label for surface in Surface)
            raise WorldPatchError(
                f"{feature['id']}: unknown surfaceClass {label!r}; expected {allowed}"
            ) from error

    @staticmethod
    def _polygon_cells(raster, points):
        x0, y0, x1, y1 = _bbox(points)
        c0 = max(0, int(x0 // raster.cell))
        c1 = min(raster.cols - 1, int(x1 // raster.cell))
        r0 = max(0, int(y0 // raster.cell))
        r1 = min(raster.rows - 1, int(y1 // raster.cell))
        cells = set()
        for row in range(r0, r1 + 1):
            py = (row + 0.5) * raster.cell
            for col in range(c0, c1 + 1):
                px = (col + 0.5) * raster.cell
                if point_in_poly((px, py), points):
                    cells.add((col, row))
        return cells

    @staticmethod
    def _paint_acera_ring(raster, cells, width):
        """Paint an inside sidewalk ring of ``width`` raster cells."""
        remaining = set(cells)
        for _layer in range(width):
            boundary = {
                cell for cell in remaining
                if any((cell[0] + dc, cell[1] + dr) not in remaining
                       for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1)))
            }
            if not boundary:
                break
            for col, row in boundary:
                raster.set(col, row, CLS_ACERA)
            remaining.difference_update(boundary)

    def _apply_surface_feature(self, ctx, feature):
        if feature["geometry"]["kind"] != "polygon":
            raise WorldPatchError(
                f"{feature['id']}: a surface region needs polygon geometry")
        properties = feature.get("properties") or {}
        points = _feature_points(feature)
        surface = self._surface_class(feature)
        cells = self._polygon_cells(ctx.raster, points)
        if surface is not None:
            for col, row in cells:
                ctx.raster.set(col, row, surface)
        acera_width = max(0, int(properties.get("aceraWidthCells") or 0))
        if acera_width and surface != Surface.WATER:
            self._paint_acera_ring(ctx.raster, cells, acera_width)

        preset = properties.get("groundPreset") or feature["type"]
        style = {
            "id": feature["id"],
            "pts": _flat(points),
            "surfaceClass": surface.label if surface is not None else None,
            "groundPreset": preset,
            "groundColor": properties.get("groundColor")
                or _style_color(feature),
            "aceraColor": properties.get("aceraColor"),
            "aceraWidthCells": acera_width,
            "collisionMode": properties.get("collisionMode") or "auto",
        }
        ctx.surface_styles.append(style)

        if preset == "balneario":
            x0, y0, x1, y1 = _bbox(points)
            ctx.waters.append(_flat(points))
            ctx.balneario = {
                "x0": x0, "y0": y0, "x1": x1, "y1": y1,
                "cx": round((x0 + x1) / 2),
                "cy": round((y0 + y1) / 2),
            }

    @staticmethod
    def _stadium_source_id(ctx, stadium, index):
        candidates = [
            landmark for landmark in ctx.landmarks
            if landmark.get("type") == "stadium"
            and math.hypot(
                landmark["x"] - stadium.get("cx", 0),
                landmark["y"] - stadium.get("cy", 0),
            ) < 80
        ]
        if candidates:
            return min(
                candidates,
                key=lambda landmark: math.hypot(
                    landmark["x"] - stadium.get("cx", 0),
                    landmark["y"] - stadium.get("cy", 0),
                ),
            )["id"]
        return f"stadium_{index}"
