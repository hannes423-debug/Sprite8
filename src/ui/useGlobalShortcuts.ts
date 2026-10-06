import { useEffect } from 'react';
import { redo, undo } from '../app/actions/document';
import { importDirectionFile } from '../app/actions/frames';
import { generateAll, regenerate } from '../app/actions/generation';
import { importSourceFile, openProjectFile, saveProjectFile } from '../app/actions/project';
import { openDialog, openEditor, selectDirection, toast } from '../app/actions/ui';
import { getState } from '../app/store';
import { DIRECTIONS, directionInfo, type Direction } from '../core/directions';

export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function compassStep(from: Direction, dx: number, dy: number): Direction {
  const { col, row } = directionInfo(from).compass;
  let c = col + dx;
  let r = row + dy;
  if (c === 1 && r === 1) {
    c += dx;
    r += dy;
  }
  c = Math.max(0, Math.min(2, c));
  r = Math.max(0, Math.min(2, r));
  return (
    DIRECTIONS.find(
      (d) => directionInfo(d).compass.col === c && directionInfo(d).compass.row === r,
    ) ?? from
  );
}

/** Keyboard shortcuts and clipboard paste for the main screen (the editor has its own). */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { ui } = getState();
      if (ui.editorOpen || ui.dialog || isTypingTarget(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key;
      if (mod && key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && key.toLowerCase() === 's') {
        e.preventDefault();
        void saveProjectFile();
        return;
      }
      if (mod && key.toLowerCase() === 'o') {
        e.preventDefault();
        void openProjectFile();
        return;
      }
      if (mod || e.altKey) return;
      if (/^[1-8]$/.test(key)) {
        selectDirection(DIRECTIONS[Number(key) - 1]);
        return;
      }
      const arrows: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      if (
        arrows[key] &&
        !(e.target instanceof HTMLButtonElement && e.target.closest('[role="radiogroup"]'))
      ) {
        e.preventDefault();
        const next = compassStep(ui.selected, ...arrows[key]);
        selectDirection(next);
        document
          .querySelector<HTMLElement>(`[data-testid="cell-${next}"]`)
          ?.focus({ preventScroll: true });
        return;
      }
      if (
        key === 'Enter' &&
        (e.target === document.body || (e.target as HTMLElement).classList?.contains('dir-cell'))
      ) {
        e.preventDefault();
        openEditor();
        return;
      }
      if (key === 'e' && getState().project.source) {
        openEditor();
        return;
      }
      if (key === 'R' && e.shiftKey) {
        void regenerate(ui.selected);
        return;
      }
      if (key === 'G' && e.shiftKey) {
        void generateAll();
        return;
      }
      if (key === '?') openDialog({ kind: 'help' });
    };
    const onPaste = (e: ClipboardEvent) => {
      const { ui, project } = getState();
      if (ui.editorOpen || ui.dialog || isTypingTarget(e.target)) return;
      const file = Array.from(e.clipboardData?.files ?? []).find((f) =>
        f.type.startsWith('image/'),
      );
      if (!file) return;
      e.preventDefault();
      if (!project.source) void importSourceFile(file);
      else {
        void importDirectionFile(ui.selected, file);
        toast(
          'info',
          `Pasted image into ${ui.selected}.`,
          'Undo with Ctrl+Z. To replace the source instead, use "Replace" in the Source panel.',
        );
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('paste', onPaste);
    };
  }, []);
}
