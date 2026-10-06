import { packRgba } from './color';
import { blendPixelInPlace, createRaster, type RasterImage, type Rect } from './raster';

/* ------------------------------------------------------------------------ */
/* Flips, mirrors and rotations                                              */
/* ------------------------------------------------------------------------ */

export function flipHorizontal(img: RasterImage): RasterImage {
  const out = createRaster(img.width, img.height);
  const { width: w, height: h } = img;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4;
      const di = (y * w + (w - 1 - x)) * 4;
      out.data[di] = img.data[si];
      out.data[di + 1] = img.data[si + 1];
      out.data[di + 2] = img.data[si + 2];
      out.data[di + 3] = img.data[si + 3];
    }
  }
  return out;
}

export function flipVertical(img: RasterImage): RasterImage {
  const out = createRaster(img.width, img.height);
  const rowBytes = img.width * 4;
  for (let y = 0; y < img.height; y++) {
    const src = img.data.subarray(y * rowBytes, (y + 1) * rowBytes);
    out.data.set(src, (img.height - 1 - y) * rowBytes);
  }
  return out;
}

/**
 * Mirrors the image around a vertical axis at continuous x-coordinate `axisX`
 * (pixel i covers [i, i+1)). Keeps the canvas size, so mirroring around a
 * character's foot anchor keeps the character standing on the same spot —
 * unlike a naive whole-canvas flip. `axisX` must be a multiple of 0.5.
 */
export function mirrorAroundAxis(img: RasterImage, axisX: number): RasterImage {
  const out = createRaster(img.width, img.height);
  const twoA = Math.round(axisX * 2);
  const { width: w, height: h } = img;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tx = twoA - x - 1;
      if (tx < 0 || tx >= w) continue;
      const si = (y * w + x) * 4;
      const di = (y * w + tx) * 4;
      out.data[di] = img.data[si];
      out.data[di + 1] = img.data[si + 1];
      out.data[di + 2] = img.data[si + 2];
      out.data[di + 3] = img.data[si + 3];
    }
  }
  return out;
}

export function rotate90(img: RasterImage, clockwise = true): RasterImage {
  const { width: w, height: h } = img;
  const out = createRaster(h, w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = clockwise ? h - 1 - y : y;
      const ny = clockwise ? x : w - 1 - x;
      const si = (y * w + x) * 4;
      const di = (ny * h + nx) * 4;
      out.data[di] = img.data[si];
      out.data[di + 1] = img.data[si + 1];
      out.data[di + 2] = img.data[si + 2];
      out.data[di + 3] = img.data[si + 3];
    }
  }
  return out;
}

export function rotate180(img: RasterImage): RasterImage {
  return flipVertical(flipHorizontal(img));
}

export interface RotateOptions {
  /** Rotation pivot in continuous coordinates. Defaults to the image centre. */
  pivotX?: number;
  pivotY?: number;
  /** When true the output grows to fit the rotated image (pivot = centre). */
  expand?: boolean;
}

/**
 * Rotates by an arbitrary angle (degrees, clockwise on screen) using
 * nearest-neighbour sampling, which never invents new colours — important for
 * pixel art and palettes.
 */
