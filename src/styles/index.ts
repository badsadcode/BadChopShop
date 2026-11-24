/**
 * Styles (eras). A style owns the design language: how boxy, how much glass, what the bumpers
 * and lamps look like, what wheels it rolls on and which colours it comes in. It never owns
 * proportions of a vehicle type; that's the archetype's job. Ranges are [min, max], and the seed
 * picks a value inside them, so two seventies hatchbacks are cousins, not twins.
 */
import type { Vec3 } from '../core/math.js';

export type StyleId = 'seventies' | 'nineties' | 'modern';
export type Range = [number, number];

export type BumperKind = 'chrome' | 'plastic' | 'body';
export type HeadlampKind = 'round' | 'quad-round' | 'rect' | 'flush' | 'swept';
export type TaillampKind = 'block' | 'wide' | 'bar';
export type RimKind = 'steel-hubcap' | 'steel-plain' | 'cover' | 'alloy-5' | 'alloy-multi' | 'alloy-turbine';

export interface Palette { name: string; paint: Vec3; paint2?: Vec3 }

export interface StyleProfile {
  id: StyleId;
  name: string;
  /** multiplies vehicle lengths and widths */
  size: Range;
  shoulderIn: Range;
  shoulderRound: Range;
  sideBulge: Range;
  charLine: Range;
  charOut: Range;
  flareFront: Range;
  flareRear: Range;
  haunch: Range;
  fenderPeak: Range;
  hoodDome: Range;
  noseRake: Range;
  tailRake: Range;
  sillIn: Range;
  tumblehome: Range;
  roofCorner: Range;
  roofCrown: Range;
  hoodCrown: Range;
  bottomCorner: Range;
  tuck: Range;
  noseRatio: Range;
  tailRatio: Range;
  noseTaper: Range;
  tailTaper: Range;
  noseRound: Range;
  tailRound: Range;
  /** windshield run / rise (bigger = more raked) */
  windshieldRake: Range;
  /** how high the beltline sits (multiplies the archetype's) */
  beltScale: Range;
  /** beltline rise from front to back (m) */
  wedge: Range;
  /** roof height multiplier */
  roofScale: Range;
  wheelRadius: Range;
  /** rim radius as a fraction of the tyre radius */
  rimRatio: Range;
  tyreWidth: Range;
  clearance: Range;
  chromeSill: boolean;
  blackPillars: number;
  cladding: Range;
  twoTone: number;
  bumper: BumperKind;
  headlamps: Partial<Record<HeadlampKind, number>>;
  taillamps: Partial<Record<TaillampKind, number>>;
  rims: Partial<Record<RimKind, number>>;
  /** trim colour for grilles and bumpers (sRGB) */
  plastic: Vec3;
  interior: Vec3[];
  palettes: Palette[];
}

