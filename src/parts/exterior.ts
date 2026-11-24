/**
 * Exterior details: lamps, grille, bumpers, number plates, mirrors, door handles.
 *
 * Most of these are DECALS WITH DEPTH: a 2D outline is projected onto the body along a fixed
 * direction (raycasts), lifted a few millimetres, and given a short wall so it reads as a lens or
 * panel. Because they follow the body, a headlamp near a rounded corner wraps around it.
 * Bumpers are profiles swept along the body's outline at bumper height.
 */
import type { Vec2, Vec3 } from '../core/math.js';
import { add, normalize, scale } from '../core/math.js';
import { ellipse, roundedRect } from '../core/curve.js';
import { Mesh, box, extrude, sweep } from '../core/mesh.js';
import type { Slot, VehicleBuilder } from '../core/vehicle.js';
import { doorCode, type Design } from '../archetypes/index.js';
import type { BodyResult } from '../body/body.js';
import { layout, planHalfWidth, raycast, section } from '../body/body.js';
import { sampleAt } from '../core/curve.js';

type Proj = 'front' | 'rear' | 'left' | 'right';

/** Map outline point (u, v) to a ray origin + direction for a projection. */
function rayFor(proj: Proj, u: number, v: number, a: number, b: number, d: Design): { o: Vec3; dir: Vec3 } {
  const L = d.body.length, W = d.body.halfWidth;
  switch (proj) {
    case 'front': return { o: [a + u, b + v, L / 2 + 1], dir: [0, 0, -1] };
    case 'rear': return { o: [a + u, b + v, -L / 2 - 1], dir: [0, 0, 1] };
    case 'left': return { o: [W + 1, b + v, a + u], dir: [-1, 0, 0] };
    case 'right': return { o: [-W - 1, b + v, a + u], dir: [1, 0, 0] };
  }
}

/**
 * Project an outline (centred at (a, b) in the projection plane) onto the body.
 * Returns the face (lifted by `lift`) and a wall down into the body.
 */
export function decal(body: BodyResult, d: Design, proj: Proj, outline0: Vec2[], a: number, b: number, lift: number, wall = 0.02): { face: Mesh; wall: Mesh } | null {
  // subdivide long edges so the decal can bend round curved bodywork
  const outline: Vec2[] = [];
  const low = d.body.detail === 'low';
  const maxEdge = low ? 0.12 : 0.05;
  for (let i = 0; i < outline0.length; i++) {
    const p = outline0[i], q = outline0[(i + 1) % outline0.length];
    const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / maxEdge));
    for (let k = 0; k < n; k++) outline.push([p[0] + ((q[0] - p[0]) * k) / n, p[1] + ((q[1] - p[1]) * k) / n]);
  }
  let cu = 0, cv = 0;
  for (const [u, v] of outline) { cu += u; cv += v; }
  cu /= outline.length; cv /= outline.length;
  const size = Math.max(...outline.map(([u, v]) => Math.hypot(u - cu, v - cv)));
  const rings = size > (low ? 0.16 : 0.08) ? (low ? [1, 0.5] : [1, 0.66, 0.33]) : [1];
  const dirOut = scale(rayFor(proj, 0, 0, a, b, d).dir, -1);
  const project = (u: number, v: number): { p: Vec3; n: Vec3 } | null => {
    const r = rayFor(proj, u, v, a, b, d);
    const h = raycast(body.rayTris, r.o, r.dir);
    return h ? { p: h.p, n: h.n } : null;
  };
  const lifted = (h: { p: Vec3; n: Vec3 }): Vec3 => add(h.p, scale(normalize(add(h.n, scale(dirOut, 0.6))), lift));
  const ringHits: { p: Vec3; n: Vec3 }[][] = [];
  for (const t of rings) {
    const row: { p: Vec3; n: Vec3 }[] = [];
    for (const [u, v] of outline) {
      const h = project(cu + (u - cu) * t, cv + (v - cv) * t);
      if (!h) return null;
      row.push(h);
    }
    ringHits.push(row);
  }
  const ch = project(cu, cv);
  if (!ch) return null;
  const face = new Mesh(), side = new Mesh();
  const n = outline.length;
  const ids = ringHits.map((row) => row.map((h, i) => face.v(lifted(h), dirOut, outline[i])));
  for (let r = 0; r + 1 < ids.length; r++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      face.quad(ids[r][i], ids[r][j], ids[r + 1][j], ids[r + 1][i], ringHits[r][i].n);
    }
  }
  const c = face.v(lifted(ch), dirOut, [cu, cv]);
  const inner = ids[ids.length - 1];
  for (let i = 0; i < n; i++) face.tri(c, inner[i], inner[(i + 1) % n], ch.n);
  // wall from the lifted edge down into the body
  const top = ringHits[0].map(lifted);
  const centre = lifted(ch);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const p0 = top[i], p1 = top[j];
    const q0 = add(ringHits[0][i].p, scale(ringHits[0][i].n, -wall)), q1 = add(ringHits[0][j].p, scale(ringHits[0][j].n, -wall));
    const mid: Vec3 = scale(add(p0, p1), 0.5);
    const outward = normalize([mid[0] - centre[0], mid[1] - centre[1], mid[2] - centre[2]]);
    const i0 = side.v(p0, outward), i1 = side.v(p1, outward), i2 = side.v(q1, outward), i3 = side.v(q0, outward);
    side.quad(i0, i1, i2, i3, outward);
  }
  return { face, wall: side };
}

