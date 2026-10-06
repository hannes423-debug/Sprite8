import type { SpriteAnalysis } from '../analysis/analyzeSprite';
import { createAnimation, getFrame, updateFrameImage, type Animation } from '../animation';
import type { CharacterModel, SymmetryMode } from '../character/model';
import { DEFAULT_ORDER, type Direction, type SheetGridSettings } from '../directions';
import {
  blitInPlace,
  createRaster,
  findFeet,
  type NormalizedImport,
  type RasterImage,
} from '../sprite';

/**
 * The shared canvas every direction/frame is edited on. All frames have the
 * same size and the same anchor (the point between the feet on the ground
 * line), which is what keeps scale and ground position consistent.
 */
export interface WorkingCell {
  width: number;
  height: number;
  /** Continuous coordinates: anchorX between pixels, anchorY = ground line. */
  anchorX: number;
  anchorY: number;
}

export interface ProjectSetup {
  name: string;
  symmetry: SymmetryMode;
  sourceDirection: Direction;
}

export interface SourceAsset {
  fileName: string;
  sprite: RasterImage;
  import: {
    originalWidth: number;
    originalHeight: number;
    pixelScale: number;
    background: 'transparent' | 'removed' | 'kept';
    backgroundColor: string | null;
    downscaledBy: number;
    pixelArt: boolean;
    warnings: string[];
  };
}

export type TargetResolution = 'original' | '32' | '48' | '64' | '96' | '128' | 'custom';

export interface SheetSettings extends SheetGridSettings {
  target: TargetResolution;
  customWidth: number;
  customHeight: number;
  /** Inner margin between the character and the cell border (cell pixels). */
  padding: number;
  /** Gap between cells on the sheet (cell pixels). */
  spacing: number;
  anchorMode: 'bottom-center' | 'center' | 'custom';
  anchorX: number;
  anchorY: number;
  background: 'transparent' | 'color';
  backgroundColor: string;
  /** Integer multiplier applied to the final sheet. */
  exportScale: number;
  /** Integer scale factors only, hard alpha, no smoothing. */
  pixelPreservation: boolean;
  /** Nearest-neighbour resampling (forced on by pixel preservation). */
  nearestNeighbor: boolean;
  /** feet: re-centre each direction on its feet; as-is: keep the working-cell placement. */
  align: 'feet' | 'as-is';
}

export interface GenerationSettings {
  seed: number;
  symmetryShortcut: boolean;
  includeReferences: boolean;
  promptStyle: 'tags' | 'instruction';
  extraPrompt: string;
  extraNegative: string;
  generationSize: number;
  /** 0…1 — how far a variation may move away from the current view. */
  variationStrength: number;
  scaleMode: 'height' | 'generation' | 'off';
}

export interface Project {
  format: 'sprite8-project';
  version: 1;
  id: string;
  createdAt: number;
  updatedAt: number;
  setup: ProjectSetup;
  source: SourceAsset | null;
  analysis: SpriteAnalysis | null;
  character: CharacterModel | null;
  cell: WorkingCell;
  animations: Animation[];
  activeAnimationId: string;
  sheet: SheetSettings;
  generation: GenerationSettings;
}

export function defaultSheetSettings(pixelArt = true): SheetSettings {
  return {
    grid: '8x1',
    columns: 8,
    rows: 1,
    order: [...DEFAULT_ORDER],
    frameLayout: 'direction-rows',
    target: pixelArt ? 'original' : '128',
    customWidth: 64,
    customHeight: 64,
    padding: 4,
    spacing: 0,
    anchorMode: 'bottom-center',
    anchorX: 32,
    anchorY: 60,
    background: 'transparent',
    backgroundColor: '#20232b',
    exportScale: 1,
    pixelPreservation: pixelArt,
    nearestNeighbor: pixelArt,
    align: 'feet',
  };
}

export function defaultGenerationSettings(): GenerationSettings {
  return {
    seed: Math.floor(Math.random() * 1_000_000),
    symmetryShortcut: false,
    includeReferences: true,
    promptStyle: 'tags',
    extraPrompt: '',
    extraNegative: '',
    generationSize: 512,
    variationStrength: 0.45,
    scaleMode: 'height',
  };
}

let projectCounter = 0;

export function newProjectId(): string {
  projectCounter = (projectCounter + 1) % 1e6;
  return `p${Date.now().toString(36)}${projectCounter.toString(36)}`;
}

