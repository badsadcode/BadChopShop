/**
 * Archetypes (vehicle types). An archetype owns PROPORTIONS and LAYOUT: length, wheelbase, where
 * the windshield and roof are, how the back ends (trunk, hatch, upright tailgate), how many doors
 * and windows. It turns (type, style, seed) into a Design: a fully decided BodySpec plus the
 * choices for every other part. Every decision draws from a named random stream.
 */
import type { Vec2, Vec3 } from '../core/math.js';
import { filletPolyline, sortByX } from '../core/curve.js';
import { Rng } from '../core/rng.js';
import type { BodySpec, Detail, DoorSpec, WindowSpec } from '../body/spec.js';
import type { HeadlampKind, Palette, Range, RimKind, StyleId, StyleProfile, TaillampKind } from '../styles/index.js';
import { STYLES } from '../styles/index.js';

export type ArchetypeId = 'hatchback' | 'sedan' | 'estate' | 'van' | 'truck';
export const ARCHETYPE_IDS: ArchetypeId[] = ['hatchback', 'sedan', 'estate', 'van', 'truck'];

/** A box truck: the lofted body is only the cab; the cargo box, chassis and twin rear axle come from parts/truck.ts. */
export interface TruckSpec {
  /** z of the box's front and rear faces (vehicle frame of the cab, before centring) */
  boxFront: number;
  boxRear: number;
  boxHalfWidth: number;
  floorY: number;
  boxTop: number;
  /** 'white' | 'silver' | 'paint' */
  boxColor: string;
  /** roll-up shutter or two barn doors at the back */
  rearDoor: 'shutter' | 'barn';
}

export interface Design {
  type: ArchetypeId;
  style: StyleProfile;
  body: BodySpec;
  doorCount: number;
  seats: number;
  rows: number;
  palette: Palette;
  interiorColor: Vec3;
  headlamp: HeadlampKind;
  taillamp: TaillampKind;
  rim: RimKind;
  rimRadius: number;
  /** genes actually used, for the recipe/manifest */
  genes: Record<string, number | string | boolean>;
  /** box trucks only */
  truck?: TruckSpec;
  /** how far the whole vehicle is moved along z so its footprint is centred (trucks; 0 for cars) */
  shiftZ: number;
}

interface ArchetypeDims {
  length: Range;
  width: Range;
  roof: Range;
  wheelbase: Range;
  frontOverhang: Range;
  hood: Range;
  belt: Range;
  noseTop: Range;
}

const DIMS: Record<ArchetypeId, ArchetypeDims> = {
  hatchback: { length: [3.7, 4.15], width: [1.62, 1.76], roof: [1.4, 1.48], wheelbase: [2.36, 2.6], frontOverhang: [0.68, 0.82], hood: [0.85, 1.0], belt: [0.9, 0.96], noseTop: [0.66, 0.74] },
  sedan: { length: [4.35, 4.8], width: [1.68, 1.82], roof: [1.38, 1.45], wheelbase: [2.55, 2.8], frontOverhang: [0.82, 0.98], hood: [1.08, 1.28], belt: [0.88, 0.95], noseTop: [0.64, 0.72] },
  estate: { length: [4.4, 4.85], width: [1.7, 1.82], roof: [1.42, 1.5], wheelbase: [2.58, 2.8], frontOverhang: [0.82, 0.96], hood: [1.02, 1.2], belt: [0.9, 0.96], noseTop: [0.65, 0.73] },
  van: { length: [4.7, 5.2], width: [1.84, 1.96], roof: [1.95, 2.25], wheelbase: [2.95, 3.3], frontOverhang: [0.75, 0.9], hood: [0.5, 0.7], belt: [1.02, 1.1], noseTop: [0.8, 0.92] },
  // truck: `length` is the CAB only; the box is added behind it
  truck: { length: [2.25, 2.6], width: [1.98, 2.12], roof: [2.35, 2.6], wheelbase: [3.3, 4.1], frontOverhang: [0.95, 1.15], hood: [0.3, 0.75], belt: [1.32, 1.45], noseTop: [1.0, 1.12] },
};

