/**
 * Wheels: tyre, rim (several designs), brake disc and caliper, built around the hub at the origin
 * with the axle along X and the OUTER face toward +X. Right-side wheels are mirrored.
 */
import type { Vec2 } from '../core/math.js';
import { Mesh, box, cylinderX, discX, latheX } from '../core/mesh.js';
import type { RimKind } from '../styles/index.js';

export interface WheelGeo {
  tyre: Mesh;
  rim: Mesh;
  /** chrome/polished bits (hubcaps, trims) */
  chrome: Mesh;
  disc: Mesh;
  caliper: Mesh;
}

let SEG = 36;

export function buildTyre(R: number, rimR: number, width: number): Mesh {
  const hw = width / 2;
  const shoulder = Math.min(0.035, (R - rimR) * 0.35);
  // cross-section [radius, x], from the inner bead round the tread to the outer bead
  const prof: Vec2[] = SEG <= 16 ? [
    [rimR + 0.005, -hw * 0.86],
    [R - shoulder, -hw * 1.0],
    [R, -hw * 0.7],
    [R, hw * 0.7],
    [R - shoulder, hw * 1.0],
    [rimR + 0.005, hw * 0.86],
  ] : [
    [rimR + 0.005, -hw * 0.86],
    [rimR + (R - rimR) * 0.45, -hw * 1.0],
    [R - shoulder, -hw * 0.98],
    [R - shoulder * 0.25, -hw * 0.86],
    [R, -hw * 0.62],
    [R, hw * 0.62],
    [R - shoulder * 0.25, hw * 0.86],
    [R - shoulder, hw * 0.98],
    [rimR + (R - rimR) * 0.45, hw * 1.0],
    [rimR + 0.005, hw * 0.86],
  ];
  return latheX(prof, SEG, true);
}

/** Rim face profile helper: a dish from the barrel to the hub. */
function dish(rimR: number, hw: number, depth: number): Vec2[] {
  return [
    [rimR + 0.012, hw * 0.86],
    [rimR, hw * 0.72],
    [rimR * 0.92, hw * 0.62 - depth * 0.3],
    [rimR * 0.35, hw * 0.62 - depth],
    [rimR * 0.18, hw * 0.62 - depth * 0.7],
    [0.001, hw * 0.62 - depth * 0.6],
  ];
}

