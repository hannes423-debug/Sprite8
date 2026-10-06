import type { ImageCodec } from '../core/providers/types';
import type { RasterImage } from '../core/sprite';

/**
 * Browser image I/O. Core code works on plain RasterImage objects; these
 * helpers bridge to canvases, PNG blobs and decoded files.
 */
export function createCanvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, width);
  c.height = Math.max(1, height);
  return c;
}

export function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D is not available.');
  return ctx;
}

const canvasCache = new WeakMap<RasterImage, HTMLCanvasElement>();

/** A canvas holding the raster's pixels (cached per immutable raster). */
export function rasterCanvas(img: RasterImage): HTMLCanvasElement {
  let c = canvasCache.get(img);
  if (!c) {
    c = createCanvas(img.width, img.height);
    if (img.width > 0 && img.height > 0) {
      context2d(c).putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
    }
    canvasCache.set(img, c);
  }
  return c;
}

/** Writes pixels into an existing canvas (used for mutable editor buffers). */
export function putRaster(canvas: HTMLCanvasElement, img: RasterImage): void {
  if (canvas.width !== img.width || canvas.height !== img.height) {
    canvas.width = Math.max(1, img.width);
    canvas.height = Math.max(1, img.height);
  }
  if (img.width > 0 && img.height > 0) {
    context2d(canvas).putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  }
}

export function canvasToRaster(canvas: HTMLCanvasElement): RasterImage {
  const data = context2d(canvas).getImageData(0, 0, canvas.width, canvas.height).data;
  return { width: canvas.width, height: canvas.height, data: new Uint8ClampedArray(data) };
}

const MAX_DECODE_SIDE = 4096;

/** Decodes an image file/blob to RGBA without colour-space conversion. */
export async function decodeImage(blob: Blob): Promise<RasterImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  } catch {
    throw new Error('This file could not be read as an image (PNG, GIF, WebP or JPEG expected).');
  }
  let { width, height } = bitmap;
  const scale = Math.min(1, MAX_DECODE_SIDE / Math.max(width, height));
  width = Math.max(1, Math.round(width * scale));
  height = Math.max(1, Math.round(height * scale));
  const canvas = createCanvas(width, height);
  const ctx = context2d(canvas);
  ctx.imageSmoothingEnabled = scale < 1;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return canvasToRaster(canvas);
}

export function encodePng(img: RasterImage): Promise<Blob> {
  const canvas = createCanvas(img.width, img.height);
  putRaster(canvas, img);
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed.'))), 'image/png');
  });
}

export const browserCodec: ImageCodec = { encodePng, decode: decodeImage };
