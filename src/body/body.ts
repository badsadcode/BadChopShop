/**
 * The body kernel (low-poly faceted, or smooth).
 *
 * A car body is LOFTED: we walk along the car from tail to nose ("stations"), and at every
 * station build the same half cross-section (bottom → sill → side → shoulder → window → roof),
 * always with the same number of points. Neighbouring sections are stitched into quads, so
 * every quad knows which station interval and which part of the section it is. That lets us
 * decide, per quad, its material (paint, glass, trim…) and which panel it belongs to (a door,
 * the hood, a window) without any boolean cutting. The left half is built, the right half is
 * its mirror image.
 *
 * The section's segments, bottom to top (interval counts for low / high detail):
 *   A bottom (1/3) · B lower corner or wheel well (2/4) · C side (2/6) · D window sill (1/1)
 *   E side glass (3/5: trim, glass…, trim) · F roof rail (1/3) · G roof / hood / screens (3/6)
 * Where there is no greenhouse (hood, trunk) D, E and F collapse to a point and G becomes the hood.
 */
import type { Vec2, Vec3 } from '../core/math.js';
import { clamp, cross, lerp, normalize, smoothstep, sub } from '../core/math.js';
import { sampleAt } from '../core/curve.js';
import { Mesh } from '../core/mesh.js';
import type { Slot } from '../core/vehicle.js';
import type { BodySpec, Detail } from './spec.js';

