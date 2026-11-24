/**
 * Small vector maths. Conventions match glTF and Noor Interchange:
 * metres, +Y up, the vehicle's front faces +Z, so +X is the vehicle's LEFT side.
 */

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
/** Quaternion [x, y, z, w]. */
export type Quat = [number, number, number, number];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export function normalize(a: Vec3): Vec3 {
  const l = len(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 1, 0];
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Round to a fixed number of decimals (keeps exported numbers tidy and deterministic). */
export const round = (x: number, d = 5): number => {
  const k = 10 ** d;
  return Math.round(x * k) / k;
};

/** A 3×3 rotation stored as three column vectors (the local X, Y and Z axes in parent space). */
export interface Basis { x: Vec3; y: Vec3; z: Vec3 }

export const IDENTITY: Basis = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

export function applyBasis(b: Basis, v: Vec3): Vec3 {
  return [
    b.x[0] * v[0] + b.y[0] * v[1] + b.z[0] * v[2],
    b.x[1] * v[0] + b.y[1] * v[1] + b.z[1] * v[2],
    b.x[2] * v[0] + b.y[2] * v[1] + b.z[2] * v[2],
  ];
}

/** A basis whose +Z points along `forward`, with +Y as close to `up` as possible. */
export function basisLookZ(forward: Vec3, up: Vec3 = [0, 1, 0]): Basis {
  const z = normalize(forward);
  let x = cross(up, z);
  if (len(x) < 1e-6) x = cross([1, 0, 0], z);
  x = normalize(x);
  const y = cross(z, x);
  return { x, y, z };
}

/** Rotation about an axis (radians) as a basis. */
export function basisAxisAngle(axis: Vec3, angle: number): Basis {
  const [x, y, z] = normalize(axis);
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  return {
    x: [t * x * x + c, t * x * y + s * z, t * x * z - s * y],
    y: [t * x * y - s * z, t * y * y + c, t * y * z + s * x],
    z: [t * x * z + s * y, t * y * z - s * x, t * z * z + c],
  };
}

/** Quaternion from a rotation basis (for glTF node rotations). */
export function quatFromBasis(b: Basis): Quat {
  const m00 = b.x[0], m10 = b.x[1], m20 = b.x[2];
  const m01 = b.y[0], m11 = b.y[1], m21 = b.y[2];
  const m02 = b.z[0], m12 = b.z[1], m22 = b.z[2];
  const tr = m00 + m11 + m22;
  let q: Quat;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}
