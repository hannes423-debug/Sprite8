import type { Project } from '../project/project';
import { openKeyValueDb, type KeyValueDb } from './idb';
import { normalizeProject } from './normalize';

/**
 * Autosave of the current project in IndexedDB. Rasters are stored as raw
 * typed arrays (structured clone) — no encoding cost, nothing leaves the
 * browser.
 */
const DB_NAME = 'sprite8';
const STORE = 'projects';
const META = 'meta';
const CURRENT_KEY = 'current-project-id';

let dbPromise: Promise<KeyValueDb> | null = null;

function db(): Promise<KeyValueDb> {
  dbPromise ??= openKeyValueDb(DB_NAME, [STORE, META]);
  return dbPromise;
}

export async function saveProject(project: Project): Promise<void> {
  const d = await db();
  await d.put(STORE, project.id, project);
  await d.put(META, CURRENT_KEY, project.id);
}

export async function loadCurrentProject(): Promise<Project | null> {
  const d = await db();
  const id = await d.get<string>(META, CURRENT_KEY);
  if (!id) return null;
  const raw = await d.get<unknown>(STORE, id);
  if (!raw) return null;
  return normalizeProject(raw);
}

export async function deleteProject(id: string): Promise<void> {
  const d = await db();
  await d.delete(STORE, id);
  if ((await d.get<string>(META, CURRENT_KEY)) === id) await d.delete(META, CURRENT_KEY);
}

export async function clearCurrentProject(): Promise<void> {
  const d = await db();
  const id = await d.get<string>(META, CURRENT_KEY);
  if (id) await d.delete(STORE, id);
  await d.delete(META, CURRENT_KEY);
}