type SegId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
const SEG_ORDER: SegId[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
/** smoothing groups: normals are averaged only within a group (creases between groups) */
const GROUP: Record<SegId, number> = { A: 0, B: 1, C: 1, D: 2, E: 3, F: 4, G: 4 };

/** How many intervals each segment gets: 'low' is the faceted low-poly look, 'high' is smooth. */
const COUNTS: Record<Detail, Record<SegId, number>> = {
  low: { A: 1, B: 2, C: 2, D: 1, E: 3, F: 1, G: 3 },
  high: { A: 3, B: 4, C: 6, D: 1, E: 5, F: 3, G: 6 },
};

interface Layout {
  counts: Record<SegId, number>;
  /** segment of every interval k */
  segOf: SegId[];
  /** first interval index of each segment */
  start: Record<SegId, number>;
  npts: number;
}

const LAYOUTS = new Map<Detail, Layout>();
export function layout(detail: Detail): Layout {
  let l = LAYOUTS.get(detail);
  if (!l) {
    const counts = COUNTS[detail];
    const segOf = SEG_ORDER.flatMap((s) => Array(counts[s]).fill(s) as SegId[]);
    const start = {} as Record<SegId, number>;
    let k = 0;
    for (const sg of SEG_ORDER) { start[sg] = k; k += counts[sg]; }
    l = { counts, segOf, start, npts: segOf.length + 1 };
    LAYOUTS.set(detail, l);
  }
  return l;
}

export interface Section {
  z: number;
  pts: Vec2[];
  B: number;
  H: number;
  L: number;
  W: number;
  arch: boolean;
}

export interface BodyResult {
  /** bucket → slot → mesh. Buckets: body, hood, trunk, tailgate, door_<id>_L/R, windshield, rear_window, win_<id>_L/R */
  buckets: Map<string, Map<Slot, Mesh>>;
  /** cabin liner seen through the glass (MAT_Interior) */
  liner: Mesh;
  /** coarse hull for physics */
  collision: Mesh;
  /** thin dark strips along panel gaps */
  shutLines: Mesh;
  /** every exterior triangle as flat xyz triples, for raycasts */
  rayTris: Float64Array;
  sectionAt: (z: number) => Section;
  stations: Section[];
}

export function planHalfWidth(sp: BodySpec, z: number): number {
  const noseZ = sp.length / 2, tailZ = -sp.length / 2;
  let f = 1;
  const uN = clamp((z - (noseZ - sp.noseTaper)) / sp.noseTaper, 0, 1);
  const uT = clamp(((tailZ + sp.tailTaper) - z) / sp.tailTaper, 0, 1);
  if (uN > 0) f = Math.min(f, 1 - (1 - sp.noseRatio) * uN ** 2.4);
  if (uT > 0) f = Math.min(f, 1 - (1 - sp.tailRatio) * uT ** 2.4);
  return sp.halfWidth * f;
}

/** The half cross-section at z (x ≥ 0), NPTS points from bottom centre to top centre. */
export function section(sp: BodySpec, z: number): Section {
  const C = layout(sp.detail).counts;
  const B = sampleAt(sp.bottom, z);
  const H = sampleAt(sp.top, z);
  const W = planHalfWidth(sp, z);
  const inGlass = z < sp.cowlZ && z > sp.glassEndZ - 1e-6;
  const L = inGlass ? Math.min(sampleAt(sp.belt, z), H) : H;
  const G = Math.max(0, H - L);

  // wheel arches
  let archY = -Infinity;
  const Ra = sp.wheelRadius + sp.archGap;
  for (const za of [sp.frontAxleZ, sp.rearAxleZ]) {
    const dz = z - za;
    if (Math.abs(dz) < Ra - 1e-6) {
      const ay = sp.wheelRadius + Math.sqrt(Ra * Ra - dz * dz);
      if (ay > B + 0.004) archY = Math.max(archY, ay);
    }
  }
  const arch = archY > -Infinity;
  const rb = Math.min(sp.bottomCorner, (L - B) * 0.3, W * 0.3);
  const wellX = W - sp.wellDepth;

  const pts: Vec2[] = [[0, B]];
  // A: bottom
  const xA = arch ? wellX : W - rb;
  for (let k = 1; k <= C.A; k++) pts.push([(xA * k) / C.A, B]);
  // B: lower corner, or the wheel well (up the inner wall, then out along the arch)
  for (let k = 1; k <= C.B; k++) {
    const t = k / C.B;
    if (arch) pts.push(t <= 0.5 ? [wellX, lerp(B, archY, t * 2)] : [lerp(wellX, W, (t - 0.5) * 2), archY]);
    else {
      const ang = -Math.PI / 2 + t * (Math.PI / 2);
      pts.push([W - rb + Math.cos(ang) * rb, B + rb + Math.sin(ang) * rb]);
    }
  }
  // C: the side, from the sill (or arch) up to the shoulder, with a little tuck-under
  const yC0 = arch ? Math.min(archY, L - 0.02) : B + rb;
  for (let k = 1; k <= C.C; k++) {
    const t = k / C.C;
    pts.push([W - sp.shoulderIn * t * t - sp.tuck * (1 - t) ** 3 * (arch ? 0 : 1), lerp(yC0, L, t)]);
  }
  // D: window sill step
  const xs = W - sp.shoulderIn - sp.sillIn * smoothstep(0, 0.05, G);
  const sillH = Math.min(sp.sillHeight, G * 0.3);
  pts.push([xs, L + sillH]);
  // E: side glass, leaning in (tumblehome), with thin trim bands top and bottom
  const rr = Math.min(sp.roofCorner, G * 0.3);
  const xr = xs - sp.tumblehome * Math.max(0, G - sillH);
  const e0: Vec2 = [xs, L + sillH], e1: Vec2 = [xr, H - rr];
  const a = G > 1e-4 ? Math.min(0.2, sp.trim / Math.max(1e-4, G)) : 0.2;
  const eT = [a];
  for (let k = 1; k <= C.E - 3; k++) eT.push(a + ((1 - 2 * a) * k) / (C.E - 2));
  eT.push(1 - a, 1);
  for (const t of eT) pts.push([lerp(e0[0], e1[0], t), lerp(e0[1], e1[1], t)]);
  // F: roof rail (rounded or chamfered corner)
  for (let k = 1; k <= C.F; k++) {
    const ang = (k / C.F) * (Math.PI / 2);
    pts.push([xr - rr + Math.cos(ang) * rr, H - rr + Math.sin(ang) * rr]);
  }
  // G: across the top to the centre line, crowned
  const xg = Math.max(1e-4, xr - rr);
  const crown = lerp(sp.hoodCrown, sp.roofCrown, smoothstep(0, 0.25, G));
  const a2 = Math.min(0.15, sp.trim / xg);
  const gT = [a2];
  for (let k = 1; k < C.G; k++) gT.push(a2 + ((1 - a2) * k) / (C.G - 1));
  for (const t of gT) {
    const x = xg * (1 - t);
    pts.push([x, H + crown * (1 - (x / xg) ** 2)]);
  }
  return { z, pts, B, H, L, W, arch };
}

// ---------------------------------------------------------------------------------------------

interface QuadInfo { slot: Slot; bucket: string }

function inRange(z: number, r: [number, number] | null): boolean {
  return !!r && z >= Math.min(r[0], r[1]) - 1e-6 && z <= Math.max(r[0], r[1]) + 1e-6;
}

/** Decide material and panel for one quad of the left half. */
function classify(sp: BodySpec, k: number, z: number, sec0: Section, sec1: Section, endRow: boolean): QuadInfo {
  const lay = layout(sp.detail);
  const seg = lay.segOf[k];
  const local = k - lay.start[seg];
  const paint: Slot = 'MAT_Paint';
  const glassZone = z < sp.cowlZ && z > sp.glassEndZ;
  const yMid = (sec0.pts[k][1] + sec1.pts[k + 1][1]) / 2;
  if (seg === 'A') return { slot: 'MAT_Underbody', bucket: 'body' };
  if (seg === 'B') {
    if (sec0.arch && sec1.arch) return { slot: 'MAT_Underbody', bucket: 'body' };
    return { slot: sp.cladding > 0 ? 'MAT_Plastic' : paint, bucket: 'body' };
  }
  if (endRow) {
    if (seg === 'E' && glassZone && !sp.uprightRear && z < 0 && sp.tailgate) return { slot: 'MAT_Glass', bucket: 'body' };
    return { slot: seg === 'D' ? (sp.chromeSill ? 'MAT_Chrome' : 'MAT_Trim') : paint, bucket: 'body' };
  }
  const door = sp.doors.find((d) => z >= d.z0 && z <= d.z1);
  const doorBucket = door ? `door_${door.id}_L` : 'body';
  if (seg === 'C') {
    const clad = sp.cladding > 0 && yMid < sec0.B + sp.cladding + 0.12 && local === 0;
    return { slot: clad ? 'MAT_Plastic' : paint, bucket: doorBucket };
  }
  if (seg === 'D') {
    // the sill strip only where real side glass sits above it; where the greenhouse is just growing out
    // of the hood or the deck (pillar bases) it's bodywork, or it shows up as a shiny wedge
    const tall = Math.min(sec0.H - sec0.L, sec1.H - sec1.L) > 0.08;
    return { slot: tall ? (sp.chromeSill ? 'MAT_Chrome' : 'MAT_Trim') : paint, bucket: glassZone ? doorBucket : 'body' };
  }
  if (seg === 'E') {
    if (!glassZone) return { slot: paint, bucket: 'body' };
    const win = sp.windows.find((w) => z >= w.z0 && z <= w.z1);
    if (win) {
      const bucket = win.door ? `door_${win.door}_L` : 'body';
      if (local === 0 || local === lay.counts.E - 1) return { slot: 'MAT_Trim', bucket };
      return { slot: 'MAT_Glass', bucket: `win_${win.id}_L` };
    }
    // pillars and door frames
    const nearB = sp.doors.length > 1 && sp.blackPillars && door == null;
    return { slot: nearB ? 'MAT_Trim' : paint, bucket: doorBucket };
  }
  if (seg === 'F') return { slot: sp.twoToneRoof && glassZone ? 'MAT_Paint2' : paint, bucket: 'body' };
  // G: the top. Windshield, roof, rear window, hood, trunk.
  if (z <= sp.cowlZ && z >= sp.windshieldTopZ) {
    const edge = local === 0 || z > sp.cowlZ - 0.035 || z < sp.windshieldTopZ + 0.03;
    return edge ? { slot: 'MAT_Trim', bucket: 'body' } : { slot: 'MAT_Glass', bucket: 'windshield' };
  }
  if (z < sp.windshieldTopZ && z > sp.roofRearZ) return { slot: sp.twoToneRoof ? 'MAT_Paint2' : paint, bucket: 'body' };
  if (glassZone && z <= sp.roofRearZ && !sp.uprightRear) {
    const lid = sp.tailgate ? 'tailgate' : 'body';
    const edge = local === 0 || z > sp.roofRearZ - 0.03 || z < sp.glassEndZ + 0.035;
    return edge ? { slot: 'MAT_Trim', bucket: lid } : { slot: 'MAT_Glass', bucket: 'rear_window' };
  }
  if (z > sp.cowlZ && z <= sp.hoodFrontZ) return { slot: paint, bucket: 'hood' };
  if (inRange(z, sp.trunk)) return { slot: paint, bucket: 'trunk' };
  return { slot: paint, bucket: 'body' };
}

/** Station z values: uniform spacing plus every z where something changes, sorted tail → nose. */
function stationZs(sp: BodySpec): number[] {
  const z0 = -sp.length / 2 + sp.tailRound, z1 = sp.length / 2 - sp.noseRound;
  const low = sp.detail === 'low';
  const zs: number[] = [z0, z1];
  const Ra = sp.wheelRadius + sp.archGap;
  // arches: stations at even angles round the arch, so it comes out as a regular polygon
  const archSteps = low ? 6 : 24;
  for (const za of [sp.frontAxleZ, sp.rearAxleZ]) {
    for (let k = 0; k <= archSteps; k++) zs.push(za + Math.cos((k / archSteps) * Math.PI) * Ra * (k === 0 || k === archSteps ? 0.999 : 1));
    zs.push(za - Ra - 0.012, za + Ra + 0.012);
  }
  const keys = [sp.cowlZ, sp.cowlZ - 0.035, sp.windshieldTopZ, sp.windshieldTopZ + 0.03, sp.roofRearZ, sp.roofRearZ - 0.03,
    sp.glassEndZ, sp.glassEndZ + 0.035, sp.hoodFrontZ];
  if (sp.trunk) keys.push(...sp.trunk);
  for (const w of sp.windows) keys.push(w.z0, w.z1);
  for (const d of sp.doors) keys.push(d.z0, d.z1);
  for (const k of keys) zs.push(k);
  // fill long gaps (the loft needs stations wherever the profile curves)
  const maxGap = low ? 0.3 : 0.045;
  const sorted0 = zs.filter((z) => z >= z0 - 1e-9 && z <= z1 + 1e-9).sort((a, b) => a - b);
  for (let i = 0; i + 1 < sorted0.length; i++) {
    const gap = sorted0[i + 1] - sorted0[i];
    const n = Math.floor(gap / maxGap);
    for (let k = 1; k <= n; k++) zs.push(sorted0[i] + (gap * k) / (n + 1));
  }
  const s = zs.filter((z) => z >= z0 - 1e-9 && z <= z1 + 1e-9).sort((a, b) => a - b);
  const out: number[] = [];
  for (const z of s) if (!out.length || z - out[out.length - 1] > 0.006) out.push(z);
  // keep exact keys when a uniform station was very close (replace)
  for (const k of keys) {
    if (k < z0 || k > z1) continue;
    let best = 0;
    for (let i = 1; i < out.length; i++) if (Math.abs(out[i] - k) < Math.abs(out[best] - k)) best = i;
    out[best] = k;
  }
  return out;
}

/** Shrink a section toward its middle (used for the rounded nose and tail). */
function shrinkSection(s: Section, d: number, z: number): Section {
  let top = -Infinity;
  for (const p of s.pts) top = Math.max(top, p[1]);
  const cy = (s.B + top) / 2, hh = Math.max(0.05, (top - s.B) / 2);
  const sx = Math.max(0.05, 1 - d / Math.max(0.1, s.W)), sy = Math.max(0.05, 1 - d / hh);
  return { ...s, z, pts: s.pts.map(([x, y]) => [x * sx, cy + (y - cy) * sy] as Vec2) };
}

export function buildBody(sp: BodySpec): BodyResult {
  const main = stationZs(sp).map((z) => section(sp, z));
  // rounded ends
  const tail: Section[] = [], nose: Section[] = [];
  const lay = layout(sp.detail);
  const NPTS = lay.npts;
  const flat = sp.detail === 'low';
  const ROUND_ROWS = flat ? 1 : 5;
  for (let k = ROUND_ROWS; k >= 1; k--) {
    const phi = (k / ROUND_ROWS) * (Math.PI / 2);
    tail.push(shrinkSection(main[0], sp.tailRound * (1 - Math.cos(phi)), main[0].z - sp.tailRound * Math.sin(phi)));
  }
  for (let k = 1; k <= ROUND_ROWS; k++) {
    const phi = (k / ROUND_ROWS) * (Math.PI / 2);
    const last = main[main.length - 1];
    nose.push(shrinkSection(last, sp.noseRound * (1 - Math.cos(phi)), last.z + sp.noseRound * Math.sin(phi)));
  }
  const st = [...tail, ...main, ...nose];
  const nS = st.length;
  const isEndRow = (i: number): boolean => i < ROUND_ROWS || i >= ROUND_ROWS + main.length - 1;

  // positions grid (left half)
  const P = (i: number, j: number): Vec3 => [st[i].pts[j][0], st[i].pts[j][1], st[i].z];
  // UVs: arc length along the section, z along the car
  const U: number[][] = st.map((s) => {
    const u = [0];
    for (let j = 1; j < NPTS; j++) u.push(u[j - 1] + Math.hypot(s.pts[j][0] - s.pts[j - 1][0], s.pts[j][1] - s.pts[j - 1][1]));
    return u;
  });

  // face normals (area-weighted) for every quad
  const FN: Vec3[][] = [];
  for (let i = 0; i + 1 < nS; i++) {
    const row: Vec3[] = [];
    for (let k = 0; k + 1 < NPTS; k++) {
      // outward for the left half: (dz along +i) × (along section)
      const d1 = sub(P(i + 1, k + 1), P(i, k)), d2 = sub(P(i, k + 1), P(i + 1, k));
      row.push(cross(d2, d1));
    }
    FN.push(row);
  }
  // creases across stations (top surface only): cowl, windshield top on some styles, sedan deck
  const creaseZ = [sp.cowlZ];
  if (sp.trunk) creaseZ.push(sp.glassEndZ);
  const creaseAt = new Set<number>();
  for (const cz of creaseZ) {
    let best = -1;
    for (let i = 0; i < nS; i++) if (best < 0 || Math.abs(st[i].z - cz) < Math.abs(st[best].z - cz)) best = i;
    if (best >= 0 && Math.abs(st[best].z - cz) < 1e-6) creaseAt.add(best);
  }
  const zGroup = (i: number): number => {
    let g = 0;
    for (const c of creaseAt) if (i >= c) g++;
    return g;
  };
  /** normal at grid vertex (i,j) as seen from quad (qi,qk) */
  const vertexNormal = (i: number, j: number, qi: number, qk: number): Vec3 => {
    const grp = GROUP[lay.segOf[qk]];
    const topSeg = grp === 4;
    const zg = zGroup(qi);
    let n: Vec3 = [0, 0, 0];
    for (const ii of [i - 1, i]) {
      if (ii < 0 || ii >= nS - 1) continue;
      if (topSeg && zGroup(ii) !== zg) continue;
      for (const kk of [j - 1, j]) {
        if (kk < 0 || kk >= NPTS - 1) continue;
        if (GROUP[lay.segOf[kk]] !== grp) continue;
        const f = FN[ii][kk];
        n = [n[0] + f[0], n[1] + f[1], n[2] + f[2]];
      }
    }
    if (Math.hypot(...n) < 1e-12) n = FN[qi][qk];
    if (Math.hypot(...n) < 1e-12) n = [1, 0, 0];
    return normalize(n);
  };

  const buckets = new Map<string, Map<Slot, Mesh>>();
  const out = (bucket: string, slot: Slot): Mesh => {
    if (!buckets.has(bucket)) buckets.set(bucket, new Map());
    const b = buckets.get(bucket)!;
    if (!b.has(slot)) b.set(slot, new Mesh());
    return b.get(slot)!;
  };

  const left = new Map<string, Map<Slot, Mesh>>();
  const outL = (bucket: string, slot: Slot): Mesh => {
    if (!left.has(bucket)) left.set(bucket, new Map());
    const b = left.get(bucket)!;
    if (!b.has(slot)) b.set(slot, new Mesh());
    return b.get(slot)!;
  };

  for (let i = 0; i + 1 < nS; i++) {
    const zMid = (st[i].z + st[i + 1].z) / 2;
    for (let k = 0; k + 1 < NPTS; k++) {
      const area = Math.hypot(...FN[i][k]);
      if (area < 1e-10) continue;
      const info = classify(sp, k, zMid, st[i], st[i + 1], isEndRow(i));
      const m = outL(info.bucket, info.slot);
      const corners: [number, number][] = [[i, k], [i + 1, k], [i + 1, k + 1], [i, k + 1]];
      const fn = normalize(FN[i][k]);
      const ids = corners.map(([ii, jj]) => m.v(P(ii, jj), flat ? fn : vertexNormal(ii, jj, i, k), [U[ii][jj], st[ii].z]));
      m.quad(ids[0], ids[1], ids[2], ids[3], FN[i][k]);
    }
  }

  // end caps (with an upright rear window for estates and vans)
  const capTail = capMesh(st[0], -1, sp.uprightRear ? sp : null);
  const capNose = capMesh(st[nS - 1], 1, null);
  for (const [bucket, slot, m] of [...capTail, ...capNose]) {
    const target = bucket === 'glass' ? outL('rear_window', 'MAT_Glass') : outL(sp.uprightRear && bucket === 'trim' ? 'body' : 'body', slot);
    target.merge(m);
  }

  // mirror into full buckets: left half as is, right half mirrored with _L → _R
  for (const [bucket, slots] of left) {
    for (const [slot, m] of slots) {
      out(bucket, slot).merge(m);
      const rb = bucket.endsWith('_L') ? bucket.slice(0, -2) + '_R' : bucket;
      out(rb, slot).merge(m.clone().mirrorX());
    }
  }

  const rayTris = collectTris(buckets);
  const sectionAt = (z: number): Section => section(sp, z);
  return {
    buckets,
    liner: buildLiner(sp, main, NPTS),
    collision: buildCollision(st, lay),
    shutLines: buildShutLines(sp, st),
    rayTris,
    sectionAt,
    stations: st,
  };
}

/** Full closed outline of a section (both halves), counter-clockwise seen from +Z. */
function fullOutline(s: Section): Vec2[] {
  const right = s.pts.map(([x, y]) => [-x, y] as Vec2);
  const leftPts = [...s.pts].reverse();
  // right half goes bottom→top on −x, then the left half top→bottom on +x
  const ring = [...right.slice(0, -1), ...leftPts.slice(0, -1)];
  // drop duplicates
  const outPts: Vec2[] = [];
  for (const p of ring) {
    const q = outPts[outPts.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-5) outPts.push(p);
  }
  return outPts;
}

/**
 * Close an end of the body. The cap is built as rings shrinking toward the middle, so an upright
 * rear window (a rounded rectangle) can sit in it as real geometry with a trim frame.
 */
function capMesh(s: Section, dir: 1 | -1, glassFor: BodySpec | null): [string, Slot, Mesh][] {
  const outline = fullOutline(s);
  let top = -Infinity;
  for (const p of outline) top = Math.max(top, p[1]);
  const facing: Vec3 = [0, 0, dir];
  const paint = new Mesh(), glass = new Mesh(), trim = new Mesh();
  if (!glassFor) {
    // simple fan around the section's middle
    const cy = (s.B + top) / 2;
    const c = paint.v([0, cy, s.z], facing, [0, cy]);
    const ids = outline.map((p) => paint.v([p[0], p[1], s.z], facing, [p[0], p[1]]));
    for (let i = 0; i < ids.length; i++) paint.tri(c, ids[i], ids[(i + 1) % ids.length], facing);
    return [['body', 'MAT_Paint', paint]];
  }
  // rear window rectangle on the back face
  const sp = glassFor;
  const yBot = Math.min(top - 0.25, sampleAt(sp.belt, s.z) + 0.04);
  const yTop = top - 0.07;
  let halfW = Infinity;
  for (const p of outline) if (p[1] > yBot && p[1] < yTop) halfW = Math.min(halfW, Math.abs(p[0]));
  halfW = Math.max(0.2, (isFinite(halfW) ? halfW : 0.5) - 0.08);
  const cx = 0, cy = (yBot + yTop) / 2, hw = halfW, hh = (yTop - yBot) / 2;
  const rad = Math.min(0.06, hh * 0.4);
  // point on the rounded rect in the direction of angle a from (cx, cy)
  const rectAt = (a: number, inset: number): Vec2 => {
    const dx = Math.cos(a), dy = Math.sin(a);
    const w = hw - inset, h = hh - inset, r = Math.max(0.005, rad - inset);
    // superellipse-ish: march along the ray to the rounded rectangle boundary
    let lo = 0, hi = Math.hypot(w, h) * 2;
    for (let it = 0; it < 40; it++) {
      const mid = (lo + hi) / 2;
      const x = Math.abs(dx * mid), y = Math.abs(dy * mid);
      const qx = Math.max(0, x - (w - r)), qy = Math.max(0, y - (h - r));
      const inside = x <= w && y <= h && Math.hypot(qx, qy) <= r;
      if (inside) lo = mid; else hi = mid;
    }
    return [cx + dx * lo, cy + dy * lo];
  };
  const ang = outline.map((p) => Math.atan2(p[1] - cy, p[0] - cx));
  const ring0 = outline;
  const ring1 = ang.map((a) => rectAt(a, 0));
  const ring2 = ang.map((a) => rectAt(a, 0.035));
  const strip = (m: Mesh, ra: Vec2[], rbb: Vec2[]): void => {
    const n = ra.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = m.v([ra[i][0], ra[i][1], s.z], facing, ra[i]), b = m.v([ra[j][0], ra[j][1], s.z], facing, ra[j]);
      const c = m.v([rbb[j][0], rbb[j][1], s.z], facing, rbb[j]), d = m.v([rbb[i][0], rbb[i][1], s.z], facing, rbb[i]);
      m.tri(a, b, c, facing);
      m.tri(a, c, d, facing);
    }
  };
  strip(paint, ring0, ring1);
  strip(trim, ring1, ring2);
  const c = glass.v([cx, cy, s.z], facing, [cx, cy]);
  const ids = ring2.map((p) => glass.v([p[0], p[1], s.z], facing, p));
  for (let i = 0; i < ids.length; i++) glass.tri(c, ids[i], ids[(i + 1) % ids.length], facing);
  return [['body', 'MAT_Paint', paint], ['trim', 'MAT_Trim', trim], ['glass', 'MAT_Glass', glass]];
}

