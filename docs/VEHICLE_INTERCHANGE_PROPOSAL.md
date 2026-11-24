# Noor Interchange v0.5 proposal: vehicles

**Status:** Draft proposal from BadChopShop, 2026-11-24. Not part of Noor Interchange yet.
**Target:** NoorEngine `docs/interchange/NOOR_INTERCHANGE.md` (currently v0.4) and `noor.asset.schema.json`.

Noor Interchange says new marker types go into its table first, in one PR, before anyone uses them. This document is
that PR's draft. Everything here follows the existing golden rule: **standard glTF first, `extras` second, readable
names last.**

Design goals:
1. NoorEngine's Milestone 10 vehicles (Jolt `WheeledVehicleController` / `TrackedVehicleController`) can be built
   straight from this data.
2. Godot's `VehicleBody3D` / `VehicleWheel3D` (Baltic Drive), Unity's `WheelCollider` and Unreal's Chaos vehicles can
   be set up from it by a thin importer script.
3. Engines that read none of it still get a correct-looking, static model.

---

## 1. New kinds

Add to the `kind` list:

| Kind | Meaning |
|---|---|
| `vehicle.wheeled` | Cars, vans, trucks, buses, wheeled military |
| `vehicle.tracked` | Tanks, tracked APCs; half-tracks use this and also have wheel markers |

Plain `vehicle` stays valid for static props (a wreck with no driving data).

## 2. Space

