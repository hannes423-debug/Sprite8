import type { Direction } from '../../core/directions';
import { getState, setUi, type DialogState, type Toast } from '../store';

let toastId = 0;

export function toast(kind: Toast['kind'], message: string, detail?: string, ttlMs?: number): void {
  const id = ++toastId;
  setUi((ui) => ({ toasts: [...ui.toasts.slice(-4), { id, kind, message, detail }] }));
  const ttl = ttlMs ?? (kind === 'error' ? 9000 : kind === 'warn' ? 7000 : 3500);
  setTimeout(() => dismissToast(id), ttl);
}

export function dismissToast(id: number): void {
  setUi((ui) => ({ toasts: ui.toasts.filter((t) => t.id !== id) }));
}

export function errorToast(err: unknown, fallback = 'Something went wrong.'): void {
  const e = err as { message?: string; hint?: string };
  toast('error', e?.message || fallback, e?.hint);
}

export function openDialog(dialog: Exclude<DialogState, { kind: 'confirm' }>): void {
  setUi({ dialog });
}

export function closeDialog(): void {
  setUi({ dialog: null });
}

/** Promise-based confirmation dialog. */
export function confirmDialog(opts: {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  extraLabel?: string;
}): Promise<'confirm' | 'extra' | 'cancel'> {
  return new Promise((resolve) => {
    setUi({
      dialog: {
        kind: 'confirm',
        title: opts.title,
        message: opts.message,
        confirmLabel: opts.confirmLabel ?? 'OK',
        danger: opts.danger,
        extraLabel: opts.extraLabel,
        resolve: (choice) => {
          setUi({ dialog: null });
          resolve(choice);
        },
      },
    });
  });
}

export function selectDirection(direction: Direction): void {
  if (getState().ui.selected !== direction) setUi({ selected: direction });
}

export function openEditor(direction?: Direction): void {
  // Notifications about the main screen would only cover the canvas.
  setUi((ui) => ({ editorOpen: true, selected: direction ?? ui.selected, toasts: [] }));
}

export function closeEditor(): void {
  setUi({ editorOpen: false });
}
