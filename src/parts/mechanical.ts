/**
 * The oily bits: engine, battery, exhaust, suspension, plus damage-zone markers.
 *
 * Each is its own node so a game can hide it, show it when the hood opens, take it out in a
 * workshop, or break it (Baltic Drive's parts: engine, battery, tyres, brakes, suspension…).
 * Engines sit in the engine bay under the hood; the hood closed means they're hidden but there.
 */
import type { Vec3 } from '../core/math.js';
import { sampleAt } from '../core/curve.js';
import { Mesh, box, cylinderX, tubePath } from '../core/mesh.js';
import type { VehicleBuilder } from '../core/vehicle.js';
import type { Design } from '../archetypes/index.js';
import type { BodyResult } from '../body/body.js';
import { planHalfWidth } from '../body/body.js';

export interface WheelPlace { name: string; x: number; z: number; side: number }

const turnY = (m: Mesh): Mesh => m.transform({ x: [0, 0, -1], y: [0, 1, 0], z: [1, 0, 0] });

export function buildMechanicals(vb: VehicleBuilder, d: Design, body: BodyResult, wheels: WheelPlace[] = []): void {
  const sp = d.body;
  const low = sp.detail === 'low';
  const zN = sp.length / 2;
  const bayFront = Math.min(zN - 0.25, sp.frontAxleZ + 0.45);
  const bayRear = sp.cowlZ + 0.05;
  const bayZ = (bayFront + Math.max(bayRear, sp.frontAxleZ - 0.25)) / 2;
  const floor = sampleAt(sp.bottom, bayZ) + 0.08;
  const hoodY = body.sectionAt(bayZ).H - 0.06;
  const bayW = planHalfWidth(sp, bayZ) - sp.wellDepth - 0.02;

  // ------------------------------------------------------------------ engine
  const blockH = Math.min(0.42, hoodY - floor - 0.12);
  const blockL = Math.min(0.55, (bayFront - bayRear) * 0.7 + 0.25);
  const ez = bayZ;
  vb.node('Engine', { parent: 'Body', group: 'engine', pivot: [0, floor, ez], noor: { part: 'engine' } });
  const blockW = Math.min(0.5, bayW * 1.2);
  vb.add('Engine', 'MAT_Engine', box([0, floor + blockH * 0.45, ez], [blockW * 0.75, blockH * 0.9, blockL], 0.02));
  vb.add('Engine', 'MAT_Paint2', box([0, floor + blockH * 0.97, ez], [blockW * 0.6, 0.06, blockL * 0.9], 0.015)); // valve cover
  vb.add('Engine', 'MAT_Metal', box([blockW * 0.42, floor + blockH * 0.55, ez], [0.08, 0.06, blockL * 0.85])); // manifold
  // air filter
  vb.add('Engine', 'MAT_Plastic', cylinderX(0.12, 0.08, low ? 8 : 20).transform({ x: [0, 1, 0], y: [-1, 0, 0], z: [0, 0, 1] }, [-blockW * 0.15, floor + blockH + 0.06, ez]));
  // radiator in front of the engine
  const radZ = Math.min(bayFront, zN - 0.2);
  vb.add('Engine', 'MAT_Trim', box([0, floor + blockH * 0.55, radZ], [Math.min(0.75, bayW * 1.8), blockH * 0.9, 0.05]));
  // gearbox behind
  vb.add('Engine', 'MAT_Engine', box([0, floor + 0.12, ez - blockL / 2 - 0.15], [0.3, 0.22, 0.3], 0.03));

  // ------------------------------------------------------------------ battery
  const bx = -Math.min(bayW * 0.75, blockW * 0.5 + 0.17);
  const by = floor + Math.max(0.15, blockH * 0.45);
  const bz = ez + blockL * 0.2;
  vb.node('Battery', { parent: 'Body', group: 'battery', pivot: [bx, by, bz], noor: { part: 'battery' } });
  vb.add('Battery', 'MAT_Plastic', box([bx, by + 0.09, bz], [0.18, 0.18, 0.26], 0.01));
  vb.add('Battery', 'MAT_LightBrake', box([bx + 0.05, by + 0.195, bz + 0.08], [0.03, 0.03, 0.03]));
  vb.add('Battery', 'MAT_Metal', box([bx + 0.05, by + 0.195, bz - 0.08], [0.03, 0.03, 0.03]));

  // ------------------------------------------------------------------ exhaust
  const tailZ = -sp.length / 2;
  const under = (z: number): number => sampleAt(sp.bottom, z) - 0.035;
  const ex = -sp.halfWidth * 0.55;
  const path: Vec3[] = [];
  const zStart = ez - 0.1;
  const zEnd = tailZ - 0.03;
  const N = low ? 6 : 16;
  for (let k = 0; k <= N; k++) {
    const z = zStart + ((zEnd - zStart) * k) / N;
    const x = (k / N) ** 1.5 * ex - 0.08 * (1 - k / N);
    path.push([x, Math.max(0.08, under(z)), z]);
  }
  path[0] = [-0.08, floor + 0.1, zStart];
  vb.node('Exhaust', { parent: 'Body', group: 'exhaust', pivot: [ex, under(tailZ + 0.4), tailZ], noor: { part: 'exhaust' } });
  vb.add('Exhaust', 'MAT_Metal', tubePath(path, 0.028, low ? 6 : 12));
  const mufZ = tailZ + Math.min(0.75, sp.length * 0.17);
  vb.add('Exhaust', 'MAT_Metal', box([ex * 0.85, under(mufZ) + 0.02, mufZ], [0.26, 0.14, 0.45], 0.03));
  vb.add('Exhaust', 'MAT_Trim', turnY(cylinderX(0.024, 0.02, low ? 6 : 12)).transform(undefined, [ex, path[N][1], zEnd - 0.01]));

  // ------------------------------------------------------------------ suspension (one per wheel, attached to the body)
  for (const w of wheels) {
    const nm = w.name.replace('Wheel_', 'Suspension_');
    const R = sp.wheelRadius;
    const hubIn = w.x - w.side * (sp.tyreWidth / 2 + 0.06);
    const topY = R + sp.archGap + R * 0.75;
    vb.node(nm, { parent: 'Body', group: 'suspension', pivot: [hubIn, R, w.z], noor: { part: 'suspension' } });
    // coil spring
    const coil: Vec3[] = [];
    const turns = low ? 4 : 5, steps = low ? turns * 5 : turns * 16;
    const y0 = R + 0.06, y1 = topY;
    for (let k = 0; k <= steps; k++) {
      const a = (k / steps) * turns * Math.PI * 2;
      coil.push([hubIn + Math.cos(a) * 0.06, y0 + ((y1 - y0) * k) / steps, w.z + Math.sin(a) * 0.06]);
    }
    vb.add(nm, 'MAT_Brake', tubePath(coil, 0.009, low ? 3 : 8));
    // damper and lower arm
    vb.add(nm, 'MAT_Metal', box([hubIn, (y0 + y1) / 2, w.z], [0.035, y1 - y0 + 0.08, 0.035]));
    const armIn = w.side * 0.25;
    vb.add(nm, 'MAT_Underbody', box([(hubIn + armIn) / 2, R - 0.08, w.z], [Math.abs(hubIn - armIn), 0.04, 0.08]));
  }

  // ------------------------------------------------------------------ damage zones (hidden parts games aim at)
  const zones: [string, Vec3, Vec3, string][] = [
    ['Zone_Engine', [0, floor + blockH / 2, ez], [blockW, blockH, blockL], 'engine'],
    ['Zone_Battery', [bx, by + 0.09, bz], [0.18, 0.18, 0.26], 'battery'],
    ['Zone_Fuel', [0, sampleAt(sp.bottom, sp.rearAxleZ + 0.4) + 0.15, sp.rearAxleZ + 0.4], [0.7, 0.22, 0.45], 'fuel'],
  ];
  for (const [name, p, size, zone] of zones) {
    vb.node(name, { parent: 'Body', group: 'markers', pivot: p, noor: { marker: 'vehicle.zone', id: zone, zone, size } });
  }
}
