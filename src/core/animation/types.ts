import type { Direction } from '../directions';
import type { RasterImage } from '../sprite';

/**
 * Animation System data model.
 *
 *   Animation (idle, walk, run, attack, skate, hurt, death, custom)
 *   └── one DirectionTrack per direction (N … NW)
 *       └── frames[] — every track always has the same number of frames
 *
 * Version 0.1 uses a single "idle" animation with one frame per direction,
 * but every module (generation, editor, exporter, storage) already works on
 * (animation, direction, frame) so walk cycles etc. slot in without changes.
 */
export type AnimationKind =
  'idle' | 'walk' | 'run' | 'attack' | 'skate' | 'hurt' | 'death' | 'custom';

export const ANIMATION_KIND_LABELS: Record<AnimationKind, string> = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
  attack: 'Attack',
  skate: 'Skate',
  hurt: 'Hurt',
  death: 'Death',
  custom: 'Custom',
};

/** How a frame's pixels came to be. Shown as a badge on every direction cell. */
export type FrameStatus = 'empty' | 'source' | 'guide' | 'ai' | 'mirror' | 'imported' | 'edited';

export const FRAME_STATUS_LABELS: Record<FrameStatus, string> = {
  empty: 'Empty',
  source: 'Source',
  guide: 'Guide only',
  ai: 'AI generated',
  mirror: 'Mirrored',
  imported: 'Imported',
  edited: 'Edited',
};

export interface FrameOrigin {
  kind: Exclude<FrameStatus, 'empty' | 'edited'> | 'manual';
  providerId?: string;
  providerLabel?: string;
  seed?: number;
  prompt?: string;
  mirroredFrom?: Direction;
  fileName?: string;
  createdAt: number;
  notes?: string[];
}

export interface Frame {
  id: string;
  /** Working-cell sized image, or null when nothing has been drawn/generated. */
  image: RasterImage | null;
  status: FrameStatus;
  origin: FrameOrigin | null;
  /** Per-frame duration override (ms). */
  durationMs?: number;
}

export interface DirectionTrack {
  direction: Direction;
  frames: Frame[];
  /** Locked tracks are skipped by "Generate all". */
  locked: boolean;
}

export interface Animation {
  id: string;
  name: string;
  kind: AnimationKind;
  fps: number;
  loop: boolean;
  tracks: Record<Direction, DirectionTrack>;
}

export interface FrameRef {
  animationId: string;
  direction: Direction;
  frame: number;
}