/** The inside of the cabin, seen through the glass: the body sections pushed in, faces flipped. */
function buildLiner(sp: BodySpec, main: Section[], NPTS: number): Mesh {
  const z1 = sp.cowlZ + 0.05, z0 = Math.max(sp.glassEndZ - 0.05, -sp.length / 2 + 0.15);
  const secs = main.filter((s) => s.z >= z0 && s.z <= z1);
  const m = new Mesh();
  if (secs.length < 2) return m;
  const inset = 0.035;
  const inner = secs.map((s) => {
    const pts: Vec2[] = s.pts.map((p, j) => {
      // 2D normal from neighbours (skip collapsed points)
      let a = j - 1, b = j + 1;
      while (a > 0 && Math.hypot(s.pts[a][0] - p[0], s.pts[a][1] - p[1]) < 1e-4) a--;
      while (b < s.pts.length - 1 && Math.hypot(s.pts[b][0] - p[0], s.pts[b][1] - p[1]) < 1e-4) b++;
      const pa = s.pts[Math.max(0, a)], pb = s.pts[Math.min(s.pts.length - 1, b)];
      const tx = pb[0] - pa[0], ty = pb[1] - pa[1];
      const l = Math.hypot(tx, ty) || 1;
      // outward normal for a bottom→top half-profile on the +x side is (ty, -tx)
      const nx = ty / l, ny = -tx / l;
      return [Math.max(0, p[0] - nx * inset), p[1] - ny * inset] as Vec2;
    });
    // floor flat at the sill, not down in the wheel wells
    const floorY = s.B + 0.12;
    return pts.map(([x, y]) => [x, Math.max(y, floorY)] as Vec2);
  });
  const rows: number[][] = [];
  for (let i = 0; i < inner.length; i++) {
    const row: number[] = [];
    for (let j = 0; j < NPTS; j++) row.push(m.v([inner[i][j][0], inner[i][j][1], secs[i].z], [0, 1, 0], [j * 0.1, secs[i].z]));
    rows.push(row);
  }
  for (let i = 0; i + 1 < rows.length; i++) {
    for (let j = 0; j + 1 < NPTS; j++) {
      // facing inward: toward the cabin centre
      const p = m.pos(rows[i][j]);
      const inward: Vec3 = [-p[0], 0.8 - p[1], 0];
      m.quad(rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1], inward);
    }
  }
  // bulkheads at both ends
  for (const [idx, dir] of [[0, 1], [inner.length - 1, -1]] as [number, number][]) {
    const ring = inner[idx];
    const cy = (ring[0][1] + ring[NPTS - 1][1]) / 2;
    const c = m.v([0, cy, secs[idx].z], [0, 0, dir], [0, 0]);
    const ids = ring.map((p) => m.v([p[0], p[1], secs[idx].z], [0, 0, dir], p));
    for (let j = 0; j + 1 < ids.length; j++) m.tri(c, ids[j], ids[j + 1], [0, 0, dir]);
  }
  // smooth-ish normals: recompute from faces
  recomputeNormals(m);
  const right = m.clone().mirrorX();
  return m.merge(right);
}