Unchanged from v0.4: +Y up, **front faces +Z**, metres, kg; pivot at the bottom centre of the footprint, the ground at
y = 0 **with the vehicle at rest on its suspension** (wheels touching y = 0). Right side is −X (glTF is right-handed:
facing +Z with +Y up, +X is the vehicle's left).

> Importers whose vehicles drive towards −Z (Baltic Drive's `Car` today) rotate the root 180° about Y. Exports never do.

## 3. New markers

### 3.1 `vehicle.wheel`

An **empty node at the wheel's hub centre**, at rest height. Its child mesh node(s) are the wheel's visuals
(rim + tyre), so an engine can spin the marker about its local **X** axis and steer it about local **Y**. The wheel's
rolling direction is +Z.

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Stable, e.g. `w_fl`, `w_rr2` |
| `axle` | int | 0 = frontmost |
| `side` | `"left"` \| `"right"` \| `"center"` | `center` for motorbike-style single wheels |
| `radius` | m | Tyre outer radius |
| `width` | m | Tyre width |
| `steer` | rad | Maximum steering angle, signed: negative for rear-steer axles (opposite phase). 0 = not steered |
| `driven` | bool | Receives engine torque |
| `brake` | bool | Has a service brake (default true) |
| `handbrake` | bool | Has the handbrake (default: rear axles) |
| `suspension` | object | `{ "travel_up": m, "travel_down": m }` measured from rest; stiffness lives in the manifest's drive spec |
| `twin` | bool | Twin tyres (trucks): one physics wheel, wider visual |

Name fallback: `Wheel_FL`, `Wheel_RR2`, …

### 3.2 `vehicle.track` (tracked vehicles)

One empty node per side, at the centre of the track run.

| Field | Type | Meaning |
|---|---|---|
| `side` | `"left"` \| `"right"` | |
| `width` | m | Track width |
| `wheels` | string[] | Ids of `vehicle.wheel` markers on this side in order (sprocket, road wheels, idler); road wheels carry suspension |
| `sprocket` | string | Id of the driving wheel |
| `idler` | string | Id of the idler |
| `uv_scroll` | object | `{ "channel": "TEXCOORD_0", "axis": "v", "per_metre": 4.0 }`: how far the tread texture moves per metre travelled |

The track mesh is its own node with `"part": "track"`, so engines without track simulation can still scroll its UVs.

### 3.3 `seat`

Where a character sits. Node +Z faces forward, the node origin is the hip point on the seat cushion.

| Field | Type | Meaning |
|---|---|---|
| `role` | `"driver"` \| `"passenger"` \| `"gunner"` \| `"commander"` \| `"crew"` | |
| `index` | int | Order of filling, driver = 0 |
| `entry` | string | Id of the `door` or `entrance` marker used to get in |
| `exposed` | bool | Sitting in the open (jeep, turret hatch) |

### 3.4 `joint` (generic: turrets, guns, ramps, cranes; also useful to BadMechs)

A moving part that is **not** a door. The joint's children move with it.

| Field | Type | Meaning |
|---|---|---|
| `kind` | `"hinge"` \| `"slide"` | |
| `axis` | [x,y,z] | Local axis |
| `min`, `max` | rad or m | Limits; omit both for continuous (turret yaw) |
| `rest` | rad or m | Rest value (default 0) |
| `speed` | rad/s or m/s | Suggested maximum speed (turret traverse) |
| `role` | string | `turret.yaw`, `gun.pitch`, `ramp`, `tipper`, `crane`, … |

### 3.5 Existing markers, used by vehicles

| Marker | Vehicle use |
|---|---|
| `door` (v0.4) | Doors, hood, trunk, tailgate, hatches. **Add fields** `axis` [x,y,z], `max` (rad), and `opens` value `"hinge"`; `part` tells which (`door`, `hood`, `trunk`, `hatch`) |
| `entrance` (v0.4) | Where a character stands to get in, `kind: "vehicle"` (new value) |
| `socket` (v0.4) | `accepts`: `weapon.mount`, `cargo`, `tow.hitch`, `roof.rack`, `trailer` |
| `light` (v0.4) | Headlights are `KHR_lights_punctual` spots; the marker adds `role`: `head`, `high`, `brake`, `reverse`, `indicator.left`, `indicator.right`, `beacon`, and `material` (the emissive slot to switch, e.g. `MAT_LightBrake`) |
| `audio.emitter` (v0.4) | `sound`: `engine`, `exhaust`, `horn`, `siren`, `tracks` |
| `camera` (v0.4) | `role`: `chase`, `hood`, `cockpit`, `gunner` |
| new: `fx` | `effect`: `exhaust`, `muzzle`, `smoke`, `dust`; +Z is the emission direction |

### 3.6 Damage zones: `vehicle.zone`

Things that matter for damage but have no visible mesh of their own (engine, battery, fuel tank, ammo rack). An empty
node with `size` [x,y,z] (a box centred on the node) and `zone`: `engine`, `battery`, `fuel`, `ammo`, `crew`,
`transmission`. Visible damageable parts are tagged through `part` instead (section 4).

## 4. Part vocabulary additions

Add to the `part` list (v0.4 already has `door`, `window`, `hull`, `detail`): `body`, `panel`, `bumper`, `hood`,
`trunk`, `windshield`, `wheel`, `tyre`, `rim`, `light`, `mirror`, `interior`, `seat`, `chassis`, `armour`, `turret`,
`gun`, `track`, `running_gear`.

These line up with Baltic Drive's damage parts (`Engine, Battery, Tyre, Brakes, Suspension, Windshield, Window, Door,
Hood, Trunk, Seat`): visible ones via `part`, hidden ones via `vehicle.zone`, brakes and suspension via the wheel.

## 5. Collision

Unchanged rules. A wheeled vehicle exports a convex body hull (`"collision": "convex"`, `Body-convcolonly`) **without
wheels**: wheels are raycasts or shape casts in every engine listed. Tanks may add hulls for the turret
(`Turret-convcolonly`, child of the turret joint so it turns with it).

## 6. The manifest's `vehicle` block

A tool-independent top-level block (not a tool block), so engines read it without knowing who made the vehicle.
Physics values are **suggestions**; games tune them.

```json
"vehicle": {
  "v": 1,
  "class": "hatchback",
  "mass": 1150,
  "center_of_mass": [0.0, 0.48, 0.12],
  "drive": "front",
  "power": 7800,
  "top_kmh": 165,
  "grip": { "front": 1.7, "rear": 1.6 },
  "steer": 0.6,
  "brakes": 40,
  "suspension": { "stiffness": 30, "damping": [2.8, 3.8] },
  "engine": "front",
  "tank_l": 45,
  "consumption_l100km": 7,
  "boot_kg": 60,
  "seats": 4,
  "wheels": 4,
  "tracks": 0,
  "dimensions": { "length": 3.9, "width": 1.7, "height": 1.45, "wheelbase": 2.45, "track_front": 1.45, "track_rear": 1.44 }
}
```

| Field | Unit | Note |
|---|---|---|
| `mass` | kg | |
| `center_of_mass` | m, asset space | |
| `drive` | `front` \| `rear` \| `all` \| `tracks` | |
| `power` | N | Total pull at the driven wheels, as in Baltic Drive's `cars.json` (a deliberately simple model) |
| `top_kmh` | km/h | On roads |
| `grip.front`, `grip.rear` | ≈ g of cornering | |
| `steer` | rad | Lock at parking speed |
| `brakes` | N·m per wheel | |
| `suspension` | engine-agnostic springs (stiffness per kg of sprung mass) and damping [compression, rebound] | |
| `engine` | `front` \| `mid` \| `rear` | Where the engine zone is (also a `vehicle.zone`) |

The first nine fields are named after Baltic Drive's `CarSpec` (D98/D96/D123/D125) on purpose, so its importer is a
copy. NoorEngine's Milestone 10 may want more (gear ratios, torque curve); add them as optional fields in `v: 2`.

## 7. Open questions

1. Should `joint` be generic now (vehicles + BadMechs) or vehicle-only (`vehicle.joint`) until BadMechs adopts it?
   Proposal: generic.
2. Wheel visuals as children of the marker (proposed) vs. siblings referenced by id. Children make spinning trivial
   in every engine; the cost is one extra empty node per wheel.
3. Do trailers (semi + trailer) become two assets with a `trailer` socket on the tractor and a `hitch` marker on the
   trailer? Proposal: yes.
4. Units of `suspension.stiffness`: per kg (scales with mass, as in Baltic Drive) or N/m (what Jolt and Unity
   want)? Proposal: write both; `stiffness_n_per_m` alongside.