function put(vb: VehicleBuilder, node: string, slot: Slot, wallSlot: Slot, r: { face: Mesh; wall: Mesh } | null): void {
  if (!r) return;
  vb.add(node, slot, r.face);
  vb.add(node, wallSlot, r.wall);
}

/** Height of the front face's "lamp line": a bit under the hood edge. */
function frontLampY(d: Design): number {
  const sp = d.body;
  return sampleAt(sp.top, sp.length / 2 - 0.02) - 0.1;
}

export function buildExterior(vb: VehicleBuilder, d: Design, body: BodyResult): void {
  const sp = d.body;
  const st = d.style;
  const L = sp.length;
  const zN = L / 2, zT = -L / 2;
  // half-width of the flat end faces (the rounded ends eat into them); lamps stay on these faces,
  // because a decal projected onto a corner at a grazing angle smears down the side
  const noseW = planHalfWidth(sp, zN - sp.noseRound) - sp.noseRound * 0.8;
  const tailW = planHalfWidth(sp, zT + sp.tailRound) - sp.tailRound * 0.8;
  const lampY = frontLampY(d);
  const low = sp.detail === 'low';
  const seg = low ? 8 : 20;

  vb.node('Lights_Front', { parent: 'Body', group: 'lights', noor: { part: 'light' } });
  vb.node('Lights_Rear', { parent: 'Body', group: 'lights', noor: { part: 'light' } });
  vb.node('Grille', { parent: 'Body', group: 'body', noor: { part: 'detail' } });
  vb.node('Bumper_Front', { parent: 'Body', group: 'body', noor: { part: 'bumper' } });
  vb.node('Bumper_Rear', { parent: 'Body', group: 'body', noor: { part: 'bumper' } });

  // ------------------------------------------------------------------ recessed fascia (lamps and grille sit in a dark panel)
  if (d.features.fascia) {
    put(vb, 'Grille', 'MAT_Trim', 'MAT_Trim', decal(body, d, 'front', roundedRect(noseW * 1.82, 0.21, 0.03, 1), 0, lampY - 0.005, 0.004, 0.03));
  }

  // ------------------------------------------------------------------ headlamps
  const heads: { x: number; y: number }[] = [];
  const bezel: Slot = st.id === 'seventies' ? 'MAT_Chrome' : 'MAT_Trim';
  for (const s of [1, -1]) {
    switch (d.headlamp) {
      case 'round': {
        const x = s * noseW * 0.7, r = 0.085;
        put(vb, 'Lights_Front', bezel, bezel, decal(body, d, 'front', ellipse(r + 0.018, r + 0.018, seg), x, lampY, 0.01));
        put(vb, 'Lights_Front', 'MAT_LightHead', bezel, decal(body, d, 'front', ellipse(r, r, seg), x, lampY, 0.018, 0.01));
        heads.push({ x, y: lampY });
        break;
      }
      case 'quad-round': {
        for (const k of [0.5, 0.78]) {
          const x = s * noseW * k, r = 0.065;
          put(vb, 'Lights_Front', bezel, bezel, decal(body, d, 'front', ellipse(r + 0.015, r + 0.015, seg), x, lampY, 0.01));
          put(vb, 'Lights_Front', 'MAT_LightHead', bezel, decal(body, d, 'front', ellipse(r, r, seg), x, lampY, 0.018, 0.01));
        }
        heads.push({ x: s * noseW * 0.64, y: lampY });
        break;
      }
      case 'rect': {
        const x = s * noseW * 0.68, w = Math.min(0.3, noseW * 0.42), h = 0.13;
        put(vb, 'Lights_Front', bezel, bezel, decal(body, d, 'front', roundedRect(w + 0.03, h + 0.03, 0.02, 1), x, lampY, 0.01));
        put(vb, 'Lights_Front', 'MAT_LightHead', bezel, decal(body, d, 'front', roundedRect(w, h, 0.015, 1), x, lampY, 0.018, 0.01));
        heads.push({ x, y: lampY });
        break;
      }
      case 'flush': {
        // wraps round the corner: centred further out
        const x = s * noseW * 0.64, w = noseW * 0.46, h = 0.12;
        put(vb, 'Lights_Front', 'MAT_Trim', 'MAT_Trim', decal(body, d, 'front', roundedRect(w + 0.03, h + 0.03, 0.035, 1), x, lampY, 0.008));
        put(vb, 'Lights_Front', 'MAT_LightHead', 'MAT_Trim', decal(body, d, 'front', roundedRect(w, h, 0.03, 1), x, lampY, 0.014));
        // amber corner strip
        put(vb, 'Lights_Front', 'MAT_LightIndicator', 'MAT_Trim', decal(body, d, 'front', roundedRect(0.05, h * 0.8, 0.01, 1), s * noseW * 0.9, lampY, 0.012));
        heads.push({ x, y: lampY });
        break;
      }
      case 'swept': {
        // a slim slanted lamp, higher at the outside, with an LED brow
        const w = noseW * 0.5, h = 0.075;
        const x = s * noseW * 0.64;
        const pts: Vec2[] = [[-w / 2, -h / 2 - 0.02 * s], [w / 2, -h / 2 + 0.02 * s], [w / 2, h / 2 + 0.025 * s], [-w / 2, h / 2 - 0.01 * s]];
        const shape = s > 0 ? pts : pts.map(([u, v]) => [u, v] as Vec2);
        put(vb, 'Lights_Front', 'MAT_Trim', 'MAT_Trim', decal(body, d, 'front', inflate(shape, 0.018), x, lampY + 0.02, 0.008));
        put(vb, 'Lights_Front', 'MAT_LightHead', 'MAT_Trim', decal(body, d, 'front', shape, x, lampY + 0.02, 0.014));
        put(vb, 'Lights_Front', 'MAT_LightReverse', 'MAT_Trim', decal(body, d, 'front', roundedRect(w * 0.9, 0.012, 0.004, 1), x, lampY + 0.02 + h / 2 + 0.006, 0.016));
        heads.push({ x, y: lampY + 0.02 });
        break;
      }
    }
  }
  // front indicators (separate lamps for older styles)
  if (d.headlamp !== 'flush' && d.headlamp !== 'swept') {
    for (const s of [1, -1]) {
      put(vb, 'Lights_Front', 'MAT_LightIndicator', 'MAT_Trim', decal(body, d, 'front', roundedRect(0.09, 0.045, 0.01, 1), s * noseW * 0.72, lampY - 0.17, 0.012));
    }
  }

  // ------------------------------------------------------------------ grille
  const gw = Math.max(0.2, (heads[0]?.x ?? noseW * 0.6) * 2 - 0.42);
  if (st.id === 'seventies') {
    put(vb, 'Grille', 'MAT_Chrome', 'MAT_Chrome', decal(body, d, 'front', roundedRect(gw + 0.04, 0.17, 0.01, 1), 0, lampY, 0.008));
    put(vb, 'Grille', 'MAT_Trim', 'MAT_Chrome', decal(body, d, 'front', roundedRect(gw, 0.13, 0.008, 1), 0, lampY, 0.012));
    for (const yy of [-0.035, 0, 0.035]) {
      put(vb, 'Grille', 'MAT_Chrome', 'MAT_Chrome', decal(body, d, 'front', roundedRect(gw - 0.02, 0.008, 0.002, 1), 0, lampY + yy, 0.016));
    }
  } else if (st.id === 'nineties') {
    put(vb, 'Grille', 'MAT_Trim', 'MAT_Plastic', decal(body, d, 'front', roundedRect(gw * 0.85, 0.06, 0.02, 1), 0, lampY + 0.01, 0.01));
  } else {
    // modern: thin upper slot and a big lower intake
    put(vb, 'Grille', 'MAT_Trim', 'MAT_Plastic', decal(body, d, 'front', roundedRect(gw * 0.7, 0.03, 0.012, 1), 0, lampY + 0.04, 0.008));
    const iw = noseW * 1.25, ih = 0.16;
    const trap: Vec2[] = [[-iw / 2, -ih / 2], [iw / 2, -ih / 2], [iw / 2 - 0.08, ih / 2], [-iw / 2 + 0.08, ih / 2]];
    put(vb, 'Grille', 'MAT_Trim', 'MAT_Plastic', decal(body, d, 'front', trap, 0, lampY - 0.24, 0.006));
  }

  // ------------------------------------------------------------------ bumpers
  const bumperYFront = lampY - (st.bumper === 'chrome' ? 0.25 : 0.27);
  const bumperYRear = sampleAt(sp.bottom, zT) + 0.17;
  buildBumper(vb, d, body, 'Bumper_Front', 1, bumperYFront);
  // trucks: the back end belongs to the cargo box (parts/truck.ts)
  const carRear = !d.truck;
  if (carRear) buildBumper(vb, d, body, 'Bumper_Rear', -1, bumperYRear);

  // ------------------------------------------------------------------ number plates
  const plate = roundedRect(0.5, 0.11, 0.01, 1);
  const plateFrontY = st.bumper === 'body' ? lampY - 0.24 : bumperYFront - 0.02;
  if (st.bumper !== 'body') put(vb, 'Bumper_Front', 'MAT_Plate', 'MAT_Trim', decal(body, d, 'front', plate, 0, plateFrontY, 0.075));
  else put(vb, 'Bumper_Front', 'MAT_Plate', 'MAT_Trim', decal(body, d, 'front', plate, 0, plateFrontY, 0.012));

  // ------------------------------------------------------------------ tail lamps
  const tailTop = sampleAt(sp.top, zT + 0.02);
  const beltRear = sampleAt(sp.belt, zT + 0.02);
  const tailY = Math.min(tailTop - 0.12, beltRear - 0.06);
  const rearPlateY = Math.max(bumperYRear + 0.15, tailY - 0.15);
  if (carRear) put(vb, 'Bumper_Rear', 'MAT_Plate', 'MAT_Trim', decal(body, d, 'rear', plate, 0, rearPlateY, 0.012));
  for (const s of carRear ? [1, -1] : []) {
    const x = s * tailW * 0.72;
    if (d.taillamp === 'block') {
      const w = 0.2, h = 0.15;
      put(vb, 'Lights_Rear', 'MAT_Chrome', 'MAT_Chrome', decal(body, d, 'rear', roundedRect(w + 0.025, h + 0.025, 0.01, 1), x, tailY, 0.008));
      put(vb, 'Lights_Rear', 'MAT_LightBrake', 'MAT_Trim', decal(body, d, 'rear', roundedRect(w, h * 0.45, 0.005, 1), x, tailY + h * 0.27, 0.014));
      put(vb, 'Lights_Rear', 'MAT_LightIndicator', 'MAT_Trim', decal(body, d, 'rear', roundedRect(w * 0.48, h * 0.45, 0.005, 1), x + s * w * 0.26, tailY - h * 0.25, 0.014));
      put(vb, 'Lights_Rear', 'MAT_LightReverse', 'MAT_Trim', decal(body, d, 'rear', roundedRect(w * 0.48, h * 0.45, 0.005, 1), x - s * w * 0.26, tailY - h * 0.25, 0.014));
    } else if (d.taillamp === 'wide') {
      const w = tailW * 0.5, h = 0.13;
      const cx = s * tailW * 0.64;
      put(vb, 'Lights_Rear', 'MAT_LightBrake', 'MAT_Trim', decal(body, d, 'rear', roundedRect(w, h, 0.02, 1), cx, tailY, 0.012));
      put(vb, 'Lights_Rear', 'MAT_LightIndicator', 'MAT_Trim', decal(body, d, 'rear', roundedRect(w * 0.3, h * 0.35, 0.005, 1), cx + s * w * 0.28, tailY - h * 0.22, 0.017));
      put(vb, 'Lights_Rear', 'MAT_LightReverse', 'MAT_Trim', decal(body, d, 'rear', roundedRect(w * 0.3, h * 0.35, 0.005, 1), cx - s * w * 0.1, tailY - h * 0.22, 0.017));
    } else {
      const w = tailW * 0.4, h = 0.07;
      const cx = s * tailW * 0.68;
      put(vb, 'Lights_Rear', 'MAT_LightBrake', 'MAT_Trim', decal(body, d, 'rear', roundedRect(w, h, 0.01, 1), cx, tailY + 0.02, 0.012));
      put(vb, 'Lights_Rear', 'MAT_LightReverse', 'MAT_Trim', decal(body, d, 'rear', roundedRect(w * 0.25, h * 0.5, 0.005, 1), cx - s * w * 0.2, tailY + 0.02, 0.016));
    }
  }
  if (carRear && d.taillamp === 'bar') {
    put(vb, 'Lights_Rear', 'MAT_LightBrake', 'MAT_Trim', decal(body, d, 'rear', roundedRect(tailW * 0.6, 0.02, 0.005, 1), 0, tailY + 0.045, 0.012));
  }

  // ------------------------------------------------------------------ mirrors and handles
  const front = sp.doors[0];
  for (const side of ['L', 'R'] as const) {
    const s = side === 'L' ? 1 : -1;
    const doorNode = vb.has(`Door_F${side}`) ? `Door_F${side}` : 'Body';
    const mz = Math.min(sp.cowlZ - 0.12, front.z1 - 0.1);
    const my = sampleAt(sp.belt, mz) + 0.05;
    const hit = raycast(body.rayTris, [s * (sp.halfWidth + 1), my - 0.07, mz], [-s, 0, 0]);
    const sx = hit ? Math.abs(hit.p[0]) : sp.halfWidth;
    const mname = `Mirror_${side}`;
    vb.node(mname, { parent: doorNode, group: 'body', pivot: [s * sx, my, mz], noor: { part: 'mirror' } });
    const mslot: Slot = st.id === 'seventies' ? 'MAT_Chrome' : st.id === 'nineties' ? 'MAT_Plastic' : 'MAT_Paint';
    if (d.truck) {
      // tall truck mirror on an arm, so the driver can see past the box
      vb.add(mname, 'MAT_Plastic', box([s * (sx + 0.1), my + 0.05, mz], [0.2, 0.03, 0.03]));
      vb.add(mname, 'MAT_Plastic', box([s * (sx + 0.22), my + 0.12, mz - 0.02], [0.05, 0.36, 0.14], low ? 0.01 : 0.015));
      vb.add(mname, 'MAT_Chrome', box([s * (sx + 0.22), my + 0.12, mz - 0.093], [0.04, 0.32, 0.005]));
    } else {
      vb.add(mname, mslot, box([s * (sx + 0.11), my + 0.03, mz - 0.02], [0.17, 0.11, 0.07], low ? 0.012 : 0.02));
      vb.add(mname, 'MAT_Plastic', box([s * (sx + 0.03), my, mz], [0.07, 0.03, 0.05]));
      vb.add(mname, 'MAT_Chrome', box([s * (sx + 0.11), my + 0.03, mz - 0.057], [0.14, 0.085, 0.006]));
    }

    // door handles near the rear edge of each hinged door
    for (const door of sp.doors) {
      const nm = `Door_${doorCode(door.id)}${side}`;
      const node = vb.has(nm) ? nm : 'Body';
      const hz = door.slide ? door.z1 - 0.12 : door.z0 + 0.13;
      const hy = sampleAt(sp.belt, hz) - 0.08;
      const hslot: Slot = st.id === 'seventies' ? 'MAT_Chrome' : st.id === 'nineties' ? 'MAT_Plastic' : 'MAT_Paint';
      put(vb, node, hslot, hslot, decal(body, d, side === 'L' ? 'left' : 'right', roundedRect(0.13, 0.028, 0.012, 1), hz, hy, 0.014));
    }
  }

  // ------------------------------------------------------------------ hood scoop and spoiler
  if (d.features.scoop) buildScoop(vb, d, body);
  if (d.features.spoiler !== 'none') buildSpoiler(vb, d, body, d.features.spoiler);

  // light markers for games (which slot to switch on)
  const markers: [string, Vec3, string, string][] = [];
  for (const h of heads) markers.push([`Light_Head${h.x > 0 ? 'L' : 'R'}`, [h.x, h.y, zN], 'head', 'MAT_LightHead']);
  if (carRear) markers.push(['Light_BrakeL', [tailW * 0.75, tailY, zT], 'brake', 'MAT_LightBrake'], ['Light_BrakeR', [-tailW * 0.75, tailY, zT], 'brake', 'MAT_LightBrake']);
  for (const [name, p, role, material] of markers) {
    vb.node(name, { parent: 'Lights_Front', group: 'lights', pivot: p, noor: { marker: 'light', id: name.toLowerCase(), role, material, tags: [p[2] > 0 ? 'dir:+z' : 'dir:-z'] } });
  }
}

