/**
 * 2D curve helpers: polylines, corner rounding, and "height at z" lookups for side profiles.
 */
import type { Vec2 } from './math.js';
import { clamp, lerp } from './math.js';

/**
 * Round every interior corner of an open polyline with a circular-ish fillet.
 * `radii[i]` is the fillet size at point i (0 = keep the sharp corner). Ends are kept.
 */
export function filletPolyline(pts: Vec2[], radii: number[] | number, segs = 6): Vec2[] {
  const out: Vec2[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const r = typeof radii === 'number' ? radii : radii[i] ?? 0;
    const p = pts[i], a = pts[i - 1], b = pts[i + 1];
    if (r <= 0) { out.push(p); continue; }
    const la = Math.hypot(a[0] - p[0], a[1] - p[1]);
    const lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const d = Math.min(r, la * 0.48, lb * 0.48);
    const p0: Vec2 = [p[0] + ((a[0] - p[0]) / la) * d, p[1] + ((a[1] - p[1]) / la) * d];
    const p1: Vec2 = [p[0] + ((b[0] - p[0]) / lb) * d, p[1] + ((b[1] - p[1]) / lb) * d];
    // Quadratic Bezier with the corner as control point: smooth, tangent to both edges.
    for (let k = 0; k <= segs; k++) {
      const t = k / segs, u = 1 - t;
      out.push([u * u * p0[0] + 2 * u * t * p[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * p[1] + t * t * p1[1]]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Linear lookup of y at x on a polyline sorted by x (clamped at the ends). */
export function sampleAt(pts: Vec2[], x: number): number {
  if (x <= pts[0][0]) return pts[0][1];
  const n = pts.length;
  if (x >= pts[n - 1][0]) return pts[n - 1][1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid][0] <= x) lo = mid; else hi = mid;
  }
  const [x0, y0] = pts[lo], [x1, y1] = pts[hi];
  return x1 - x0 < 1e-12 ? y1 : lerp(y0, y1, (x - x0) / (x1 - x0));
}

/** Sort points by x and drop near-duplicates (keeps the later one). */
export function sortByX(pts: Vec2[]): Vec2[] {
  const s = [...pts].sort((a, b) => a[0] - b[0]);
  const out: Vec2[] = [];
  for (const p of s) {
    if (out.length && Math.abs(out[out.length - 1][0] - p[0]) < 1e-6) out[out.length - 1] = p;
    else out.push(p);
  }
  return out;
}

/** Resample an open polyline into `n` points evenly spaced by arc length. */
export function resample(pts: Vec2[], n: number): Vec2[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1];
  if (total < 1e-9) return Array.from({ length: n }, () => [pts[0][0], pts[0][1]] as Vec2);
  const out: Vec2[] = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const s = (total * k) / (n - 1);
    while (j < cum.length - 2 && cum[j + 1] < s) j++;
    const seg = cum[j + 1] - cum[j];
    const t = seg > 1e-12 ? clamp((s - cum[j]) / seg, 0, 1) : 0;
    out.push([lerp(pts[j][0], pts[j + 1][0], t), lerp(pts[j][1], pts[j + 1][1], t)]);
  }
  return out;
}

/** Points on a superellipse quarter-ish arc, for rounded-rectangle outlines. */
export function roundedRect(w: number, h: number, r: number, seg = 4, cx = 0, cy = 0): Vec2[] {
  const rr = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4);
  const pts: Vec2[] = [];
  const corners: [number, number, number][] = [
    [w / 2 - rr, h / 2 - rr, 0],
    [-w / 2 + rr, h / 2 - rr, Math.PI / 2],
    [-w / 2 + rr, -h / 2 + rr, Math.PI],
    [w / 2 - rr, -h / 2 + rr, (3 * Math.PI) / 2],
  ];
  for (const [x, y, a0] of corners) {
    for (let k = 0; k <= seg; k++) {
      const a = a0 + (k / seg) * (Math.PI / 2);
      pts.push([cx + x + Math.cos(a) * rr, cy + y + Math.sin(a) * rr]);
    }
  }
  return pts;
}

/** A circle (or ellipse) outline, counter-clockwise. */
export function ellipse(rx: number, ry: number, seg = 20, cx = 0, cy = 0): Vec2[] {
  const pts: Vec2[] = [];
  for (let k = 0; k < seg; k++) {
    const a = (k / seg) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return pts;
}

export function signedArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Ear-clipping triangulation of a simple polygon. Returns index triples (counter-clockwise). */
export function triangulate(poly: Vec2[]): number[] {
  const n = poly.length;
  const idx = Array.from({ length: n }, (_, i) => i);
  if (signedArea(poly) < 0) idx.reverse();
  const out: number[] = [];
  const isEar = (i0: number, i1: number, i2: number, rest: number[]): boolean => {
    const a = poly[i0], b = poly[i1], c = poly[i2];
    const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (cr <= 1e-12) return false;
    for (const j of rest) {
      if (j === i0 || j === i1 || j === i2) continue;
      const p = poly[j];
      const d1 = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
      const d2 = (c[0] - b[0]) * (p[1] - b[1]) - (c[1] - b[1]) * (p[0] - b[0]);
      const d3 = (a[0] - c[0]) * (p[1] - c[1]) - (a[1] - c[1]) * (p[0] - c[0]);
      if (d1 >= 0 && d2 >= 0 && d3 >= 0) return false;
    }
    return true;
  };
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k + idx.length - 1) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length];
      if (isEar(i0, i1, i2, idx)) {
        out.push(i0, i1, i2);
        idx.splice(k, 1);
        clipped = true;
        break;
      }
    }
    if (!clipped) break; // degenerate leftovers: fan the rest
  }
  for (let k = 1; k + 1 < idx.length; k++) out.push(idx[0], idx[k], idx[k + 1]);
  return out;
}
