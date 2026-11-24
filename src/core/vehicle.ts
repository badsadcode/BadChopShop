/**
 * The in-memory vehicle: a tree of named nodes, each with geometry per material slot.
 *
 * Builders author every mesh in VEHICLE space (one shared frame: metres, +Y up, front at +Z,
 * ground at y = 0, centred between the bumpers). `VehicleBuilder.add` converts it into the
 * node's local space, so pivots can sit wherever a game needs them (a door's hinge, a wheel's hub)
 * without the builders having to care.
 *
 * Nodes are translation-only (no rotation), which keeps local space = vehicle space minus an offset.
 */
import type { Vec3 } from './math.js';
import { Mesh } from './mesh.js';

/** Semantic material slots: stable names, so a game can recolour any slot without touching geometry. */
export const SLOTS = [
  'MAT_Paint', 'MAT_Paint2', 'MAT_Trim', 'MAT_Chrome', 'MAT_Plastic', 'MAT_Rubber', 'MAT_Rim', 'MAT_Glass',
  'MAT_Interior', 'MAT_Seat', 'MAT_Underbody', 'MAT_Engine', 'MAT_Metal', 'MAT_Brake',
  'MAT_LightHead', 'MAT_LightBrake', 'MAT_LightIndicator', 'MAT_LightReverse', 'MAT_Plate', 'MAT_Box',
] as const;
export type Slot = (typeof SLOTS)[number];

export interface MaterialDef {
  /** sRGB colour, 0..1 */
  color: Vec3;
  metallic: number;
  roughness: number;
  /** sRGB emissive colour (lamps); exported at strength 0 = off unless `lit` */
  emissive?: Vec3;
  /** 0..1, < 1 makes the material blended (glass) */
  alpha?: number;
  doubleSided?: boolean;
}

/**
 * Part groups that a recipe can switch on or off (`recipe.include`). Every node belongs to one.
 * `body` is always present.
 */
export const PART_GROUPS = [
  'body', 'panels', 'glass', 'lights', 'wheels', 'brakes', 'suspension',
  'interior', 'engine', 'battery', 'exhaust', 'collision', 'markers',
] as const;
export type PartGroup = (typeof PART_GROUPS)[number];

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export interface VNode {
  name: string;
  parent: string | null;
  /** Local translation relative to the parent. */
  translation: Vec3;
  group: PartGroup;
  meshes: Map<Slot, Mesh>;
  /** `extras.noor` block (markers, parts, collision). */
  noor?: { [k: string]: Json };
  /** Collision-only mesh (never rendered). */
  collision?: Mesh;
}

export interface Vehicle {
  name: string;
  nodes: VNode[];
  materials: Record<Slot, MaterialDef>;
}

export class VehicleBuilder {
  readonly nodes: VNode[] = [];
  private byName = new Map<string, VNode>();

  constructor(readonly name: string, readonly materials: Record<Slot, MaterialDef>) {}

  /** Create a node whose pivot is at `pivot` (VEHICLE space). */
  node(name: string, opts: { parent?: string | null; pivot?: Vec3; group: PartGroup; noor?: { [k: string]: Json } }): VNode {
    if (this.byName.has(name)) throw new Error(`duplicate node ${name}`);
    const parent = opts.parent ?? null;
    const pivot = opts.pivot ?? [0, 0, 0];
    const pw = parent ? this.worldPos(parent) : [0, 0, 0];
    const n: VNode = {
      name, parent, group: opts.group, meshes: new Map(), noor: opts.noor,
      translation: [pivot[0] - pw[0], pivot[1] - pw[1], pivot[2] - pw[2]],
    };
    this.nodes.push(n);
    this.byName.set(name, n);
    return n;
  }

  has(name: string): boolean { return this.byName.has(name); }
  get(name: string): VNode {
    const n = this.byName.get(name);
    if (!n) throw new Error(`no node ${name}`);
    return n;
  }

  /** World (vehicle-space) position of a node's pivot. */
  worldPos(name: string): Vec3 {
    let n: VNode | undefined = this.get(name);
    const p: Vec3 = [0, 0, 0];
    while (n) {
      p[0] += n.translation[0]; p[1] += n.translation[1]; p[2] += n.translation[2];
      n = n.parent ? this.byName.get(n.parent) : undefined;
    }
    return p;
  }

  /** Add vehicle-space geometry to a node's slot. */
  add(name: string, slot: Slot, mesh: Mesh): void {
    if (mesh.indices.length === 0) return;
    const node = this.get(name);
    const w = this.worldPos(name);
    const local = mesh.clone().translate([-w[0], -w[1], -w[2]]);
    const cur = node.meshes.get(slot);
    if (cur) cur.merge(local);
    else node.meshes.set(slot, local);
  }

  setCollision(name: string, mesh: Mesh): void {
    const w = this.worldPos(name);
    this.get(name).collision = mesh.clone().translate([-w[0], -w[1], -w[2]]);
  }

  /** Drop every node in an excluded group, and their descendants. */
  build(include: Partial<Record<PartGroup, boolean>>): Vehicle {
    const dropped = new Set<string>();
    const kept: VNode[] = [];
    for (const n of this.nodes) {
      const off = n.group !== 'body' && include[n.group] === false;
      if (off || (n.parent && dropped.has(n.parent))) { dropped.add(n.name); continue; }
      kept.push(n);
    }
    return { name: this.name, nodes: kept, materials: this.materials };
  }
}

/** World position of a node in a finished vehicle. */
export function nodeWorldPos(v: Vehicle, name: string): Vec3 {
  const by = new Map(v.nodes.map((n) => [n.name, n]));
  let n = by.get(name);
  const p: Vec3 = [0, 0, 0];
  while (n) {
    p[0] += n.translation[0]; p[1] += n.translation[1]; p[2] += n.translation[2];
    n = n.parent ? by.get(n.parent) : undefined;
  }
  return p;
}
