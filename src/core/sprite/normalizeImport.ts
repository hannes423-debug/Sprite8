import { removeBackground, type BackgroundInfo, type RemoveBackgroundOptions } from './background';
import { contentBounds } from './bounds';
import { colorHistogram } from './quantize';
import { detectPixelScale, downsamplePixelArt, type PixelScaleResult } from './pixelScale';
import type { RasterImage } from './raster';
import { binarizeAlpha, crop, scaleForStyle } from './transform';

export interface NormalizeImportOptions {
  backgroundMode?: RemoveBackgroundOptions['mode'];
  tolerance?: number;
  /** Detect and undo integer upscaling of pixel art. */
  detectPixelScale?: boolean;
  /** Force pixel-art handling on/off, or detect it. */
  pixelArt?: boolean | 'auto';
  /** Largest side of the working sprite; bigger images are downscaled. */
  maxDimension?: number;
}

export interface NormalizedImport {
  /** Trimmed sprite at native resolution with a transparent background. */
  sprite: RasterImage;
  original: { width: number; height: number };
  pixelScale: PixelScaleResult;
  background: BackgroundInfo;
  removedPixels: number;
  pixelArt: boolean;
  /** Extra downscale applied to respect `maxDimension` (1 = none). */
  downscaledBy: number;
  /** Position of the sprite inside the (native-scale) uploaded image. */
  offset: { x: number; y: number };
  warnings: string[];
}

function alphaIsBinary(img: RasterImage): boolean {
  let soft = 0;
  let visible = 0;
  for (let i = 3; i < img.data.length; i += 4) {
    const a = img.data[i];
    if (a > 0) visible++;
    if (a > 0 && a < 255) soft++;
  }
  return visible === 0 || soft / visible < 0.01;
}

/** Heuristic: limited colours, hard alpha and small size read as pixel art. */
export function looksLikePixelArt(img: RasterImage, upscale: number): boolean {
  if (upscale > 1) return true;
  if (Math.max(img.width, img.height) > 320) return false;
  if (!alphaIsBinary(img)) return false;
  return colorHistogram(img).size <= 256;
}

/**
 * Turns an arbitrary uploaded image into a clean source sprite:
 * pixel-scale detection → background keying → trim → size cap.
 */
export function normalizeImport(
  input: RasterImage,
  opts: NormalizeImportOptions = {},
): NormalizedImport {
  const warnings: string[] = [];
  const pixelScale =
    opts.detectPixelScale === false || opts.pixelArt === false
      ? { scale: 1, offsetX: 0, offsetY: 0, confidence: 0 }
      : detectPixelScale(input);
  let img = input;
  if (pixelScale.scale > 1) {
    img = downsamplePixelArt(input, pixelScale.scale, pixelScale.offsetX, pixelScale.offsetY);
    warnings.push(
      `Detected pixel art upscaled ${pixelScale.scale}×. Working at its native resolution (${img.width}×${img.height}).`,
    );
  }
  // Decide pixel-art handling before keying so painted art gets soft edges.
  let pixelArt =
    opts.pixelArt === 'auto' || opts.pixelArt === undefined
      ? looksLikePixelArt(img, pixelScale.scale)
      : opts.pixelArt;
  const bg = removeBackground(img, {
    mode: opts.backgroundMode ?? 'auto',
    tolerance: opts.tolerance ?? 32,
    defringe: !pixelArt,
  });
  img = bg.image;
  if (bg.info.kind === 'none' && opts.backgroundMode !== 'off') {
    warnings.push(
      'No transparent or uniform background was found, so the image was kept as is. A transparent PNG gives the best results.',
    );
  } else if (bg.info.kind === 'solid' && bg.removedPixels > 0) {
    warnings.push('Removed a solid background colour.');
  }
  if ((opts.pixelArt === 'auto' || opts.pixelArt === undefined) && bg.info.kind === 'solid') {
    // Re-evaluate now that the background is gone.
    pixelArt = looksLikePixelArt(img, pixelScale.scale);
  }
  if (pixelArt) img = binarizeAlpha(img);

  const bounds = contentBounds(img, 8);
  if (!bounds) {
    return {
      sprite: img,
      original: { width: input.width, height: input.height },
      pixelScale,
      background: bg.info,
      removedPixels: bg.removedPixels,
      pixelArt,
      downscaledBy: 1,
      offset: { x: 0, y: 0 },
      warnings: [...warnings, 'The image appears to be empty after removing the background.'],
    };
  }
  let sprite = crop(img, bounds);
  const maxDim = opts.maxDimension ?? 768;
  let downscaledBy = 1;
  if (Math.max(sprite.width, sprite.height) > maxDim) {
    downscaledBy = Math.max(sprite.width, sprite.height) / maxDim;
    const w = Math.max(1, Math.round(sprite.width / downscaledBy));
    const h = Math.max(1, Math.round(sprite.height / downscaledBy));
    warnings.push(
      `Large image downscaled from ${sprite.width}×${sprite.height} to ${w}×${h} for editing.`,
    );
    sprite = scaleForStyle(sprite, w, h, pixelArt);
  }
  return {
    sprite,
    original: { width: input.width, height: input.height },
    pixelScale,
    background: bg.info,
    removedPixels: bg.removedPixels,
    pixelArt,
    downscaledBy,
    offset: { x: bounds.x, y: bounds.y },
    warnings,
  };
}