export function rotateArbitrary(
  img: RasterImage,
  degrees: number,
  opts: RotateOptions = {},
): RasterImage {
  const norm = ((degrees % 360) + 360) % 360;
  if (norm === 0)
    return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
  if (opts.expand) {
    if (norm === 90) return rotate90(img, true);
    if (norm === 180) return rotate180(img);
    if (norm === 270) return rotate90(img, false);
  }
  const rad = (norm * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  let outW = img.width;
  let outH = img.height;
  let px = opts.pivotX ?? img.width / 2;
  let py = opts.pivotY ?? img.height / 2;
  let offX = 0;
  let offY = 0;
  if (opts.expand) {
    outW = Math.max(1, Math.ceil(Math.abs(img.width * cos) + Math.abs(img.height * sin) - 1e-9));
    outH = Math.max(1, Math.ceil(Math.abs(img.width * sin) + Math.abs(img.height * cos) - 1e-9));
    px = img.width / 2;
    py = img.height / 2;
    offX = outW / 2 - px;
    offY = outH / 2 - py;
  }
  const out = createRaster(outW, outH);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      // Inverse-map the destination pixel centre into the source.
      const dx = x + 0.5 - offX - px;
      const dy = y + 0.5 - offY - py;
      const sx = Math.floor(cos * dx + sin * dy + px);
      const sy = Math.floor(-sin * dx + cos * dy + py);
      if (sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) continue;
      const si = (sy * img.width + sx) * 4;
      const di = (y * outW + x) * 4;
      out.data[di] = img.data[si];
      out.data[di + 1] = img.data[si + 1];
      out.data[di + 2] = img.data[si + 2];
      out.data[di + 3] = img.data[si + 3];
    }
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* Scaling                                                                   */
/* ------------------------------------------------------------------------ */

/** Nearest-neighbour scaling. Never blurs, never invents colours. */
export function scaleNearest(img: RasterImage, width: number, height: number): RasterImage {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const out = createRaster(w, h);
  if (img.width === 0 || img.height === 0) return out;
  const sx = img.width / w;
  const sy = img.height / h;
  for (let y = 0; y < h; y++) {
    const srcY = Math.min(img.height - 1, Math.floor((y + 0.5) * sy));
    for (let x = 0; x < w; x++) {
      const srcX = Math.min(img.width - 1, Math.floor((x + 0.5) * sx));
      const si = (srcY * img.width + srcX) * 4;
      const di = (y * w + x) * 4;
      out.data[di] = img.data[si];
      out.data[di + 1] = img.data[si + 1];
      out.data[di + 2] = img.data[si + 2];
      out.data[di + 3] = img.data[si + 3];
    }
  }
  return out;
}

interface Contribution {
  index: Int32Array;
  weight: Float64Array;
  start: Int32Array; // offset into index/weight for destination pixel i
  count: Int32Array;
}

function contributions(srcSize: number, dstSize: number): Contribution {
  const scale = srcSize / dstSize;
  const idx: number[] = [];
  const wts: number[] = [];
  const start = new Int32Array(dstSize);
  const count = new Int32Array(dstSize);
  for (let i = 0; i < dstSize; i++) {
    start[i] = idx.length;
    if (scale > 1) {
      // Downscale: box filter over the exact footprint (area averaging).
      const f0 = i * scale;
      const f1 = (i + 1) * scale;
      let total = 0;
      for (let s = Math.floor(f0); s < Math.ceil(f1); s++) {
        const overlap = Math.min(f1, s + 1) - Math.max(f0, s);
        if (overlap <= 0) continue;
        idx.push(Math.min(srcSize - 1, s));
        wts.push(overlap);
        total += overlap;
      }
      for (let k = start[i]; k < idx.length; k++) wts[k] /= total;
    } else {
      // Upscale: bilinear (triangle filter) between the two nearest samples.
      const c = (i + 0.5) * scale - 0.5;
      const i0 = Math.floor(c);
      const t = c - i0;
      idx.push(Math.max(0, Math.min(srcSize - 1, i0)));
      wts.push(1 - t);
      idx.push(Math.max(0, Math.min(srcSize - 1, i0 + 1)));
      wts.push(t);
    }
    count[i] = idx.length - start[i];
  }
  return { index: Int32Array.from(idx), weight: Float64Array.from(wts), start, count };
}

/**
 * High-quality smooth scaling for painted / high-resolution art: area
 * averaging when shrinking and bilinear when enlarging, in premultiplied alpha
 * so transparent pixels never darken the edges.
 */
export function scaleSmooth(img: RasterImage, width: number, height: number): RasterImage {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  if (img.width === 0 || img.height === 0) return createRaster(w, h);
  const sw = img.width;
  const sh = img.height;
  // Premultiplied float copy.
  const pre = new Float64Array(sw * sh * 4);
  for (let i = 0; i < sw * sh; i++) {
    const a = img.data[i * 4 + 3] / 255;
    pre[i * 4] = img.data[i * 4] * a;
    pre[i * 4 + 1] = img.data[i * 4 + 1] * a;
    pre[i * 4 + 2] = img.data[i * 4 + 2] * a;
    pre[i * 4 + 3] = a;
  }
  // Horizontal pass: sw x sh -> w x sh
  const cx = contributions(sw, w);
  const tmp = new Float64Array(w * sh * 4);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let k = cx.start[x]; k < cx.start[x] + cx.count[x]; k++) {
        const si = (y * sw + cx.index[k]) * 4;
        const wt = cx.weight[k];
        r += pre[si] * wt;
        g += pre[si + 1] * wt;
        b += pre[si + 2] * wt;
        a += pre[si + 3] * wt;
      }
      const di = (y * w + x) * 4;
      tmp[di] = r;
      tmp[di + 1] = g;
      tmp[di + 2] = b;
      tmp[di + 3] = a;
    }
  }
  // Vertical pass: w x sh -> w x h
  const cy = contributions(sh, h);
  const out = createRaster(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let k = cy.start[y]; k < cy.start[y] + cy.count[y]; k++) {
        const si = (cy.index[k] * w + x) * 4;
        const wt = cy.weight[k];
        r += tmp[si] * wt;
        g += tmp[si + 1] * wt;
        b += tmp[si + 2] * wt;
        a += tmp[si + 3] * wt;
      }
      const di = (y * w + x) * 4;
      if (a > 1e-6) {
        out.data[di] = r / a;
        out.data[di + 1] = g / a;
        out.data[di + 2] = b / a;
        out.data[di + 3] = a * 255;
      }
    }
  }
  return out;
}

