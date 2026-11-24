/**
 * Triangle meshes and the small set of primitives the parts are made of.
 *
 * UVs are *physical*: metres along the surface. The exporter scales them by UV_UNITS_PER_METER,
 * so tiling textures and trim sheets have the same density on every generated vehicle.
 */
import type { Basis, Vec2, Vec3 } from './math.js';
import { IDENTITY, add, applyBasis, cross, dot, normalize, sub } from './math.js';
import { signedArea, triangulate } from './curve.js';

export class Mesh {
  positions: number[] = [];
  normals: number[] = [];
  uvs: number[] = [];
  indices: number[] = [];

  get vertexCount(): number { return this.positions.length / 3; }
  get triangleCount(): number { return this.indices.length / 3; }

  v(p: Vec3, n: Vec3, uv: Vec2 = [0, 0]): number {
    this.positions.push(p[0], p[1], p[2]);
    this.normals.push(n[0], n[1], n[2]);
    this.uvs.push(uv[0], uv[1]);
    return this.vertexCount - 1;
  }

  pos(i: number): Vec3 { return [this.positions[3 * i], this.positions[3 * i + 1], this.positions[3 * i + 2]]; }
  nrm(i: number): Vec3 { return [this.normals[3 * i], this.normals[3 * i + 1], this.normals[3 * i + 2]]; }

  /** Triangle a-b-c, wound so its face points along `facing` (glTF front = counter-clockwise). */
  tri(a: number, b: number, c: number, facing?: Vec3): void {
    if (facing) {
      const n = cross(sub(this.pos(b), this.pos(a)), sub(this.pos(c), this.pos(a)));
      if (dot(n, facing) < 0) { this.indices.push(a, c, b); return; }
    }
    this.indices.push(a, b, c);
  }

  /** Quad a-b-c-d (in order around the edge). */
  quad(a: number, b: number, c: number, d: number, facing?: Vec3): void {
    this.tri(a, b, c, facing);
    this.tri(a, c, d, facing);
  }

  merge(o: Mesh): this {
    const base = this.vertexCount;
    for (const x of o.positions) this.positions.push(x);
    for (const x of o.normals) this.normals.push(x);
    for (const x of o.uvs) this.uvs.push(x);
    for (const i of o.indices) this.indices.push(i + base);
    return this;
  }

  /** Rotate by `b` then move by `t` (in place). */
  transform(b: Basis = IDENTITY, t: Vec3 = [0, 0, 0]): this {
    for (let i = 0; i < this.vertexCount; i++) {
      const p = add(applyBasis(b, this.pos(i)), t);
      const n = normalize(applyBasis(b, this.nrm(i)));
      this.positions[3 * i] = p[0]; this.positions[3 * i + 1] = p[1]; this.positions[3 * i + 2] = p[2];
      this.normals[3 * i] = n[0]; this.normals[3 * i + 1] = n[1]; this.normals[3 * i + 2] = n[2];
    }
    return this;
  }

  translate(t: Vec3): this {
    for (let i = 0; i < this.positions.length; i += 3) {
      this.positions[i] += t[0];
      this.positions[i + 1] += t[1];
      this.positions[i + 2] += t[2];
    }
    return this;
  }

  /** Mirror across the YZ plane (x → −x), keeping faces pointing outward. */
  mirrorX(): this {
    for (let i = 0; i < this.positions.length; i += 3) {
      this.positions[i] = -this.positions[i];
      this.normals[i] = -this.normals[i];
    }
    for (let i = 0; i < this.indices.length; i += 3) {
      const t = this.indices[i + 1];
      this.indices[i + 1] = this.indices[i + 2];
      this.indices[i + 2] = t;
    }
    return this;
  }

  /** Reverse every face (for surfaces seen from the inside, such as the cabin liner). */
  flip(): this {
    for (let i = 0; i < this.normals.length; i++) this.normals[i] = -this.normals[i];
    for (let i = 0; i < this.indices.length; i += 3) {
      const t = this.indices[i + 1];
      this.indices[i + 1] = this.indices[i + 2];
      this.indices[i + 2] = t;
    }
    return this;
  }

  clone(): Mesh {
    const m = new Mesh();
    m.positions = [...this.positions];
    m.normals = [...this.normals];
    m.uvs = [...this.uvs];
    m.indices = [...this.indices];
    return m;
  }

