/**
 * Box truck parts: everything behind the cab. The cab itself is an ordinary lofted body (a tall,
 * short-nosed van front); this adds the chassis rails, the cargo box with its rear doors, the
 * mudguards over the twin rear wheels, the underrun bar with the rear lamps and number plate, a
 * fuel tank, and the box's collision.
 *
 * Built in the cab's frame like everything else; generate() centres the whole vehicle at the end.
 */
import type { Vec3 } from '../core/math.js';
import { Mesh, box, cylinderX } from '../core/mesh.js';
import type { Slot, VehicleBuilder } from '../core/vehicle.js';
import type { Design } from '../archetypes/index.js';

export function buildTruck(vb: VehicleBuilder, d: Design): void {
  const t = d.truck;
  if (!t) return;
  const sp = d.body;
  const low = sp.detail === 'low';
  const R = sp.wheelRadius;
  const bw = t.boxHalfWidth;
  const len = t.boxFront - t.boxRear;
  const zc = (t.boxFront + t.boxRear) / 2;
  const h = t.boxTop - t.floorY;
  const yc = (t.boxTop + t.floorY) / 2;
  const bev = low ? 0.035 : 0.05;

  // ------------------------------------------------------------------ chassis
  vb.node('Chassis', { parent: 'Body', group: 'body', noor: { part: 'chassis' } });
  const railY = R + 0.12;
  const railZ0 = sp.frontAxleZ + 0.35, railZ1 = t.boxRear + 0.05;
  for (const s of [1, -1]) {
    vb.add('Chassis', 'MAT_Underbody', box([s * 0.42, railY, (railZ0 + railZ1) / 2], [0.08, 0.2, railZ0 - railZ1]));
  }
  for (const z of [sp.rearAxleZ + 0.6, sp.rearAxleZ - 0.5, t.boxFront - 0.2]) {
    vb.add('Chassis', 'MAT_Underbody', box([0, railY, z], [0.84, 0.12, 0.08]));
  }
  // subframe the box sits on
  for (const s of [1, -1]) {
    vb.add('Chassis', 'MAT_Underbody', box([s * 0.42, (railY + 0.1 + t.floorY) / 2, zc], [0.1, t.floorY - railY - 0.1, len - 0.1]));
  }
  // side guards between the axles (they keep cyclists out from under the box)
  const gz0 = sp.rearAxleZ + R + 0.2, gz1 = t.boxFront - 0.1;
  if (gz1 - gz0 > 0.5) {
    for (const s of [1, -1]) {
      for (const y of [R * 0.9, R * 1.45]) {
        vb.add('Chassis', 'MAT_Metal', box([s * (bw - 0.06), y, (gz0 + gz1) / 2], [0.03, 0.07, gz1 - gz0]));
      }
    }
  }

  // ------------------------------------------------------------------ the box
  vb.node('Box', { parent: 'Body', group: 'body', pivot: [0, t.floorY, zc], noor: { part: 'cargo' } });
  vb.add('Box', 'MAT_Box', box([0, yc, zc], [bw * 2, h, len], bev));
  // corner posts, roof and floor rails
  const post = 0.07;
  for (const s of [1, -1]) {
    for (const z of [t.boxFront - post / 2 + 0.01, t.boxRear + post / 2 - 0.01]) {
      vb.add('Box', 'MAT_Metal', box([s * (bw - post / 2 + 0.012), yc, z], [post, h + 0.01, post]));
    }
    for (const y of [t.boxTop - 0.04, t.floorY + 0.05]) {
      vb.add('Box', 'MAT_Metal', box([s * (bw + 0.006), y, zc], [0.02, 0.07, len - 0.04]));
    }
  }
  // a "logo" panel on each side, in the cab's paint (a blank for liveries)
  if (t.boxColor !== 'paint') {
    for (const s of [1, -1]) vb.add('Box', 'MAT_Paint', box([s * (bw + 0.004), yc + h * 0.05, zc], [0.01, h * 0.28, len * 0.55]));
  }
  // side marker lamps along the bottom rail
  const markers = Math.max(2, Math.round(len / 1.2));
  for (let k = 0; k < markers; k++) {
    const z = t.boxFront - 0.25 - ((len - 0.5) * k) / (markers - 1);
    for (const s of [1, -1]) vb.add('Box', 'MAT_LightIndicator', box([s * (bw + 0.018), t.floorY + 0.05, z], [0.02, 0.035, 0.07]));
  }
  vb.setCollision('Box', box([0, yc, zc], [bw * 2, h, len]));

  // rear doors: a roll-up shutter (slides up) or two barn doors (hinged at the corners)
  const doorW = bw * 2 - post * 2, doorH = h - 0.12;
  const doorY = t.floorY + 0.06 + doorH / 2;
  const zr = t.boxRear - 0.012;
  if (t.rearDoor === 'shutter') {
    vb.node('Door_Cargo', {
      parent: 'Box', group: 'body', pivot: [0, doorY, zr],
      noor: { part: 'door', marker: 'door', id: 'door_cargo', axis: [0, 1, 0], max: round(doorH * 0.92), opens: 'slide' },
    });
    vb.add('Door_Cargo', 'MAT_Box', box([0, doorY, zr], [doorW, doorH, 0.02]));
    const slats = low ? 8 : 16;
    for (let k = 1; k < slats; k++) {
      vb.add('Door_Cargo', 'MAT_Metal', box([0, t.floorY + 0.06 + (doorH * k) / slats, zr - 0.012], [doorW - 0.02, 0.012, 0.008]));
    }
    vb.add('Door_Cargo', 'MAT_Trim', box([0, t.floorY + 0.2, zr - 0.03], [0.3, 0.04, 0.04]));
  } else {
    for (const s of [1, -1]) {
      const nm = s > 0 ? 'Door_CargoL' : 'Door_CargoR';
      const hx = s * (bw - post);
      vb.node(nm, {
        parent: 'Box', group: 'body', pivot: [hx, doorY, zr],
        // hinged at the outer edge, swinging out and round toward the side of the box
        noor: { part: 'door', marker: 'door', id: nm.toLowerCase(), axis: [0, -s, 0], max: 2.6, opens: 'hinge' },
      });
      vb.add(nm, 'MAT_Box', box([s * (bw - post - doorW / 4), doorY, zr], [doorW / 2 - 0.006, doorH, 0.025]));
      // lock bars
      vb.add(nm, 'MAT_Metal', box([s * (bw - post - doorW * 0.42), doorY, zr - 0.025], [0.025, doorH - 0.1, 0.025]));
      for (const y of [doorY - doorH * 0.35, doorY + doorH * 0.35]) vb.add(nm, 'MAT_Metal', box([s * (bw - post - 0.04), y, zr - 0.02], [0.08, 0.05, 0.02]));
    }
  }

  // ------------------------------------------------------------------ mudguards over the twin rear wheels
  const tw = sp.tyreWidth * 2 + 0.03;
  const gx = bw - tw / 2 - 0.02;
  for (const s of [1, -1]) {
    const gy = R * 2 + 0.06;
    vb.add('Chassis', 'MAT_Plastic', box([s * gx, Math.min(gy, t.floorY - 0.04), sp.rearAxleZ], [tw + 0.06, 0.03, R * 2.1]));
    vb.add('Chassis', 'MAT_Rubber', box([s * gx, R * 0.75, sp.rearAxleZ - R * 1.15], [tw + 0.04, R * 1.1, 0.012]));
  }

  // ------------------------------------------------------------------ fuel tank on the left rail
  const tankZ = (sp.rearAxleZ + t.boxFront) / 2 + 0.2;
  vb.add('Chassis', 'MAT_Metal', turnZ(cylinderX(0.22, 0.75, low ? 10 : 20)).transform(undefined, [0.42 + 0.3, railY - 0.02, tankZ]));

  // ------------------------------------------------------------------ underrun bar, plate, rear lamps
  const barY = R + 0.08, barZ = t.boxRear + 0.04;
  vb.add('Bumper_Rear', 'MAT_Metal', box([0, barY, barZ], [bw * 2 - 0.2, 0.1, 0.08], 0.01));
  for (const s of [1, -1]) vb.add('Bumper_Rear', 'MAT_Underbody', box([s * 0.42, (barY + railY) / 2, barZ + 0.06], [0.06, railY - barY + 0.1, 0.06]));
  vb.add('Bumper_Rear', 'MAT_Plate', box([0, barY + 0.13, barZ - 0.02], [0.52, 0.11, 0.01]));
  vb.add('Bumper_Rear', 'MAT_Trim', box([0, barY + 0.13, barZ - 0.01], [0.55, 0.14, 0.012]));
  const lampY = Math.max(barY + 0.15, t.floorY - 0.12);
  const lamp = (x: number, w: number, slot: Slot): void => vb.add('Lights_Rear', slot, box([x, lampY, t.boxRear + 0.02], [w, 0.1, 0.05], 0.008));
  for (const s of [1, -1]) {
    const x0 = s * (bw - 0.2);
    lamp(x0, 0.12, 'MAT_LightBrake');
    lamp(x0 - s * 0.13, 0.1, 'MAT_LightIndicator');
    lamp(x0 - s * 0.24, 0.08, 'MAT_LightReverse');
    vb.add('Lights_Rear', 'MAT_Trim', box([s * (bw - 0.32), lampY, t.boxRear + 0.045], [0.4, 0.13, 0.02]));
  }
  // high marker lamps on the box top corners
  for (const s of [1, -1]) vb.add('Lights_Rear', 'MAT_LightBrake', box([s * (bw - 0.12), t.boxTop - 0.08, t.boxRear - 0.015], [0.1, 0.05, 0.02]));
  const zT = t.boxRear;
  for (const [name, p] of [['Light_BrakeL', [bw - 0.2, lampY, zT]], ['Light_BrakeR', [-(bw - 0.2), lampY, zT]]] as [string, Vec3][]) {
    vb.node(name, { parent: 'Lights_Rear', group: 'lights', pivot: p, noor: { marker: 'light', id: name.toLowerCase(), role: 'brake', material: 'MAT_LightBrake', tags: ['dir:-z'] } });
  }
}

/** Twin-tyre wheel geometry: the inner tyre and rim next to the outer one (axle along X, outer face +X). */
export function twinOffset(tyreWidth: number): number {
  return tyreWidth + 0.03;
}

const turnZ = (m: Mesh): Mesh => m.transform({ x: [0, 0, 1], y: [0, 1, 0], z: [-1, 0, 0] });
const round = (x: number): number => Math.round(x * 1e4) / 1e4;
