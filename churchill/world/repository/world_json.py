"""The world on disk: src/world2d/manifest.json + tiles/<tc>_<tr>.json.

Implements WorldSink and WorldSource. The serialisation details that the game
depends on live HERE and nowhere else:

* `separators=(",", ":")` — no spaces. The world is ~11.7 MB across 417 files
  and every space ships to a phone.
* `ensure_ascii=False` — "Parroquia Nuestra Señora de El Carmen" stays readable
  in the file instead of becoming \\u00f1 escapes.
* No `indent`, no `sort_keys`. Key order is whatever the producer built, which
  is why the byte-identical check in tools/world_snapshot.py is meaningful:
  it catches a reordering as loudly as a value change.
"""
import json
import os

from ..dto import Manifest


class JsonWorldRepository:
    def __init__(self, world_dir):
        self.dir = world_dir
        self.tiles_dir = os.path.join(world_dir, "tiles")

    # ---- WorldSink ----------------------------------------------------------
    def clear_tiles(self):
        """Remove stale tiles BEFORE emitting. A world that shrinks (a smaller
        bbox) would otherwise leave orphans the client happily streams."""
        if os.path.isdir(self.tiles_dir):
            for fn in os.listdir(self.tiles_dir):
                if fn.endswith(".json"):
                    os.remove(os.path.join(self.tiles_dir, fn))
        os.makedirs(self.tiles_dir, exist_ok=True)

    def write_tile(self, tc, tr, tile):
        self._write(os.path.join(self.tiles_dir, f"{tc}_{tr}.json"), tile)

    def write_manifest(self, manifest):
        # Validate before writing: the manifest is small, the check is
        # milliseconds, and a missing `ang` or a landmark without a district is
        # a bug that must fail the build rather than reach a phone.
        Manifest.model_validate(manifest)
        self._write(os.path.join(self.dir, "manifest.json"), manifest)

    def total_bytes(self):
        total = os.path.getsize(os.path.join(self.dir, "manifest.json"))
        total += sum(os.path.getsize(os.path.join(self.tiles_dir, fn))
                     for fn in os.listdir(self.tiles_dir))
        return total

    # ---- WorldSource --------------------------------------------------------
    def read_manifest(self) -> Manifest:
        with open(os.path.join(self.dir, "manifest.json"), encoding="utf-8") as f:
            return Manifest.model_validate(json.load(f))

    def read_tile(self, tc, tr):
        with open(os.path.join(self.tiles_dir, f"{tc}_{tr}.json"), encoding="utf-8") as f:
            return json.load(f)

    # ---- internals ----------------------------------------------------------
    @staticmethod
    def _write(path, payload):
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
