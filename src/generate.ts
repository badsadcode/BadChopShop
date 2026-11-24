/**
 * generate(recipe): Recipe → Design → body + parts → Vehicle (a node tree ready for export).
 *
 * Node tree (names are stable; everything optional is switchable through recipe.include):
 *
 * Opening convention: a `door` marker opens by rotating `max` radians about `axis` (right-hand rule,
 * node-local), or for `opens: 'slide'` by moving `max` metres along it. Positive always opens outward.
 *
 *   Body                      body shell, shut lines, collision child
 *   ├─ Hood, Trunk|Tailgate   hinged panels (separate.panels)
 *   ├─ Door_FL, Door_FR, …    hinged doors, each with its Window_* child (separate.glass)
 *   ├─ Windshield, RearWindow, Window_QL/QR
 *   ├─ Lights_Front, Lights_Rear     lamps by function (MAT_LightHead, MAT_LightBrake, …)
 *   ├─ Interior, Engine, Battery, Exhaust
 *   ├─ Suspension_FL, …
 *   ├─ Wheel_FL (vehicle.wheel marker: steering pivot at the hub)
 *   │   ├─ Wheel_FL_Hub (spins about X: tyre, rim)
 *   │   │   └─ Wheel_FL_Disc (brakes)
 *   │   └─ Wheel_FL_Caliper (brakes, steers but does not spin)
 *   └─ Seat_Driver, Exhaust_FX, Camera_Chase … (markers)
 */
import type { Vec3 } from './core/math.js';
import { Mesh, faceted } from './core/mesh.js';
import type { Json, Slot, Vehicle } from './core/vehicle.js';
import { VehicleBuilder } from './core/vehicle.js';
import { doorCode, makeDesign, type Design } from './archetypes/index.js';
import { buildBody, planHalfWidth, type BodyResult } from './body/body.js';
import { buildWheel } from './parts/wheels.js';
import { buildExterior } from './parts/exterior.js';
import { buildInterior } from './parts/interior.js';
import { buildMechanicals } from './parts/mechanical.js';
import { materialsFor } from './materials.js';
import type { Include, Recipe } from './types.js';

export interface Generated {
  vehicle: Vehicle;
  design: Design;
  recipe: Recipe;
  body: BodyResult;
}

const SIDE = { L: 1, R: -1 } as const;

