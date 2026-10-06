import { packRgba } from './color';
import { createRaster, type RasterImage } from './raster';

export interface PixelScaleResult {
  /** Integer upscale factor (1 = native resolution). */
  scale: number;
  /** Grid offset of the first full block. */
  offsetX: number;
  offsetY: number;
  /** Fraction of colour edges that fall on the detected grid. */
  confidence: number;
}

function differs(d: Uint8ClampedArray, i: number, j: number, threshold: number): boolean {
  const a1 = d[i + 3];
  const a2 = d[j + 3];
  if (a1 < 16 && a2 < 16) return false;
  if (Math.abs(a1 - a2) > 64) return true;
  const dr = d[i] - d[j];
  const dg = d[i + 1] - d[j + 1];
  const db = d[i + 2] - d[j + 2];
  return dr * dr + dg * dg + db * db > threshold * threshold;
}

function bestPeriod(events: Int32Array, maxScale: number, minRatio: number): Map<number, { offset: number; ratio: number }> {
  const out = new Map<number, { offset: number; ratio: number }>();
  let total = 0;
  for (let i = 0; i < events.length; i++) total += events[i];
  if (total < 8) return out;
  for (let k = 2; k <= maxScale; k++) {
    const buckets = new Float64Array(k);
    for (let i = 0; i < events.length; i++) buckets[i % k] += events[i];
    let bestOffset = 0;
    for (let o = 1; o < k; o++) if (buckets[o] > buckets[bestOffset]) bestOffset = o;
    const ratio = buckets[bestOffset] / total;
    if (ratio >= minRatio) out.set(k, { offset: bestOffset, ratio });
  }
  return out;
}

/**
 * Detects pixel art that was upscaled by an integer factor (e.g. a 32×48
 * sprite saved at 400%). Every colour edge of such an image lies on a k×k grid.
 */
export function detectPixelScale(
  img: RasterImage,
  opts: { maxScale?: number; threshold?: number; minRatio?: number } = {},
): PixelScaleResult {
  const maxScale = Math.min(opts.maxScale ?? 32, Math.floor(Math.min(img.width, img.height) / 2));
  const threshold = opts.threshold ?? 24;
  const minRatio = opts.minRatio ?? 0.97;
  const none: PixelScaleResult = { scale: 1, offsetX: 0, offsetY: 0, confidence: 0 };
  if (maxScale < 2) return none;
  const { width: w, height: h, data: d } = img;
  // events[x] = number of rows with a colour change between column x-1 and x.
  const colEvents = new Int32Array(w);
  const rowEvents = new Int32Array(h);
  for (let y = 0; y < h; y++) {
    for (let x = 1; x < w; x++) {
      if (differs(d, (y * w + x - 1) * 4, (y * w + x) * 4, threshold)) colEvents[x]++;
    }
  }
  for (let y = 1; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (differs(d, ((y - 1) * w + x) * 4, (y * w + x) * 4, threshold)) rowEvents[y]++;
    }
  }
  const cols = bestPeriod(colEvents, maxScale, minRatio);
  const rows = bestPeriod(rowEvents, maxScale, minRatio);
  for (let k = maxScale; k >= 2; k--) {
    const c = cols.get(k);
    const r = rows.get(k);
    if (c && r) {
      return { scale: k, offsetX: c.offset, offsetY: r.offset, confidence: Math.min(c.ratio, r.ratio) };
    }
  }
  return none;
}

/**
 * Reverses an integer upscale: every k×k block becomes one pixel (the most
 * common colour of the block, robust against small compression noise).
 */
export function downsamplePixelArt(img: RasterImage, scale: number, offsetX = 0, offsetY = 0): RasterImage {
  if (scale <= 1) return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
  const k = scale;
  const ox = ((offsetX % k) + k) % k;
  const oy = ((offsetY % k) + k) % k;
  const leadX = ox > 0 ? 1 : 0;
  const leadY = oy > 0 ? 1 : 0;
  const outW = leadX + Math.ceil((img.width - ox) / k);
  const outH = leadY + Math.ceil((img.height - oy) / k);
  const out = createRaster(outW, outH);
  const counts = new Map<number, number>();
  for (let by = 0; by < outH; by++) {
    const y0 = Math.max(0, oy + (by - leadY) * k);
    const y1 = Math.min(img.height, oy + (by - leadY + 1) * k);
    for (let bx = 0; bx < outW; bx++) {
      const x0 = Math.max(0, ox + (bx - leadX) * k);
      const x1 = Math.min(img.width, ox + (bx - leadX + 1) * k);
      counts.clear();
      let bestKey = 0;
      let bestN = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * img.width + x) * 4;
          const a = img.data[i + 3];
          const key = a < 16 ? 0 : packRgba(img.data[i], img.data[i + 1], img.data[i + 2], a);
          const n = (counts.get(key) ?? 0) + 1;
          counts.set(key, n);
          if (n > bestN) {
            bestN = n;
            bestKey = key;
          }
        }
      }
      const di = (by * outW + bx) * 4;
      out.data[di] = (bestKey >>> 24) & 255;
      out.data[di + 1] = (bestKey >>> 16) & 255;
      out.data[di + 2] = (bestKey >>> 8) & 255;
      out.data[di + 3] = bestKey & 255;
    }
  }
  return out;
}
