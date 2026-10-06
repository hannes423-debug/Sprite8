import type { Direction } from '../directions';
import { DIRECTIONS } from '../directions';
import type { Project } from '../project/project';
import type { BuiltSheet } from './sheet';

export const APP_NAME = 'Sprite8';
export const APP_VERSION = '0.1.0';
export const APP_URL = 'https://github.com/hannes423-debug/Sprite8';

export interface ExportNames {
  base: string;
  sheet: string;
  json: string;
  cell(direction: Direction, frame: number): string;
}

/** Lower-case, file-system safe base name. */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  return slug || 'character';
}

export function exportNames(
  characterName: string,
  animationName: string,
  frames: number,
): ExportNames {
  const base = slugify(characterName);
  const anim = slugify(animationName).toLowerCase();
  return {
    base,
    sheet: `${base}_sheet.png`,
    json: `${base}.json`,
    cell: (d, f) => (frames > 1 ? `${base}_${anim}_${d}_${f}.png` : `${base}_${d}.png`),
  };
}

export interface FrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
  file: string;
}

export interface SheetMetadata {
  character: string;
  directions: Record<Direction, string>;
  cellWidth: number;
  cellHeight: number;
  anchor: { x: number; y: number };
  sheet: {
    image: string;
    width: number;
    height: number;
    columns: number;
    rows: number;
    spacing: number;
    order: Direction[];
  };
  animation: {
    name: string;
    kind: string;
    frameCount: number;
    fps: number;
    loop: boolean;
    frames: Record<Direction, FrameRect[]>;
  };
  symmetry: string;
  handedness: string;
  sourceDirection: Direction;
  pixelArt: boolean;
  /** Working pixels → exported pixels. */
  scale: number;
  generator: { name: string; version: string; url: string };
}

/**
 * JSON metadata for engines. The first keys follow the simple format
 * (character / directions / cellWidth / cellHeight / anchor); `sheet` and
 * `animation` add per-frame rectangles for atlas-based engines.
 */
export function buildMetadata(
  project: Project,
  sheet: BuiltSheet,
  names: ExportNames,
): SheetMetadata {
  const directions = {} as Record<Direction, string>;
  const frames = {} as Record<Direction, FrameRect[]>;
  for (const d of DIRECTIONS) {
    directions[d] = names.cell(d, 0);
    frames[d] = sheet.cells
      .filter((c) => c.direction === d)
      .sort((a, b) => a.frame - b.frame)
      .map((c) => ({
        x: c.x,
        y: c.y,
        w: sheet.cellWidth,
        h: sheet.cellHeight,
        file: names.cell(d, c.frame),
      }));
  }
  const order = [...new Set(sheet.cells.map((c) => c.direction))];
  return {
    character: names.base,
    directions,
    cellWidth: sheet.cellWidth,
    cellHeight: sheet.cellHeight,
    anchor: { ...sheet.anchor },
    sheet: {
      image: names.sheet,
      width: sheet.image.width,
      height: sheet.image.height,
      columns: sheet.columns,
      rows: sheet.rows,
      spacing: sheet.spacing,
      order,
    },
    animation: {
      name: sheet.animation.name,
      kind: sheet.animation.kind,
      frameCount: sheet.frameCount,
      fps: sheet.animation.fps,
      loop: sheet.animation.loop,
      frames,
    },
    symmetry: project.setup.symmetry,
    handedness: project.character?.handedness ?? 'none',
    sourceDirection: project.setup.sourceDirection,
    pixelArt: project.sheet.pixelPreservation,
    scale: Math.round(sheet.scale * 1000) / 1000,
    generator: { name: APP_NAME, version: APP_VERSION, url: APP_URL },
  };
}
