/**
 * BodySpec: every number the body kernel needs, already decided (seeded) by the archetype and
 * the style. The kernel itself makes no random choices.
 *
 * Coordinates: vehicle space. z runs from the tail (−length/2) to the nose (+length/2),
 * y = 0 is the ground with the car resting on its wheels, x ≥ 0 is the left half (mirrored).
 */
import type { Vec2 } from '../core/math.js';

export interface WindowSpec {
  id: string;
  /** z range of the glass (front edge z1 > rear edge z0) */
  z0: number;
  z1: number;
  /** the door this window belongs to (moves with it), or null for fixed glass */
  door: string | null;
}

export interface DoorSpec {
  /** 'front' | 'rear' | 'slide' */
  id: string;
  z0: number;
  z1: number;
  /** sliding doors run on rails instead of swinging */
  slide?: boolean;
}

export type Detail = 'low' | 'high';

export interface BodySpec {
  /** 'low': faceted low-poly (default); 'high': smooth */
  detail: Detail;
  length: number;
  /** half of the body's widest point */
  halfWidth: number;
  wheelbase: number;
  frontAxleZ: number;
  rearAxleZ: number;
  wheelRadius: number;
  tyreWidth: number;
  /** clearance between tyre and arch */
  archGap: number;
  /** how far the wheel well goes in from the body side */
  wellDepth: number;

  /** side silhouette: (z, y) of the top edge, tail → nose, already filleted */
  top: Vec2[];
  /** (z, y) of the underside */
  bottom: Vec2[];
  /** (z, y) of the beltline (bottom of the side glass), used inside the greenhouse */
  belt: Vec2[];

  /** greenhouse z range: windshield base (cowl, the larger z) back to where the glass ends */
  cowlZ: number;
  windshieldTopZ: number;
  roofRearZ: number;
  /** where the greenhouse ends at the back: rear glass base (sedan) or the tail (hatch, estate, van) */
  glassEndZ: number;
  /** hood's front edge (z) */
  hoodFrontZ: number;
  /** sedan: trunk lid z range; others: null */
  trunk: [number, number] | null;
  /** hatch/estate/van: the rear window is in a tailgate (or on the back face) */
  tailgate: boolean;
  /** rear window is upright on the back face (estate, van) rather than sloped on top */
  uprightRear: boolean;

  windows: WindowSpec[];
  doors: DoorSpec[];
  /** B-pillar blacked out (trim) instead of body colour */
  blackPillars: boolean;

  // section shape
  bottomCorner: number;
  shoulderIn: number;
  /** radius of the rounded shoulder where the side turns onto the hood, deck or window ledge */
  shoulderRound: number;
  sillIn: number;
  sillHeight: number;
  /** inward lean of the side glass per metre of glass height */
  tumblehome: number;
  roofCorner: number;
  roofCrown: number;
  hoodCrown: number;
  /** body side tuck-under near the sill */
  tuck: number;
  /** plan view: width at the very nose / tail as a fraction of the max */
  noseRatio: number;
  tailRatio: number;
  /** plan view: how far back from the nose (and forward from the tail) the taper reaches */
  noseTaper: number;
  tailTaper: number;
  /** end rounding radius (front, back) */
  noseRound: number;
  tailRound: number;
  /** trim band width around glass */
  trim: number;
  /** chrome window sill (seventies) vs black rubber */
  chromeSill: boolean;
  /** lower body cladding in black plastic (0 = none, else height in m) */
  cladding: number;
  // --- sculpting
  /** outward barrel bulge of the side at mid-height (m) */
  sideBulge: number;
  /** height of the character line on the side, 0 (sill) … 1 (shoulder) */
  charLine: number;
  /** how far the character line stands out (m); 0 = none */
  charOut: number;
  /** extra lower-body width over the front / rear wheels (fender bulges, m) */
  flareFront: number;
  flareRear: number;
  /** 0: the flares fade out below the shoulder; 1: they run all the way up (a muscular haunch) */
  haunch: number;
  /** raised ridges along the hood's outer edges (m) */
  fenderPeak: number;
  /** a raised dome down the middle of the hood (m) */
  hoodDome: number;
  /** how far the top of the nose / tail face leans back (m) */
  noseRake: number;
  tailRake: number;
  /** two-tone lower body: everything below the character line in MAT_Paint2 */
  lowerTone: boolean;
  /** two-tone: roof in MAT_Paint2 */
  twoToneRoof: boolean;
}
