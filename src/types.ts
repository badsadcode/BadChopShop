import type { ArchetypeId } from './archetypes/index.js';
import type { StyleId } from './styles/index.js';

/** Optional extras a game can switch off. Everything defaults to on. */
export interface Include {
  wheels?: boolean;
  brakes?: boolean;
  suspension?: boolean;
  lights?: boolean;
  interior?: boolean;
  engine?: boolean;
  battery?: boolean;
  exhaust?: boolean;
  collision?: boolean;
  markers?: boolean;
}

/** Structural parts that are always there, but can be their own nodes or welded into the body. */
export interface Separate {
  /** doors, hood, trunk/tailgate as their own hinged nodes (default true) */
  panels?: boolean;
  /** each window as its own node (default true) */
  glass?: boolean;
}

/** Everything needed to rebuild a vehicle exactly. */
export interface Recipe {
  type: ArchetypeId;
  style: StyleId;
  seed: number;
  /** palette index within the style (default: picked by the seed) */
  palette?: number;
  /** pin any gene by name (see the manifest's `genes` for names), e.g. { length: 4.1, threeDoor: true } */
  set?: Record<string, number | string | boolean>;
  include?: Include;
  separate?: Separate;
  /** 'low' (default): faceted low-poly, Synty / Project Zomboid style. 'high': smooth surfaces */
  detail?: 'low' | 'high';
  /** lamps lit in the exported file (default false: games switch them) */
  lit?: boolean;
}

export const GENERATOR_VERSION = '0.1.0';
