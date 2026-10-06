import type { Direction } from '../directions';
import { findFeet, type RasterImage } from '../sprite';
import { sidePlacement, type BodySide } from './sides';

export interface ExtentAsymmetry {
  feetX: number;
  /** How far the silhouette reaches left / right of the feet centre (px). */
  left: number;
  right: number;
  /** (right − left) / max(left, right): > 0 means it reaches further to screen-right. */
  ratio: number;
  /** Horizontal centroid offset from the feet, as a fraction of the width. */
  massOffset: number;
}

/**
 * Measures one-sidedness of a silhouette relative to the feet. Long one-sided
 * equipment (sticks, spears, shields, bags) shows up as a large |ratio|.
 */
export function extentAsymmetry(img: RasterImage): ExtentAsymmetry | null {
  const feet = findFeet(img);
  if (!feet) return null;
  const b = feet.bounds;
  const left = feet.feetX - b.x;
  const right = b.x + b.width - feet.feetX;
  const ratio = (right - left) / Math.max(left, right, 1e-6);
  let sum = 0;
  let n = 0;
  for (let y = b.y; y < b.y + b.height; y++) {
    for (let x = b.x; x < b.x + b.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] > 127) {
        sum += x + 0.5;
        n++;
      }
    }
  }
  const massOffset = n ? (sum / n - feet.feetX) / Math.max(1, b.width) : 0;
  return { feetX: feet.feetX, left, right, ratio, massOffset };
}

export interface HandednessGuess {
  handedness: 'right' | 'left' | null;
  confidence: number;
  reason: string;
}

/**
 * Guesses which body side carries one-sided equipment from the source sprite.
 * Only possible when the source view shows both sides (not a pure profile).
 */
export function guessHandedness(sprite: RasterImage, sourceDirection: Direction): HandednessGuess {
  const ext = extentAsymmetry(sprite);
  if (!ext) return { handedness: null, confidence: 0, reason: 'Empty sprite.' };
  const rightScreen = sidePlacement(sourceDirection, 'right').screenX;
  if (Math.abs(rightScreen) < 0.5) {
    return {
      handedness: null,
      confidence: 0,
      reason: 'Profile views hide one side of the body, so the dominant hand cannot be measured. Please set it manually.',
    };
  }
  if (Math.abs(ext.ratio) < 0.2) {
    return {
      handedness: null,
      confidence: 0.1,
      reason: 'No clearly one-sided equipment found in the silhouette.',
    };
  }
  const side: BodySide = Math.sign(ext.ratio) === Math.sign(rightScreen) ? 'right' : 'left';
  const screenWord = ext.ratio > 0 ? 'screen-right' : 'screen-left';
  return {
    handedness: side,
    confidence: Math.min(0.75, 0.3 + Math.abs(ext.ratio) * 0.5),
    reason: `The silhouette reaches further to ${screenWord}, which is the character's ${side} side in a ${sourceDirection} view.`,
  };
}

export interface HandednessCheck {
  status: 'ok' | 'warning' | 'skipped';
  message: string;
}

/**
 * Heuristic check that a generated view did not swap the character's sides
 * (the most common failure of image generators): one-sided equipment must
 * reach toward the screen side predicted by the Asymmetry System.
 */
export function checkHandedness(args: {
  source: RasterImage;
  sourceDirection: Direction;
  target: RasterImage;
  targetDirection: Direction;
}): HandednessCheck {
  const src = extentAsymmetry(args.source);
  const tgt = extentAsymmetry(args.target);
  if (!src || !tgt) return { status: 'skipped', message: 'Nothing to compare yet.' };
  if (args.sourceDirection === args.targetDirection) return { status: 'skipped', message: 'Source view.' };
  const srcRight = sidePlacement(args.sourceDirection, 'right').screenX;
  if (Math.abs(srcRight) < 0.5 || Math.abs(src.ratio) < 0.25) {
    return { status: 'skipped', message: 'The source has no measurable one-sided equipment.' };
  }
  const side: BodySide = Math.sign(src.ratio) === Math.sign(srcRight) ? 'right' : 'left';
  const expected = sidePlacement(args.targetDirection, side).screenX;
  if (Math.abs(expected) < 0.5) {
    return { status: 'skipped', message: 'Profile view: equipment overlaps the body, nothing to measure.' };
  }
  if (Math.abs(tgt.ratio) < 0.15) {
    return { status: 'skipped', message: 'The generated silhouette is too balanced to judge.' };
  }
  const expectedWord = expected > 0 ? 'screen-right' : 'screen-left';
  if (Math.sign(tgt.ratio) === Math.sign(expected)) {
    return { status: 'ok', message: `${side === 'right' ? 'Right' : 'Left'}-side equipment reaches ${expectedWord} as expected.` };
  }
  return {
    status: 'warning',
    message: `Expected the ${side}-side equipment to reach ${expectedWord} in ${args.targetDirection}, but the silhouette reaches the other way. This view may be mirrored (wrong hand).`,
  };
}