export function buildWheel(R: number, rimR: number, width: number, kind: RimKind, low = true): WheelGeo {
  SEG = low ? 12 : 36;
  const hw = width / 2;
  const tyre = buildTyre(R, rimR, width);
  const rim = new Mesh();
  const chrome = new Mesh();
  // barrel (inside of the tyre bead, visible behind spokes)
  rim.merge(latheX([[rimR, -hw * 0.86], [rimR, hw * 0.82]], SEG).flip());
  const lip = latheX([[rimR + 0.012, hw * 0.86], [rimR - 0.004, hw * 0.9], [rimR - 0.012, hw * 0.82]], SEG, true);

  if (kind === 'steel-hubcap' || kind === 'steel-plain' || kind === 'cover') {
    rim.merge(lip);
    // steel wheel face
    rim.merge(latheX(dish(rimR, hw, 0.045), SEG, true));
    // ventilation holes as dark-ish raised pads would need cuts; use bolt bosses instead
    if (kind === 'steel-hubcap') {
      chrome.merge(latheX([[rimR * 0.62, hw * 0.78], [rimR * 0.58, hw * 0.83], [rimR * 0.3, hw * 0.88], [0.001, hw * 0.9]], SEG, true));
    } else if (kind === 'cover') {
      // full plastic wheel cover with slots: a flat disc + raised spokes
      rim.merge(latheX([[rimR * 0.97, hw * 0.82], [rimR * 0.9, hw * 0.88], [rimR * 0.25, hw * 0.9], [0.001, hw * 0.92]], SEG, true));
      const ribs = SEG <= 16 ? 6 : 10;
      for (let k = 0; k < ribs; k++) {
        const a = (k / ribs) * Math.PI * 2;
        const s = box([0, 0, 0], [0.012, rimR * 0.5, 0.025], SEG <= 16 ? 0 : 0.003);
        s.transform({ x: [1, 0, 0], y: [0, Math.cos(a), Math.sin(a)], z: [0, -Math.sin(a), Math.cos(a)] }, [hw * 0.91, Math.cos(a) * rimR * 0.62, Math.sin(a) * rimR * 0.62]);
        rim.merge(s);
      }
    } else {
      chrome.merge(latheX([[rimR * 0.22, hw * 0.78], [rimR * 0.2, hw * 0.84], [0.001, hw * 0.86]], 16, true));
    }
  } else {
    // alloy: lip, a recessed centre, and spokes
    rim.merge(lip);
    rim.merge(latheX([[rimR * 0.98, hw * 0.82], [rimR * 0.9, hw * 0.6], [rimR * 0.5, hw * 0.45]], SEG, true));
    const spokes = kind === 'alloy-5' ? 5 : kind === 'alloy-multi' ? (SEG <= 16 ? 8 : 10) : (SEG <= 16 ? 10 : 16);
    const sw = kind === 'alloy-5' ? rimR * 0.24 : kind === 'alloy-multi' ? rimR * 0.11 : rimR * 0.07;
    for (let k = 0; k < spokes; k++) {
      const a = (k / spokes) * Math.PI * 2 + (kind === 'alloy-turbine' ? 0.2 : 0);
      const len = rimR * 0.78;
      const s = box([0, 0, 0], [0.03, len, sw], SEG <= 16 ? 0 : 0.008);
      const tilt = kind === 'alloy-turbine' ? 0.5 : 0;
      const ca = Math.cos(a), sa = Math.sin(a);
      // spoke points radially (local Y → radial), lies in the wheel face
      const yAx: [number, number, number] = [0, ca, sa];
      const zAx: [number, number, number] = [0, -sa * Math.cos(tilt), ca * Math.cos(tilt)];
      const xAx: [number, number, number] = [Math.cos(tilt), sa * Math.sin(tilt) * 0, -ca * Math.sin(tilt) * 0];
      s.transform({ x: [1, 0, 0], y: yAx, z: zAx }, [hw * 0.72, ca * (rimR * 0.18 + len / 2), sa * (rimR * 0.18 + len / 2)]);
      void xAx;
      rim.merge(s);
    }
    rim.merge(latheX([[rimR * 0.24, hw * 0.62], [rimR * 0.22, hw * 0.8], [rimR * 0.12, hw * 0.84], [0.001, hw * 0.85]], 20, true));
    chrome.merge(latheX([[rimR * 0.09, hw * 0.84], [rimR * 0.07, hw * 0.87], [0.001, hw * 0.88]], 12, true));
  }
  // lug nuts
  const lugs = SEG <= 16 ? 0 : 4 + (rimR > 0.2 ? 1 : 0);
  for (let k = 0; k < lugs; k++) {
    const a = (k / lugs) * Math.PI * 2;
    const r = rimR * 0.3;
    const nut = cylinderX(0.011, 0.02, 6).transform(undefined, [hw * 0.82 - 0.04 * (kind.startsWith('steel') ? 0.6 : 0.4), Math.cos(a) * r, Math.sin(a) * r]);
    (kind === 'steel-hubcap' ? rim : chrome).merge(nut);
  }

  const discR = Math.min(rimR - 0.03, 0.17 + (rimR - 0.18) * 0.9);
  const disc = cylinderX(discR, 0.024, SEG <= 16 ? 10 : 28).transform(undefined, [-hw * 0.15, 0, 0]);
  if (SEG > 16) disc.merge(discX(discR * 0.45, -hw * 0.15 + 0.013, 16, 1));
  // caliper: a block hugging the disc at the back-top
  const caliper = box([-hw * 0.15, 0, 0], [0.055, discR * 0.55, 0.11], SEG <= 16 ? 0 : 0.012);
  caliper.translate([0, discR * 0.62, -discR * 0.45]);
  return { tyre, rim, chrome, disc, caliper };
}
