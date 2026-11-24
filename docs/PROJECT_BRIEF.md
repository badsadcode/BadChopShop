# BadChopShop

**Procedural, game-ready vehicle generator**
**Project brief** · Bad Ideas Works · Written 2026-11-24 (Tom + Sage) · Status: v0.1 running (civilian cars)

> **Core idea:** vehicle type + style + seed = a reproducible, good-looking, already-painted vehicle that a game can
> actually *drive*, from a rusty hatchback to a main battle tank.

## 1. What we're building

BadChopShop is a procedural generator of complete 3D vehicles: civilian cars, vans, trucks and buses, military
vehicles, armour. It is a sibling of BadGun, BadCharacters, BadMechs, BadShip and BadBuilding, and it follows the same
house rules:

- **Engine-agnostic.** Plain glTF 2.0 binary (`.glb`) plus small JSON sidecars. No runtime, no plugin, no engine code.
- **Deterministic.** Same generator version + recipe + seed ⇒ same vehicle. Every decision draws from a *named* random
  stream, so rerolling the wheels never reshuffles the roof.
- **Painted on arrival.** Style-appropriate PBR materials in semantic slots, several palettes per style.
- **Honest status.** Validator results are reported, not assumed; untested engines are marked untested.

What makes it different from the siblings: **a vehicle is not a prop, it's a machine a game must drive.** The real
product is the *vehicle contract*, the data that lets an engine turn the model into a working car without anyone
rigging wheels by hand. See [`VEHICLE_INTERCHANGE_PROPOSAL.md`](VEHICLE_INTERCHANGE_PROPOSAL.md).

### Where it lives

