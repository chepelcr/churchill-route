#!/usr/bin/env python3
"""Golden snapshot of the emitted world — the refactor's safety net.

The world build has no unit tests: it is judged by what it emits. So the
contract for every refactoring step is BYTE-IDENTICAL OUTPUT, and this is what
checks it. `save` records a digest of the manifest and all tiles; `verify`
recomputes and reports exactly which files moved.

    python3 tools/world_snapshot.py save      # after a KNOWN-GOOD build
    python3 tools/world_snapshot.py verify    # after any refactor step
    python3 tools/world_snapshot.py rebuild   # build, then verify in one go

A world change that is INTENDED (a new parcel, a different acera depth) shows
up as a verify failure too — that is the point. Re-run `save` to accept it, in
the same commit that makes the change, so the digest always says "this is the
world we meant to ship".
"""
import hashlib
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORLD = os.path.join(ROOT, "src", "world2d")
TILES = os.path.join(WORLD, "tiles")
DIGEST = os.path.join(ROOT, "tools", "world_digest.json")


def _sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def snapshot():
    """{relative path -> sha256} for every emitted world file, sorted."""
    out = {}
    man = os.path.join(WORLD, "manifest.json")
    if not os.path.exists(man):
        sys.exit("[snapshot] no manifest — run the world build first")
    out["manifest.json"] = _sha(man)
    for name in sorted(os.listdir(TILES)):
        if name.endswith(".json"):
            out[f"tiles/{name}"] = _sha(os.path.join(TILES, name))
    return out


def save():
    snap = snapshot()
    combined = hashlib.sha256(
        "".join(f"{k}:{v}" for k, v in snap.items()).encode()).hexdigest()
    with open(DIGEST, "w") as fh:
        json.dump({"files": len(snap), "world": combined, "sha256": snap}, fh,
                  indent=1, sort_keys=True)
        fh.write("\n")
    print(f"[snapshot] saved {len(snap)} files, world {combined[:16]}")


def verify():
    if not os.path.exists(DIGEST):
        sys.exit("[snapshot] no digest — run `save` on a known-good build first")
    with open(DIGEST) as fh:
        want = json.load(fh)["sha256"]
    have = snapshot()
    added = sorted(set(have) - set(want))
    gone = sorted(set(want) - set(have))
    moved = sorted(k for k in have.keys() & want.keys() if have[k] != want[k])
    for k in gone:
        print(f"  MISSING  {k}")
    for k in added:
        print(f"  NEW      {k}")
    for k in moved:
        print(f"  CHANGED  {k}")
    if added or gone or moved:
        sys.exit(f"[snapshot] FAIL — {len(moved)} changed, {len(added)} new, "
                 f"{len(gone)} missing (of {len(want)})")
    print(f"[snapshot] OK — {len(have)} files byte-identical")


def rebuild():
    r = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "build_world.py")],
                       cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    tail = r.stdout.decode().strip().split("\n")[-3:]
    print("\n".join(tail))
    if r.returncode != 0:
        sys.exit(f"[snapshot] build FAILED ({r.returncode})")
    verify()


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "verify"
    {"save": save, "verify": verify, "rebuild": rebuild}.get(cmd, verify)()
