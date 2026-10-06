import { DIRECTIONS, type Direction } from '../directions';
import type { RasterImage } from '../sprite';
import {
  ANIMATION_KIND_LABELS,
  type Animation,
  type AnimationKind,
  type DirectionTrack,
  type Frame,
} from './types';

let frameCounter = 0;

export function newFrameId(): string {
  frameCounter = (frameCounter + 1) % 1e6;
  return `fr${Date.now().toString(36)}${frameCounter.toString(36)}`;
}

export function emptyFrame(): Frame {
  return { id: newFrameId(), image: null, status: 'empty', origin: null };
}

export function createAnimation(kind: AnimationKind = 'idle', frames = 1, id?: string): Animation {
  const tracks = {} as Record<Direction, DirectionTrack>;
  for (const direction of DIRECTIONS) {
    tracks[direction] = {
      direction,
      frames: Array.from({ length: Math.max(1, frames) }, () => emptyFrame()),
      locked: false,
    };
  }
  return {
    id: id ?? kind,
    name: ANIMATION_KIND_LABELS[kind],
    kind,
    fps: kind === 'idle' ? 4 : 8,
    loop: kind !== 'death',
    tracks,
  };
}

export function frameCount(anim: Animation): number {
  return anim.tracks.N.frames.length;
}

export function getFrame(anim: Animation, direction: Direction, frame: number): Frame | null {
  return anim.tracks[direction].frames[frame] ?? null;
}

/** Immutable update of one frame — every other frame keeps its identity. */
export function setFrame(
  anim: Animation,
  direction: Direction,
  frame: number,
  value: Frame,
): Animation {
  const track = anim.tracks[direction];
  if (frame < 0 || frame >= track.frames.length) throw new Error(`Frame ${frame} out of range`);
  const frames = track.frames.slice();
  frames[frame] = value;
  return { ...anim, tracks: { ...anim.tracks, [direction]: { ...track, frames } } };
}

export function updateFrameImage(
  anim: Animation,
  direction: Direction,
  frame: number,
  image: RasterImage | null,
  status: Frame['status'],
  origin: Frame['origin'],
): Animation {
  const current = getFrame(anim, direction, frame);
  return setFrame(anim, direction, frame, {
    id: current?.id ?? newFrameId(),
    image,
    status,
    origin,
    durationMs: current?.durationMs,
  });
}

export function setTrackLocked(anim: Animation, direction: Direction, locked: boolean): Animation {
  const track = anim.tracks[direction];
  return { ...anim, tracks: { ...anim.tracks, [direction]: { ...track, locked } } };
}

/** Inserts a frame after `index` in every direction (duplicating or empty). */
export function insertFrame(anim: Animation, index: number, duplicate: boolean): Animation {
  const tracks = { ...anim.tracks };
  for (const direction of DIRECTIONS) {
    const track = anim.tracks[direction];
    const src = track.frames[Math.max(0, Math.min(index, track.frames.length - 1))];
    const copy: Frame =
      duplicate && src
        ? {
            ...src,
            id: newFrameId(),
            status: src.image ? 'edited' : 'empty',
            origin: src.origin ? { ...src.origin } : null,
          }
        : emptyFrame();
    const frames = track.frames.slice();
    frames.splice(index + 1, 0, copy);
    tracks[direction] = { ...track, frames };
  }
  return { ...anim, tracks };
}

/** Removes frame `index` from every direction (keeps at least one frame). */
export function removeFrame(anim: Animation, index: number): Animation {
  if (frameCount(anim) <= 1) return anim;
  const tracks = { ...anim.tracks };
  for (const direction of DIRECTIONS) {
    const track = anim.tracks[direction];
    tracks[direction] = { ...track, frames: track.frames.filter((_, i) => i !== index) };
  }
  return { ...anim, tracks };
}

/** Directions whose given frame has pixels. */
export function directionsWithContent(anim: Animation, frame = 0): Set<Direction> {
  const out = new Set<Direction>();
  for (const d of DIRECTIONS) {
    const f = anim.tracks[d].frames[frame];
    if (f?.image && f.status !== 'empty') out.add(d);
  }
  return out;
}

/** Index of the frame to show at time `ms` for playback previews. */
export function frameAtTime(anim: Animation, ms: number): number {
  const count = frameCount(anim);
  if (count <= 1) return 0;
  const frameMs = 1000 / Math.max(1, anim.fps);
  const i = Math.floor(ms / frameMs);
  return anim.loop ? i % count : Math.min(count - 1, i);
}
