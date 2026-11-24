/**
 * Material slot definitions for one vehicle: paint from the palette, everything else from the style.
 */
import type { Vec3 } from './core/math.js';
import type { MaterialDef, Slot } from './core/vehicle.js';
import type { Design } from './archetypes/index.js';

const mix = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (c: Vec3, k: number): Vec3 => [c[0] * k, c[1] * k, c[2] * k];

export function materialsFor(d: Design, overrides: Partial<Record<Slot, Partial<MaterialDef>>> = {}): Record<Slot, MaterialDef> {
  const paint = d.palette.paint;
  // second colour: the palette's, or for a two-tone lower body a dark grey (the AE86 look)
  const paint2 = d.palette.paint2 ?? (d.body.lowerTone ? [0.12, 0.12, 0.13] : mul(paint, 0.6));
  const s = d.style;
  const metallicPaint = s.id === 'seventies' ? 0.05 : 0.35;
  const base: Record<Slot, MaterialDef> = {
    // fairly matte: glossy paint under studio light reads as moulded plastic (toys)
    MAT_Paint: { color: paint, metallic: metallicPaint * 0.4, roughness: s.id === 'seventies' ? 0.6 : 0.5, doubleSided: true },
    MAT_Paint2: { color: paint2, metallic: metallicPaint * 0.4, roughness: 0.55, doubleSided: true },
    MAT_Trim: { color: [0.05, 0.05, 0.055], metallic: 0, roughness: 0.6, doubleSided: true },
    MAT_Chrome: { color: [0.78, 0.79, 0.8], metallic: 1, roughness: 0.22, doubleSided: true },
    MAT_Plastic: { color: s.plastic, metallic: 0, roughness: 0.75, doubleSided: true },
    MAT_Rubber: { color: [0.035, 0.035, 0.037], metallic: 0, roughness: 0.88 },
    MAT_Rim: d.rim.startsWith('steel')
      ? { color: d.rim === 'steel-plain' ? [0.1, 0.1, 0.11] : [0.42, 0.43, 0.45], metallic: 0.6, roughness: 0.5 }
      : d.rim === 'cover'
        ? { color: [0.58, 0.6, 0.62], metallic: 0.2, roughness: 0.45 }
        : { color: [0.5, 0.51, 0.53], metallic: 0.85, roughness: 0.35 },
    MAT_Glass: { color: [0.06, 0.075, 0.09], metallic: 0, roughness: 0.08, alpha: 0.72, doubleSided: true },
    MAT_Interior: { color: mix(mul(d.interiorColor, 0.8), [0.1, 0.1, 0.105], 0.35), metallic: 0, roughness: 0.85, doubleSided: true },
    MAT_Seat: { color: d.interiorColor, metallic: 0, roughness: 0.8 },
    MAT_Underbody: { color: [0.06, 0.06, 0.065], metallic: 0, roughness: 0.9, doubleSided: true },
    MAT_Engine: { color: [0.32, 0.33, 0.35], metallic: 0.7, roughness: 0.5 },
    MAT_Metal: { color: [0.45, 0.46, 0.48], metallic: 0.85, roughness: 0.4 },
    MAT_Brake: { color: s.id === 'modern' ? [0.62, 0.08, 0.07] : [0.2, 0.2, 0.21], metallic: 0.4, roughness: 0.5 },
    MAT_LightHead: { color: [0.72, 0.78, 0.84], metallic: 0.2, roughness: 0.08, emissive: [1, 0.97, 0.9] },
    MAT_LightBrake: { color: [0.55, 0.04, 0.04], metallic: 0, roughness: 0.15, emissive: [1, 0.05, 0.03] },
    MAT_LightIndicator: { color: [0.85, 0.45, 0.05], metallic: 0, roughness: 0.15, emissive: [1, 0.55, 0.05] },
    MAT_LightReverse: { color: [0.85, 0.86, 0.88], metallic: 0, roughness: 0.12, emissive: [1, 1, 1] },
    MAT_Plate: { color: [0.92, 0.92, 0.9], metallic: 0, roughness: 0.5 },
    // cargo box of a truck: white, aluminium, or the cab's paint
    MAT_Box: d.truck?.boxColor === 'paint' ? { color: paint, metallic: metallicPaint, roughness: 0.4 }
      : d.truck?.boxColor === 'silver' ? { color: [0.72, 0.74, 0.76], metallic: 0.6, roughness: 0.4 }
        : { color: [0.9, 0.9, 0.88], metallic: 0.05, roughness: 0.55 },
  };
  for (const [k, v] of Object.entries(overrides)) {
    const slot = k as Slot;
    base[slot] = { ...base[slot], ...v } as MaterialDef;
  }
  return base;
}