export function recomputeNormals(m: Mesh): void {
  const acc = new Float64Array(m.positions.length);
  for (let i = 0; i < m.indices.length; i += 3) {
    const a = m.indices[i], b = m.indices[i + 1], c = m.indices[i + 2];
    const n = cross(sub(m.pos(b), m.pos(a)), sub(m.pos(c), m.pos(a)));
    for (const v of [a, b, c]) { acc[3 * v] += n[0]; acc[3 * v + 1] += n[1]; acc[3 * v + 2] += n[2]; }
  }
  for (let v = 0; v < m.vertexCount; v++) {
    const n = normalize([acc[3 * v], acc[3 * v + 1], acc[3 * v + 2]]);
    m.normals[3 * v] = n[0]; m.normals[3 * v + 1] = n[1]; m.normals[3 * v + 2] = n[2];
  }
}

/** A coarse hull for physics: a few stations, a few section points. Engines take its convex hull. */
function buildCollision(st: Section[], lay: Layout): Mesh {
  const SEG_START = lay.start, NPTS = lay.npts;
  const m = new Mesh();
  const picks = [0, Math.floor(st.length * 0.25), Math.floor(st.length * 0.5), Math.floor(st.length * 0.75), st.length - 1];
  const js = [0, SEG_START.B, SEG_START.C, SEG_START.D, SEG_START.F, NPTS - 1];
  const rows = picks.map((i) => {
    const s = st[i];
    // avoid the wheel-well notch: use the sill corner
    return js.map((j) => m.v([s.pts[j][0] * (s.arch && j === SEG_START.B ? 1 : 1), s.pts[j][1], s.z], [0, 1, 0]));
  });
  for (let r = 0; r + 1 < rows.length; r++) {
    for (let k = 0; k + 1 < js.length; k++) m.quad(rows[r][k], rows[r + 1][k], rows[r + 1][k + 1], rows[r][k + 1]);
  }
  const right = m.clone().mirrorX();
  return m.merge(right);
}

