import { useSyncExternalStore } from 'react';
import type { Direction } from '../core/directions';
import { createEmptyProject, EMPTY_HISTORY, type HistoryState, type Project } from '../core/project';
import type { ProviderStatus } from '../core/providers';
import { loadSettings, type AppSettings } from '../core/storage';

export interface Job {
  state: 'queued' | 'running' | 'done' | 'error';
  progress: number;
  message?: string;
  error?: string;
  hint?: string;
}

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'warn' | 'error';
  message: string;
  detail?: string;
}

export type DialogState =
  | { kind: 'provider' }
  | { kind: 'help' }
  | {
      kind: 'confirm';
      title: string;
      message: string;
      confirmLabel: string;
      danger?: boolean;
      extraLabel?: string;
      resolve: (choice: 'confirm' | 'extra' | 'cancel') => void;
    };

export interface UiState {
  selected: Direction;
  frame: number;
  editorOpen: boolean;
  jobs: Partial<Record<Direction, Job>>;
  generating: boolean;
  analyzing: boolean;
  busy: string | null;
  toasts: Toast[];
  dialog: DialogState | null;
  providerStatus: { checking: boolean; status: ProviderStatus | null };
  restored: boolean;
  lastSavedAt: number | null;
}

export interface AppState {
  project: Project;
  history: HistoryState;
  settings: AppSettings;
  ui: UiState;
}

function initialState(): AppState {
  return {
    project: createEmptyProject(),
    history: EMPTY_HISTORY,
    settings: loadSettings(),
    ui: {
      selected: 'S',
      frame: 0,
      editorOpen: false,
      jobs: {},
      generating: false,
      analyzing: false,
      busy: null,
      toasts: [],
      dialog: null,
      providerStatus: { checking: false, status: null },
      restored: false,
      lastSavedAt: null,
    },
  };
}

type Listener = () => void;

/** Minimal external store: immutable state, synchronous notifications. */
class Store<T> {
  private state: T;
  private readonly listeners = new Set<Listener>();

  constructor(state: T) {
    this.state = state;
  }

  getState = (): T => this.state;

  setState = (updater: (s: T) => T): void => {
    const next = updater(this.state);
    if (Object.is(next, this.state)) return;
    this.state = next;
    for (const l of [...this.listeners]) l();
  };

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

export const store = new Store<AppState>(initialState());

/** Subscribes a component to a slice of the state. Selectors must return stable references. */
export function useAppState<S>(selector: (s: AppState) => S): S {
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}

export function getState(): AppState {
  return store.getState();
}

export function setUi(patch: Partial<UiState> | ((ui: UiState) => Partial<UiState>)): void {
  store.setState((s) => ({ ...s, ui: { ...s.ui, ...(typeof patch === 'function' ? patch(s.ui) : patch) } }));
}

export function setJob(direction: Direction, job: Job | null): void {
  store.setState((s) => {
    const jobs = { ...s.ui.jobs };
    if (job) jobs[direction] = job;
    else delete jobs[direction];
    return { ...s, ui: { ...s.ui, jobs } };
  });
}