  bounds(): { min: Vec3; max: Vec3 } {
    const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < this.positions.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], this.positions[i + k]);
        max[k] = Math.max(max[k], this.positions[i + k]);
      }
    }
    return { min, max };
  }
}

// ---------------------------------------------------------------------------------------------
// Primitives. Each is built around its own origin; place it with `.transform(basis, position)`.
// ---------------------------------------------------------------------------------------------

/** Offset a closed polygon inward by d (miter joins). Counter-clockwise input. */
export function insetPolygon(poly: Vec2[], d: number): Vec2[] {
  const n = poly.length;
  const ccw = signedArea(poly) > 0 ? 1 : -1;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = poly[(i + n - 1) % n], p = poly[i], b = poly[(i + 1) % n];
    const e0 = normalize([p[0] - a[0], p[1] - a[1], 0]);
    const e1 = normalize([b[0] - p[0], b[1] - p[1], 0]);
    // inward normals of each edge (left of the edge for CCW)
    const n0: Vec2 = [-e0[1] * ccw, e0[0] * ccw], n1: Vec2 = [-e1[1] * ccw, e1[0] * ccw];
    let mx = n0[0] + n1[0], my = n0[1] + n1[1];
    const ml = Math.hypot(mx, my) || 1;
    mx /= ml; my /= ml;
    const cosHalf = Math.max(0.35, mx * n0[0] + my * n0[1]);
    out.push([p[0] + (mx * d) / cosHalf, p[1] + (my * d) / cosHalf]);
  }
  return out;
}

/**
 * Extrude a 2D shape (in the local XY plane) along +Z from 0 to `depth`.
 * `bevel` chamfers the front edge (z = depth); the back face is left open unless `back` is set.
 */
export function extrude(shape: Vec2[], depth: number, opts: { bevel?: number; back?: boolean } = {}): Mesh {
  const m = new Mesh();
  const poly = signedArea(shape) < 0 ? [...shape].reverse() : shape;
  const bevel = Math.min(opts.bevel ?? 0, depth * 0.9);
  const front = bevel > 0 ? insetPolygon(poly, bevel) : poly;
  const zSide = depth - bevel;
  const n = poly.length;
  // sides
  let u = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const e = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const nn = normalize([b[1] - a[1], -(b[0] - a[0]), 0]);
    const i0 = m.v([a[0], a[1], 0], nn, [u, 0]);
    const i1 = m.v([b[0], b[1], 0], nn, [u + e, 0]);
    const i2 = m.v([b[0], b[1], zSide], nn, [u + e, zSide]);
    const i3 = m.v([a[0], a[1], zSide], nn, [u, zSide]);
    m.quad(i0, i1, i2, i3, nn);
    if (bevel > 0) {
      const fa = front[i], fb = front[(i + 1) % n];
      const bn = normalize(add(nn, [0, 0, 1]));
      const j0 = m.v([a[0], a[1], zSide], bn, [u, zSide]);
      const j1 = m.v([b[0], b[1], zSide], bn, [u + e, zSide]);
      const j2 = m.v([fb[0], fb[1], depth], bn, [u + e, zSide + bevel]);
      const j3 = m.v([fa[0], fa[1], depth], bn, [u, zSide + bevel]);
      m.quad(j0, j1, j2, j3, bn);
    }
    u += e;
  }
  // front cap
  const tris = triangulate(front);
  const base = m.vertexCount;
  for (const p of front) m.v([p[0], p[1], depth], [0, 0, 1], [p[0], p[1]]);
  for (let i = 0; i < tris.length; i += 3) m.tri(base + tris[i], base + tris[i + 1], base + tris[i + 2], [0, 0, 1]);
  if (opts.back) {
    const b0 = m.vertexCount;
    for (const p of poly) m.v([p[0], p[1], 0], [0, 0, -1], [p[0], p[1]]);
    const bt = triangulate(poly);
    for (let i = 0; i < bt.length; i += 3) m.tri(b0 + bt[i], b0 + bt[i + 1], b0 + bt[i + 2], [0, 0, -1]);
  }
  return m;
}