/** Grow a polygon outward by d (for bezels around lamps). */
function inflate(poly: Vec2[], dd: number): Vec2[] {
  let cx = 0, cy = 0;
  for (const [x, y] of poly) { cx += x; cy += y; }
  cx /= poly.length; cy /= poly.length;
  return poly.map(([x, y]) => {
    const l = Math.hypot(x - cx, y - cy) || 1;
    return [x + ((x - cx) / l) * dd, y + ((y - cy) / l) * dd] as Vec2;
  });
}

/** A bumper bar swept around the nose or tail at height y. dir: +1 front, −1 rear. */
function buildBumper(vb: VehicleBuilder, d: Design, body: BodyResult, node: string, dir: 1 | -1, y: number): void {
  const sp = d.body, st = d.style;
  const low = sp.detail === 'low';
  const zEnd = (dir * sp.length) / 2;
  const back = 1.2;
  const center: Vec3 = [0, y, zEnd - dir * back];
  const path: Vec3[] = [];
  const n = low ? 9 : 25;
  // wrap just round the corners, ending well ahead of the wheel arch
  const wrap = st.bumper === 'chrome' ? 0.22 : 0.3;
  const spread = Math.atan2(sp.halfWidth, back - wrap);
  for (let k = 0; k < n; k++) {
    const a = -spread + (2 * spread * k) / (n - 1);
    const rd: Vec3 = [Math.sin(a), 0, dir * Math.cos(a)];
    const h = raycast(body.rayTris, add(center, scale(rd, 3)), scale(rd, -1));
    if (!h) continue;
    const out = normalize([h.n[0], 0, h.n[2]]);
    const off = st.bumper === 'chrome' ? 0.045 : st.bumper === 'plastic' ? 0.02 : 0.008;
    path.push(add(h.p, scale(out, off)));
  }
  if (path.length < 3) return;
  let prof: Vec2[];
  let slot: Slot;
  if (st.bumper === 'chrome') {
    prof = low ? [[-0.035, -0.05], [0.03, -0.045], [0.035, 0.045], [-0.035, 0.05]] : roundedRect(0.07, 0.1, 0.02, 3);
    slot = 'MAT_Chrome';
    // rubber strip on the bar
    vb.add(node, 'MAT_Rubber', sweep(path.map((p) => [p[0], p[1] + 0.005, p[2]] as Vec3), [[0.03, -0.012], [0.045, -0.01], [0.045, 0.012], [0.03, 0.014]], center));
  } else if (st.bumper === 'plastic') {
    prof = [[-0.03, -0.11], [0.025, -0.1], [0.035, 0.0], [0.025, 0.08], [-0.03, 0.09]];
    slot = 'MAT_Plastic';
  } else {
    prof = [[-0.02, -0.03], [0.02, -0.025], [0.022, 0.02], [-0.02, 0.025]];
    slot = 'MAT_Plastic';
    path.forEach((p) => { p[1] = sampleAt(sp.bottom, p[2]) + 0.04; });
  }
  vb.add(node, slot, sweep(path, prof, center));
}