/** Dark hairline strips along door and lid edges (so panels read as panels). */
function buildShutLines(sp: BodySpec, st: Section[]): Mesh {
  const { start: SEG_START, npts: NPTS } = layout(sp.detail);
  const m = new Mesh();
  const w = 0.0035, lift = 0.0015;
  const atZ = (z: number): Section | null => {
    let best: Section | null = null;
    for (const s of st) if (!best || Math.abs(s.z - z) < Math.abs(best.z - z)) best = s;
    return best && Math.abs(best.z - z) < 1e-4 ? best : null;
  };
  /** vertical strip at a station, between section intervals k0..k1 */
  const vertical = (z: number, k0: number, k1: number): void => {
    const s = atZ(z);
    if (!s) return;
    for (let k = k0; k < k1; k++) {
      const p0 = s.pts[k], p1 = s.pts[k + 1];
      if (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) < 1e-5) continue;
      const tx = p1[0] - p0[0], ty = p1[1] - p0[1], l = Math.hypot(tx, ty);
      const nx = ty / l, ny = -tx / l;
      const n: Vec3 = [nx, ny, 0];
      const a = m.v([p0[0] + nx * lift, p0[1] + ny * lift, z - w], n);
      const b = m.v([p0[0] + nx * lift, p0[1] + ny * lift, z + w], n);
      const c = m.v([p1[0] + nx * lift, p1[1] + ny * lift, z + w], n);
      const d = m.v([p1[0] + nx * lift, p1[1] + ny * lift, z - w], n);
      m.quad(a, b, c, d, n);
    }
  };
  for (const d of sp.doors) {
    vertical(d.z0, SEG_START.C, SEG_START.E);
    vertical(d.z1, SEG_START.C, SEG_START.E);
  }
  // hood rear edge (at the cowl) and trunk edges, across the top
  /** strip running along the car at section point j, between z0 and z1 (lid side edges) */
  const along = (j: number, z0: number, z1: number): void => {
    const sts = st.filter((s) => s.z >= z0 - 1e-6 && s.z <= z1 + 1e-6);
    for (let i = 0; i + 1 < sts.length; i++) {
      const quadAt = (s: Section): [Vec3, Vec3, Vec3] => {
        const p = s.pts[j];
        let k = j + 1;
        while (k < s.pts.length - 1 && Math.hypot(s.pts[k][0] - p[0], s.pts[k][1] - p[1]) < 1e-4) k++;
        const tx = s.pts[k][0] - p[0], ty = s.pts[k][1] - p[1], l = Math.hypot(tx, ty) || 1;
        const n: Vec3 = [ty / l, -tx / l, 0];
        const ux = tx / l, uy = ty / l;
        const base: Vec3 = [p[0] + n[0] * lift + ux * 0.006, p[1] + n[1] * lift + uy * 0.006, s.z];
        return [[base[0] - ux * w, base[1] - uy * w, s.z], [base[0] + ux * w, base[1] + uy * w, s.z], n];
      };
      const [a0, a1, n] = quadAt(sts[i]);
      const [b0, b1] = quadAt(sts[i + 1]);
      const ia = m.v(a0, n), ib = m.v(a1, n), ic = m.v(b1, n), id = m.v(b0, n);
      m.quad(ia, ib, ic, id, n);
    }
  };
  // hood: front edge across, and both sides along the shoulder
  vertical(sp.hoodFrontZ, SEG_START.G, NPTS - 1);
  along(SEG_START.G, sp.cowlZ + 0.01, sp.hoodFrontZ);
  if (sp.trunk) {
    for (const z of sp.trunk) vertical(z, SEG_START.G, NPTS - 1);
    along(SEG_START.G, sp.trunk[0], sp.trunk[1]);
  }
  const right = m.clone().mirrorX();
  return m.merge(right);
}