export function createEmptyProject(): Project {
  const now = Date.now();
  return {
    format: 'sprite8-project',
    version: 1,
    id: newProjectId(),
    createdAt: now,
    updatedAt: now,
    setup: { name: 'character', symmetry: 'asymmetric', sourceDirection: 'S' },
    source: null,
    analysis: null,
    character: null,
    cell: { width: 64, height: 64, anchorX: 32, anchorY: 60 },
    animations: [createAnimation('idle', 1)],
    activeAnimationId: 'idle',
    sheet: defaultSheetSettings(true),
    generation: defaultGenerationSettings(),
  };
}

/** A square working cell with room around the sprite for other poses. */
export function createWorkingCell(spriteWidth: number, spriteHeight: number): WorkingCell {
  const base = Math.max(spriteHeight * 1.4, spriteWidth * 1.6, 16);
  const size = Math.min(1024, Math.ceil(base / 8) * 8);
  const margin = Math.max(2, Math.round(size * 0.06));
  return { width: size, height: size, anchorX: size / 2, anchorY: size - margin };
}

export interface Placement {
  image: RasterImage;
  clipped: boolean;
}

/** Places a trimmed sprite so its feet centre sits on the cell anchor. */
export function placeOnAnchor(sprite: RasterImage, cell: WorkingCell): Placement {
  const out = createRaster(cell.width, cell.height);
  const feet = findFeet(sprite);
  if (!feet) return { image: out, clipped: false };
  const dx = Math.round(cell.anchorX - feet.feetX);
  const dy = Math.round(cell.anchorY - feet.groundY);
  blitInPlace(out, sprite, dx, dy, 'replace');
  const clipped =
    dx < 0 || dy < 0 || dx + sprite.width > cell.width || dy + sprite.height > cell.height;
  return { image: out, clipped };
}

export function activeAnimation(project: Project): Animation {
  return (
    project.animations.find((a) => a.id === project.activeAnimationId) ?? project.animations[0]
  );
}

export function replaceAnimation(project: Project, anim: Animation): Project {
  return { ...project, animations: project.animations.map((a) => (a.id === anim.id ? anim : a)) };
}

/** New project state after a source image was imported. */
export function projectWithSource(
  project: Project,
  imported: NormalizedImport,
  fileName: string,
): Project {
  const cell = createWorkingCell(imported.sprite.width, imported.sprite.height);
  const anim = createAnimation('idle', 1);
  const placed = placeOnAnchor(imported.sprite, cell);
  const withSource = updateFrameImage(
    anim,
    project.setup.sourceDirection,
    0,
    placed.image,
    'source',
    {
      kind: 'source',
      fileName,
      createdAt: Date.now(),
    },
  );
  const baseName =
    fileName
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'character';
  return {
    ...project,
    updatedAt: Date.now(),
    setup: { ...project.setup, name: baseName.slice(0, 48) },
    source: {
      fileName,
      sprite: imported.sprite,
      import: {
        originalWidth: imported.original.width,
        originalHeight: imported.original.height,
        pixelScale: imported.pixelScale.scale,
        background:
          imported.background.kind === 'transparent'
            ? 'transparent'
            : imported.removedPixels > 0
              ? 'removed'
              : 'kept',
        backgroundColor: imported.background.color
          ? `#${[
              imported.background.color.r,
              imported.background.color.g,
              imported.background.color.b,
            ]
              .map((v) => v.toString(16).padStart(2, '0'))
              .join('')}`
          : null,
        downscaledBy: imported.downscaledBy,
        pixelArt: imported.pixelArt,
        warnings: imported.warnings,
      },
    },
    analysis: null,
    character: null,
    cell,
    animations: [withSource],
    activeAnimationId: withSource.id,
    sheet: {
      ...defaultSheetSettings(imported.pixelArt),
      order: project.sheet.order,
      grid: project.sheet.grid,
    },
  };
}

/**
 * Moves the source sprite to a new source direction. If the old direction
 * still holds the untouched source it is cleared; anything the user edited
 * there is kept.
 */
export function moveSourceDirection(project: Project, direction: Direction): Project {
  const prev = project.setup.sourceDirection;
  if (!project.source)
    return { ...project, setup: { ...project.setup, sourceDirection: direction } };
  let anim = activeAnimation(project);
  if (prev !== direction) {
    const old = getFrame(anim, prev, 0);
    if (old?.status === 'source') anim = updateFrameImage(anim, prev, 0, null, 'empty', null);
  }
  const placed = placeOnAnchor(project.source.sprite, project.cell);
  anim = updateFrameImage(anim, direction, 0, placed.image, 'source', {
    kind: 'source',
    fileName: project.source.fileName,
    createdAt: Date.now(),
  });
  return replaceAnimation(
    { ...project, setup: { ...project.setup, sourceDirection: direction } },
    anim,
  );
}