/**
 * Wheel-arch lips: a small rolled lip swept round each arch on the body side. It hides the hard
 * cut-out edge and gives the arch a shape (body colour, or black plastic flares where the era
 * has plastic cladding).
 */
export function buildArchLips(vb: VehicleBuilder, d: Design): void {
  const sp = d.body;
  const low = sp.detail === 'low';
  const Ra = sp.wheelRadius + sp.archGap;
  const st = d.style.id;
  const lipH = st === 'seventies' ? 0.03 : st === 'nineties' ? (sp.cladding > 0 ? 0.06 : 0.04) : 0.05;
  const lipOut = st === 'seventies' ? 0.012 : st === 'nineties' && sp.cladding > 0 ? 0.03 : 0.02;
  const slot: Slot = sp.cladding > 0 ? 'MAT_Plastic' : sp.lowerTone ? 'MAT_Paint2' : 'MAT_Paint';
  // profile across the lip: [outward along the body side normal (x), along the arch radius (into the body)]
  const prof: [number, number][] = [[-0.035, -0.004], [lipOut * 0.4, -0.01], [lipOut, lipH * 0.35], [0, lipH]];
  const steps = low ? 9 : 26;
  const m = new Mesh();
  for (const za of [sp.frontAxleZ, sp.rearAxleZ]) {
    if (Math.abs(za) > sp.length / 2) continue; // truck rear axle: under the box, not the cab
    const rows: Vec3[][] = [];
    for (let k = 0; k <= steps; k++) {
      const th = 0.12 + ((Math.PI - 0.24) * k) / steps;
      const z = za + Math.cos(th) * Ra, y = sp.wheelRadius + Math.sin(th) * Ra;
      if (y < sampleAt(sp.bottom, z) + 0.02) continue;
      // the outer arch edge is where the wheel well meets the (flared) side
      const w = section(sp, z).pts[layout(sp.detail).start.C][0];
      const rad: Vec3 = [0, Math.sin(th), Math.cos(th)];
      rows.push(prof.map(([o, r]) => [w + o, y + rad[1] * r, z + rad[2] * r] as Vec3));
    }
    for (let i = 0; i + 1 < rows.length; i++) {
      for (let j = 0; j + 1 < prof.length; j++) {
        const a = rows[i][j], b = rows[i + 1][j], c = rows[i + 1][j + 1], e = rows[i][j + 1];
        const mid: Vec3 = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2];
        const th = Math.atan2(mid[1] - sp.wheelRadius, mid[2] - za);
        const facing = normalize([1, -Math.sin(th) * 0.8, -Math.cos(th) * 0.8]);
        const ia = m.v(a, facing), ib = m.v(b, facing), ic = m.v(c, facing), ie = m.v(e, facing);
        m.quad(ia, ib, ic, ie, facing);
      }
    }
  }
  const both = m.clone().merge(m.clone().mirrorX());
  vb.add('Body', slot, both);
}

