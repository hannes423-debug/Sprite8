import { createAnimation, type Animation, type DirectionTrack, type Frame } from '../animation';
import { createCharacterModel } from '../character/createModel';
import type { CharacterModel } from '../character/model';
import { DIRECTIONS, isDirection, normalizeOrder } from '../directions';
import {
  createEmptyProject,
  defaultGenerationSettings,
  defaultSheetSettings,
  type Project,
} from '../project/project';
import type { RasterImage } from '../sprite';

function isRaster(v: unknown): v is RasterImage {
  const r = v as RasterImage;
  return !!r && typeof r.width === 'number' && typeof r.height === 'number' && r.data instanceof Uint8ClampedArray && r.data.length === r.width * r.height * 4;
}

function normalizeFrame(raw: unknown): Frame {
  const f = (raw ?? {}) as Partial<Frame>;
  const image = isRaster(f.image) ? f.image : null;
  return {
    id: typeof f.id === 'string' ? f.id : `fr${Math.random().toString(36).slice(2)}`,
    image,
    status: image ? (f.status ?? 'edited') : f.status === 'guide' ? 'guide' : 'empty',
    origin: f.origin ?? null,
    durationMs: typeof f.durationMs === 'number' ? f.durationMs : undefined,
  };
}

function normalizeAnimation(raw: unknown): Animation {
  const a = (raw ?? {}) as Partial<Animation>;
  const base = createAnimation(a.kind ?? 'idle', 1, typeof a.id === 'string' ? a.id : undefined);
  const tracks = {} as Record<(typeof DIRECTIONS)[number], DirectionTrack>;
  let count = 1;
  for (const d of DIRECTIONS) count = Math.max(count, a.tracks?.[d]?.frames?.length ?? 0);
  for (const d of DIRECTIONS) {
    const t = a.tracks?.[d];
    const frames = Array.from({ length: count }, (_, i) => normalizeFrame(t?.frames?.[i]));
    tracks[d] = { direction: d, frames, locked: !!t?.locked };
  }
  return {
    ...base,
    name: typeof a.name === 'string' ? a.name : base.name,
    fps: typeof a.fps === 'number' && a.fps > 0 ? a.fps : base.fps,
    loop: typeof a.loop === 'boolean' ? a.loop : base.loop,
    tracks,
  };
}

/**
 * Validates a project loaded from storage or a file and fills in defaults
 * for anything missing, so older or hand-edited files keep working.
 */
export function normalizeProject(raw: unknown): Project {
  const p = (raw ?? {}) as Partial<Project>;
  if (p.format !== 'sprite8-project') throw new Error('This is not a Sprite8 project.');
  if (typeof p.version === 'number' && p.version > 1) {
    throw new Error(`This project was saved by a newer Sprite8 (format v${p.version}). Please update Sprite8.`);
  }
  const empty = createEmptyProject();
  const pixelArt = p.source?.import?.pixelArt ?? p.sheet?.pixelPreservation ?? true;
  const animations = Array.isArray(p.animations) && p.animations.length ? p.animations.map(normalizeAnimation) : empty.animations;
  const source = p.source && isRaster(p.source.sprite) ? p.source : null;
  let character: CharacterModel | null = p.character ?? null;
  if (character && source && p.analysis) {
    // Fill fields added by newer versions while keeping everything stored.
    const fresh = createCharacterModel(source.sprite, p.analysis, character);
    character = {
      ...fresh,
      ...character,
      style: { ...fresh.style, ...character.style },
      locks: { ...fresh.locks, ...character.locks },
      proportions: { ...fresh.proportions, ...character.proportions },
      colors: { ...fresh.colors, ...character.colors },
      anatomy: { ...fresh.anatomy, ...character.anatomy },
      features: Array.isArray(character.features) ? character.features : [],
    };
  }
  return {
    ...empty,
    id: typeof p.id === 'string' ? p.id : empty.id,
    createdAt: typeof p.createdAt === 'number' ? p.createdAt : empty.createdAt,
    updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : empty.updatedAt,
    setup: {
      name: typeof p.setup?.name === 'string' && p.setup.name ? p.setup.name : empty.setup.name,
      symmetry: p.setup?.symmetry === 'symmetric' ? 'symmetric' : 'asymmetric',
      sourceDirection: isDirection(p.setup?.sourceDirection) ? p.setup.sourceDirection : 'S',
    },
    source,
    analysis: p.analysis ?? null,
    character,
    cell: p.cell && p.cell.width > 0 && p.cell.height > 0 ? p.cell : empty.cell,
    animations,
    activeAnimationId: animations.some((a) => a.id === p.activeAnimationId) ? p.activeAnimationId! : animations[0].id,
    sheet: { ...defaultSheetSettings(pixelArt), ...(p.sheet ?? {}), order: normalizeOrder(p.sheet?.order) },
    generation: { ...defaultGenerationSettings(), ...(p.generation ?? {}) },
  };
}
