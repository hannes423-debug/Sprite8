import { crop } from './transform';
import type { RasterImage, Rect } from './raster';

/** Bounding box of pixels whose alpha is above `alphaThreshold`, or null if empty. */
export function contentBounds(img: RasterImage, alphaThreshold = 0): Rect | null {
  let minX = img.width;
  let minY = img.height;
  let maxX = -1;
  let maxY = -1;
  const d = img.data;
  for (let y = 0; y < img.height; y++) {
    const row = y * img.width * 4;
    for (let x = 0; x < img.width; x++) {
      if (d[row + x * 4 + 3] > alphaThreshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export interface TrimResult {
  image: RasterImage;
  /** Position of the trimmed image inside the original. */
  offsetX: number;
  offsetY: number;
}

export function trim(img: RasterImage, alphaThreshold = 0): TrimResult | null {
  const b = contentBounds(img, alphaThreshold);
  if (!b) return null;
  return { image: crop(img, b), offsetX: b.x, offsetY: b.y };
}

export interface FootInfo {
  /** Horizontal centre of the feet (continuous coordinate). */
  feetX: number;
  /** Continuous y of the ground line: one past the lowest opaque row. */
  groundY: number;
  bounds: Rect;
}

/**
 * Locates the character's feet: the horizontal centre of the opaque pixels in
 * the lowest `bandFraction` of the silhouette. Aligning on the feet (not the
 * bounding box) keeps a character with a long weapon or hockey stick standing
 * in the same place in every direction.
 *
 * Equipment that touches the ground (a hockey blade, a staff, a tail) is
 * ignored: only ground pixels inside the body's core column — the middle half
 * of all opaque pixels, widened a little — count as feet.
 */
export function findFeet(
  img: RasterImage,
  bandFraction = 0.12,
  alphaThreshold = 127,
): FootInfo | null {
  const b = contentBounds(img, alphaThreshold);
  if (!b) return null;
  // Column histogram of the whole silhouette → interquartile "body core".
  const cols = new Float64Array(b.width);
  let total = 0;
  for (let y = b.y; y < b.y + b.height; y++) {
    for (let x = b.x; x < b.x + b.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] > alphaThreshold) {
        cols[x - b.x]++;
        total++;
      }
    }
  }
  const quantile = (q: number) => {
    let acc = 0;
    for (let i = 0; i < cols.length; i++) {
      acc += cols[i];
      if (acc >= total * q) return b.x + i;
    }
    return b.x + b.width - 1;
  };
  const q1 = quantile(0.25);
  const q3 = quantile(0.75);
  const margin = Math.max(1, (q3 - q1) * 0.25);
  const coreMin = q1 - margin;
  const coreMax = q3 + 1 + margin;

  const band = Math.max(1, Math.round(b.height * bandFraction));
  let sum = 0;
  let n = 0;
  let sumAll = 0;
  let nAll = 0;
  for (let y = b.y + b.height - band; y < b.y + b.height; y++) {
    for (let x = b.x; x < b.x + b.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] > alphaThreshold) {
        sumAll += x + 0.5;
        nAll++;
        if (x + 0.5 >= coreMin && x + 0.5 <= coreMax) {
          sum += x + 0.5;
          n++;
        }
      }
    }
  }
  const feetX = n > 0 ? sum / n : nAll > 0 ? sumAll / nAll : b.x + b.width / 2;
  return { feetX, groundY: b.y + b.height, bounds: b };
}

/** Horizontal opaque-pixel count per row (the silhouette "width profile"). */
export function rowCoverage(img: RasterImage, alphaThreshold = 127): Int32Array {
  const out = new Int32Array(img.height);
  for (let y = 0; y < img.height; y++) {
    let n = 0;
    for (let x = 0; x < img.width; x++)
      if (img.data[(y * img.width + x) * 4 + 3] > alphaThreshold) n++;
    out[y] = n;
  }
  return out;
}

/** Number of separate opaque runs in row `y` (gaps of at least `minGap` pixels). */
export function runsInRow(img: RasterImage, y: number, minGap = 1, alphaThreshold = 127): number {
  let runs = 0;
  let inRun = false;
  let gap = 0; // transparent pixels since the last opaque one
  for (let x = 0; x < img.width; x++) {
    const opaque = img.data[(y * img.width + x) * 4 + 3] > alphaThreshold;
    if (opaque) {
      if (!inRun && (runs === 0 || gap >= minGap)) runs++;
      inRun = true;
      gap = 0;
    } else {
      inRun = false;
      gap++;
    }
  }
  return runs;
}
