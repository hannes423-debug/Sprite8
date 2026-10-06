import { oppositeDirection, type Direction } from '../directions';
import { createRaster, mirrorAroundAxis, type RasterImage, type Rgba } from '../sprite';

/**
 * Opposite-view silhouettes.
 *
 * Seen through an orthographic camera, a body viewed from the opposite
 * direction (N↔S, NE↔SW, E↔W, SE↔NW) projects to exactly the mirrored
 * outline — for symmetric AND asymmetric characters. The interior (face vs
 * back of the head, which hand is in front) is NOT known, so Sprite8 only
 * offers the outline as a drawing guide, never as a finished view. With an
 * elevated camera the guide is an approximation.
 */
export function silhouetteMask(img: RasterImage, alphaThreshold = 127): Uint8Array {
  const mask = new Uint8Array(img.width * img.height);
  for (let p = 0; p < mask.length; p++) if (img.data[p * 4 + 3] > alphaThreshold) mask[p] = 1;
  return mask;
}

export function maskToRaster(
  mask: Uint8Array,
  width: number,
  height: number,
  color: Rgba,
): RasterImage {
  const out = createRaster(width, height);
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    out.data[p * 4] = color.r;
    out.data[p * 4 + 1] = color.g;
    out.data[p * 4 + 2] = color.b;
    out.data[p * 4 + 3] = color.a;
  }
  return out;
}

/** The outline guide for the view opposite to `img`'s view. */
export function oppositeSilhouette(img: RasterImage, anchorX: number, color: Rgba): RasterImage {
  const mirrored = mirrorAroundAxis(img, Math.round(anchorX * 2) / 2);
  return maskToRaster(silhouetteMask(mirrored), img.width, img.height, color);
}

export interface SilhouetteGuideSource {
  from: Direction;
  reason: string;
}

/** Which existing view can provide an outline guide for `direction`, if any. */
export function silhouetteGuideSource(
  direction: Direction,
  available: ReadonlySet<Direction>,
): SilhouetteGuideSource | null {
  const from = oppositeDirection(direction);
  if (!available.has(from)) return null;
  return {
    from,
    reason: `Outline mirrored from ${from}: a view from the opposite side has the same (mirrored) silhouette. The interior must be drawn.`,
  };
}
