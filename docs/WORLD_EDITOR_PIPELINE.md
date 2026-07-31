# World editor pipeline

The private visual editor is an authoring client. The game repository remains
the source of truth for deterministic world builds and playable artifacts.

## Patch input

The builder accepts schema-v1 semantic patches from:

1. `CHURCHILL_WORLD_PATCH=/absolute/path/to/world-editor.patch.json`; or
2. `docs/world-editor.patch.json`, when that committed file exists.

An explicitly selected missing or invalid patch fails the build. With neither
source present, the original OSM-only build is unchanged.

```sh
CHURCHILL_WORLD_PATCH="$PWD/world-editor/exports/world-editor.patch.json" \
  pnpm world:build
```

Every successful patched manifest carries `editorPatch` with the patch SHA-256
and applied-operation counts. Future entity types that do not have a runtime
catalog yet are retained in `editorFeatures`; valid edits are never silently
dropped.

## Application order

Road additions, overrides, and deletions are resolved immediately after OSM
extraction and before surface rasterization. The edited road network therefore
drives blocks, aceras, collision, building placement, and emitted vectors.

Buildings, trees, palms, landmarks, parcels, stadiums, and green areas are
resolved after normal procedural placement and before the playability gate.
Moving or hiding a building therefore changes the emitted polygon used by the
runtime collision spatial hash.

Generated roads first created after the initial raster stage require an
explicit replacement surface if moved or deleted; otherwise the importer fails
instead of creating ghost collision.

Surface regions and generated cuadras paint the actual raster class used by
physics. They may also carry inside-only acera width/color and a visual ground
preset. The Balneario preset emits water collision, backdrop geometry, and
runtime inlet metadata together.

## Stable source references

Schema v1 uses the same content-addressed IDs as the editor:

- `road_<hash>` from class, name, reference, and points;
- `building_<hash>` from footprint points;
- `tree_<hash>` from position and tree kind;
- authored IDs for landmarks and parcels;
- the nearest stadium landmark ID for stadium records.

The importer rejects missing, ambiguous, duplicated, or modify-and-delete
references. This is intentional: guessing which generated feature an edit
meant would make human and agent changes non-deterministic.

## Current support

| Family | Add | Modify | Delete | Collision/surface |
| --- | --- | --- | --- | --- |
| Extracted roads | Yes | Yes | Yes | Rebuilt from edited road |
| Buildings | Yes | Yes | Yes | Polygon collision follows edit |
| Trees/palms/tree lines | Yes | Yes | Yes | Decorative |
| Landmarks/kiosks | Yes | Yes | Yes | Reachability gate runs |
| Parcels/stadiums/greens | Yes | Yes | Yes | Vector/metadata today |
| Water/surface regions/cuadras | Yes | Yes | Cuadra uses replacement | Raster + collision rebuilt |
| Player/vehicles/routes/triggers | Yes | — | — | Runtime consumes `editorFeatures` |
| Stages/deliveries/spawns | Yes | — | — | Runtime catalogs merge them |
| Screen/UI configuration | Yes | Yes | Yes | Emitted as `editorUI` |
| Future structures/entities | Preserved | — | — | Never silently dropped |

## Human and agent entry points

The private editor provides the visual canvas plus a stable JSON/HTTP/CLI
contract. `world-editor/agent-api.json` documents endpoints and feature shape;
`pnpm editor` supports status, catalog, list, upsert, delete, and export.
Reusable multi-feature prefabs retain internal route/target references when
instantiated.

## Verification

Fast importer tests:

```sh
python3 -m unittest discover -s tests -p 'test_*.py' -v
```

A shippable patch must additionally pass the full world build, inventory
generation, production build, and in-browser drive check.