| When | Home |
|---|---|
| Now | This repository: a TypeScript library + CLI + web playground, the same style as BadGun and BadCharacters, with a devlog and GitHub Pages |
| Later, once polished | A bench in **NoorForge**, the Windows desktop (C#) home app for all Bad Ideas Works asset generators. The generators move out of NoorMD into NoorForge to unclutter NoorMD |

The port to C# is expected and planned for (section 7).

## 2. Vehicle types and styles

**Type** (archetype) owns proportions, layout and the parts list. **Style** owns design language, part choices and
palettes. They are independent: a new style works with every type, a new type works with every style. Odd
combinations (a cyberpunk tank, a seventies MRAP) are features, not bugs; special rules can be added progressively.

**Types (expandable)**

| Family | Types |
|---|---|
| Civilian | hatchback, sedan, estate/wagon, coupe, SUV, pickup, minivan, panel van, microcar |
| Commercial / heavy | box truck, flatbed, tipper, semi tractor (+ trailer later), bus, minibus, tractor (farm) |
| Service | police, ambulance, fire engine, taxi, ice-cream van (variants of the above with liveries, lights and kit) |
| Military, wheeled | light utility (jeep), military truck, APC (4×4, 8×8), MRAP, armoured car |
| Military, tracked | main battle tank, light tank, tracked APC/IFV, self-propelled gun |
| Later / odd | half-tracks, buggies, motorbikes, hovercraft, sci-fi hover vehicles |

**Styles (expandable)**

| Style | Design language |
|---|---|
| Modern | Contemporary, rounded, flush glass, LED strips |
| Seventies | 1970s–80s boxy saloons and vans, chrome bumpers, round lamps, an Eastern-bloc flavour (fits Baltic Drive) |
| Wasteland | Post-apocalyptic: rust, plates welded on, bull bars, roof racks, mismatched panels (fits Dead Miles) |
| WW2 | Rivets, flat armour, spoked or split rims, period paint |
| Cold War | Sloped cast armour, box-like trucks, NATO and Warsaw Pact paint schemes |
| Sci-fi | Clean panels, emissive strips, covered wheels |
| Cyberpunk | Aggressive wedges, neon, aftermarket clutter |

Military types also get **camouflage palettes** (woodland, desert, winter, urban) independent of style.

All designs are fictional. No real manufacturers, badges or recognisable trademarked shapes: each type should read
clearly as "a pickup" without being "a Ford".

## 3. The look

**Low-poly, faceted, flat-coloured: Synty POLYGON / Project Zomboid style** (Tom, 2026-11-24). Chunky chamfers, flat
shading, readable silhouettes, one material per surface type. A vehicle should look designed for a particular game,
not assembled from random parts. A smooth `detail: 'high'` mode exists for later (and for LODs the other way round).

Budgets (LOD0, adjustable): car ~5–6k triangles for the exterior, ~6–9k with every part (interior, engine, suspension…);
trucks/buses later ~10–15k; tanks ~15–20k.

## 4. How the geometry works (the honest engineering problem)

Guns, ships and mechs are mostly hard edges. Civilian cars are **smooth**, and smooth is where procedural cars
usually turn into soap bars. Two body kernels:

1. **Smooth kernel (civilian).** The body is lofted along its length from three curves: a **side profile**, a **plan
   (top) outline**, and a **superellipse cross-section** whose exponent slides from boxy to round (the same trick
   BadCharacters uses for limbs). The greenhouse (cabin + glass) is a separate loft sitting on the body's belt line.
   Then wheel arches are cut, panel gaps and shut lines are added as shallow grooves, and lamps, grille, mirrors,
   handles and bumpers are attached as parts.
2. **Hard kernel (military, heavy).** Flat and sloped plates, chamfered boxes, bolt-on kit (stowage, jerry cans,
   smoke launchers), closer to BadShip's construction. A tank is a hull + turret + tracks + running gear.

Proving the smooth kernel is milestone 1. If a generated hatchback looks good, the rest is work; if it doesn't,
nothing else matters.

## 5. What every vehicle ships with

- **Separate, correctly pivoted moving parts:** wheels (at hub centres), steering, doors, hood, trunk/tailgate, ramps,
  turret (yaw) and gun (pitch), hatches.
- **Semantic material slots**, shared and stable across regenerations: `MAT_Paint`, `MAT_Paint2` (two-tone/livery),
  `MAT_Trim`, `MAT_Chrome`, `MAT_Plastic`, `MAT_Rubber`, `MAT_Rim`, `MAT_Glass`, `MAT_Interior`, `MAT_Underbody`,
  `MAT_LightHead`, `MAT_LightBrake`, `MAT_LightIndicator`, `MAT_LightBeacon`, `MAT_Armour`, `MAT_Track`.
  Light slots are emissive and separate so a game can switch them on and off.
- **Two UV sets** like BadGun: tiling (1 UV unit = 0.25 m) and a non-overlapping atlas.
- **Driving data:** wheel markers with radius, width, axle, steering and drive flags, suspension rest and travel; a
  drive spec (mass, centre of mass, power, drive wheels, grip, brakes, springs); tracks for tracked vehicles.
- **Sockets:** seats (driver first), exhaust, mounted gun, cargo bed, tow hitch, camera suggestions.
- **Damage-ready parts:** parts named and tagged so a game's damage system (e.g. Baltic Drive's engine, battery,
  tyres, windshield, windows, doors, hood, trunk, seats) can map hits to parts without extra setup.
- **Collision:** a convex body hull (plus optional extra hulls), never rendered.
- **Interior:** a simple, low-detail cabin (seats, dashboard, wheel), visible through the glass.
- **Separate, switchable parts** (Tom, for Baltic Drive): interior, engine, battery, exhaust, wheels (tyre + rim),
  brakes (disc + caliper), suspension (spring + damper + arm), lights, windshield and windows, doors, hood, trunk/tailgate,
  mirrors, bumpers. Not every game needs them, so every optional group can be switched off (`include`), and doors,
  hood, trunk and glass can be their own nodes or welded into the body (`separate`).

## 6. Output and compatibility

Output follows **Noor Interchange** (NoorEngine `docs/interchange/NOOR_INTERCHANGE.md`, v0.4):

