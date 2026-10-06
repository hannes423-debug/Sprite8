import { luma, packRgba, unpackRgba } from './color';
import type { RasterImage, Rgba } from './raster';

const OPAQUE = 128;

function isOpaque(img: RasterImage, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return false;
  return img.data[(y * img.width + x) * 4 + 3] >= OPAQUE;
}

/** Mask of opaque pixels that touch transparency (4-neighbourhood) or the canvas edge. */
export function boundaryMask(img: RasterImage): Uint8Array {
  const mask = new Uint8Array(img.width * img.height);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (!isOpaque(img, x, y)) continue;
      if (
        !isOpaque(img, x - 1, y) ||
        !isOpaque(img, x + 1, y) ||
        !isOpaque(img, x, y - 1) ||
        !isOpaque(img, x, y + 1)
      ) {
        mask[y * img.width + x] = 1;
      }
    }
  }
  return mask;
}

export interface OutlineInfo {
  detected: boolean;
  color: Rgba | null;
  /** Share of boundary pixels that use the outline colour. */
  share: number;
  thickness: number;
}

/**
 * Detects a uniform outline (very common in pixel art and cartoon sprites):
 * most silhouette-boundary pixels share one dark colour.
 */
export function detectOutline(img: RasterImage): OutlineInfo {
  const mask = boundaryMask(img);
  const hist = new Map<number, number>();
  let total = 0;
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    const i = p * 4;
    const key = packRgba(img.data[i], img.data[i + 1], img.data[i + 2], 255);
    hist.set(key, (hist.get(key) ?? 0) + 1);
    total++;
  }
  if (total < 8) return { detected: false, color: null, share: 0, thickness: 0 };
  let bestKey = 0;
  let bestN = 0;
  for (const [k, n] of hist) {
    if (n > bestN) {
      bestN = n;
      bestKey = k;
    }
  }
  const color = unpackRgba(bestKey);
  const share = bestN / total;
  // An outline is a genuinely dark colour, clearly darker than the fill.
  let interiorLuma = 0;
  let interiorN = 0;
  for (let p = 0; p < mask.length; p++) {
    if (mask[p] || img.data[p * 4 + 3] < OPAQUE) continue;
    interiorLuma += luma({ r: img.data[p * 4], g: img.data[p * 4 + 1], b: img.data[p * 4 + 2] });
    interiorN++;
  }
  const fillLuma = interiorN ? interiorLuma / interiorN : 1;
  const detected = share >= 0.6 && luma(color) < 0.3 && luma(color) < fillLuma - 0.1;
  if (!detected) return { detected: false, color, share, thickness: 0 };
  // Second ring: opaque pixels adjacent to the boundary but not on it.
  let ring2 = 0;
  let ring2Outline = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const p = y * img.width + x;
      if (mask[p] || !isOpaque(img, x, y)) continue;
      const touches =
        (x > 0 && mask[p - 1]) ||
        (x < img.width - 1 && mask[p + 1]) ||
        (y > 0 && mask[p - img.width]) ||
        (y < img.height - 1 && mask[p + img.width]);
      if (!touches) continue;
      ring2++;
      const i = p * 4;
      if (packRgba(img.data[i], img.data[i + 1], img.data[i + 2], 255) === bestKey) ring2Outline++;
    }
  }
  const thickness = ring2 > 0 && ring2Outline / ring2 > 0.5 ? 2 : 1;
  return { detected: true, color, share, thickness };
}

/**
 * Recolours the silhouette boundary with the outline colour — keeps the
 * silhouette size identical while enforcing the source's outline style.
 */
export function applyOutline(img: RasterImage, color: Rgba, thickness = 1): RasterImage {
  let out: RasterImage = {
    width: img.width,
    height: img.height,
    data: new Uint8ClampedArray(img.data),
  };
  for (let pass = 0; pass < Math.max(1, thickness); pass++) {
    const source = pass === 0 ? img : out;
    const mask = pass === 0 ? boundaryMask(source) : innerRing(source, out, color);
    const next: RasterImage = {
      width: out.width,
      height: out.height,
      data: new Uint8ClampedArray(out.data),
    };
    for (let p = 0; p < mask.length; p++) {
      if (!mask[p]) continue;
      const i = p * 4;
      next.data[i] = color.r;
      next.data[i + 1] = color.g;
      next.data[i + 2] = color.b;
      next.data[i + 3] = 255;
    }
    out = next;
  }
  return out;
}

function innerRing(original: RasterImage, current: RasterImage, color: Rgba): Uint8Array {
  // Pixels next to an outline pixel that are not outline yet.
  const key = packRgba(color.r, color.g, color.b, 255);
  const isOutline = (p: number) =>
    packRgba(current.data[p * 4], current.data[p * 4 + 1], current.data[p * 4 + 2], 255) === key &&
    current.data[p * 4 + 3] >= OPAQUE;
  const w = original.width;
  const mask = new Uint8Array(w * original.height);
  for (let y = 0; y < original.height; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (!isOpaque(original, x, y) || isOutline(p)) continue;
      if (
        (x > 0 && isOutline(p - 1)) ||
        (x < w - 1 && isOutline(p + 1)) ||
        (y > 0 && isOutline(p - w)) ||
        (y < original.height - 1 && isOutline(p + w))
      ) {
        mask[p] = 1;
      }
    }
  }
  return mask;
}
