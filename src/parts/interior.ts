/**
 * Interior: seats, dashboard, steering wheel, and (vans) a bulkhead behind the cab.
 * Low-poly blocks: it's seen through glass, and in Project Zomboid-style games, from above.
 * The driver sits on the LEFT (+X); games can mirror the Interior node for right-hand drive.
 */
import type { Vec3 } from '../core/math.js';
import { sampleAt } from '../core/curve.js';
import { box, latheX, Mesh } from '../core/mesh.js';
import type { VehicleBuilder } from '../core/vehicle.js';
import { frontSeatZ, type Design } from '../archetypes/index.js';
import type { BodyResult } from '../body/body.js';
import { planHalfWidth } from '../body/body.js';

/**
 * A seat sized to the cabin: `room` is the height from the floor to the roof lining above it.
 * Real seats: cushion ~0.28 m up, backrest to ~0.85, headrest to ~0.95; scaled down in low cars.
 */
function seat(x: number, floorY: number, z: number, w: number, room: number, bench = false): Mesh {
  const m = new Mesh();
  const k = Math.min(1, (room - 0.12) / 0.95);
  const cushionH = 0.26 * k, backH = (bench ? 0.44 : 0.52) * k, headH = 0.13 * k;
  const cushionTop = floorY + cushionH;
  m.merge(box([x, floorY + cushionH / 2, z + 0.04], [w, cushionH, 0.5], 0.03));
  m.merge(box([x, cushionTop + backH / 2, z - 0.24], [w * (bench ? 1 : 0.92), backH, 0.12], 0.03));
  if (!bench) m.merge(box([x, cushionTop + backH + 0.03 + headH / 2, z - 0.25], [w * 0.55, headH, 0.1], 0.02));
  return m;
}

export function buildInterior(vb: VehicleBuilder, d: Design, body: BodyResult): void {
  const sp = d.body;
  const seatZ = frontSeatZ(sp);
  const sec = body.sectionAt(seatZ);
  const floorY = sec.B + 0.12;
  const innerW = planHalfWidth(sp, seatZ) - 0.12;
  vb.node('Interior', { parent: 'Body', group: 'interior', pivot: [0, floorY, seatZ], noor: { part: 'interior' } });

  const sx = sp.halfWidth * 0.42;
  const room = (zz: number): number => body.sectionAt(zz).H - 0.06 - floorY;
  const seatW = Math.min(0.52, innerW * 0.75);
  if (d.type === 'van' || d.type === 'truck') {
    vb.add('Interior', 'MAT_Seat', seat(sx, floorY, seatZ, seatW, room(seatZ - 0.25)));
    vb.add('Interior', 'MAT_Seat', seat(-sx * 0.75, floorY, seatZ, innerW * 1.05, room(seatZ - 0.25), true));
    // bulkhead between the cab and the cargo area
    const bz = seatZ - 0.45;
    const top = body.sectionAt(bz).H - 0.08;
    vb.add('Interior', 'MAT_Interior', box([0, (floorY + top) / 2, bz], [innerW * 2, top - floorY, 0.04]));
  } else {
    vb.add('Interior', 'MAT_Seat', seat(sx, floorY, seatZ, seatW, room(seatZ - 0.25)));
    vb.add('Interior', 'MAT_Seat', seat(-sx, floorY, seatZ, seatW, room(seatZ - 0.25)));
    const rz = seatZ - 0.82;
    if (rz > sp.glassEndZ + 0.3 || sp.tailgate) vb.add('Interior', 'MAT_Seat', seat(0, floorY, rz, innerW * 1.75, room(rz - 0.25), true));
  }

  // dashboard: a slab under the windshield base
  const dashZ = sp.cowlZ - 0.22;
  const belt = sampleAt(sp.belt, dashZ);
  const dashW = planHalfWidth(sp, dashZ) * 2 - 0.2;
  vb.add('Interior', 'MAT_Interior', box([0, belt - 0.1, dashZ], [dashW, 0.24, 0.42], 0.04));
  // steering wheel: a low-poly ring on a column, facing the driver
  const wz = dashZ - 0.3, wy = belt + 0.02;
  const ring = latheX([[0.17, -0.015], [0.19, 0], [0.17, 0.015], [0.15, 0]], sp.detail === 'low' ? 10 : 24, true);
  // lathe is round X; turn it to face -Z (toward the driver), tilted back a little
  const tilt = 0.35;
  const basis = { x: [0, Math.sin(tilt), -Math.cos(tilt)] as Vec3, y: [0, Math.cos(tilt), Math.sin(tilt)] as Vec3, z: [1, 0, 0] as Vec3 };
  vb.add('Interior', 'MAT_Trim', ring.transform(basis, [sx, wy, wz]));
  vb.add('Interior', 'MAT_Trim', box([sx, wy - 0.06, wz + 0.15], [0.05, 0.05, 0.3]));
}