/** Gene overrides: recipe.set pins any gene by name. */
type Pins = Record<string, number | string | boolean>;

class Genes {
  readonly used: Record<string, number | string | boolean> = {};
  constructor(private seed: number, private pins: Pins) {}
  /** A number from a range, on its own named stream. */
  num(name: string, r: Range): number {
    const pin = this.pins[name];
    const v = typeof pin === 'number' ? pin : Rng.stream(this.seed, `gene:${name}`).range(r[0], r[1]);
    this.used[name] = Math.round(v * 10000) / 10000;
    return v;
  }
  chance(name: string, p: number): boolean {
    const pin = this.pins[name];
    const v = typeof pin === 'boolean' ? pin : Rng.stream(this.seed, `gene:${name}`).chance(p);
    this.used[name] = v;
    return v;
  }
  pick<K extends string>(name: string, table: Partial<Record<K, number>>): K {
    const pin = this.pins[name];
    const v = typeof pin === 'string' && pin in table ? (pin as K) : Rng.stream(this.seed, `gene:${name}`).weighted(table);
    this.used[name] = v;
    return v;
  }
  int(name: string, lo: number, hi: number): number {
    const pin = this.pins[name];
    const v = typeof pin === 'number' ? Math.round(pin) : Rng.stream(this.seed, `gene:${name}`).int(lo, hi);
    this.used[name] = v;
    return v;
  }
}

