/**
 * Dependency-free glTF 2.0 binary (.glb) writer.
 *
 * Layout: one scene, one root node (the vehicle, pivot at bottom centre), the vehicle's node tree
 * below it. Each node with geometry gets one mesh with one primitive per material slot.
 * Noor data goes in `node.extras.noor` (Noor Interchange). Collision meshes become separate child
 * nodes named `<node>-convcolonly` with `extras.noor.collision`, never rendered by Noor importers,
 * and turned into physics shapes by Godot's name suffix.
 */
import type { Json, MaterialDef, Slot, Vehicle } from '../core/vehicle.js';
import { SLOTS } from '../core/vehicle.js';
import type { Mesh } from '../core/mesh.js';

/** Tiling UVs: 1 UV unit = 0.25 m on every vehicle. */
export const UV_UNITS_PER_METER = 4;

export interface ExportOptions {
  /** Light the lamps (emissive on). Default false: lamps are off, games switch them. */
  lit?: boolean;
  /** Extra data for the root node's `extras`. */
  rootExtras?: { [k: string]: Json };
}

const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const r6 = (x: number): number => Math.round(x * 1e6) / 1e6;

class BinWriter {
  chunks: Uint8Array[] = [];
  length = 0;
  views: Json[] = [];
  accessors: Json[] = [];

  private push(bytes: Uint8Array, target?: number): number {
    const pad = (4 - (this.length % 4)) % 4;
    if (pad) { this.chunks.push(new Uint8Array(pad)); this.length += pad; }
    const view: { [k: string]: Json } = { buffer: 0, byteOffset: this.length, byteLength: bytes.byteLength };
    if (target) view.target = target;
    this.chunks.push(bytes);
    this.length += bytes.byteLength;
    this.views.push(view);
    return this.views.length - 1;
  }

  floats(data: number[], type: 'VEC2' | 'VEC3', minmax = false): number {
    const arr = new Float32Array(data);
    const view = this.push(new Uint8Array(arr.buffer), 34962);
    const comps = type === 'VEC2' ? 2 : 3;
    const acc: { [k: string]: Json } = { bufferView: view, componentType: 5126, count: data.length / comps, type };
    if (minmax) {
      const min = Array(comps).fill(Infinity), max = Array(comps).fill(-Infinity);
      for (let i = 0; i < arr.length; i++) {
        const k = i % comps;
        if (arr[i] < min[k]) min[k] = arr[i];
        if (arr[i] > max[k]) max[k] = arr[i];
      }
      acc.min = min;
      acc.max = max;
    }
    this.accessors.push(acc);
    return this.accessors.length - 1;
  }

  indices(data: number[], vertexCount: number): number {
    const big = vertexCount > 65535;
    const arr = big ? new Uint32Array(data) : new Uint16Array(data);
    const view = this.push(new Uint8Array(arr.buffer, 0, arr.byteLength), 34963);
    this.accessors.push({ bufferView: view, componentType: big ? 5125 : 5123, count: data.length, type: 'SCALAR' });
    return this.accessors.length - 1;
  }

  bytes(): Uint8Array {
    const pad = (4 - (this.length % 4)) % 4;
    const out = new Uint8Array(this.length + pad);
    let o = 0;
    for (const c of this.chunks) { out.set(c, o); o += c.byteLength; }
    return out;
  }
}

/** Weld identical vertices (same position, normal and UV after rounding) and drop degenerate triangles. */
export function weld(mesh: Mesh): { pos: number[]; nrm: number[]; uv: number[]; idx: number[] } {
  const map = new Map<string, number>();
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
  const remap: number[] = [];
  for (let i = 0; i < mesh.vertexCount; i++) {
    let nx = mesh.normals[3 * i], ny = mesh.normals[3 * i + 1], nz = mesh.normals[3 * i + 2];
    const l = Math.hypot(nx, ny, nz);
    if (l > 1e-9) { nx /= l; ny /= l; nz /= l; } else { nx = 0; ny = 1; nz = 0; }
    const p = [r6(mesh.positions[3 * i]), r6(mesh.positions[3 * i + 1]), r6(mesh.positions[3 * i + 2])];
    const n = [Math.round(nx * 1e4) / 1e4, Math.round(ny * 1e4) / 1e4, Math.round(nz * 1e4) / 1e4];
    const t = [r6(mesh.uvs[2 * i] * UV_UNITS_PER_METER), r6(mesh.uvs[2 * i + 1] * UV_UNITS_PER_METER)];
    const key = `${p[0]},${p[1]},${p[2]}|${n[0]},${n[1]},${n[2]}|${t[0]},${t[1]}`;
    let j = map.get(key);
    if (j === undefined) {
      j = pos.length / 3;
      map.set(key, j);
      pos.push(...p);
      const nl = Math.hypot(n[0], n[1], n[2]) || 1;
      nrm.push(n[0] / nl, n[1] / nl, n[2] / nl);
      uv.push(t[0], t[1]);
    }
    remap.push(j);
  }
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = remap[mesh.indices[i]], b = remap[mesh.indices[i + 1]], c = remap[mesh.indices[i + 2]];
    if (a === b || b === c || a === c) continue;
    // drop zero-area triangles (validator warns about them)
    const ax = pos[3 * a], ay = pos[3 * a + 1], az = pos[3 * a + 2];
    const ux = pos[3 * b] - ax, uy = pos[3 * b + 1] - ay, uz = pos[3 * b + 2] - az;
    const vx = pos[3 * c] - ax, vy = pos[3 * c + 1] - ay, vz = pos[3 * c + 2] - az;
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (Math.hypot(cx, cy, cz) < 1e-10) continue;
    idx.push(a, b, c);
  }
  return { pos, nrm, uv, idx };
}

