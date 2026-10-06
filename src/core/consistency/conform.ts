import type { StyleLocks } from '../character/model';
import { placeOnAnchor, type WorkingCell } from '../project/project';
import {
  applyOutline,
  binarizeAlpha,
  contentBounds,
  crop,
  detectPixelScale,
  downscaleMode,
  downsamplePixelArt,
  quantizeToPalette,
  removeBackground,
  scaleNearest,
  scaleSmooth,
  type RasterImage,
  type RemoveBackgroundOptions,
  type Rgba,
} from '../sprite';

/**
 * Consistency System — conform pipeline.
 *
 * Every image that enters a direction slot from outside (AI output, an
 * imported drawing) goes through the same deterministic steps so it matches
 * the character reference:
 *
 *   background removal → (undo pixel upscale) → trim → scale to the
 *   reference height → palette lock → outline lock → hard alpha →
 *   place feet on the shared anchor
 */
export interface ConformContext {
  cell: WorkingCell;
  pixelArt: boolean;
  locks: StyleLocks;
  /** Reference palette from the source sprite. */
  palette: Rgba[];
  outline: { color: Rgba; thickness: number } | null;
  /** Height of the source silhouette in working pixels. */
  referenceHeight: number;
  scaleMode: 'height' | 'generation' | 'off';
  /** Provider-input pixels per working pixel (used by scaleMode = generation). */
  generationScale?: number;
  backgroundHint?: Rgba | null;
  backgroundMode?: RemoveBackgroundOptions['mode'];
  tolerance?: number;
  /** Detect integer-upscaled pixel art (for user imports). */
  detectUpscale?: boolean;
}

export interface ConformResult {
  image: RasterImage;
  warnings: string[];
  metrics: {
    contentWidth: number;
    contentHeight: number;
    scale: number;
    clipped: boolean;
    removedBackground: boolean;
  };
}

export class ConformError extends Error {}

export function conformToCharacter(raw: RasterImage, ctx: ConformContext): ConformResult {
  const warnings: string[] = [];
  let img = raw;
  if (ctx.detectUpscale && ctx.pixelArt) {
    const ps = detectPixelScale(img);
    if (ps.scale > 1) img = downsamplePixelArt(img, ps.scale, ps.offsetX, ps.offsetY);
  }
  const bg = removeBackground(img, {
    mode: ctx.backgroundMode ?? 'auto',
    tolerance: ctx.tolerance ?? 40,
    defringe: !ctx.pixelArt,
    hint: ctx.backgroundHint ?? null,
  });
  img = bg.image;
  if (bg.info.kind === 'none') {
    warnings.push('Could not find a uniform background to remove; check the edges of this view.');
  }
  const bounds = contentBounds(img, 16);
  if (!bounds) throw new ConformError('The image is empty after background removal.');
  let content = crop(img, bounds);

  let scale = 1;
  if (ctx.scaleMode === 'height' && ctx.locks.scale && ctx.referenceHeight > 0) {
    scale = ctx.referenceHeight / content.height;
  } else if (ctx.scaleMode === 'generation' && ctx.generationScale && ctx.generationScale > 0) {
    scale = 1 / ctx.generationScale;
  }
  const paletteLocked = ctx.locks.palette && ctx.palette.length > 0;
  // Pixel art: snap to the palette at full resolution first, so the
  // majority-vote downscale below only ever picks exact palette colours.
  if (paletteLocked && ctx.pixelArt) {
    content = quantizeToPalette(content, ctx.palette, { binarizeAlpha: true });
  }
  if (Math.abs(scale - 1) > 0.02) {
    const w = Math.max(1, Math.round(content.width * scale));
    const h = Math.max(1, Math.round(content.height * scale));
    if (scale > 1.5) warnings.push(`The view was enlarged ${scale.toFixed(1)}× to match the character height; details may be soft.`);
    if (!ctx.pixelArt) content = scaleSmooth(content, w, h);
    else if (scale < 0.75) content = downscaleMode(content, w, h, { bits: paletteLocked ? 8 : 5 });
    else content = scaleNearest(content, w, h);
  }
  if (paletteLocked && !ctx.pixelArt) {
    // Smooth resampling blends colours, so quantize afterwards.
    content = quantizeToPalette(content, ctx.palette);
  }
  if (ctx.pixelArt) content = binarizeAlpha(content);
  if (ctx.locks.outline && ctx.outline) {
    content = applyOutline(content, ctx.outline.color, ctx.outline.thickness);
  }

  const placed = placeOnAnchor(content, ctx.cell);
  if (placed.clipped) {
    warnings.push('The view is larger than the working canvas and was clipped. Enlarge the canvas or reduce the scale.');
  }
  return {
    image: placed.image,
    warnings,
    metrics: {
      contentWidth: content.width,
      contentHeight: content.height,
      scale,
      clipped: placed.clipped,
      removedBackground: bg.removedPixels > 0,
    },
  };
}
