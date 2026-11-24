/**
 * Interior: seats, dashboard, steering wheel, and (vans) a bulkhead behind the cab.
 * Low-poly blocks: it's seen through glass, and in Project Zomboid-style games, from above.
 * The driver sits on the LEFT (+X); games can mirror the Interior node for right-hand drive.
 */
import type { Vec3 } from '../core/math.js';
import { sampleAt } from '../core/curve.js';
import { box, latheX, Mesh } from '../core/mesh.js';
import type { VehicleBuilder } from '../core/vehicle.js';
import type { Design } from '../archetypes/index.js';
import type { BodyResult } from '../body/body.js';
import { planHalfWidth } from '../body/body.js';

function seat(x: number, floorY: number, z: number, w: number, bench = false): Mesh {
  const m = new Mesh();
  const cushionTop = floorY + 0.28;
  m.merge(box([x, floorY + 0.14, z + 0.04], [w, 0.28, 0.5], 0.03));
  const back = bench ? 0.46 : 0.6;
  m.merge(box([x, cushionTop + back / 2, z - 0.24], [w * (bench ? 1 : 0.92), back, 0.12], 0.03));
  if (!bench) m.merge(box([x, cushionTop + 0.7, z - 0.25], [w * 0.55, 0.16, 0.1], 0.02));
  return m;
}

export function buildInterior(vb: VehicleBuilder, d: Design, body: BodyResult): void {
  const sp = d.body;
  const front = sp.doors[0];
  const seatZ = (front.z0 + front.z1) / 2 - 0.15;
  const sec = body.sectionAt(seatZ);
  const floorY = sec.B + 0.12;
  const innerW = planHalfWidth(sp, seatZ) - 0.12;
  vb.node('Interior', { parent: 'Body', group: 'interior', pivot: [0, floorY, seatZ], noor: { part: 'interior' } });

  const sx = sp.halfWidth * 0.42;
  const seatW = Math.min(0.52, innerW * 0.75);
  if (d.type === 'van' || d.type === 'truck') {
    vb.add('Interior', 'MAT_Seat', seat(sx, floorY, seatZ, seatW));
    vb.add('Interior', 'MAT_Seat', seat(-sx * 0.75, floorY, seatZ, innerW * 1.05, true));
    // bulkhead between the cab and the cargo area
    const bz = seatZ - 0.45;
    const top = body.sectionAt(bz).H - 0.08;
    vb.add('Interior', 'MAT_Interior', box([0, (floorY + top) / 2, bz], [innerW * 2, top - floorY, 0.04]));
  } else {
    vb.add('Interior', 'MAT_Seat', seat(sx, floorY, seatZ, seatW));
    vb.add('Interior', 'MAT_Seat', seat(-sx, floorY, seatZ, seatW));
    const rz = seatZ - 0.82;
    if (rz > sp.glassEndZ + 0.3 || sp.tailgate) vb.add('Interior', 'MAT_Seat', seat(0, floorY, rz, innerW * 1.75, true));
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
