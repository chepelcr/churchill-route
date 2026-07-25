"""Build log.

The pipeline talks to a human reading a terminal: every stage prints what it
resolved, placed or dropped, and eyeballing that log is how a world change gets
reviewed (there are no unit tests — see tools/world_snapshot.py). It was 80
hand-written `print(f"[tag] …")` calls; this is the same output behind one
function, so the tag becomes a value a stage can carry and the sink can later
be swapped (a file, a JSON stream for CI) without touching a single stage.

    log("parcel", f"{part_id} ({use}) {n}v")     -> [parcel] carmen_plaza (stadium) 22v
    warn("estadio", "street resolve failed")     -> [estadio] WARNING: street resolve failed
"""


def log(tag, msg):
    """One build-log line: `[tag] msg`."""
    print(f"[{tag}] {msg}")


def warn(tag, msg):
    """A line the reader must not miss, but which is not fatal."""
    print(f"[{tag}] WARNING: {msg}")


def die(tag, msg):
    """Fatal: the world is not shippable. Raises SystemExit."""
    raise SystemExit(f"[{tag}] {msg}")
