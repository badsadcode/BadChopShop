# BadChopShop architecture

> Studio motto #001: *"Code shall remain understandable to whichever AI inherits this mess."*
> This page is for you, future inheritor (very possibly the one porting it to C# for NoorForge).

## The pipeline

```
Recipe ──► makeDesign ──► buildBody ──► parts ──────────────► VehicleBuilder ──► toGLB / buildManifest
(type,      (archetype ×    (lofted       (wheels, exterior,     (node tree,        (glTF 2.0 binary,
 style,      style × seed:   shell, panels  interior,             slots, groups;     .noor.json, recipe)
 seed)       a BodySpec)     and glass)     mechanical)           include/separate)
```

## Source map

| Path | Responsibility |
|---|---|
| `src/types.ts` | `Recipe` (type, style, seed, palette, `set` gene pins, `include`, `separate`, `detail`, `lit`) |
| `src/archetypes/index.ts` | Types: proportions, roof/back shape, doors and windows → a fully decided `Design` (with `BodySpec`). Every number from a named gene stream |
| `src/styles/index.ts` | Eras: shape tendencies (boxiness, glass lean, rake…), bumpers, lamps, rims, palettes |
| `src/body/spec.ts` | `BodySpec`: every number the body kernel needs. The kernel makes no random choices |
| `src/body/body.ts` | **The body kernel** (below), cabin liner, collision hull, shut lines, raycasts |
| `src/parts/wheels.ts` | Tyre, rims (steel+hubcap, plain steel, plastic cover, alloys), brake disc, caliper |
| `src/parts/exterior.ts` | Decals with depth (lamps, grille, plates, handles), swept bumpers, mirrors |
| `src/parts/interior.ts` | Seats, dashboard, steering wheel, van bulkhead |
| `src/parts/mechanical.ts` | Engine, battery, exhaust, suspension, damage zones |
| `src/generate.ts` | Assembles everything into nodes: panels, glass, wheels, markers; flat shading for `low` |
| `src/core/` | Maths, curves, `Mesh` + primitives (extrude, box, lathe, tube, sweep, faceted), RNG, `VehicleBuilder` |
| `src/export/` | GLB writer, manifest + recipe, SHA-256 / UUID v5 |
| `src/cli.ts` | Command line |
| `tools/preview/index.html` | The playground (three.js), also the GitHub Pages front page |
| `tools/render.mjs` | Batch renders through headless Chromium (devlog pictures) |
| `tools/build-site.mjs`, `tools/devlog.mjs` | Pages site: playground + logbook from `devlog/*.md` |

## The body kernel (the important bit)

A car body is **lofted**: walk along the car from tail to nose ("stations"), and at every station build the same
half cross-section, always with the same number of points, bottom to top:

```
A bottom · B lower corner or wheel well · C side · D window sill · E side glass · F roof rail · G roof/hood/screens
```

The section is computed from curves in the `BodySpec`: the side silhouette (top), the underside, the beltline (bottom
of the windows) and the plan-view width. Where there's no greenhouse (hood, trunk) D, E and F collapse to one point and
G becomes the hood. Wheel arches are a notch in segment B (up the inner wall, out along the arch), so stations around
the arch are placed at even angles and the arch comes out as a clean polygon.

Neighbouring sections are stitched into quads, and **every quad knows its station interval and its segment**. That's
the trick: `classify()` decides per quad which material it gets (paint, glass, trim, chrome) and which panel it belongs
to (a door, the hood, a window) with no boolean cutting at all. Doors are "segments C–E between these two z values",
windows are "segment E inside this z range", the windshield is "segment G between cowl and roof".

The left half is built, the right half mirrored (`_L` buckets become `_R`). Ends are closed by shrunken sections (a
chamfer in low-poly, a rounded nose in high detail) and a cap; estates and vans get their rear window built into the cap.

**Detail levels** change only how many points each segment gets and how many stations are used (`layout()` and
`stationZs()`), plus flat shading (`faceted()`) for `low`. Same code, same classification: that's also how LODs will work.

## Parts on the body

Exterior details are **decals with depth**: a 2D outline is projected onto the body along a fixed direction with
raycasts (`decal()`), lifted a few millimetres and given a short wall. The outline is subdivided into rings so a lamp
near a rounded corner bends round it instead of cutting through. Bumpers are a profile swept along body hit points at
bumper height. Everything is authored in vehicle space; `VehicleBuilder.add` converts to the node's local space, so
pivots (hinges, hubs) can be anywhere without the builders caring.

## Key decisions

- **Named random streams** (`Genes` in `archetypes/index.ts`): every gene has its own stream, so pinning `length`
  never changes the wheels or the colour. Recipes can pin any gene by name via `set`.
- **Nodes are translation-only.** Local space = vehicle space minus an offset. Keeps the C# port and every importer simple.
- **Groups:** every node is in one group. `include` drops optional groups (and their children: no wheels ⇒ no brakes);
  `separate` decides whether panels and glass are their own nodes or welded into the body. The shell is the same either way.
- **Opening convention:** `door` markers open by rotating `max` radians about `axis` (right-hand rule); positive opens outward.
- **Driver on the left (+X).** Games mirror `Interior` for right-hand drive.

## Adding things

- **An era:** add a `StyleProfile` to `src/styles/index.ts` and its id to `StyleId`. Lamps, bumpers and rims come from
  the lists in the profile; a new lamp shape goes into `buildExterior`'s switch.
- **A type:** add dimensions to `DIMS` in `src/archetypes/index.ts`, a branch for its back end (roof/tail) and its doors
  and windows. Trucks with a separate box will need a second body (the cab is a short van front); that's next.
- **A part:** build it in vehicle space in `src/parts/`, put it on its own node with a `group` and a `noor.part`.
