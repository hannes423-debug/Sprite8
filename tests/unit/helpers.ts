import { decodePng, encodePng } from '../../models/reference-server/png.mjs';
import type { ImageCodec } from '../../src/core/providers/types';
import { createRaster, setPixelInPlace, type RasterImage, type Rgba } from '../../src/core/sprite';

/** Real PNG codec for Node tests (same code as the reference server). */
export const nodeCodec: ImageCodec = {
  async encodePng(img: RasterImage) {
    return new Blob([encodePng(img.width, img.height, img.data) as Uint8Array<ArrayBuffer>], {
      type: 'image/png',
    });
  },
  async decode(blob: Blob) {
    const { width, height, data } = decodePng(new Uint8Array(await blob.arrayBuffer()));
    return { width, height, data };
  },
};

export const C = {
  outline: { r: 27, g: 26, b: 41, a: 255 },
  skin: { r: 243, g: 198, b: 144, a: 255 },
  red: { r: 200, g: 58, b: 58, a: 255 },
  blue: { r: 40, g: 60, b: 150, a: 255 },
  stick: { r: 198, g: 154, b: 91, a: 255 },
  white: { r: 255, g: 255, b: 255, a: 255 },
} satisfies Record<string, Rgba>;

/** Builds a raster from ASCII art: '.' = transparent, other chars from `palette`. */
export function fromAscii(rows: string[], palette: Record<string, Rgba>): RasterImage {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const img = createRaster(w, h);
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === '.' || ch === ' ') return;
      const c = palette[ch];
      if (!c) throw new Error(`Unknown palette key "${ch}"`);
      setPixelInPlace(img, x, y, c);
    });
  });
  return img;
}

function fillRect(img: RasterImage, x0: number, y0: number, w: number, h: number, c: Rgba): void {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) setPixelInPlace(img, x, y, c);
}

/** Adds a 1px outline around every opaque pixel (4-neighbourhood, outside). */
export function outlined(img: RasterImage, color: Rgba = C.outline): RasterImage {
  const out = createRaster(img.width + 2, img.height + 2);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      if (img.data[i + 3] === 0) continue;
      setPixelInPlace(out, x + 1, y + 1, {
        r: img.data[i],
        g: img.data[i + 1],
        b: img.data[i + 2],
        a: img.data[i + 3],
      });
    }
  }
  const copy = new Uint8ClampedArray(out.data);
  const opaque = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < out.width && y < out.height && copy[(y * out.width + x) * 4 + 3] > 0;
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      if (opaque(x, y)) continue;
      if (opaque(x - 1, y) || opaque(x + 1, y) || opaque(x, y - 1) || opaque(x, y + 1))
        setPixelInPlace(out, x, y, color);
    }
  }
  return out;
}

/**
 * Procedural front-view humanoid (≈ 4 heads tall) used by analysis tests.
 * `stick` adds a long one-sided item reaching to that SCREEN side.
 */
export function humanoid(
  opts: { stick?: 'screen-left' | 'screen-right' | null; scale?: number } = {},
): RasterImage {
  const s = opts.scale ?? 1;
  const W = 40 * s;
  const H = 48 * s;
  const img = createRaster(W, H);
  const cx = 20 * s;
  // head
  fillRect(img, cx - 5 * s, 0, 10 * s, 10 * s, C.skin);
  // neck
  fillRect(img, cx - 2 * s, 10 * s, 4 * s, 2 * s, C.skin);
  // torso + arms
  fillRect(img, cx - 7 * s, 12 * s, 14 * s, 13 * s, C.red);
  fillRect(img, cx - 9 * s, 13 * s, 2 * s, 11 * s, C.red);
  fillRect(img, cx + 7 * s, 13 * s, 2 * s, 11 * s, C.red);
  // legs with a gap
  fillRect(img, cx - 6 * s, 25 * s, 5 * s, 20 * s, C.blue);
  fillRect(img, cx + 1 * s, 25 * s, 5 * s, 20 * s, C.blue);
  // feet
  fillRect(img, cx - 7 * s, 45 * s, 6 * s, 3 * s, C.outline);
  fillRect(img, cx + 1 * s, 45 * s, 6 * s, 3 * s, C.outline);
  if (opts.stick === 'screen-left') {
    for (let i = 0; i < 18 * s; i++)
      setPixelInPlace(img, cx - 9 * s - i, 22 * s + Math.floor(i * 1.4), C.stick);
    fillRect(img, cx - 9 * s - 18 * s, 46 * s, 5 * s, 2 * s, C.outline);
  } else if (opts.stick === 'screen-right') {
    for (let i = 0; i < 18 * s; i++)
      setPixelInPlace(img, cx + 9 * s + i, 22 * s + Math.floor(i * 1.4), C.stick);
    fillRect(img, cx + 9 * s + 14 * s, 46 * s, 5 * s, 2 * s, C.outline);
  }
  return img;
}

/** Unique opaque colours (packed) of an image. */
export function opaqueColors(img: RasterImage): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] > 0)
      out.add(`${img.data[i]},${img.data[i + 1]},${img.data[i + 2]},${img.data[i + 3]}`);
  }
  return out;
}

/** Simple deterministic PRNG for noise in tests. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
