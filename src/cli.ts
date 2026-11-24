#!/usr/bin/env node
/**
 * BadChopShop command line.
 *
 *   badchopshop generate <type> [--style seventies] [--seed 42] [--palette 3] [--out out/]
 *                        [--no interior,engine,…] [--welded panels,glass] [--detail low|high] [--lit]
 *   badchopshop recipe <file.recipe.json> [--out out/]
 *   badchopshop batch [--count 12] [--out out/]
 *   badchopshop list
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generate } from './generate.js';
import { toGLB } from './export/glb.js';
import { baseName, buildManifest, recipeJson } from './export/manifest.js';
import { ARCHETYPE_IDS, type ArchetypeId } from './archetypes/index.js';
import { STYLE_IDS, STYLES, type StyleId } from './styles/index.js';
import type { Include, Recipe } from './types.js';

function parseArgs(argv: string[]): { pos: string[]; opt: Record<string, string | true> } {
  const pos: string[] = [];
  const opt: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { opt[k] = next; i++; } else opt[k] = true;
    } else pos.push(a);
  }
  return { pos, opt };
}

async function validate(glb: Uint8Array): Promise<{ gltf_validator: 'pass' | 'fail' | 'not_run'; errors?: number; warnings?: number }> {
  try {
    const mod = await import('gltf-validator' as string);
    const v = (mod.default ?? mod) as { validateBytes: (b: Uint8Array, o?: object) => Promise<{ issues: { numErrors: number; numWarnings: number } }> };
    const r = await v.validateBytes(glb, { maxIssues: 100 });
    return { gltf_validator: r.issues.numErrors === 0 ? 'pass' : 'fail', errors: r.issues.numErrors, warnings: r.issues.numWarnings };
  } catch {
    return { gltf_validator: 'not_run' };
  }
}

async function write(recipe: Recipe, out: string): Promise<void> {
  const g = generate(recipe);
  const glb = toGLB(g.vehicle, { lit: recipe.lit });
  const name = baseName(recipe);
  mkdirSync(out, { recursive: true });
  const validation = await validate(glb);
  writeFileSync(join(out, `${name}.glb`), glb);
  writeFileSync(join(out, `${name}.recipe.json`), recipeJson(recipe));
  writeFileSync(join(out, `${name}.noor.json`), JSON.stringify(buildManifest(g, { glb, validation }), null, 2) + '\n');
  let tris = 0;
  for (const n of g.vehicle.nodes) for (const m of n.meshes.values()) tris += m.indices.length / 3;
  console.log(`${name}: ${g.design.palette.name}, ${tris} triangles, ${(glb.length / 1024).toFixed(0)} KB, validator ${validation.gltf_validator}`);
}

const GROUPS = ['wheels', 'brakes', 'suspension', 'lights', 'interior', 'engine', 'battery', 'exhaust', 'collision', 'markers'];

function recipeFromOpts(type: string, opt: Record<string, string | true>): Recipe {
  if (!ARCHETYPE_IDS.includes(type as ArchetypeId)) throw new Error(`unknown type "${type}" (${ARCHETYPE_IDS.join(', ')})`);
  const style = (typeof opt.style === 'string' ? opt.style : 'seventies') as StyleId;
  if (!STYLE_IDS.includes(style)) throw new Error(`unknown style "${style}" (${STYLE_IDS.join(', ')})`);
  const r: Recipe = { type: type as ArchetypeId, style, seed: typeof opt.seed === 'string' ? Number(opt.seed) : 1 };
  if (typeof opt.palette === 'string') r.palette = Number(opt.palette);
  if (typeof opt.detail === 'string') r.detail = opt.detail as 'low' | 'high';
  if (opt.lit) r.lit = true;
  if (typeof opt.no === 'string') {
    const inc: Include = {};
    for (const k of opt.no.split(',')) {
      if (!GROUPS.includes(k)) throw new Error(`--no: unknown part group "${k}" (${GROUPS.join(', ')})`);
      (inc as Record<string, boolean>)[k] = false;
    }
    r.include = inc;
  }
  if (typeof opt.welded === 'string') {
    r.separate = {};
    for (const k of opt.welded.split(',')) (r.separate as Record<string, boolean>)[k] = false;
  }
  return r;
}

async function main(): Promise<void> {
  const { pos, opt } = parseArgs(process.argv.slice(2));
  const out = typeof opt.out === 'string' ? opt.out : 'out';
  const cmd = pos[0];
  if (cmd === 'generate' && pos[1]) await write(recipeFromOpts(pos[1], opt), out);
  else if (cmd === 'recipe' && pos[1]) {
    const r = JSON.parse(readFileSync(pos[1], 'utf8')) as Recipe & { badchopshop_recipe?: number; version?: string };
    delete r.badchopshop_recipe;
    delete r.version;
    await write(r, out);
  } else if (cmd === 'batch') {
    const count = typeof opt.count === 'string' ? Number(opt.count) : 12;
    for (let i = 0; i < count; i++) {
      await write({ type: ARCHETYPE_IDS[i % ARCHETYPE_IDS.length], style: STYLE_IDS[Math.floor(i / ARCHETYPE_IDS.length) % STYLE_IDS.length], seed: 1000 + i }, out);
    }
  } else if (cmd === 'list') {
    console.log(`types:  ${ARCHETYPE_IDS.join(', ')}`);
    console.log(`styles: ${STYLE_IDS.map((s) => `${s} (${STYLES[s].palettes.length} palettes)`).join(', ')}`);
    console.log(`parts you can switch off (--no): ${GROUPS.join(', ')}`);
    console.log('parts you can weld into the body (--welded): panels, glass');
  } else {
    console.log(`BadChopShop: procedural, game-ready vehicles. No questions asked.

  badchopshop generate <type> [--style S] [--seed N] [--palette N] [--out DIR]
                              [--no interior,engine,battery,exhaust,brakes,suspension,lights,wheels,collision,markers]
                              [--welded panels,glass] [--detail low|high] [--lit]
  badchopshop recipe <file.recipe.json> [--out DIR]
  badchopshop batch [--count N] [--out DIR]
  badchopshop list`);
  }
}

main().catch((e: Error) => { console.error(e.message); process.exit(1); });