/** Axis-aligned box centred at `c`, optionally chamfered on every edge. */
export function box(c: Vec3, size: Vec3, bevel = 0): Mesh {
  const [sx, sy, sz] = size;
  if (bevel <= 0) {
    const m = new Mesh();
    const h: Vec3 = [sx / 2, sy / 2, sz / 2];
    const faces: [Vec3, Vec3, Vec3][] = [
      [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      [[-1, 0, 0], [0, 1, 0], [0, 0, 1]],
      [[0, 1, 0], [1, 0, 0], [0, 0, 1]],
      [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
      [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
      [[0, 0, -1], [1, 0, 0], [0, 1, 0]],
    ];
    for (const [n, a, b] of faces) {
      const center: Vec3 = [c[0] + n[0] * h[0], c[1] + n[1] * h[1], c[2] + n[2] * h[2]];
      const ha = Math.abs(a[0] * h[0] + a[1] * h[1] + a[2] * h[2]);
      const hb = Math.abs(b[0] * h[0] + b[1] * h[1] + b[2] * h[2]);
      const corner = (s: number, t: number): Vec3 => [
        center[0] + a[0] * ha * s + b[0] * hb * t,
        center[1] + a[1] * ha * s + b[1] * hb * t,
        center[2] + a[2] * ha * s + b[2] * hb * t,
      ];
      const i0 = m.v(corner(-1, -1), n, [0, 0]);
      const i1 = m.v(corner(1, -1), n, [2 * ha, 0]);
      const i2 = m.v(corner(1, 1), n, [2 * ha, 2 * hb]);
      const i3 = m.v(corner(-1, 1), n, [0, 2 * hb]);
      m.quad(i0, i1, i2, i3, n);
    }
    return m;
  }
  // Chamfered: extrude a chamfered rectangle (XY) along Z with bevelled caps on both ends.
  const b = Math.min(bevel, sx / 2.2, sy / 2.2, sz / 2.2);
  const rect: Vec2[] = [
    [sx / 2 - b, -sy / 2], [sx / 2, -sy / 2 + b], [sx / 2, sy / 2 - b], [sx / 2 - b, sy / 2],
    [-sx / 2 + b, sy / 2], [-sx / 2, sy / 2 - b], [-sx / 2, -sy / 2 + b], [-sx / 2 + b, -sy / 2],
  ];
  const half = extrude(rect, sz / 2, { bevel: b });
  const other = half.clone().transform({ x: [-1, 0, 0], y: [0, 1, 0], z: [0, 0, -1] });
  return half.merge(other).translate(c);
}

/**
 * Lathe a profile around the X axis. Profile points are [radius, x].
 * Each profile segment gets its own vertices, so creases stay crisp; normals are smooth around.
 */
export function latheX(profile: Vec2[], segments: number, smooth = false): Mesh {
  const m = new Mesh();
  const ring = (k: number): [number, number] => {
    const a = (k / segments) * Math.PI * 2;
    return [Math.cos(a), Math.sin(a)];
  };
  if (smooth) {
    // one shared band: normals from neighbouring profile points
    const rows: number[][] = [];
    let vAcc = 0;
    for (let i = 0; i < profile.length; i++) {
      const prev = profile[Math.max(0, i - 1)], next = profile[Math.min(profile.length - 1, i + 1)];
      const dr = next[0] - prev[0], dx = next[1] - prev[1];
      // normal in the (r, x) plane: perpendicular to the tangent, pointing outward-ish
      let nr = dx, nx = -dr;
      const l = Math.hypot(nr, nx) || 1;
      nr /= l; nx /= l;
      if (i > 0) vAcc += Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]);
      const row: number[] = [];
      for (let k = 0; k <= segments; k++) {
        const [c, s] = ring(k);
        const r = profile[i][0];
        row.push(m.v([profile[i][1], c * r, s * r], [nx, c * nr, s * nr], [(k / segments) * Math.PI * 2 * Math.max(r, 0.01), vAcc]));
      }
      rows.push(row);
    }
    for (let i = 0; i + 1 < rows.length; i++) {
      for (let k = 0; k < segments; k++) {
        const a = rows[i][k], b = rows[i][k + 1], c = rows[i + 1][k + 1], d = rows[i + 1][k];
        m.indices.push(a, b, c, a, c, d);
      }
    }
    return m;
  }
  let vAcc = 0;
  for (let i = 0; i + 1 < profile.length; i++) {
    const [r0, x0] = profile[i], [r1, x1] = profile[i + 1];
    const dr = r1 - r0, dx = x1 - x0;
    const seg = Math.hypot(dr, dx);
    if (seg < 1e-9) continue;
    const nr = dx / seg, nx = -dr / seg;
    const base = m.vertexCount;
    for (let k = 0; k <= segments; k++) {
      const [c, s] = ring(k);
      const u = (k / segments) * Math.PI * 2;
      m.v([x0, c * r0, s * r0], [nx, c * nr, s * nr], [u * Math.max(r0, 0.01), vAcc]);
      m.v([x1, c * r1, s * r1], [nx, c * nr, s * nr], [u * Math.max(r1, 0.01), vAcc + seg]);
    }
    for (let k = 0; k < segments; k++) {
      const a = base + 2 * k, b = base + 2 * k + 1, c = base + 2 * k + 3, d = base + 2 * k + 2;
      m.indices.push(a, d, c, a, c, b);
    }
    vAcc += seg;
  }
  return m;
}

/** A disc cap for a lathe at axial position x, facing +X (or −X). */
export function discX(r: number, x: number, segments: number, facing: 1 | -1 = 1): Mesh {
  const m = new Mesh();
  const c = m.v([x, 0, 0], [facing, 0, 0], [0, 0]);
  const ids: number[] = [];
  for (let k = 0; k < segments; k++) {
    const a = (k / segments) * Math.PI * 2;
    ids.push(m.v([x, Math.cos(a) * r, Math.sin(a) * r], [facing, 0, 0], [Math.cos(a) * r, Math.sin(a) * r]));
  }
  for (let k = 0; k < segments; k++) m.tri(c, ids[k], ids[(k + 1) % segments], [facing, 0, 0]);
  return m;
}

/** A closed cylinder along X, centred at the origin. */
export function cylinderX(r: number, length: number, segments: number): Mesh {
  const m = latheX([[r, -length / 2], [r, length / 2]], segments);
  m.merge(discX(r, length / 2, segments, 1)).merge(discX(r, -length / 2, segments, -1));
  return m;
}

/** A round tube following a 3D path (pipes, springs, wires). Open ends. */
export function tubePath(path: Vec3[], radius: number, segments = 8): Mesh {
  const m = new Mesh();
  const rows: number[][] = [];
  let prevX: Vec3 | null = null;
  let vAcc = 0;
  for (let i = 0; i < path.length; i++) {
    const t = normalize(sub(path[Math.min(path.length - 1, i + 1)], path[Math.max(0, i - 1)]));
    // parallel transport a stable side vector along the path
    let x: Vec3 = prevX ? normalize(sub(prevX, [t[0] * dot(prevX, t), t[1] * dot(prevX, t), t[2] * dot(prevX, t)])) : normalize(cross([0, 1, 0], t));
    if (!isFinite(x[0]) || Math.hypot(...x) < 0.5) x = normalize(cross([1, 0, 0], t));
    const y = cross(t, x);
    prevX = x;
    if (i > 0) vAcc += Math.hypot(...sub(path[i], path[i - 1]));
    const row: number[] = [];
    for (let k = 0; k <= segments; k++) {
      const a = (k / segments) * Math.PI * 2;
      const n: Vec3 = [x[0] * Math.cos(a) + y[0] * Math.sin(a), x[1] * Math.cos(a) + y[1] * Math.sin(a), x[2] * Math.cos(a) + y[2] * Math.sin(a)];
      row.push(m.v(add(path[i], [n[0] * radius, n[1] * radius, n[2] * radius]), n, [(k / segments) * Math.PI * 2 * radius, vAcc]));
    }
    rows.push(row);
  }
  for (let i = 0; i + 1 < rows.length; i++) {
    for (let k = 0; k < segments; k++) {
      const a = rows[i][k], b = rows[i][k + 1], c = rows[i + 1][k + 1], d = rows[i + 1][k];
      const p = m.pos(a), nrm = m.nrm(a);
      void p;
      m.tri(a, b, c, nrm);
      m.tri(a, c, d, nrm);
    }
  }
  return m;
}

/**
 * Sweep a closed 2D profile along a 3D path. Profile coordinates are [out, up]: `out` is the
 * horizontal direction pointing away from `center` (in plan), `up` is +Y. Ends are capped.
 */
export function sweep(path: Vec3[], profile: Vec2[], center: Vec3, opts: { capped?: boolean } = {}): Mesh {
  const m = new Mesh();
  const n = profile.length;
  const frames = path.map((p, i) => {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)];
    const t = normalize([b[0] - a[0], 0, b[2] - a[2]]);
    let out = normalize(cross([0, 1, 0], t));
    if (dot(out, [p[0] - center[0], 0, p[2] - center[2]]) < 0) out = [-out[0], -out[1], -out[2]];
    return { p, out, t };
  });
  // per-profile-point normals in 2D (smooth)
  const pn = profile.map((_, j) => {
    const a = profile[(j + n - 1) % n], b = profile[(j + 1) % n];
    const tx = b[0] - a[0], ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1;
    return [ty / l, -tx / l] as Vec2;
  });
  const ccw = signedArea(profile) > 0;
  const rows: number[][] = [];
  let vAcc = 0;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (i > 0) vAcc += Math.hypot(f.p[0] - frames[i - 1].p[0], f.p[1] - frames[i - 1].p[1], f.p[2] - frames[i - 1].p[2]);
    const row: number[] = [];
    let u = 0;
    for (let j = 0; j <= n; j++) {
      const q = profile[j % n];
      if (j > 0) u += Math.hypot(q[0] - profile[j - 1][0], q[1] - profile[j - 1][1]);
      const nn = pn[j % n];
      const s = ccw ? 1 : -1;
      const nrm = normalize([f.out[0] * nn[0] * s, nn[1] * s, f.out[2] * nn[0] * s]);
      row.push(m.v([f.p[0] + f.out[0] * q[0], f.p[1] + q[1], f.p[2] + f.out[2] * q[0]], nrm, [u, vAcc]));
    }
    rows.push(row);
  }
  for (let i = 0; i + 1 < rows.length; i++) {
    for (let j = 0; j < n; j++) {
      const a = rows[i][j], b = rows[i][j + 1], c = rows[i + 1][j + 1], d = rows[i + 1][j];
      m.tri(a, b, c, m.nrm(a));
      m.tri(a, c, d, m.nrm(a));
    }
  }
  if (opts.capped !== false) {
    for (const [i, sgn] of [[0, -1], [rows.length - 1, 1]] as [number, number][]) {
      const f = frames[i];
      const facing: Vec3 = [f.t[0] * sgn, 0, f.t[2] * sgn];
      const ids = profile.map((q) => m.v([f.p[0] + f.out[0] * q[0], f.p[1] + q[1], f.p[2] + f.out[2] * q[0]], facing, q));
      const tris = triangulate(profile);
      for (let k = 0; k < tris.length; k += 3) m.tri(ids[tris[k]], ids[tris[k + 1]], ids[tris[k + 2]], facing);
    }
  }
  return m;
}

/** Flat shading: every triangle gets its own three vertices and its face normal (the low-poly look). */
export function faceted(src: Mesh): Mesh {
  const m = new Mesh();
  for (let i = 0; i < src.indices.length; i += 3) {
    const a = src.indices[i], b = src.indices[i + 1], c = src.indices[i + 2];
    const pa = src.pos(a), pb = src.pos(b), pc = src.pos(c);
    const n = cross(sub(pb, pa), sub(pc, pa));
    if (Math.hypot(n[0], n[1], n[2]) < 1e-14) continue;
    let fn = normalize(n);
    // keep the original orientation if the source normals disagree (shouldn't happen)
    if (dot(fn, src.nrm(a)) < -0.9 && dot(fn, src.nrm(b)) < -0.9) fn = [-fn[0], -fn[1], -fn[2]];
    const uv = (v: number): Vec2 => [src.uvs[2 * v], src.uvs[2 * v + 1]];
    const ia = m.v(pa, fn, uv(a)), ib = m.v(pb, fn, uv(b)), ic = m.v(pc, fn, uv(c));
    m.indices.push(ia, ib, ic);
  }
  return m;
}
