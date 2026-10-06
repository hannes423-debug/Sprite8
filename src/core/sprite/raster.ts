/**
 * RGBA8 raster images.
 *
 * `RasterImage` is structurally compatible with the DOM `ImageData`, but it is
 * a plain object so every algorithm in `core/` can run (and be unit tested)
 * without a browser or a canvas.
 *
 * Convention: functions in `core/` never mutate their input rasters unless the
 * function name ends in `InPlace`. Project state stores rasters immutably, which
 * is what makes per-direction regeneration and cheap undo snapshots possible.
 */
export interface RasterImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const TRANSPARENT: Readonly<Rgba> = Object.freeze({ r: 0, g: 0, b: 0, a: 0 });

export function createRaster(width: number, height: number, fill?: Rgba): RasterImage {
  const w = Math.max(0, Math.floor(width));
  const h = Math.max(0, Math.floor(height));
  const data = new Uint8ClampedArray(w * h * 4);
  if (fill && (fill.r || fill.g || fill.b || fill.a)) {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = fill.r;
      data[i + 1] = fill.g;
      data[i + 2] = fill.b;
      data[i + 3] = fill.a;
    }
  }
  return { width: w, height: h, data };
}

export function rasterFromData(width: number, height: number, data: ArrayLike<number>): RasterImage {
  if (data.length !== width * height * 4) {
    throw new Error(`Raster data length ${data.length} does not match ${width}x${height}`);
  }
  return { width, height, data: new Uint8ClampedArray(data) };
}

export function cloneRaster(src: RasterImage): RasterImage {
  return { width: src.width, height: src.height, data: new Uint8ClampedArray(src.data) };
}

export function inBounds(img: RasterImage, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < img.width && y < img.height;
}

export function pixelOffset(img: RasterImage, x: number, y: number): number {
  return (y * img.width + x) * 4;
}

export function getPixel(img: RasterImage, x: number, y: number): Rgba {
  if (!inBounds(img, x, y)) return { ...TRANSPARENT };
  const i = pixelOffset(img, x, y);
  const d = img.data;
  return { r: d[i], g: d[i + 1], b: d[i + 2], a: d[i + 3] };
}

export function alphaAt(img: RasterImage, x: number, y: number): number {
  if (!inBounds(img, x, y)) return 0;
  return img.data[pixelOffset(img, x, y) + 3];
}

/** Writes a pixel (no blending). Out-of-bounds writes are ignored. */
export function setPixelInPlace(img: RasterImage, x: number, y: number, c: Rgba): void {
  if (!inBounds(img, x, y)) return;
  const i = pixelOffset(img, x, y);
  const d = img.data;
  d[i] = c.r;
  d[i + 1] = c.g;
  d[i + 2] = c.b;
  d[i + 3] = c.a;
}

/** Source-over compositing of one non-premultiplied pixel. */
export function blendPixelInPlace(img: RasterImage, x: number, y: number, c: Rgba): void {
  if (!inBounds(img, x, y) || c.a <= 0) return;
  if (c.a >= 255) {
    setPixelInPlace(img, x, y, c);
    return;
  }
  const i = pixelOffset(img, x, y);
  const d = img.data;
  const sa = c.a / 255;
  const da = d[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa <= 0) return;
  d[i] = Math.round((c.r * sa + d[i] * da * (1 - sa)) / oa);
  d[i + 1] = Math.round((c.g * sa + d[i + 1] * da * (1 - sa)) / oa);
  d[i + 2] = Math.round((c.b * sa + d[i + 2] * da * (1 - sa)) / oa);
  d[i + 3] = Math.round(oa * 255);
}

/** True when every pixel is fully transparent (or the raster has no area). */
export function isRasterEmpty(img: RasterImage | null | undefined): boolean {
  if (!img || img.width === 0 || img.height === 0) return true;
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return false;
  return true;
}

export function rastersEqual(a: RasterImage, b: RasterImage): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  const da = a.data;
  const db = b.data;
  for (let i = 0; i < da.length; i++) if (da[i] !== db[i]) return false;
  return true;
}

export function countOpaquePixels(img: RasterImage, alphaThreshold = 0): number {
  let n = 0;
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) if (d[i] > alphaThreshold) n++;
  return n;
}

export function rasterByteSize(img: RasterImage): number {
  return img.data.byteLength;
}

export function rectIntersect(a: Rect, b: Rect): Rect | null {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.width, b.x + b.width);
  const y1 = Math.min(a.y + a.height, b.y + b.height);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export function rectUnion(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b ? { ...b } : null;
  if (!b) return { ...a };
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.width, b.x + b.width);
  const y1 = Math.max(a.y + a.height, b.y + b.height);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export function normalizeRect(x0: number, y0: number, x1: number, y1: number): Rect {
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  return { x, y, width: Math.abs(x1 - x0) + 1, height: Math.abs(y1 - y0) + 1 };
}
