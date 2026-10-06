import { packRgba, rgbDistance } from './color';
import { floodFillMask } from './floodFill';
import type { RasterImage, Rgba } from './raster';

export interface BackgroundInfo {
  /** transparent: already has alpha; solid: uniform colour found; none: no clear background. */
  kind: 'transparent' | 'solid' | 'none';
  color: Rgba | null;
  /** Fraction of border pixels that match the background. */
  coverage: number;
}

function borderIndices(width: number, height: number): number[] {
  const out: number[] = [];
  for (let x = 0; x < width; x++) {
    out.push(x);
    if (height > 1) out.push((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    out.push(y * width);
    if (width > 1) out.push(y * width + width - 1);
  }
  return out;
}

function colorAt(d: Uint8ClampedArray, p: number): Rgba {
  const i = p * 4;
  return { r: d[i], g: d[i + 1], b: d[i + 2], a: d[i + 3] };
}

/**
 * Looks at the image border to decide whether the sprite already has a
 * transparent background or sits on a uniform colour that can be keyed out.
 */
export function detectBackground(img: RasterImage, hint?: Rgba | null, tolerance = 32): BackgroundInfo {
  const border = borderIndices(img.width, img.height);
  if (border.length === 0) return { kind: 'none', color: null, coverage: 0 };
  const d = img.data;
  let transparent = 0;
  for (const p of border) if (d[p * 4 + 3] < 16) transparent++;
  if (transparent / border.length >= 0.5) {
    return { kind: 'transparent', color: null, coverage: transparent / border.length };
  }
  if (hint) {
    let match = 0;
    for (const p of border) if (d[p * 4 + 3] >= 16 && rgbDistance(colorAt(d, p), hint) <= tolerance) match++;
    if (match / border.length >= 0.2) {
      return { kind: 'solid', color: { ...hint, a: 255 }, coverage: match / border.length };
    }
  }
  // Cluster border colours (5 bits per channel) and take the biggest cluster.
  const clusters = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (const p of border) {
    const c = colorAt(d, p);
    if (c.a < 16) continue;
    const key = packRgba(c.r >> 3, c.g >> 3, c.b >> 3, 0);
    const e = clusters.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++;
    e.r += c.r;
    e.g += c.g;
    e.b += c.b;
    clusters.set(key, e);
  }
  let best: { n: number; r: number; g: number; b: number } | null = null;
  for (const e of clusters.values()) if (!best || e.n > best.n) best = e;
  if (!best) return { kind: 'none', color: null, coverage: 0 };
  const color: Rgba = {
    r: Math.round(best.r / best.n),
    g: Math.round(best.g / best.n),
    b: Math.round(best.b / best.n),
    a: 255,
  };
  // Re-measure coverage with the real tolerance (neighbouring clusters count).
  let match = 0;
  for (const p of border) if (d[p * 4 + 3] >= 16 && rgbDistance(colorAt(d, p), color) <= tolerance) match++;
  const coverage = match / border.length;
  return coverage >= 0.35 ? { kind: 'solid', color, coverage } : { kind: 'none', color, coverage };
}

/** Classic chroma-key colours that are safe to remove everywhere, not only at the border. */
export function isKeyColor(c: Rgba): boolean {
  const magenta = c.r > 200 && c.g < 70 && c.b > 200;
  const green = c.r < 90 && c.g > 200 && c.b < 90;
  const cyan = c.r < 70 && c.g > 200 && c.b > 200;
  const blue = c.r < 50 && c.g < 50 && c.b > 220;
  return magenta || green || cyan || blue;
}

export interface RemoveBackgroundOptions {
  /** auto: flood from the border (+ global removal for chroma-key colours). */
  mode?: 'auto' | 'flood' | 'global' | 'off';
  /** RGB distance tolerance for "same as background". */
  tolerance?: number;
  /** Soften and colour-decontaminate edge pixels (painted art only, never pixel art). */
  defringe?: boolean;
  /** Expected background colour (e.g. the colour we sent to an AI provider). */
  hint?: Rgba | null;
}

export interface RemoveBackgroundResult {
  image: RasterImage;
  info: BackgroundInfo;
  removedPixels: number;
}

/** Makes the background transparent. Never touches images that already have alpha. */
export function removeBackground(img: RasterImage, opts: RemoveBackgroundOptions = {}): RemoveBackgroundResult {
  const tolerance = opts.tolerance ?? 32;
  const mode = opts.mode ?? 'auto';
  const info = detectBackground(img, opts.hint ?? null, tolerance);
  const out: RasterImage = { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
  const d = out.data;

  if (info.kind === 'transparent') {
    // Normalise near-invisible pixels so later steps see clean transparency.
    let removed = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 8 && (d[i + 3] !== 0 || d[i] || d[i + 1] || d[i + 2])) {
        d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0;
        removed++;
      }
    }
    return { image: out, info, removedPixels: removed };
  }
  if (mode === 'off' || info.kind !== 'solid' || !info.color) {
    return { image: out, info, removedPixels: 0 };
  }

  const bg = info.color;
  const { width, height } = img;
  const near = (p: number) => {
    const i = p * 4;
    if (d[i + 3] === 0) return true;
    const dr = d[i] - bg.r;
    const dg = d[i + 1] - bg.g;
    const db = d[i + 2] - bg.b;
    return Math.sqrt(dr * dr + dg * dg + db * db) <= tolerance;
  };
  const mask =
    mode === 'global'
      ? Uint8Array.from({ length: width * height }, (_, p) => (near(p) ? 1 : 0))
      : floodFillMask(width, height, borderIndices(width, height), near);

  if (mode === 'auto' && isKeyColor(bg)) {
    // Enclosed pockets (between legs, under arms) of a chroma key colour.
    const keyTol = Math.min(tolerance, 24);
    for (let p = 0; p < mask.length; p++) {
      if (mask[p]) continue;
      const i = p * 4;
      if (Math.hypot(d[i] - bg.r, d[i + 1] - bg.g, d[i + 2] - bg.b) <= keyTol) mask[p] = 1;
    }
  }

  let removed = 0;
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    const i = p * 4;
    d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0;
    removed++;
  }

  if (opts.defringe) defringeInPlace(out, mask, bg, tolerance);
  return { image: out, info, removedPixels: removed };
}