export function generate(recipe: Recipe): Generated {
  const design = makeDesign(recipe.type, recipe.style, recipe.seed, recipe.set ?? {}, recipe.palette, recipe.detail ?? 'low');
  const sp = design.body;
  const body = buildBody(sp);
  const name = `${cap(recipe.type)}_${recipe.style}_${recipe.seed}`;
  const vb = new VehicleBuilder(name, materialsFor(design));
  const sepPanels = recipe.separate?.panels !== false;
  const sepGlass = recipe.separate?.glass !== false;
  const inc: Include = recipe.include ?? {};

  // ------------------------------------------------------------------ body and panels
  vb.node('Body', { group: 'body', noor: { part: 'body' } });
  const panelNode = new Map<string, string>(); // bucket → node name
  const W = (z: number): number => planHalfWidth(sp, z);
  if (sepPanels) {
    vb.node('Hood', {
      parent: 'Body', group: 'body', pivot: [0, sp.top.length ? body.sectionAt(sp.cowlZ + 0.02).H : 1, sp.cowlZ + 0.02],
      noor: { part: 'hood', marker: 'door', id: 'hood', axis: [-1, 0, 0], max: 1.1, opens: 'up' },
    });
    panelNode.set('hood', 'Hood');
    if (sp.trunk) {
      const z = sp.trunk[1];
      vb.node('Trunk', { parent: 'Body', group: 'body', pivot: [0, body.sectionAt(z).H, z], noor: { part: 'trunk', marker: 'door', id: 'trunk', axis: [1, 0, 0], max: 1.2, opens: 'up' } });
      panelNode.set('trunk', 'Trunk');
    }
    if (sp.tailgate && !sp.uprightRear) {
      const z = sp.roofRearZ;
      vb.node('Tailgate', { parent: 'Body', group: 'body', pivot: [0, body.sectionAt(z).H, z], noor: { part: 'trunk', marker: 'door', id: 'tailgate', axis: [1, 0, 0], max: 1.4, opens: 'up' } });
      panelNode.set('tailgate', 'Tailgate');
    }
    for (const d of sp.doors) {
      for (const side of ['L', 'R'] as const) {
        const nm = `Door_${doorCode(d.id)}${side}`;
        const z = d.slide ? d.z0 : d.z1;
        const sec = body.sectionAt(z);
        const pivot: Vec3 = [SIDE[side] * sec.W, (sec.B + sec.L) / 2, z];
        vb.node(nm, {
          parent: 'Body', group: 'body', pivot,
          noor: d.slide
            ? { part: 'door', marker: 'door', id: nm.toLowerCase(), axis: [0, 0, -1], max: 0.95, opens: 'slide' }
            : { part: 'door', marker: 'door', id: nm.toLowerCase(), axis: [0, -SIDE[side], 0], max: 1.15, opens: 'hinge' },
        });
        panelNode.set(`door_${d.id}_${side}`, nm);
      }
    }
  }
  const nodeFor = (bucket: string): string => panelNode.get(bucket) ?? 'Body';

  // glass buckets → window nodes
  const glassNode = (bucket: string): { node: string; parent: string } => {
    if (bucket === 'windshield') return { node: 'Windshield', parent: 'Body' };
    if (bucket === 'rear_window') return { node: 'RearWindow', parent: panelNode.has('tailgate') ? 'Tailgate' : 'Body' };
    const m = /^win_(\w+)_(L|R)$/.exec(bucket)!;
    const win = sp.windows.find((w) => w.id === m[1])!;
    const parent = win.door ? nodeFor(`door_${win.door}_${m[2]}`) : 'Body';
    return { node: `Window_${doorCode(win.id)}${m[2]}`, parent };
  };

  for (const [bucket, slots] of body.buckets) {
    const isGlass = bucket === 'windshield' || bucket === 'rear_window' || bucket.startsWith('win_');
    let target: string;
    if (isGlass) {
      const g = glassNode(bucket);
      if (sepGlass) {
        if (!vb.has(g.node)) vb.node(g.node, { parent: g.parent, group: 'body', noor: { part: bucket === 'windshield' ? 'windshield' : 'window' } });
        target = g.node;
      } else target = g.parent;
    } else target = nodeFor(bucket);
    for (const [slot, m] of slots) vb.add(target, slot, m);
  }
  // opening panels get an inner skin (door cards, the underside of the hood) so they're solid when open
  for (const [bucket, node] of panelNode) {
    const paint = body.buckets.get(bucket)?.get('MAT_Paint');
    if (!paint) continue;
    const inner = paint.clone().flip();
    // pull the inner skin in a little along its own normals
    for (let i = 0; i < inner.vertexCount; i++) {
      for (let k = 0; k < 3; k++) inner.positions[3 * i + k] += inner.normals[3 * i + k] * 0.025;
    }
    vb.add(node, bucket.startsWith('door') ? 'MAT_Interior' : 'MAT_Underbody', inner);
  }
  vb.add('Body', 'MAT_Trim', body.shutLines);
  // the cabin's inner skin is part of the body, so the car is never see-through, interior or not
  vb.add('Body', 'MAT_Interior', body.liner);
  if (inc.collision !== false) vb.setCollision('Body', body.collision);

  // ------------------------------------------------------------------ wheels
  const R = sp.wheelRadius;
  const wheelX = (z: number): number => W(z) - sp.tyreWidth / 2 - 0.02;
  const wheels: { id: string; z: number; side: 'L' | 'R'; front: boolean }[] = [];
  for (const [axle, z] of [['F', sp.frontAxleZ], ['R', sp.rearAxleZ]] as const) {
    for (const side of ['L', 'R'] as const) wheels.push({ id: `${axle}${side}`, z, side, front: axle === 'F' });
  }
  const wheelGeo = buildWheel(R, design.rimRadius, sp.tyreWidth, design.rim, sp.detail === 'low');
  for (const w of wheels) {
    const x = SIDE[w.side] * wheelX(w.z);
    const nm = `Wheel_${w.id}`;
    vb.node(nm, {
      parent: 'Body', group: 'wheels', pivot: [x, R, w.z],
      noor: {
        marker: 'vehicle.wheel', id: `w_${w.id.toLowerCase()}`, axle: w.front ? 0 : 1, side: w.side === 'L' ? 'left' : 'right',
        radius: round(R), width: round(sp.tyreWidth), steer: w.front ? 0.6 : 0, driven: true, brake: true, handbrake: !w.front,
        suspension: { travel_up: 0.09, travel_down: 0.11 },
        spin_node: `${nm}_Hub`,
      },
    });
    const place = (m: Mesh): Mesh => {
      const c = m.clone();
      if (w.side === 'R') c.mirrorX();
      return c.translate([x, R, w.z]);
    };
    vb.node(`${nm}_Hub`, { parent: nm, group: 'wheels', pivot: [x, R, w.z], noor: { part: 'wheel', spin: [1, 0, 0] } });
    vb.add(`${nm}_Hub`, 'MAT_Rubber', place(wheelGeo.tyre));
    vb.add(`${nm}_Hub`, 'MAT_Rim', place(wheelGeo.rim));
    vb.add(`${nm}_Hub`, 'MAT_Chrome', place(wheelGeo.chrome));
    vb.node(`${nm}_Disc`, { parent: `${nm}_Hub`, group: 'brakes', pivot: [x, R, w.z], noor: { part: 'brakes' } });
    vb.add(`${nm}_Disc`, 'MAT_Metal', place(wheelGeo.disc));
    vb.node(`${nm}_Caliper`, { parent: nm, group: 'brakes', pivot: [x, R, w.z], noor: { part: 'brakes' } });
    vb.add(`${nm}_Caliper`, 'MAT_Brake', place(wheelGeo.caliper));
  }

  // ------------------------------------------------------------------ exterior details, interior, mechanicals
  buildExterior(vb, design, body);
  buildInterior(vb, design, body);
  buildMechanicals(vb, design, body, wheels.map((w) => ({ name: `Wheel_${w.id}`, x: SIDE[w.side] * wheelX(w.z), z: w.z, side: SIDE[w.side] })));

  // ------------------------------------------------------------------ markers
  addMarkers(vb, design, body);

  // low-poly look: flat shading everywhere
  if (sp.detail === 'low') for (const n of vb.nodes) for (const [slot, m] of n.meshes) n.meshes.set(slot, faceted(m));

  const vehicle = vb.build({
    wheels: inc.wheels, brakes: inc.brakes, suspension: inc.suspension, lights: inc.lights, interior: inc.interior,
    engine: inc.engine, battery: inc.battery, exhaust: inc.exhaust, markers: inc.markers, collision: inc.collision,
  });
  if (inc.wheels === false) for (const n of vehicle.nodes) void n;
  return { vehicle, design, recipe, body };
}