function materialJson(slot: Slot, m: MaterialDef, lit: boolean): { [k: string]: Json } {
  const alpha = m.alpha ?? 1;
  const out: { [k: string]: Json } = {
    name: slot,
    pbrMetallicRoughness: {
      baseColorFactor: [r6(srgbToLinear(m.color[0])), r6(srgbToLinear(m.color[1])), r6(srgbToLinear(m.color[2])), alpha],
      metallicFactor: m.metallic,
      roughnessFactor: m.roughness,
    },
  };
  if (alpha < 1) out.alphaMode = 'BLEND';
  if (m.doubleSided) out.doubleSided = true;
  if (m.emissive) {
    const k = lit ? 1 : 0;
    out.emissiveFactor = m.emissive.map((c) => r6(srgbToLinear(c) * k));
    out.extras = { noor: { v: 1, emissive_on: m.emissive.map((c) => r6(srgbToLinear(c))) } };
  }
  return out;
}

export function toGltf(v: Vehicle, opts: ExportOptions = {}): { json: { [k: string]: Json }; bin: Uint8Array } {
  const bin = new BinWriter();
  const used = new Set<Slot>();
  for (const n of v.nodes) for (const s of n.meshes.keys()) used.add(s);
  const slotList = SLOTS.filter((s) => used.has(s));
  const matIndex = new Map(slotList.map((s, i) => [s, i]));
  const materials = slotList.map((s) => materialJson(s, v.materials[s], !!opts.lit));

  const nodes: { [k: string]: Json }[] = [];
  const meshes: Json[] = [];
  const nodeIndex = new Map<string, number>();
  const children = new Map<string, number[]>();
  nodes.push({ name: v.name, children: [] as Json[] });
  if (opts.rootExtras) nodes[0].extras = opts.rootExtras;

  const addPrims = (m: Mesh, material?: number): { [k: string]: Json } | null => {
    const w = weld(m);
    if (w.idx.length === 0) return null;
    const vc = w.pos.length / 3;
    const prim: { [k: string]: Json } = {
      attributes: {
        POSITION: bin.floats(w.pos, 'VEC3', true),
        NORMAL: bin.floats(w.nrm, 'VEC3'),
        TEXCOORD_0: bin.floats(w.uv, 'VEC2'),
      },
      indices: bin.indices(w.idx, vc),
    };
    if (material !== undefined) prim.material = material;
    return prim;
  };

  for (const n of v.nodes) {
    const node: { [k: string]: Json } = { name: n.name };
    if (n.translation.some((x) => Math.abs(x) > 1e-9)) node.translation = n.translation.map(r6);
    if (n.noor) node.extras = { noor: { v: 1, ...n.noor } };
    const prims: Json[] = [];
    for (const s of SLOTS) {
      const m = n.meshes.get(s);
      if (!m) continue;
      const p = addPrims(m, matIndex.get(s));
      if (p) prims.push(p);
    }
    if (prims.length) {
      meshes.push({ name: n.name, primitives: prims });
      node.mesh = meshes.length - 1;
    }
    nodes.push(node);
    const idx = nodes.length - 1;
    nodeIndex.set(n.name, idx);
    const parentKey = n.parent ?? '';
    if (!children.has(parentKey)) children.set(parentKey, []);
    children.get(parentKey)!.push(idx);

    if (n.collision) {
      const p = addPrims(n.collision);
      if (p) {
        meshes.push({ name: `${n.name}-convcolonly`, primitives: [p] });
        nodes.push({ name: `${n.name}-convcolonly`, mesh: meshes.length - 1, extras: { noor: { v: 1, collision: 'convex' } } });
        const ci = nodes.length - 1;
        if (!children.has(n.name)) children.set(n.name, []);
        children.get(n.name)!.push(ci);
      }
    }
  }
  nodes[0].children = children.get('') ?? [];
  for (const [parent, kids] of children) {
    if (!parent) continue;
    const pi = nodeIndex.get(parent);
    if (pi !== undefined) nodes[pi].children = kids;
  }

  const binBytes = bin.bytes();
  const json: { [k: string]: Json } = {
    asset: { version: '2.0', generator: 'BadChopShop' },
    scene: 0,
    scenes: [{ name: v.name, nodes: [0] }],
    nodes,
    meshes,
    materials,
    accessors: bin.accessors,
    bufferViews: bin.views,
    buffers: [{ byteLength: binBytes.byteLength }],
  };
  return { json, bin: binBytes };
}

export function toGLB(v: Vehicle, opts: ExportOptions = {}): Uint8Array {
  const { json, bin } = toGltf(v, opts);
  const enc = new TextEncoder();
  let jsonBytes = enc.encode(JSON.stringify(json));
  const jpad = (4 - (jsonBytes.length % 4)) % 4;
  if (jpad) {
    const p = new Uint8Array(jsonBytes.length + jpad);
    p.set(jsonBytes);
    p.fill(0x20, jsonBytes.length);
    jsonBytes = p;
  }
  const total = 12 + 8 + jsonBytes.length + 8 + bin.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); // 'glTF'
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length, true);
  dv.setUint32(16, 0x4e4f534a, true); // 'JSON'
  out.set(jsonBytes, 20);
  const o = 20 + jsonBytes.length;
  dv.setUint32(o, bin.length, true);
  dv.setUint32(o + 4, 0x004e4942, true); // 'BIN\0'
  out.set(bin, o + 8);
  return out;
}
