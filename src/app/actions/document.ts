import {
  changedFrames,
  pushHistory,
  redoHistory,
  undoHistory,
  type DocState,
  type Project,
} from '../../core/project';
import { getState, setUi, store } from '../store';
import { toast } from './ui';

/** Changes that are not part of undo history (settings, character model, sheet options). */
export function updateProject(updater: (p: Project) => Project): void {
  store.setState((s) => {
    const project = updater(s.project);
    return project === s.project ? s : { ...s, project: { ...project, updatedAt: Date.now() } };
  });
}

function docOf(p: Project): DocState {
  return { cell: p.cell, animations: p.animations };
}

/**
 * Applies a change to the document (pixels, frames, canvas) and records an
 * undo step. Images are immutable, so the snapshot only references them.
 */
export function commitDoc(label: string, updater: (p: Project) => Project): void {
  store.setState((s) => {
    const next = updater(s.project);
    if (next === s.project) return s;
    if (next.cell === s.project.cell && next.animations === s.project.animations) {
      return { ...s, project: { ...next, updatedAt: Date.now() } };
    }
    return {
      ...s,
      project: { ...next, updatedAt: Date.now() },
      history: pushHistory(s.history, docOf(s.project), label),
    };
  });
}

/**
 * Records the current document as one undo step before a multi-step operation
 * (e.g. "generate all"), whose individual changes are then applied without
 * history. Returns a function that removes the step again if nothing changed.
 */
export function pushUndoPoint(label: string): () => void {
  const before = getState().project.animations;
  const beforeCell = getState().project.cell;
  store.setState((s) => ({ ...s, history: pushHistory(s.history, docOf(s.project), label) }));
  const entry = getState().history.past.at(-1);
  return () => {
    const s = getState();
    if (s.project.animations !== before || s.project.cell !== beforeCell) return;
    if (s.history.past.at(-1) === entry)
      store.setState((st) => ({
        ...st,
        history: { ...st.history, past: st.history.past.slice(0, -1) },
      }));
  };
}

function restore(kind: 'undo' | 'redo'): void {
  const s = getState();
  const current = docOf(s.project);
  const res = kind === 'undo' ? undoHistory(s.history, current) : redoHistory(s.history, current);
  if (!res) {
    toast('info', kind === 'undo' ? 'Nothing to undo.' : 'Nothing to redo.', undefined, 1500);
    return;
  }
  const changed = changedFrames(current, res.doc);
  store.setState((st) => ({
    ...st,
    project: {
      ...st.project,
      cell: res.doc.cell,
      animations: res.doc.animations,
      updatedAt: Date.now(),
    },
    history: res.history,
  }));
  if (changed.length === 1) setUi({ selected: changed[0].direction });
  toast('info', `${kind === 'undo' ? 'Undid' : 'Redid'}: ${res.label}`, undefined, 1800);
}

export function undo(): void {
  restore('undo');
}

export function redo(): void {
  restore('redo');
}