/**
 * Edge pixels of painted art are blends of foreground and background. For the
 * two pixel rings next to the removed area we estimate a partial alpha from the
 * distance to the background and remove the background's colour contribution.
 */
function defringeInPlace(img: RasterImage, removed: Uint8Array, bg: Rgba, tolerance: number): void {
  const { width, height, data: d } = img;
  const range = Math.max(tolerance * 3, 96);
  const ring = new Uint8Array(width * height);
  const neighbours = (p: number, test: (n: number) => boolean) => {
    const x = p % width;
    const y = (p - x) / width;
    return (
      (x > 0 && test(p - 1)) ||
      (x < width - 1 && test(p + 1)) ||
      (y > 0 && test(p - width)) ||
      (y < height - 1 && test(p + width))
    );
  };
  for (let p = 0; p < ring.length; p++) {
    if (removed[p] || d[p * 4 + 3] === 0) continue;
    if (neighbours(p, (n) => removed[n] === 1)) ring[p] = 1;
  }
  for (let p = 0; p < ring.length; p++) {
    if (removed[p] || ring[p] || d[p * 4 + 3] === 0) continue;
    if (neighbours(p, (n) => ring[n] === 1)) ring[p] = 2;
  }
  for (let p = 0; p < ring.length; p++) {
    if (!ring[p]) continue;
    const i = p * 4;
    const dist = Math.hypot(d[i] - bg.r, d[i + 1] - bg.g, d[i + 2] - bg.b);
    const limit = ring[p] === 1 ? range : range / 2;
    if (dist >= limit) continue;
    const alpha = Math.max(0.08, Math.min(1, (dist - tolerance * 0.5) / (limit - tolerance * 0.5)));
    for (let c = 0; c < 3; c++) {
      const bgc = c === 0 ? bg.r : c === 1 ? bg.g : bg.b;
      d[i + c] = Math.max(0, Math.min(255, Math.round((d[i + c] - (1 - alpha) * bgc) / alpha)));
    }
    d[i + 3] = Math.round(d[i + 3] * alpha);
  }
}