const rgb = (hex: string): Vec3 => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export const STYLES: Record<StyleId, StyleProfile> = {
  seventies: {
    id: 'seventies',
    name: 'Seventies',
    size: [0.94, 0.98],
    shoulderIn: [0.0048, 0.012],
    shoulderRound: [0.025, 0.04],
    // slab sides with one crisp crease, flat hoods, upright ends
    sideBulge: [0.002, 0.0045],
    charLine: [0.58, 0.68],
    charOut: [0.014, 0.022],
    flareFront: [0.0, 0.004],
    flareRear: [0.0, 0.0045],
    haunch: [0.0, 0.0],
    fenderPeak: [0.0, 0.003],
    hoodDome: [0.0, 0.0024],
    noseRake: [-0.005, 0.015],
    tailRake: [0.0, 0.015],
    sillIn: [0.012, 0.02],
    tumblehome: [0.066, 0.11],
    roofCorner: [0.03, 0.05],
    roofCrown: [0.009, 0.018],
    hoodCrown: [0.004, 0.01],
    bottomCorner: [0.04, 0.06],
    tuck: [0.0, 0.005],
    noseRatio: [0.955, 0.982],
    tailRatio: [0.955, 0.982],
    noseTaper: [0.126, 0.21],
    tailTaper: [0.126, 0.21],
    noseRound: [0.015, 0.025],
    tailRound: [0.015, 0.025],
    windshieldRake: [0.85, 1.15],
    beltScale: [0.94, 0.98],
    wedge: [0.0, 0.018],
    roofScale: [0.98, 1.02],
    wheelRadius: [0.28, 0.295],
    rimRatio: [0.58, 0.62],
    tyreWidth: [0.155, 0.175],
    clearance: [0.16, 0.19],
    chromeSill: true,
    blackPillars: 0.15,
    cladding: [0, 0],
    twoTone: 0.25,
    bumper: 'chrome',
    headlamps: { round: 3, 'quad-round': 2, rect: 2 },
    taillamps: { block: 3, wide: 1 },
    rims: { 'steel-hubcap': 3, 'steel-plain': 1, 'alloy-turbine': 1 },
    plastic: rgb('#1d1d1d'),
    interior: [rgb('#5a3a22'), rgb('#3b2a20'), rgb('#6b5a3f'), rgb('#2e2b28')],
    palettes: [
      { name: 'Harvest Orange', paint: rgb('#c8641c') },
      { name: 'Mustard', paint: rgb('#c9a227') },
      { name: 'Avocado', paint: rgb('#6f7a32') },
      { name: 'Chocolate', paint: rgb('#5a3826') },
      { name: 'Sky Blue', paint: rgb('#6f9fc8') },
      { name: 'Cream', paint: rgb('#e9dfc2'), paint2: rgb('#5a3826') },
      { name: 'Signal Red', paint: rgb('#b3261e'), paint2: rgb('#f0ece0') },
      { name: 'Lada Beige', paint: rgb('#d2c09a') },
      { name: 'Polar White', paint: rgb('#ece9e1'), paint2: rgb('#2b2b2b') },
      { name: 'Teal', paint: rgb('#2f7c7a') },
    ],
  },
  nineties: {
    id: 'nineties',
    name: 'Nineties',
    size: [0.98, 1.02],
    shoulderIn: [0.0108, 0.0192],
    shoulderRound: [0.05, 0.075],
    // rounder, softer: a barrel side, a faint high line, gentle bulges over the wheels
    sideBulge: [0.005, 0.0085],
    charLine: [0.7, 0.8],
    charOut: [0, 0.005],
    flareFront: [0.004, 0.008],
    flareRear: [0.0045, 0.009],
    haunch: [0.0, 0.15],
    fenderPeak: [0.0, 0.005],
    hoodDome: [0.0024, 0.0056],
    noseRake: [0.02, 0.04],
    tailRake: [0.015, 0.03],
    sillIn: [0.01, 0.016],
    tumblehome: [0.121, 0.165],
    roofCorner: [0.05, 0.08],
    roofCrown: [0.015, 0.024],
    hoodCrown: [0.01, 0.0175],
    bottomCorner: [0.06, 0.09],
    tuck: [0.004, 0.01],
    noseRatio: [0.91, 0.946],
    tailRatio: [0.928, 0.955],
    noseTaper: [0.245, 0.35],
    tailTaper: [0.21, 0.294],
    noseRound: [0.03, 0.05],
    tailRound: [0.025, 0.04],
    windshieldRake: [1.3, 1.6],
    beltScale: [0.98, 1.02],
    wedge: [0.012, 0.03],
    roofScale: [0.99, 1.02],
    wheelRadius: [0.295, 0.31],
    rimRatio: [0.6, 0.65],
    tyreWidth: [0.175, 0.195],
    clearance: [0.14, 0.17],
    chromeSill: false,
    blackPillars: 0.6,
    cladding: [0, 0.1],
    twoTone: 0,
    bumper: 'plastic',
    headlamps: { rect: 2, flush: 3 },
    taillamps: { wide: 2, block: 1 },
    rims: { cover: 3, 'alloy-multi': 1, 'steel-plain': 1 },
    plastic: rgb('#2a2b2d'),
    interior: [rgb('#3b3e44'), rgb('#4a4640'), rgb('#2c2f36')],
    palettes: [
      { name: 'Teal Pearl', paint: rgb('#1f6f74') },
      { name: 'Burgundy', paint: rgb('#6b1f2a') },
      { name: 'Racing Green', paint: rgb('#1f4a33') },
      { name: 'Silver', paint: rgb('#b7bcc2') },
      { name: 'Alpine White', paint: rgb('#eceeee') },
      { name: 'Tornado Red', paint: rgb('#c2201f') },
      { name: 'Midnight Blue', paint: rgb('#1d2a4f') },
      { name: 'Champagne', paint: rgb('#cdbd9a') },
      { name: 'Purple Haze', paint: rgb('#5a3e78') },
    ],
  },
  modern: {
    id: 'modern',
    name: 'Modern',
    size: [1.03, 1.08],
    shoulderIn: [0.021, 0.03],
    shoulderRound: [0.045, 0.07],
    // sculpted: a sharp rising waist line, muscular rear haunches, fender peaks, raked ends
    sideBulge: [0.006, 0.01],
    charLine: [0.72, 0.82],
    charOut: [0.007, 0.013],
    flareFront: [0.006, 0.011],
    flareRear: [0.0099, 0.0162],
    haunch: [0.25, 0.45],
    fenderPeak: [0.006, 0.012],
    hoodDome: [0.004, 0.008],
    noseRake: [0.04, 0.07],
    tailRake: [0.025, 0.05],
    sillIn: [0.008, 0.012],
    tumblehome: [0.165, 0.22],
    roofCorner: [0.07, 0.1],
    roofCrown: [0.021, 0.033],
    hoodCrown: [0.0175, 0.025],
    bottomCorner: [0.08, 0.11],
    tuck: [0.006, 0.0125],
    noseRatio: [0.883, 0.919],
    tailRatio: [0.91, 0.946],
    noseTaper: [0.315, 0.42],
    tailTaper: [0.245, 0.35],
    noseRound: [0.05, 0.07],
    tailRound: [0.035, 0.05],
    windshieldRake: [1.7, 2.1],
    beltScale: [1.04, 1.09],
    wedge: [0.03, 0.054],
    roofScale: [1.0, 1.03],
    wheelRadius: [0.32, 0.345],
    rimRatio: [0.66, 0.72],
    tyreWidth: [0.205, 0.235],
    clearance: [0.13, 0.16],
    chromeSill: false,
    blackPillars: 0.85,
    cladding: [0, 0],
    twoTone: 0.2,
    bumper: 'body',
    headlamps: { swept: 3, flush: 1 },
    taillamps: { bar: 2, wide: 2 },
    rims: { 'alloy-5': 2, 'alloy-multi': 2, 'alloy-turbine': 1 },
    plastic: rgb('#141516'),
    interior: [rgb('#1b1c1e'), rgb('#2a2b2e'), rgb('#6e5a48'), rgb('#8a2a22')],
    palettes: [
      { name: 'Glacier White', paint: rgb('#eef0f1'), paint2: rgb('#151515') },
      { name: 'Obsidian', paint: rgb('#17181a') },
      { name: 'Nardo Grey', paint: rgb('#8a8d8f') },
      { name: 'Moonlight Silver', paint: rgb('#c4c8cc'), paint2: rgb('#151515') },
      { name: 'Deep Ocean', paint: rgb('#123457') },
      { name: 'Soul Red', paint: rgb('#a3141c'), paint2: rgb('#151515') },
      { name: 'Sage Green', paint: rgb('#7f8f78') },
      { name: 'Noor Purple', paint: rgb('#6c3fa0'), paint2: rgb('#151515') },
      { name: 'Sand', paint: rgb('#bfae8c') },
    ],
  },
};

export const STYLE_IDS = Object.keys(STYLES) as StyleId[];
