import type { AppSettings } from '../../core/storage';
import type { GenerationSettings } from '../../core/project';
import { store } from '../store';
import { updateProject } from './document';

export function updateUiSettings(patch: Partial<AppSettings['ui']>): void {
  store.setState((s) => ({ ...s, settings: { ...s.settings, ui: { ...s.settings.ui, ...patch } } }));
}

export function updateEditorSettings(patch: Partial<AppSettings['editor']>): void {
  store.setState((s) => ({ ...s, settings: { ...s.settings, editor: { ...s.settings.editor, ...patch } } }));
}

export function updateGeneration(patch: Partial<GenerationSettings>): void {
  updateProject((p) => ({ ...p, generation: { ...p.generation, ...patch } }));
}