export interface ModeDownscaleOptions {
  /** Bits per channel used to group similar colours (8 = exact colours). */
  bits?: number;
  /** Pixels with alpha below this count as transparent votes. */
  alphaThreshold?: number;
}

/**
 * Pixel-art aware downscaling: every destination pixel takes the most common
 * colour cluster inside its footprint (instead of averaging). Edges stay crisp
 * and thin dark outlines survive, which is what you want when turning a
 * high-resolution AI render back into a sprite. Output alpha is binary.
 */
export function downscaleMode(
  img: RasterImage,
  width: number,
  height: number,
  opts: ModeDownscaleOptions = {},
): RasterImage {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const out = createRaster(w, h);
  if (img.width === 0 || img.height === 0) return out;
  const bits = Math.max(1, Math.min(8, opts.bits ?? 8));
  const shift = 8 - bits;
  const alphaThreshold = opts.alphaThreshold ?? 128;
  const sx = img.width / w;
  const sy = img.height / h;
  const TRANSPARENT_KEY = -1;
  const counts = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.min(img.height, Math.ceil((y + 1) * sy)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.min(img.width, Math.ceil((x + 1) * sx)));
      counts.clear();
      // Centre pixel of the footprint wins ties.
      const cxp = Math.min(img.width - 1, Math.floor((x + 0.5) * sx));
      const cyp = Math.min(img.height - 1, Math.floor((y + 0.5) * sy));
      const ci = (cyp * img.width + cxp) * 4;
      const centreKey =
        img.data[ci + 3] < alphaThreshold
          ? TRANSPARENT_KEY
          : packRgba(
              img.data[ci] >> shift,
              img.data[ci + 1] >> shift,
              img.data[ci + 2] >> shift,
              0,
            );
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * img.width + xx) * 4;
          const key =
            img.data[i + 3] < alphaThreshold
              ? TRANSPARENT_KEY
              : packRgba(
                  img.data[i] >> shift,
                  img.data[i + 1] >> shift,
                  img.data[i + 2] >> shift,
                  0,
                );
          let entry = counts.get(key);
          if (!entry) {
            entry = { n: 0, r: 0, g: 0, b: 0 };
            counts.set(key, entry);
          }
          entry.n++;
          entry.r += img.data[i];
          entry.g += img.data[i + 1];
          entry.b += img.data[i + 2];
        }
      }
      let bestKey = centreKey;
      let bestN = counts.get(centreKey)?.n ?? 0;
      for (const [key, entry] of counts) {
        if (entry.n > bestN) {
          bestN = entry.n;
          bestKey = key;
        }
      }
      if (bestKey === TRANSPARENT_KEY) continue;
      const e = counts.get(bestKey)!;
      const di = (y * w + x) * 4;
      out.data[di] = Math.round(e.r / e.n);
      out.data[di + 1] = Math.round(e.g / e.n);
      out.data[di + 2] = Math.round(e.b / e.n);
      out.data[di + 3] = 255;
    }
  }
  return out;
}

/** Scales with the method appropriate for the art style. */
export function scaleForStyle(
  img: RasterImage,
  width: number,
  height: number,
  pixelArt: boolean,
): RasterImage {
  if (!pixelArt) return scaleSmooth(img, width, height);
  const shrinking = width < img.width * 0.75 || height < img.height * 0.75;
  return shrinking
    ? downscaleMode(img, width, height, { bits: 5 })
    : scaleNearest(img, width, height);
}

/* ------------------------------------------------------------------------ */
/* Cropping, compositing, translating                                        */
/* ------------------------------------------------------------------------ */

/** Copies `rect` out of `img`. Areas outside the source become transparent. */
export function crop(img: RasterImage, rect: Rect): RasterImage {
  const out = createRaster(rect.width, rect.height);
  for (let y = 0; y < rect.height; y++) {
    const sy = rect.y + y;
    if (sy < 0 || sy >= img.height) continue;
    for (let x = 0; x < rect.width; x++) {
      const sx = rect.x + x;
      if (sx < 0 || sx >= img.width) continue;
      const si = (sy * img.width + sx) * 4;
      const di = (y * rect.width + x) * 4;
      out.data[di] = img.data[si];
      out.data[di + 1] = img.data[si + 1];
      out.data[di + 2] = img.data[si + 2];
      out.data[di + 3] = img.data[si + 3];
    }
  }
  return out;
}

export type BlitMode = 'over' | 'replace';