/** A hood scoop: a raised, chamfered block on the hood with a dark intake at the front. Rides on the Hood. */
function buildScoop(vb: VehicleBuilder, d: Design, body: BodyResult): void {
  const sp = d.body;
  const z = sp.cowlZ + (sp.hoodFrontZ - sp.cowlZ) * 0.42;
  const hit = raycast(body.rayTris, [0, 5, z], [0, -1, 0]);
  if (!hit) return;
  const node = vb.has('Hood') ? 'Hood' : 'Body';
  const w = 0.42, l = Math.min(0.55, (sp.hoodFrontZ - sp.cowlZ) * 0.45), h = 0.075;
  const y = hit.p[1];
  // side profile (z, y): low at the back, tall and open at the front
  const prof: Vec2[] = [[-l / 2, -0.03], [l / 2, -0.03], [l / 2, h], [l / 2 - 0.05, h], [-l / 2, 0.01]];
  const m = extrudeAlongX(prof, w, 0.012).translate([0, y, z]);
  vb.add(node, 'MAT_Paint', m);
  vb.add(node, 'MAT_Trim', box([0, y + h * 0.45, z + l / 2 + 0.004], [w - 0.06, h * 0.6, 0.01]));
}

/** A boot-lid lip (ducktail) or a wing on posts, at the back of the trunk or the top of the hatch. */
function buildSpoiler(vb: VehicleBuilder, d: Design, body: BodyResult, kind: 'lip' | 'wing'): void {
  const sp = d.body;
  const zT = -sp.length / 2;
  const z = sp.trunk ? zT + 0.14 : sp.roofRearZ - 0.03;
  const hit = raycast(body.rayTris, [0, 5, z], [0, -1, 0]);
  if (!hit) return;
  const node = sp.trunk && vb.has('Trunk') ? 'Trunk' : vb.has('Tailgate') ? 'Tailgate' : 'Body';
  const y = hit.p[1];
  const half = planHalfWidth(sp, z) - 0.12;
  if (kind === 'lip') {
    const prof: Vec2[] = [[-0.07, 0], [0.06, 0], [0.04, 0.02], [-0.07, 0.055]];
    vb.add(node, 'MAT_Paint', extrudeAlongX(prof, half * 2, 0.01).translate([0, y - 0.005, z]));
  } else {
    const wing: Vec2[] = [[-0.11, 0], [0.09, 0.01], [0.08, 0.025], [-0.11, 0.035]];
    const wy = y + (sp.trunk ? 0.16 : 0.05);
    vb.add(node, 'MAT_Paint', extrudeAlongX(wing, half * 2 + 0.06, 0.008).translate([0, wy, z - 0.02]));
    for (const s of [1, -1]) vb.add(node, d.style.id === 'modern' ? 'MAT_Trim' : 'MAT_Paint', box([s * (half - 0.12), (y + wy) / 2, z - 0.02], [0.04, wy - y + 0.02, 0.1]));
  }
}

/** Extrude a side profile (z, y) across the car (along X), centred on x = 0, with chamfered ends. */
function extrudeAlongX(prof: Vec2[], width: number, bevel: number): Mesh {
  // extrude() builds along +Z from a shape in XY: build in (shapeX = z, shapeY = y), then turn Z into X
  const m = extrude(prof, width, { bevel, back: true }).translate([0, 0, -width / 2]);
  return m.transform({ x: [0, 0, 1], y: [0, 1, 0], z: [-1, 0, 0] });
}
