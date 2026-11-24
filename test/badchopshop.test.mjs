// BadChopShop tests: run with `npm test` (builds first).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import validator from 'gltf-validator';
import * as B from '../dist/index.js';

const all = [];
for (const type of B.ARCHETYPE_IDS) for (const style of B.STYLE_IDS) all.push({ type, style });

function readGlbJson(glb) {
  const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const len = dv.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + len)));
}

test('every type × style passes the Khronos glTF validator', async () => {
  for (const { type, style } of all) {
    for (const seed of [1, 2]) {
      const g = B.generate({ type, style, seed });
      const glb = B.toGLB(g.vehicle);
      const r = await validator.validateBytes(glb, { maxIssues: 50 });
      assert.equal(r.issues.numErrors, 0, `${type}/${style}/${seed}: ${JSON.stringify(r.issues.messages.slice(0, 3))}`);
    }
  }
});

test('same recipe gives a byte-identical GLB; a different seed does not', () => {
  for (const { type, style } of all) {
    const a = B.toGLB(B.generate({ type, style, seed: 42 }).vehicle);
    const b = B.toGLB(B.generate({ type, style, seed: 42 }).vehicle);
    const c = B.toGLB(B.generate({ type, style, seed: 43 }).vehicle);
    assert.deepEqual(a, b, `${type}/${style} not deterministic`);
    assert.notDeepEqual(a, c, `${type}/${style}: seed ignored`);
  }
});

test('named random streams: pinning one gene leaves the others alone', () => {
  const a = B.generate({ type: 'sedan', style: 'nineties', seed: 9 }).design;
  const b = B.generate({ type: 'sedan', style: 'nineties', seed: 9, set: { length: 4.7 } }).design;
  assert.equal(a.genes.wheelRadius, b.genes.wheelRadius);
  assert.equal(a.genes.roof, b.genes.roof);
  assert.equal(a.palette.name, b.palette.name);
  assert.equal(b.genes.length, 4.7);
});

test('optional part groups can be switched off', () => {
  const groups = ['wheels', 'brakes', 'suspension', 'lights', 'interior', 'engine', 'battery', 'exhaust', 'markers'];
  const full = B.generate({ type: 'hatchback', style: 'seventies', seed: 5 }).vehicle;
  for (const gName of groups) assert.ok(full.nodes.some((n) => n.group === gName), `full car has no ${gName}`);
  for (const gName of groups) {
    const v = B.generate({ type: 'hatchback', style: 'seventies', seed: 5, include: { [gName]: false } }).vehicle;
    assert.ok(!v.nodes.some((n) => n.group === gName), `${gName} still present`);
    assert.ok(v.nodes.some((n) => n.name === 'Body'), 'body missing');
  }
  // brakes live under the wheels: no wheels means no brakes either
  const nw = B.generate({ type: 'hatchback', style: 'seventies', seed: 5, include: { wheels: false } }).vehicle;
  assert.ok(!nw.nodes.some((n) => n.group === 'brakes'));
  const nc = B.toGLB(B.generate({ type: 'sedan', style: 'modern', seed: 5, include: { collision: false } }).vehicle);
  assert.ok(!readGlbJson(nc).nodes.some((n) => n.name.includes('colonly')));
});

test('panels and glass: separate nodes, or welded into the body', () => {
  const sep = B.generate({ type: 'sedan', style: 'modern', seed: 3 }).vehicle;
  const names = sep.nodes.map((n) => n.name);
  for (const n of ['Hood', 'Trunk', 'Door_FL', 'Door_FR', 'Door_RL', 'Door_RR', 'Windshield', 'RearWindow', 'Window_FL', 'Window_RR']) {
    assert.ok(names.includes(n), `missing ${n}`);
  }
  // windows ride on their doors
  assert.equal(sep.nodes.find((n) => n.name === 'Window_FL').parent, 'Door_FL');
  const welded = B.generate({ type: 'sedan', style: 'modern', seed: 3, separate: { panels: false, glass: false } }).vehicle;
  assert.ok(!welded.nodes.some((n) => /^(Door_|Hood|Trunk|Window_|Windshield)/.test(n.name)));
  // same shell either way; separate panels only add their inner skins (door cards, hood underside)
  const tris = (v) => v.nodes.reduce((s, n) => s + [...n.meshes.values()].reduce((t, m) => t + m.indices.length / 3, 0), 0);
  assert.ok(tris(welded) < tris(sep) && tris(welded) > tris(sep) * 0.85);
});

test('wheels: four markers at hub height, tyres touching the ground', () => {
  for (const { type, style } of all) {
    const g = B.generate({ type, style, seed: 11 });
    const json = readGlbJson(B.toGLB(g.vehicle));
    const wheels = json.nodes.filter((n) => n.extras?.noor?.marker === 'vehicle.wheel');
    assert.equal(wheels.length, 4, `${type}/${style}`);
    for (const w of wheels) {
      const r = w.extras.noor.radius;
      assert.ok(Math.abs(w.translation[1] - r) < 1e-4, 'hub not at radius height');
      assert.ok(w.extras.noor.spin_node.endsWith('_Hub'));
    }
    const steered = wheels.filter((w) => w.extras.noor.steer > 0);
    assert.equal(steered.length, 2);
    for (const w of steered) assert.ok(w.translation[2] > 0, 'front wheels should steer (front faces +Z)');
  }
});

test('manifest follows Noor Interchange v0.4 basics', () => {
  const recipe = { type: 'estate', style: 'nineties', seed: 77 };
  const g = B.generate(recipe);
  const glb = B.toGLB(g.vehicle);
  const m = B.buildManifest(g, { glb, created: '2026-11-24T00:00:00Z' });
  for (const k of ['noor_interchange', 'id', 'name', 'kind', 'generator', 'created', 'space', 'files']) assert.ok(k in m, `missing ${k}`);
  assert.equal(m.kind, 'vehicle');
  assert.match(m.generator.tool, /^Bad[A-Za-z]+$/);
  assert.match(m.id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  for (const f of m.files) assert.match(f.path, /^[^/\\:]+$/);
  assert.equal(m.files[0].sha256.length, 64);
  assert.equal(m.id, B.buildManifest(B.generate(recipe), { glb, created: 'x' }).id, 'id must be stable');
  assert.ok(m.bounds.min[1] >= -0.15 && m.bounds.min[1] <= 0.001, 'car should rest on y = 0');
  assert.ok(m.vehicle.mass > 500 && m.vehicle.seats >= 3);
  assert.equal(m.markers['vehicle.wheel'], 4);
});

test('sha256 matches a known vector', () => {
  assert.equal(B.hex(B.sha256(new TextEncoder().encode('abc'))), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('stress: 200 random cars build without throwing', () => {
  for (let i = 0; i < 200; i++) {
    const { type, style } = all[i % all.length];
    const g = B.generate({ type, style, seed: 5000 + i });
    assert.ok(g.vehicle.nodes.length > 20);
  }
});