function collectTris(buckets: Map<string, Map<Slot, Mesh>>): Float64Array {
  const list: number[] = [];
  for (const slots of buckets.values()) {
    for (const m of slots.values()) {
      for (let i = 0; i < m.indices.length; i++) {
        const v = m.indices[i];
        list.push(m.positions[3 * v], m.positions[3 * v + 1], m.positions[3 * v + 2]);
      }
    }
  }
  return new Float64Array(list);
}

/** Cast a ray against the body; returns the nearest hit point and the face normal there. */
export function raycast(tris: Float64Array, o: Vec3, d: Vec3): { p: Vec3; n: Vec3; t: number } | null {
  let best: { p: Vec3; n: Vec3; t: number } | null = null;
  for (let i = 0; i < tris.length; i += 9) {
    const ax = tris[i], ay = tris[i + 1], az = tris[i + 2];
    const e1x = tris[i + 3] - ax, e1y = tris[i + 4] - ay, e1z = tris[i + 5] - az;
    const e2x = tris[i + 6] - ax, e2y = tris[i + 7] - ay, e2z = tris[i + 8] - az;
    const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) continue;
    const inv = 1 / det;
    const tx = o[0] - ax, ty = o[1] - ay, tz = o[2] - az;
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const vv = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
    if (vv < 0 || u + vv > 1) continue;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (t <= 1e-6 || (best && t >= best.t)) continue;
    let n = normalize([e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x]);
    if (n[0] * d[0] + n[1] * d[1] + n[2] * d[2] > 0) n = [-n[0], -n[1], -n[2]];
    best = { p: [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t], n, t };
  }
  return best;
}