function addMarkers(vb: VehicleBuilder, d: Design, body: BodyResult): void {
  const sp = d.body;
  const front = sp.doors[0];
  const seatZ = front ? (front.z0 + front.z1) / 2 - 0.15 : 0;
  const sec = body.sectionAt(seatZ);
  const hipY = sec.B + 0.32;
  const seat = (name: string, x: number, z: number, role: string, index: number, entry: string): void => {
    vb.node(name, { parent: 'Body', group: 'markers', pivot: [x, hipY, z], noor: { marker: 'seat', id: name.toLowerCase(), role, index, entry } });
  };
  const sx = sp.halfWidth * 0.42;
  // driver on the left side of the car (+X); a game can mirror for right-hand drive
  seat('Seat_Driver', sx, seatZ, 'driver', 0, 'door_fl');
  seat('Seat_Passenger', -sx, seatZ, 'passenger', 1, 'door_fr');
  if (d.rows > 1) {
    const rz = seatZ - 0.82;
    seat('Seat_RearL', sx, rz, 'passenger', 2, d.doorCount > 2 ? 'door_rl' : 'door_fl');
    seat('Seat_RearR', -sx, rz, 'passenger', 3, d.doorCount > 2 ? 'door_rr' : 'door_fr');
  }
  const tail = -sp.length / 2;
  vb.node('Exhaust_FX', { parent: 'Body', group: 'markers', pivot: [-sp.halfWidth * 0.55, sp.bottom[0][1] - 0.04, tail - 0.02], noor: { marker: 'fx', id: 'exhaust', effect: 'exhaust', tags: ['dir:-z'] } });
  vb.node('Camera_Chase', { parent: 'Body', group: 'markers', pivot: [0, sp.top.reduce((a, p) => Math.max(a, p[1]), 0) + 1.2, tail - 4.5], noor: { marker: 'camera', id: 'chase', role: 'chase', fov: 1.05 } });
  vb.node('Sound_Engine', { parent: 'Body', group: 'markers', pivot: [0, 0.7, sp.length / 2 - 0.6], noor: { marker: 'audio.emitter', id: 'engine', sound: 'engine', radius: 40 } });
}

const cap = (s: string): string => s[0].toUpperCase() + s.slice(1);
const round = (x: number): number => Math.round(x * 1e4) / 1e4;

export type { Json, Slot };
