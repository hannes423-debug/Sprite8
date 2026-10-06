import { loadCurrentProject, saveProject, saveSettings } from '../../core/storage';
import { getState, setUi, store } from '../store';
import { toast } from './ui';

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastSavedProject: unknown = null;
let storageBroken = false;

async function flushSave(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const { project } = getState();
  if (project === lastSavedProject || storageBroken) return;
  lastSavedProject = project;
  if (!project.source) return;
  try {
    await saveProject(project);
    setUi({ lastSavedAt: Date.now() });
  } catch (err) {
    storageBroken = true;
    toast(
      'warn',
      'Autosave is not available in this browser.',
      `${(err as Error).message} Use "Save project" to keep your work.`,
    );
  }
}

/** Restores the last session and keeps it autosaved (IndexedDB) from then on. */
export async function initPersistence(): Promise<void> {
  try {
    const restored = await loadCurrentProject();
    if (restored && !getState().project.source) {
      lastSavedProject = restored;
      store.setState((s) => ({
        ...s,
        project: restored,
        ui: { ...s.ui, selected: restored.setup.sourceDirection },
      }));
      toast('info', `Restored “${restored.setup.name}” from your last session.`, undefined, 2500);
    }
  } catch {
    /* no IndexedDB (private mode) — start fresh */
  }
  setUi({ restored: true });

  let lastProject = getState().project;
  let lastSettings = getState().settings;
  store.subscribe(() => {
    const s = getState();
    if (s.project !== lastProject) {
      lastProject = s.project;
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => void flushSave(), 1200);
    }
    if (s.settings !== lastSettings) {
      lastSettings = s.settings;
      saveSettings(s.settings);
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushSave();
  });
  window.addEventListener('pagehide', () => void flushSave());
}
