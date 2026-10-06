import type { Animation, FrameRef } from '../animation';
import { DIRECTIONS } from '../directions';
import type { RasterImage } from '../sprite';
import type { WorkingCell } from './project';

/**
 * Undo/redo via immutable document snapshots. Frames and rasters are never
 * mutated, so a snapshot only costs the objects that actually changed —
 * regenerating NE shares every other direction's pixels with the previous
 * snapshot.
 */
export interface DocState {
  cell: WorkingCell;
  animations: Animation[];
}

export interface HistoryEntry {
  label: string;
  doc: DocState;
}

export interface HistoryState {
  past: HistoryEntry[];
  future: HistoryEntry[];
}

export const EMPTY_HISTORY: HistoryState = { past: [], future: [] };

export interface HistoryLimits {
  maxEntries: number;
  maxBytes: number;
}

export const DEFAULT_HISTORY_LIMITS: HistoryLimits = { maxEntries: 200, maxBytes: 192 * 1024 * 1024 };

function collectRasters(doc: DocState, into: Set<RasterImage>): void {
  for (const anim of doc.animations) {
    for (const d of DIRECTIONS) {
      for (const f of anim.tracks[d].frames) if (f.image) into.add(f.image);
    }
  }
}

export function historyBytes(history: HistoryState): number {
  const set = new Set<RasterImage>();
  for (const e of history.past) collectRasters(e.doc, set);
  for (const e of history.future) collectRasters(e.doc, set);
  let bytes = 0;
  for (const r of set) bytes += r.data.byteLength;
  return bytes;
}

/** Records `before` (the state prior to an action called `label`). Clears redo. */
export function pushHistory(
  history: HistoryState,
  before: DocState,
  label: string,
  limits: HistoryLimits = DEFAULT_HISTORY_LIMITS,
): HistoryState {
  let past = [...history.past, { label, doc: before }];
  if (past.length > limits.maxEntries) past = past.slice(past.length - limits.maxEntries);
  let next: HistoryState = { past, future: [] };
  while (next.past.length > 1 && historyBytes(next) > limits.maxBytes) {
    next = { past: next.past.slice(1), future: [] };
  }
  return next;
}

export function undoHistory(history: HistoryState, current: DocState): { history: HistoryState; doc: DocState; label: string } | null {
  const entry = history.past[history.past.length - 1];
  if (!entry) return null;
  return {
    history: { past: history.past.slice(0, -1), future: [{ label: entry.label, doc: current }, ...history.future] },
    doc: entry.doc,
    label: entry.label,
  };
}

export function redoHistory(history: HistoryState, current: DocState): { history: HistoryState; doc: DocState; label: string } | null {
  const entry = history.future[0];
  if (!entry) return null;
  return {
    history: { past: [...history.past, { label: entry.label, doc: current }], future: history.future.slice(1) },
    doc: entry.doc,
    label: entry.label,
  };
}

/** Frames whose identity differs between two document states (for focusing the UI after undo). */
export function changedFrames(a: DocState, b: DocState): FrameRef[] {
  const out: FrameRef[] = [];
  for (const animB of b.animations) {
    const animA = a.animations.find((x) => x.id === animB.id);
    for (const d of DIRECTIONS) {
      const fb = animB.tracks[d].frames;
      const fa = animA?.tracks[d].frames ?? [];
      const n = Math.max(fa.length, fb.length);
      for (let i = 0; i < n; i++) {
        if (fa[i] !== fb[i]) out.push({ animationId: animB.id, direction: d, frame: Math.min(i, fb.length - 1) });
      }
    }
  }
  return out;
}
