import type { RasterImage, Rgba } from './raster';

/**
 * Scanline-free BFS flood fill over a width×height grid.
 * Returns a mask (1 = filled) of every pixel reachable from `seeds` through
 * pixels for which `accept(pixelIndex)` is true.
 */
export function floodFillMask(
  width: number,
  height: number,
  seeds: Iterable<number>,
  accept: (pixelIndex: number) => boolean,
  diagonal = false,
): Uint8Array {
  const mask = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  for (const s of seeds) {
    if (s < 0 || s >= mask.length || mask[s]) continue;
    if (!accept(s)) continue;
    mask[s] = 1;
    queue[tail++] = s;
  }
  while (head < tail) {
    const p = queue[head++];
    const x = p % width;
    const y = (p - x) / width;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (!diagonal && dx !== 0 && dy !== 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const n = ny * width + nx;
        if (mask[n]) continue;
        if (!accept(n)) continue;
        mask[n] = 1;
        queue[tail++] = n;
      }
    }
  }
  return mask;
}

function pixelDistance(d: Uint8ClampedArray, i: number, c: Rgba): number {
  const a = d[i + 3];
  // Fully transparent pixels are equal regardless of their RGB garbage.
  if (a === 0 && c.a === 0) return 0;
  const dr = d[i] - c.r;
  const dg = d[i + 1] - c.g;
  const db = d[i + 2] - c.b;
  const da = a - c.a;
  return Math.sqrt(dr * dr + dg * dg + db * db + da * da);
}

export interface RegionOptions {
  /** RGBA Euclidean distance tolerance (0 = exact colour). */
  tolerance?: number;
  /** false = select every matching pixel in the image, not just connected ones. */
  contiguous?: boolean;
  diagonal?: boolean;
}

/** Mask of the colour region under (x, y) — the "magic wand" / bucket region. */
export function colorRegionMask(
  img: RasterImage,
  x: number,
  y: number,
  opts: RegionOptions = {},
): Uint8Array {
  const { width, height, data } = img;
  const mask = new Uint8Array(width * height);
  if (x < 0 || y < 0 || x >= width || y >= height) return mask;
  const tol = opts.tolerance ?? 0;
  const si = (y * width + x) * 4;
  const seed: Rgba = { r: data[si], g: data[si + 1], b: data[si + 2], a: data[si + 3] };
  const accept = (p: number) => pixelDistance(data, p * 4, seed) <= tol;
  if (opts.contiguous === false) {
    for (let p = 0; p < width * height; p++) if (accept(p)) mask[p] = 1;
    return mask;
  }
  return floodFillMask(width, height, [y * width + x], accept, opts.diagonal ?? false);
}

/** Writes `color` into every masked pixel (replacing, not blending). */
export function fillMaskInPlace(img: RasterImage, mask: Uint8Array, color: Rgba): void {
  const d = img.data;
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    const i = p * 4;
    if (color.a === 0) {
      d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0;
    } else {
      d[i] = color.r;
      d[i + 1] = color.g;
      d[i + 2] = color.b;
      d[i + 3] = color.a;
    }
  }
}
