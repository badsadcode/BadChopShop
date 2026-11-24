/**
 * The Noor Interchange manifest (<name>.noor.json) and the recipe file (<name>.recipe.json).
 * See NoorEngine docs/interchange/NOOR_INTERCHANGE.md (v0.4) and this repo's
 * docs/VEHICLE_INTERCHANGE_PROPOSAL.md for the `vehicle` block.
 */
import type { Generated } from '../generate.js';
import type { Json } from '../core/vehicle.js';
import { nodeWorldPos } from '../core/vehicle.js';
import { GENERATOR_VERSION, type Recipe } from '../types.js';
import { hex, sha256, uuidV5 } from './hash.js';

/** Canonical recipe JSON (stable key order), used for the recipe file, its hash and the asset id. */
export function recipeJson(r: Recipe): string {
  const canon = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]));
    return v;
  };
  return JSON.stringify({ badchopshop_recipe: 1, version: GENERATOR_VERSION, ...(canon(r) as object) }, null, 2) + '\n';
}

export function baseName(r: Recipe): string {
  return `${r.type}_${r.style}_${r.seed}`;
}

export interface ManifestOptions {
  glb: Uint8Array;
  /** ISO timestamp (defaults to now; pass one for reproducible manifests) */
  created?: string;
  validation?: { gltf_validator: 'pass' | 'fail' | 'not_run'; errors?: number; warnings?: number };
  preview?: boolean;
}

export function buildManifest(g: Generated, opts: ManifestOptions): { [k: string]: Json } {
  const { vehicle: v, design: d, recipe } = g;
  const sp = d.body;
  const name = baseName(recipe);
  const rj = recipeJson(recipe);
  const rHash = hex(sha256(new TextEncoder().encode(rj)));
  let tris = 0;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const markers: Record<string, number> = {};
  const parts: Record<string, string[]> = {};
  for (const n of v.nodes) {
    const w = nodeWorldPos(v, n.name);
    for (const m of n.meshes.values()) {
      tris += m.indices.length / 3;
      if (n.group === 'markers') continue;
      for (let i = 0; i < m.positions.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          const x = m.positions[i + k] + w[k];
          if (x < min[k]) min[k] = x;
          if (x > max[k]) max[k] = x;
        }
      }
    }
    const mk = n.noor?.marker;
    if (typeof mk === 'string') markers[mk] = (markers[mk] ?? 0) + 1;
    const part = n.noor?.part;
    if (typeof part === 'string') (parts[part] ??= []).push(n.name);
  }
  const r4 = (x: number): number => Math.round(x * 1e4) / 1e4;
  const files: Json[] = [
    { path: `${name}.glb`, role: 'model', sha256: hex(sha256(opts.glb)) },
    { path: `${name}.recipe.json`, role: 'recipe', sha256: rHash },
  ];
  if (opts.preview) files.push({ path: `${name}.preview.png`, role: 'preview' });
  const included = Object.fromEntries(['wheels', 'brakes', 'suspension', 'lights', 'interior', 'engine', 'battery', 'exhaust', 'collision', 'markers']
    .map((k) => [k, (recipe.include as Record<string, boolean> | undefined)?.[k] !== false]));

  // Suggested driving values (Baltic Drive cars.json field names; games tune them)
  const lengthAll = max[2] - min[2];
  const mass = Math.round({ hatchback: 950, sedan: 1200, estate: 1300, van: 1750, truck: 4800 }[d.type] * (lengthAll / { hatchback: 3.9, sedan: 4.55, estate: 4.6, van: 4.95, truck: 7.2 }[d.type]) * (d.style.id === 'modern' ? 1.18 : d.style.id === 'nineties' ? 1.05 : 1));
  const power = Math.round(mass * ({ seventies: 5.6, nineties: 6.6, modern: 7.4 }[d.style.id]));
  const vehicleBlock: { [k: string]: Json } = {
    v: 1,
    class: d.type,
    mass,
    center_of_mass: [0, r4(sp.wheelRadius + (d.truck ? 0.55 : 0.22)), r4((sp.frontAxleZ + sp.rearAxleZ) / 2 + d.shiftZ + (d.truck ? 0.3 : 0.1))],
    drive: d.truck || (d.style.id === 'seventies' && d.type !== 'hatchback') ? 'rear' : 'front',
    power,
    top_kmh: { seventies: 145, nineties: 175, modern: 195 }[d.style.id] - (d.type === 'van' ? 30 : d.truck ? 55 : 0),
    grip: { front: d.style.id === 'modern' ? 1.8 : 1.6, rear: d.style.id === 'modern' ? 1.7 : 1.5 },
    steer: 0.6,
    brakes: Math.round(mass / 30),
    suspension: { stiffness: d.style.id === 'seventies' ? 26 : 32, damping: [2.6, 3.6] },
    engine: 'front',
    tank_l: d.truck ? 150 : d.type === 'van' ? 70 : 45 + (d.style.id === 'modern' ? 5 : 0),
    consumption_l100km: d.truck ? 18 : d.type === 'van' ? 11 : { seventies: 9.5, nineties: 7.5, modern: 6 }[d.style.id],
    boot_kg: { hatchback: 50, sedan: 80, estate: 120, van: 400, truck: 3000 }[d.type],
    seats: d.seats,
    doors: d.doorCount,
    wheels: d.truck ? 6 : 4,
    tracks: 0,
    dimensions: {
      length: r4(max[2] - min[2]), width: r4(max[0] - min[0]), height: r4(max[1] - min[1]),
      wheelbase: r4(sp.wheelbase), track_front: r4(2 * (sp.halfWidth - sp.tyreWidth / 2 - 0.02)),
      track_rear: r4(2 * (d.truck ? d.truck.boxHalfWidth - 0.04 - sp.tyreWidth : sp.halfWidth - sp.tyreWidth / 2 - 0.02)),
      wheel_radius: r4(sp.wheelRadius),
    },
  };

  return {
    noor_interchange: '0.4',
    id: uuidV5(`badchopshop:${rHash}`),
    name,
    // "vehicle.wheeled" is proposed for v0.5 (docs/VEHICLE_INTERCHANGE_PROPOSAL.md); v0.4 knows "vehicle"
    kind: 'vehicle',
    generator: { tool: 'BadChopShop', version: GENERATOR_VERSION, determinism: 'same_platform' },
    recipe: { file: `${name}.recipe.json`, seed: recipe.seed, sha256: rHash },
    created: opts.created ?? new Date().toISOString(),
    space: { up: '+Y', forward: '+Z', handedness: 'right', units: 'meters' },
    bounds: { min: min.map(r4), max: max.map(r4) },
    files,
    lods: [{ level: 0, triangles: tris }],
    collision: included.collision ? 'convex' : 'none',
    markers,
    tags: ['vehicle', d.truck ? 'truck' : 'car', d.type, d.style.id, 'low-poly'].filter((t) => t !== 'low-poly' || sp.detail === 'low'),
    license: { spdx: 'MIT', author: 'Bad Ideas Works', attribution: '' },
    validation: opts.validation ?? { gltf_validator: 'not_run' },
    vehicle: vehicleBlock,
    badchopshop: {
      type: d.type,
      style: d.style.id,
      palette: d.palette.name,
      detail: sp.detail,
      include: included,
      separate: { panels: recipe.separate?.panels !== false, glass: recipe.separate?.glass !== false },
      parts,
      genes: d.genes as { [k: string]: Json },
      material_slots: Object.keys(v.materials),
    },
  };
}
