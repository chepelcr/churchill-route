#!/usr/bin/env python3
"""CLI for the world build: docs/map.osm -> src/world2d/.

The build itself is churchill.world — this file only puts the repo root on
sys.path (the package is not installed; `pnpm world:build` runs this script
directly) and calls the pipeline runner.

    python3 tools/build_world.py            # build the world
    python3 tools/world_snapshot.py verify  # ...and check nothing moved
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from churchill.world.pipeline.runner import main  # noqa: E402

if __name__ == "__main__":
    main()
