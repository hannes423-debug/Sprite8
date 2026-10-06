import { frameCount, type Animation } from '../animation';
import { DIRECTIONS, computePlacements, gridDimensions, type Direction } from '../directions';
import { activeAnimation, type Project, type SheetSettings, type WorkingCell } from '../project/project';
import {
  binarizeAlpha,
  blitInPlace,
  contentBounds,
  createRaster,
  downscaleMode,
  findFeet,
  hexToRgba,
  scaleNearest,
  scaleSmooth,
  translate,
  type RasterImage,
} from '../sprite';

export interface SheetCellOut {
  direction: Direction;
  frame: number;
  col: number;
  row: number;
  /** Top-left of the cell on the sheet (export pixels). */
  x: number;
  y: number;
  /** The cell on its own (export pixels) — used for individual PNGs. */
  image: RasterImage;
  empty: boolean;
}

export interface BuiltSheet {
  image: RasterImage;
  cellWidth: number;
  cellHeight: number;
  anchor: { x: number; y: number };
  columns: number;
  rows: number;
  spacing: number;
  /** Working pixels → exported pixels (includes the export scale). */
  scale: number;
  cells: SheetCellOut[];
  frameCount: number;
  animation: Animation;
  warnings: string[];
}

interface Extents {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function alignOffsets(anim: Animation, cell: WorkingCell, align: SheetSettings['align']): Record<Direction, { dx: number; dy: number }> {
  const out = {} as Record<Direction, { dx: number; dy: number }>;
  for (const d of DIRECTIONS) {
    out[d] = { dx: 0, dy: 0 };
    if (align !== 'feet') continue;
    const first = anim.tracks[d].frames.find((f) => f.image && f.status !== 'empty');
    const feet = first?.image ? findFeet(first.image) : null;
    if (feet) out[d] = { dx: Math.round(cell.anchorX - feet.feetX), dy: Math.round(cell.anchorY - feet.groundY) };
  }
  return out;
}

/** Character extents around the anchor across every frame (working pixels). */
function unionExtents(images: RasterImage[], cell: WorkingCell): Extents | null {
  let ext: Extents | null = null;
  for (const img of images) {
    const b = contentBounds(img, 0);
    if (!b) continue;
    const e = {
      left: Math.max(0, cell.anchorX - b.x),
      right: Math.max(0, b.x + b.width - cell.anchorX),
      top: Math.max(0, cell.anchorY - b.y),
      bottom: Math.max(0, b.y + b.height - cell.anchorY),
    };
    ext = ext
      ? {
          left: Math.max(ext.left, e.left),
          right: Math.max(ext.right, e.right),
          top: Math.max(ext.top, e.top),
          bottom: Math.max(ext.bottom, e.bottom),
        }
      : e;
  }
  return ext;
}

export const TARGET_SIZES: Record<string, number> = { '32': 32, '48': 48, '64': 64, '96': 96, '128': 128 };

/**
 * Lays out every (direction, frame) of an animation into one sprite sheet.
 * All cells share one size, one anchor and ONE character scale, so the
 * character never changes size between directions.
 */
export function buildSheet(project: Project, animation?: Animation): BuiltSheet {
  const settings = project.sheet;
  const cell = project.cell;
  const anim = animation ?? activeAnimation(project);
  const frames = frameCount(anim);
  const warnings: string[] = [];
  const pixelMode = settings.pixelPreservation;
  const nearest = pixelMode || settings.nearestNeighbor;
  const exportScale = Math.max(1, Math.floor(settings.exportScale || 1));
  const padding = Math.max(0, Math.floor(settings.padding));

  const offsets = alignOffsets(anim, cell, settings.align);
  const aligned = new Map<string, RasterImage | null>();
  for (const d of DIRECTIONS) {
    anim.tracks[d].frames.forEach((f, i) => {
      if (!f.image || f.status === 'empty') {
        aligned.set(`${d}:${i}`, null);
        return;
      }
      const { dx, dy } = offsets[d];
      aligned.set(`${d}:${i}`, dx || dy ? translate(f.image, dx, dy) : f.image);
    });
  }
  const images = [...aligned.values()].filter((x): x is RasterImage => !!x);
  if (images.length === 0) warnings.push('There is nothing to export yet.');
  const ext = unionExtents(images, cell) ?? { left: cell.width / 4, right: cell.width / 4, top: cell.height / 2, bottom: 0 };

  // Cell size, anchor and character scale (before the export scale).
  let cellW: number;
  let cellH: number;
  let anchorX: number;
  let anchorY: number;
  let scale: number;
  if (settings.target === 'original') {
    scale = 1;
    const half = Math.ceil(Math.max(ext.left, ext.right));
    cellW = 2 * half + 2 * padding;
    if (settings.anchorMode === 'center') {
      const halfH = Math.ceil(Math.max(ext.top, ext.bottom));
      cellH = 2 * halfH + 2 * padding;
      anchorY = cellH / 2;
    } else {
      cellH = Math.ceil(ext.top) + Math.ceil(ext.bottom) + 2 * padding;
      anchorY = padding + Math.ceil(ext.top);
    }
    anchorX = cellW / 2;
  } else {
    const size = TARGET_SIZES[settings.target];
    cellW = Math.max(1, Math.floor(size ?? settings.customWidth));
    cellH = Math.max(1, Math.floor(size ?? settings.customHeight));
    if (settings.anchorMode === 'center') {
      anchorX = cellW / 2;
      anchorY = cellH / 2;
    } else if (settings.anchorMode === 'custom') {
      anchorX = Math.min(cellW, Math.max(0, settings.anchorX));
      anchorY = Math.min(cellH, Math.max(0, settings.anchorY));
    } else {
      anchorX = cellW / 2;
      anchorY = cellH - padding;
    }
    const fit = (space: number, need: number) => (need > 0 ? space / need : Infinity);
    scale = Math.min(
      fit(anchorX - padding, ext.left),
      fit(cellW - padding - anchorX, ext.right),
      fit(anchorY - padding, ext.top),
      fit(cellH - padding - anchorY, ext.bottom),
    );
    if (!Number.isFinite(scale) || scale <= 0) scale = 1;
    if (pixelMode) {
      if (scale >= 1) scale = Math.floor(scale);
      else {
        scale = 1 / Math.ceil(1 / scale);
        warnings.push(
          `The character is larger than the ${cellW}×${cellH} cell, so pixel art is reduced ${Math.round(1 / scale)}×. Choose a larger cell or "Original" to keep every pixel.`,
        );
      }
    }
  }

  // Render at the final (export) scale directly: one resampling step only.
  const S = scale * exportScale;
  const finalW = Math.round(cellW * exportScale);
  const finalH = Math.round(cellH * exportScale);
  const finalAnchorX = anchorX * exportScale;
  const finalAnchorY = anchorY * exportScale;
  const spacing = Math.max(0, Math.floor(settings.spacing)) * exportScale;
  const bg = settings.background === 'color' ? hexToRgba(settings.backgroundColor) : null;

  const scaledCache = new Map<RasterImage, RasterImage>();
  const renderCell = (img: RasterImage | null): RasterImage => {
    const out = createRaster(finalW, finalH, bg ?? undefined);
    if (!img) return out;
    let scaled = scaledCache.get(img);
    if (!scaled) {
      const w = Math.max(1, Math.round(img.width * S));
      const h = Math.max(1, Math.round(img.height * S));
      if (Math.abs(S - 1) < 1e-9) scaled = img;
      else if (nearest) scaled = S < 1 && pixelMode ? downscaleMode(img, w, h) : scaleNearest(img, w, h);
      else scaled = scaleSmooth(img, w, h);
      if (pixelMode) scaled = binarizeAlpha(scaled);
      scaledCache.set(img, scaled);
    }
    blitInPlace(out, scaled, Math.round(finalAnchorX - cell.anchorX * S), Math.round(finalAnchorY - cell.anchorY * S), 'over');
    return out;
  };

  const { columns, rows } = gridDimensions(settings, frames);
  const sheetW = columns * finalW + (columns - 1) * spacing;
  const sheetH = rows * finalH + (rows - 1) * spacing;
  const sheet = createRaster(sheetW, sheetH, bg ?? undefined);
  const cells: SheetCellOut[] = [];
  for (const p of computePlacements(settings, frames)) {
    const src = aligned.get(`${p.direction}:${p.frame}`) ?? null;
    const image = renderCell(src);
    const x = p.col * (finalW + spacing);
    const y = p.row * (finalH + spacing);
    blitInPlace(sheet, image, x, y, 'replace');
    cells.push({ direction: p.direction, frame: p.frame, col: p.col, row: p.row, x, y, image, empty: !src });
  }
  const emptyDirs = DIRECTIONS.filter((d) => cells.filter((c) => c.direction === d).every((c) => c.empty));
  if (images.length > 0 && emptyDirs.length) warnings.push(`Empty directions: ${emptyDirs.join(', ')}.`);

  return {
    image: sheet,
    cellWidth: finalW,
    cellHeight: finalH,
    anchor: { x: Math.round(finalAnchorX), y: Math.round(finalAnchorY) },
    columns,
    rows,
    spacing,
    scale: S,
    cells,
    frameCount: frames,
    animation: anim,
    warnings,
  };
}