/** Draws `src` onto `dst` at (dx, dy). Mutates `dst`. */
export function blitInPlace(
  dst: RasterImage,
  src: RasterImage,
  dx: number,
  dy: number,
  mode: BlitMode = 'over',
): void {
  const ox = Math.round(dx);
  const oy = Math.round(dy);
  for (let y = 0; y < src.height; y++) {
    const ty = oy + y;
    if (ty < 0 || ty >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const tx = ox + x;
      if (tx < 0 || tx >= dst.width) continue;
      const si = (y * src.width + x) * 4;
      if (mode === 'replace') {
        const di = (ty * dst.width + tx) * 4;
        dst.data[di] = src.data[si];
        dst.data[di + 1] = src.data[si + 1];
        dst.data[di + 2] = src.data[si + 2];
        dst.data[di + 3] = src.data[si + 3];
      } else {
        const a = src.data[si + 3];
        if (a === 0) continue;
        blendPixelInPlace(dst, tx, ty, {
          r: src.data[si],
          g: src.data[si + 1],
          b: src.data[si + 2],
          a,
        });
      }
    }
  }
}

export function blit(
  dst: RasterImage,
  src: RasterImage,
  dx: number,
  dy: number,
  mode: BlitMode = 'over',
): RasterImage {
  const out: RasterImage = {
    width: dst.width,
    height: dst.height,
    data: new Uint8ClampedArray(dst.data),
  };
  blitInPlace(out, src, dx, dy, mode);
  return out;
}

/** Shifts the content by (dx, dy) on a canvas of the same size. */
export function translate(img: RasterImage, dx: number, dy: number): RasterImage {
  const out = createRaster(img.width, img.height);
  blitInPlace(out, img, dx, dy, 'replace');
  return out;
}

/** New canvas of the given size with `img` drawn at (offsetX, offsetY). */
export function resizeCanvas(
  img: RasterImage,
  width: number,
  height: number,
  offsetX: number,
  offsetY: number,
): RasterImage {
  const out = createRaster(width, height);
  blitInPlace(out, img, offsetX, offsetY, 'replace');
  return out;
}

/** Multiplies alpha by `factor` (0…n) inside `rect` (or everywhere). */
export function multiplyAlpha(img: RasterImage, factor: number, rect?: Rect): RasterImage {
  const out: RasterImage = {
    width: img.width,
    height: img.height,
    data: new Uint8ClampedArray(img.data),
  };
  const x0 = Math.max(0, rect?.x ?? 0);
  const y0 = Math.max(0, rect?.y ?? 0);
  const x1 = Math.min(img.width, rect ? rect.x + rect.width : img.width);
  const y1 = Math.min(img.height, rect ? rect.y + rect.height : img.height);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * img.width + x) * 4 + 3;
      out.data[i] = Math.round(img.data[i] * factor);
    }
  }
  return out;
}

/** Clears `rect` to transparent. */
export function clearRect(img: RasterImage, rect: Rect): RasterImage {
  const out: RasterImage = {
    width: img.width,
    height: img.height,
    data: new Uint8ClampedArray(img.data),
  };
  const x0 = Math.max(0, rect.x);
  const y0 = Math.max(0, rect.y);
  const x1 = Math.min(img.width, rect.x + rect.width);
  const y1 = Math.min(img.height, rect.y + rect.height);
  for (let y = y0; y < y1; y++)
    out.data.fill(0, (y * img.width + x0) * 4, (y * img.width + x1) * 4);
  return out;
}

/** Keeps only the pixels inside `rect`; everything else becomes transparent. */
export function clearOutside(img: RasterImage, rect: Rect): RasterImage {
  const out = createRaster(img.width, img.height);
  blitInPlace(out, crop(img, rect), rect.x, rect.y, 'replace');
  return out;
}

/** Sets alpha to 0 or 255 (pixel art should not have soft edges). */
export function binarizeAlpha(img: RasterImage, threshold = 128): RasterImage {
  const out: RasterImage = {
    width: img.width,
    height: img.height,
    data: new Uint8ClampedArray(img.data),
  };
  for (let i = 3; i < out.data.length; i += 4) {
    if (out.data[i] >= threshold) out.data[i] = 255;
    else {
      out.data[i - 3] = 0;
      out.data[i - 2] = 0;
      out.data[i - 1] = 0;
      out.data[i] = 0;
    }
  }
  return out;
}

/** Composites `img` over a solid colour (used to prepare AI inputs). */
export function flattenOnto(
  img: RasterImage,
  bg: { r: number; g: number; b: number },
): RasterImage {
  const out = createRaster(img.width, img.height, { ...bg, a: 255 });
  blitInPlace(out, img, 0, 0, 'over');
  return out;
}