```
hatchback_42.glb          LOD0, materials, markers, collision
hatchback_42.lod1.glb     lower levels of detail
hatchback_42.noor.json    manifest (kind "vehicle.wheeled"), incl. the drive spec
hatchback_42.recipe.json  everything needed to regenerate it (seed, version)
hatchback_42.preview.png  thumbnail
```

- +Y up, front faces **+Z**, metres, kilograms, pivot at bottom centre on the ground.
- Vehicle-specific markers and the manifest's `vehicle` block are **not in Noor Interchange yet**. The interchange
  rules say new markers go into its table first, so BadChopShop proposes them as **v0.5**
  ([`VEHICLE_INTERCHANGE_PROPOSAL.md`](VEHICLE_INTERCHANGE_PROPOSAL.md)) before relying on them.

| Consumer | How it uses BadChopShop |
|---|---|
| **NoorEngine** | Native import (Noor Interchange). Vehicles are planned for Milestone 10 (master spec §19.3) on Jolt, which has wheeled and tracked vehicle controllers; the proposal is written so that work can read it directly |
| **Baltic Drive** (Godot 4.7, `VehicleBody3D`) | First real customer. Replace the Quaternius pickup; the manifest's drive spec maps onto `GameData/cars.json` fields. Note: Baltic Drive's car faces −Z today; exports stay +Z and the importer turns them |
| **Dead Miles** | Wasteland style, wrecks |
| Unity / Unreal / Blender | Plain glTF; wheel data readable from node `extras` (Blender custom properties) and the manifest. Thin adapter scripts later, untested until tested |

## 7. Technology

- **TypeScript**, same style as BadGun and BadCharacters (see [`ARCHITECTURE.md`](ARCHITECTURE.md)): a library with zero runtime dependencies, a CLI
  (`badchopshop generate hatchback --style seventies --seed 42`), a web playground (three.js) with
  🎲 *Surprise me* and download, a devlog, and tests (determinism, Khronos validator clean, stress).
- **Port-friendly core.** The generator core does not touch the DOM, three.js or Node APIs: plain data in, plain
  data out, its own GLB writer. three.js lives only in the playground. Code shall remain understandable to whichever
  AI inherits this mess, and in this case that AI will be rewriting it in C# for NoorForge.
- **Recipes are the stable contract across the port.** A C# BadChopShop should read the same recipe files and
  produce the same vehicle. Byte-identical GLBs across languages are a goal, not a promise (floating-point maths
  functions can differ), so tests compare geometry within a tolerance and choices exactly.

## 8. Milestones

| # | Goal | Done when |
|---|---|---|
| 0 | Scaffold: repo, CLI, playground, GLB writer, validator, determinism test | ✅ done (v0.1) |
| 1 | **Body kernel**, civilian first: hatchback, sedan, estate, panel van × seventies, nineties, modern, low-poly | ✅ done (v0.1), Tom to approve the look |
| 2 | Vehicle contract: wheels, doors, hood, trunk, lights, seats, collision, drive spec, separate parts | ✅ in the files (v0.1); ⏳ the v0.5 proposal reviewed, and a car driving in Baltic Drive with no hand tuning |
| 2b | **Delivery trucks** (cab + box, twin rear wheels), door jambs, LOD1/LOD2 | next |
| 3 | Pickup, light utility (jeep); Wasteland style; camo palettes | Lineup render of all types × styles |
| 4 | **Hard kernel + tracks**: main battle tank | A tank whose turret turns and tracks scroll, in the playground |
| 5 | Breadth: trucks, bus, APC, service variants, LODs, texture bakes | The family photo for the README |
| — | Port to C# as a NoorForge bench | When NoorForge is ready for generators |

## 9. Not goals (for now)

Real-world brands or replicas; full vehicle simulation (that's the engine's job; we provide data); deformable crash
meshes; detailed engine bays; aircraft and boats (BadShip covers spaceships; aircraft could be a later sibling).
