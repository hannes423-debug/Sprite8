import type { SymmetryMode } from '../character/model';
import { DIRECTIONS, mirroredDirection, type Direction } from '../directions';
import { blitInPlace, crop, flipHorizontal, mirrorAroundAxis, type RasterImage } from '../sprite';

/**
 * Symmetry System.
 *
 * For a truly symmetric character, the view facing W is exactly the mirror
 * image of the view facing E (likewise NW↔NE and SW↔SE). That is the ONLY
 * case where mirroring is geometrically valid, so Sprite8:
 *   • never derives a view by mirroring for asymmetric characters,
 *   • only mirrors across the screen's vertical axis (never "N = mirror(S)"),
 *   • only does so when the user explicitly enables the symmetry shortcut,
 *   • mirrors around the foot anchor, so the character keeps its ground spot.
 */
export function mirrorShortcutAllowed(symmetry: SymmetryMode, shortcutEnabled: boolean): boolean {
  return symmetry === 'symmetric' && shortcutEnabled;
}

/** Directions that can be derived by mirroring (N and S mirror onto themselves). */
export function isMirrorDerivable(d: Direction): boolean {
  return mirroredDirection(d) !== d;
}

export interface MirrorPlan {
  target: Direction;
  from: Direction;
}

/**
 * For every requested target without content, use its mirror partner if that
 * partner has content (or will have it, e.g. the source direction).
 */
export function planMirrorDerivations(
  available: ReadonlySet<Direction>,
  targets: readonly Direction[] = DIRECTIONS,
): MirrorPlan[] {
  const plans: MirrorPlan[] = [];
  for (const target of targets) {
    if (available.has(target) || !isMirrorDerivable(target)) continue;
    const from = mirroredDirection(target);
    if (available.has(from)) plans.push({ target, from });
  }
  return plans;
}

/** Mirrors a working-cell frame around the foot anchor so the feet stay in place. */
export function mirrorFrame(img: RasterImage, anchorX: number): RasterImage {
  return mirrorAroundAxis(img, Math.round(anchorX * 2) / 2);
}

export const MIRROR_CAVEATS = [
  'Lighting flips with the image (a highlight on the left moves to the right).',
  'Text, numbers and logos come out reversed.',
  'Any one-sided detail (scar, badge, weapon hand) switches sides — use Asymmetric mode for those characters.',
];

/**
 * Makes a front/back view perfectly symmetric by copying one half onto the
 * other, mirrored around `axisX`. Useful for N and S views of symmetric
 * characters (and as an editor tool).
 */
export function symmetrize(img: RasterImage, axisX: number, keep: 'left' | 'right'): RasterImage {
  const axis = Math.round(axisX * 2) / 2;
  const out: RasterImage = {
    width: img.width,
    height: img.height,
    data: new Uint8ClampedArray(img.data),
  };
  const mirrored = mirrorAroundAxis(img, axis);
  // Overwrite the discarded half with the mirrored kept half.
  const start = keep === 'left' ? Math.ceil(axis) : 0;
  const end = keep === 'left' ? img.width : Math.floor(axis);
  for (let y = 0; y < img.height; y++) {
    for (let x = start; x < end; x++) {
      const i = (y * img.width + x) * 4;
      out.data[i] = mirrored.data[i];
      out.data[i + 1] = mirrored.data[i + 1];
      out.data[i + 2] = mirrored.data[i + 2];
      out.data[i + 3] = mirrored.data[i + 3];
    }
  }
  return out;
}

/** Mirrors only a rectangular region in place (editor "mirror selection"). */
export function mirrorRegion(
  img: RasterImage,
  rect: { x: number; y: number; width: number; height: number },
): RasterImage {
  const region = flipHorizontal(crop(img, rect));
  const out: RasterImage = {
    width: img.width,
    height: img.height,
    data: new Uint8ClampedArray(img.data),
  };
  blitInPlace(out, region, rect.x, rect.y, 'replace');
  return out;
}