export function makeDesign(type: ArchetypeId, styleId: StyleId, seed: number, pins: Pins = {}, paletteIndex?: number, detail: Detail = 'low'): Design {
  const style = STYLES[styleId];
  const d = DIMS[type];
  const g = new Genes(seed, pins);

  const size = g.num('size', style.size);
  const length = g.num('length', d.length) * size;
  const width = g.num('width', d.width) * Math.sqrt(size);
  const halfWidth = width / 2;
  const roofY = g.num('roof', d.roof) * g.num('roofScale', style.roofScale);
  const truck = type === 'truck';
  const wheelbase = truck ? g.num('wheelbase', d.wheelbase) : Math.min(length * 0.66, g.num('wheelbase', d.wheelbase) * size);
  const frontOverhang = g.num('frontOverhang', d.frontOverhang) * size;
  const wheelRadius = g.num('wheelRadius', style.wheelRadius) * (type === 'van' ? 1.04 : truck ? 1.28 : 1);
  const tyreWidth = g.num('tyreWidth', style.tyreWidth) * (type === 'van' ? 1.05 : truck ? 1.1 : 1);
  const rimRadius = wheelRadius * g.num('rimRatio', style.rimRatio);
  const clearance = g.num('clearance', style.clearance) * (type === 'van' ? 1.15 : truck ? 2.6 : 1);

  const noseZ = length / 2, tailZ = -length / 2;
  const frontAxleZ = noseZ - frontOverhang;
  const rearAxleZ = frontAxleZ - wheelbase;
  const Ra = wheelRadius + 0.045;

  const beltF = g.num('belt', d.belt) * g.num('beltScale', style.beltScale);
  const wedge = g.num('wedge', style.wedge);
  const beltAt = (z: number): number => beltF + wedge * ((cowlZ - z) / Math.max(1, length * 0.6));

  const hoodLen = g.num('hood', d.hood) * size;
  const cowlZ = noseZ - hoodLen;
  const rake = g.num('windshieldRake', style.windshieldRake) * (type === 'van' ? 0.6 : truck ? 0.4 : 1);
  const windshieldTopZ = cowlZ - (roofY - beltF) * rake;
  const noseTop = g.num('noseTop', d.noseTop) * (style.id === 'modern' ? 1.03 : 1);
  const hoodFrontY = Math.min(beltF - 0.04, noseTop + 0.06);
  const hoodFrontZ = noseZ - 0.12;

  // --- the back of the car
  let roofRearZ: number, glassEndZ: number, tailTopY: number;
  let trunk: [number, number] | null = null;
  let tailgate = false, uprightRear = false;
  const top: Vec2[] = [];
  const fil: number[] = [];
  const push = (z: number, y: number, r = 0): void => { top.push([z, y]); fil.push(r); };

  if (type === 'sedan') {
    const trunkLen = g.num('trunk', [0.85, 1.05]) * size;
    glassEndZ = tailZ + trunkLen;
    const rearRun = (roofY - beltAt(glassEndZ)) * g.num('rearRake', [1.3, 1.9]);
    roofRearZ = glassEndZ + rearRun;
    const deckY = beltAt(glassEndZ);
    tailTopY = deckY - 0.03;
    trunk = [tailZ + 0.06, glassEndZ - 0.015];
    push(tailZ, tailTopY);
    push(tailZ + 0.12, deckY - 0.005, 0.06);
    push(glassEndZ, deckY);
    push(roofRearZ, roofY - 0.025, 0.22);
  } else if (type === 'hatchback') {
    const hatchBottom = beltAt(tailZ) + g.num('hatchLip', [0.04, 0.12]);
    const run = (roofY - hatchBottom) * g.num('hatchRake', style.id === 'seventies' ? [0.35, 0.7] : [0.45, 0.95]);
    roofRearZ = tailZ + 0.06 + run;
    glassEndZ = tailZ - 1e-3;
    tailTopY = hatchBottom;
    tailgate = true;
    push(tailZ, hatchBottom);
    push(tailZ + 0.06, hatchBottom + 0.03, 0.04);
    push(roofRearZ, roofY - 0.02, 0.14);
  } else {
    // estate, van and truck cab: roof runs to the back, upright back face (with the window on it)
    const drop = type === 'van' || truck ? 0.02 : g.num('roofDrop', [0.02, 0.06]);
    roofRearZ = tailZ + 0.02;
    glassEndZ = tailZ - 1e-3;
    tailTopY = roofY - drop;
    tailgate = true;
    uprightRear = true;
    push(tailZ, roofY - drop - 0.03);
    push(tailZ + 0.08, roofY - drop, 0.05);
  }
  // roof and windshield
  const roofFrontR = type === 'van' || truck ? 0.18 : g.num('roofFrontR', [0.1, 0.22]);
  push(windshieldTopZ, roofY, roofFrontR);
  push(cowlZ, beltAt(cowlZ), 0);
  push(hoodFrontZ, hoodFrontY, 0.07);
  push(noseZ, noseTop);
  const topPts = filletPolyline(top, fil, detail === 'low' ? 2 : 6);

  const tailBottom = clearance + g.num('tailLift', [0.12, 0.2]);
  const noseBottom = clearance + g.num('noseLift', [0.1, 0.18]);
  const bottom = sortByX([
    [tailZ, tailBottom], [tailZ + 0.3, clearance + 0.03], [rearAxleZ, clearance], [frontAxleZ, clearance],
    [noseZ - 0.32, clearance + 0.02], [noseZ, noseBottom],
  ].filter((p) => p[0] >= tailZ - 1e-6) as Vec2[]);
  const belt: Vec2[] = sortByX([[tailZ - 0.01, beltAt(tailZ - 0.01)], [cowlZ, beltAt(cowlZ)], [noseZ, beltAt(noseZ)]]);

  // --- doors and windows
  const doors: DoorSpec[] = [];
  const windows: WindowSpec[] = [];
  const pillar = g.num('pillar', style.id === 'modern' ? [0.09, 0.12] : style.id === 'nineties' ? [0.07, 0.09] : [0.05, 0.07]);
  const frontEdge = frontAxleZ - Ra - 0.06;
  const cPillarFront = type === 'sedan' || type === 'hatchback' ? roofRearZ + g.num('cPillar', [0.08, 0.22]) : tailZ + 0.14 + pillar;
  const winFront = Math.min(cowlZ - 0.06, frontEdge - 0.05);
  let doorCount = 4;

  if (truck) {
    doorCount = 2;
    const fLen = Math.min(g.num('doorFront', [0.95, 1.1]), frontEdge - tailZ - 0.12);
    const f: DoorSpec = { id: 'front', z1: frontEdge, z0: frontEdge - fLen };
    doors.push(f);
    windows.push({ id: 'front', z0: f.z0 + 0.06, z1: winFront, door: 'front' });
  } else if (type === 'van') {
    doorCount = 3;
    const fLen = g.num('doorFront', [0.95, 1.1]);
    const f: DoorSpec = { id: 'front', z1: frontEdge, z0: frontEdge - fLen };
    doors.push(f);
    windows.push({ id: 'front', z0: f.z0 + 0.06, z1: winFront, door: 'front' });
    const slide: DoorSpec = { id: 'slide', z1: f.z0 - pillar, z0: Math.max(f.z0 - pillar - 1.15, rearAxleZ + Ra + 0.05), slide: true };
    doors.push(slide);
    if (g.chance('vanWindows', 0.35)) {
      windows.push({ id: 'slide', z0: slide.z0 + 0.08, z1: slide.z1 - 0.06, door: 'slide' });
      windows.push({ id: 'cargo', z0: cPillarFront, z1: slide.z0 - 0.08, door: null });
    }
  } else {
    const threeDoor = type === 'hatchback' && g.chance('threeDoor', style.id === 'seventies' ? 0.5 : 0.35);
    if (threeDoor) {
      doorCount = 2;
      const len = g.num('doorFront', [1.15, 1.3]);
      const f: DoorSpec = { id: 'front', z1: frontEdge, z0: frontEdge - len };
      doors.push(f);
      windows.push({ id: 'front', z0: f.z0 + 0.06, z1: winFront, door: 'front' });
      if (f.z0 - 0.08 - cPillarFront > 0.15) windows.push({ id: 'quarter', z0: cPillarFront, z1: f.z0 - 0.08, door: null });
    } else {
      const fLen = g.num('doorFront', type === 'sedan' ? [1.02, 1.15] : [0.95, 1.08]);
      const f: DoorSpec = { id: 'front', z1: frontEdge, z0: frontEdge - fLen };
      const rLen = g.num('doorRear', [0.82, 0.98]);
      const r: DoorSpec = { id: 'rear', z1: f.z0 - pillar, z0: Math.max(f.z0 - pillar - rLen, rearAxleZ + Ra * 0.55) };
      doors.push(f, r);
      windows.push({ id: 'front', z0: f.z0 + 0.06, z1: winFront, door: 'front' });
      // a rear door always gets a decent window: the C-pillar gives way if it has to
      const rwEnd = Math.max(r.z0 + 0.05, Math.min(cPillarFront, r.z1 - 0.06 - 0.4));
      if (r.z1 - 0.06 - rwEnd > 0.15) windows.push({ id: 'rear', z0: rwEnd, z1: r.z1 - 0.06, door: 'rear' });
      if (type === 'estate' && r.z0 - 0.08 - cPillarFront > 0.15) windows.push({ id: 'quarter', z0: cPillarFront, z1: r.z0 - 0.08, door: null });
    }
  }

  const body: BodySpec = {
    detail,
    length, halfWidth, wheelbase, frontAxleZ, rearAxleZ, wheelRadius, tyreWidth,
    archGap: 0.045, wellDepth: tyreWidth + 0.07,
    top: sortByX(topPts), bottom, belt,
    cowlZ, windshieldTopZ, roofRearZ, glassEndZ, hoodFrontZ, trunk, tailgate, uprightRear,
    windows, doors,
    blackPillars: g.chance('blackPillars', style.blackPillars),
    bottomCorner: g.num('bottomCorner', style.bottomCorner),
    shoulderIn: g.num('shoulderIn', style.shoulderIn),
    shoulderRound: g.num('shoulderRound', style.shoulderRound),
    sideBulge: g.num('sideBulge', style.sideBulge),
    charLine: g.num('charLine', style.charLine),
    charOut: g.num('charOut', style.charOut),
    flareFront: g.num('flareFront', style.flareFront),
    flareRear: g.num('flareRear', style.flareRear),
    haunch: g.num('haunch', style.haunch),
    fenderPeak: g.num('fenderPeak', style.fenderPeak),
    hoodDome: g.num('hoodDome', style.hoodDome),
    noseRake: g.num('noseRake', style.noseRake) * (truck ? 0.5 : 1),
    tailRake: g.num('tailRake', style.tailRake) * (type === 'estate' || type === 'van' || truck ? 0.3 : 1),
    sillIn: g.num('sillIn', style.sillIn),
    sillHeight: 0.018,
    tumblehome: g.num('tumblehome', style.tumblehome) * (type === 'van' ? 0.5 : truck ? 0.35 : 1),
    roofCorner: g.num('roofCorner', style.roofCorner),
    roofCrown: g.num('roofCrown', style.roofCrown),
    hoodCrown: g.num('hoodCrown', style.hoodCrown),
    tuck: g.num('tuck', style.tuck),
    noseRatio: g.num('noseRatio', style.noseRatio),
    tailRatio: g.num('tailRatio', style.tailRatio),
    noseTaper: g.num('noseTaper', style.noseTaper),
    tailTaper: g.num('tailTaper', style.tailTaper),
    noseRound: g.num('noseRound', style.noseRound),
    tailRound: g.num('tailRound', style.tailRound),
    trim: 0.022,
    chromeSill: style.chromeSill,
    cladding: g.num('cladding', style.cladding),
    twoToneRoof: false,
  };

  const palettes = style.palettes;
  const pi = paletteIndex ?? g.int('palette', 0, palettes.length - 1);
  const palette = palettes[((pi % palettes.length) + palettes.length) % palettes.length];
  body.twoToneRoof = !!palette.paint2 && g.chance('twoTone', style.twoTone);

  // --- the cargo box (trucks)
  let truckSpec: TruckSpec | undefined;
  let shiftZ = 0;
  if (truck) {
    const rearOverhang = g.num('rearOverhang', [0.9, 1.5]);
    const boxRear = rearAxleZ - rearOverhang;
    const floorY = wheelRadius * 2 + 0.16;
    truckSpec = {
      boxFront: tailZ - 0.08,
      boxRear,
      boxHalfWidth: halfWidth + g.num('boxOverhang', [0.03, 0.12]),
      floorY,
      boxTop: Math.max(roofY + 0.2, floorY + g.num('boxHeight', [1.8, 2.15])),
      boxColor: g.pick('boxColor', { white: 3, silver: 1, paint: 1 }),
      rearDoor: g.pick('rearDoor', { shutter: 2, barn: 1 }),
    };
    // centre the whole footprint (cab nose to the rear underrun bar) on z = 0
    shiftZ = -(noseZ + boxRear - 0.06) / 2;
  }

  const seats = type === 'van' || truck ? 3 : doorCount === 2 ? 4 : 5;
  return {
    type, style, body, doorCount, seats, rows: type === 'van' || truck ? 1 : 2, palette, truck: truckSpec, shiftZ,
    interiorColor: style.interior[g.int('interior', 0, style.interior.length - 1)],
    headlamp: g.pick('headlamp', style.headlamps),
    taillamp: g.pick('taillamp', style.taillamps),
    rim: g.pick('rim', style.rims),
    rimRadius,
    genes: g.used,
  };
}

export type { Vec3 };

/** Short code used in node names: Door_FL, Window_QR … */
export const doorCode = (id: string): string => ({ front: 'F', rear: 'R', slide: 'S', quarter: 'Q', cargo: 'C' } as Record<string, string>)[id] ?? id[0].toUpperCase();
