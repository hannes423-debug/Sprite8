import { DEFAULT_PROVIDER_ID } from '../providers/registry';
import type { ProviderSettings } from '../providers/types';

/** Machine-specific preferences (provider URLs, UI toggles) kept in localStorage. */
export interface AppSettings {
  version: 1;
  providerId: string;
  providers: Record<string, ProviderSettings>;
  ui: {
    gridMode: 'compass' | 'sheet';
    showGuides: boolean;
    showSideMarkers: boolean;
  };
  editor: {
    showGrid: boolean;
    onion: boolean;
    onionOpacity: number;
    brushSize: number;
    mirrorPaint: boolean;
  };
}

export const SETTINGS_KEY = 'sprite8.settings.v1';

export function defaultAppSettings(): AppSettings {
  return {
    version: 1,
    providerId: DEFAULT_PROVIDER_ID,
    providers: {},
    ui: { gridMode: 'compass', showGuides: true, showSideMarkers: true },
    editor: { showGrid: true, onion: false, onionOpacity: 0.35, brushSize: 1, mirrorPaint: false },
  };
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStore(): KeyValueStore | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null; // e.g. storage disabled in private mode
  }
}

export function loadSettings(store: KeyValueStore | null = defaultStore()): AppSettings {
  const defaults = defaultAppSettings();
  if (!store) return defaults;
  try {
    const raw = store.getItem(SETTINGS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      version: 1,
      providerId: typeof parsed.providerId === 'string' ? parsed.providerId : defaults.providerId,
      providers: parsed.providers && typeof parsed.providers === 'object' ? parsed.providers : {},
      ui: { ...defaults.ui, ...(parsed.ui ?? {}) },
      editor: { ...defaults.editor, ...(parsed.editor ?? {}) },
    };
  } catch {
    return defaults;
  }
}

export function saveSettings(settings: AppSettings, store: KeyValueStore | null = defaultStore()): void {
  try {
    store?.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* quota or privacy mode — settings simply are not persisted */
  }
}
