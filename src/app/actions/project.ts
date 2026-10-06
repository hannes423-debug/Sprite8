import { analyzeSprite } from '../../core/analysis';
import { activeAnimation, createEmptyProject, EMPTY_HISTORY, moveSourceDirection, projectWithSource, replaceAnimation, type Project } from '../../core/project';
import { updateFrameImage } from '../../core/animation';
import { characterReference, createCharacterModel, createFeature, type CharacterFeature, type CharacterModel, type SymmetryMode } from '../../core/character';
import { DIRECTIONS, type Direction } from '../../core/directions';
import { getProvider, resolveProviderSettings } from '../../core/providers';
import { normalizeImport, type RasterImage } from '../../core/sprite';
import { clearCurrentProject, deserializeProject, serializeProject } from '../../core/storage';
import { browserCodec, decodeImage } from '../../platform/canvas';
import { downloadBlob, pickFiles } from '../../platform/files';
import { getState, setUi, store } from '../store';
import { commitDoc, updateProject } from './document';
import { confirmDialog, errorToast, toast } from './ui';

export interface ExampleHints {
  name: string;
  symmetry: SymmetryMode;
  sourceDirection: Direction;
  description: string;
  features: Array<Omit<CharacterFeature, 'id'>>;
}

/** Hints applied on the first analysis of an example character (in-memory only). */
const pendingHints = new Map<string, ExampleHints>();

function hasManualWork(p: Project): boolean {
  const anim = activeAnimation(p);
  return DIRECTIONS.some((d) => anim.tracks[d].frames.some((f) => f.image && f.status !== 'source' && f.status !== 'guide'));
}

/** Replaces the project with a new character built from `raster`. */
export async function importSourceRaster(raster: RasterImage, fileName: string, hints?: ExampleHints): Promise<boolean> {
  const current = getState().project;
  if (hasManualWork(current)) {
    const choice = await confirmDialog({
      title: 'Start a new character?',
      message: 'Loading a new source image replaces all eight directions of the current character. Save a project file first if you want to keep it.',
      confirmLabel: 'Replace character',
      danger: true,
    });
    if (choice !== 'confirm') return false;
  }
  const imported = normalizeImport(raster, { maxDimension: 512 });
  if (imported.sprite.width === 0 || imported.warnings.some((w) => w.includes('empty'))) {
    toast('error', 'No character found in this image.', 'The image seems to be empty after removing its background.');
    return false;
  }
  const base = createEmptyProject();
  const setup = hints
    ? { name: hints.name, symmetry: hints.symmetry, sourceDirection: hints.sourceDirection }
    : { ...base.setup, symmetry: current.setup.symmetry, sourceDirection: current.setup.sourceDirection };
  let project = projectWithSource({ ...base, setup }, imported, fileName);
  if (hints) {
    project = { ...project, setup: { ...project.setup, name: hints.name } };
    pendingHints.set(project.id, hints);
  }
  store.setState((s) => ({
    ...s,
    project,
    history: EMPTY_HISTORY,
    ui: { ...s.ui, selected: project.setup.sourceDirection, frame: 0, jobs: {}, editorOpen: false },
  }));
  const info = imported.warnings.filter((w) => !w.startsWith('Removed a solid'));
  toast('success', `Loaded ${fileName} (${imported.sprite.width}×${imported.sprite.height}${imported.pixelArt ? ', pixel art' : ''}).`, info.join(' ') || undefined);
  return true;
}

export async function importSourceFile(file: File): Promise<void> {
  setUi({ busy: 'Reading image…' });
  try {
    const raster = await decodeImage(file);
    await importSourceRaster(raster, file.name);
  } catch (err) {
    errorToast(err, 'Could not load this image.');
  } finally {
    setUi({ busy: null });
  }
}

export async function chooseSourceFile(): Promise<void> {
  const [file] = await pickFiles('image/*');
  if (file) await importSourceFile(file);
}

export async function loadExample(url: string, fileName: string, hints: ExampleHints): Promise<void> {
  setUi({ busy: 'Loading example…' });
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not load the example (${res.status}).`);
    await importSourceRaster(await decodeImage(await res.blob()), fileName, hints);
  } catch (err) {
    errorToast(err);
  } finally {
    setUi({ busy: null });
  }
}

export async function setSymmetry(mode: SymmetryMode): Promise<void> {
  const p = getState().project;
  if (p.setup.symmetry === mode) return;
  updateProject((pr) => ({ ...pr, setup: { ...pr.setup, symmetry: mode } }));
  if (mode === 'asymmetric') {
    const anim = activeAnimation(p);
    const mirrored = DIRECTIONS.filter((d) => anim.tracks[d].frames.some((f) => f.status === 'mirror'));
    if (mirrored.length) {
      const choice = await confirmDialog({
        title: 'Remove mirrored views?',
        message: `${mirrored.join(', ')} ${mirrored.length === 1 ? 'was' : 'were'} created by mirroring. For an asymmetric character a mirrored view has the wrong hand and one-sided details on the wrong side.`,
        confirmLabel: 'Clear mirrored views',
        extraLabel: 'Keep them',
      });
      if (choice === 'confirm') {
        commitDoc('Clear mirrored views', (pr) => {
          let a = activeAnimation(pr);
          for (const d of mirrored) {
            a.tracks[d].frames.forEach((f, i) => {
              if (f.status === 'mirror') a = updateFrameImage(a, d, i, null, 'empty', null);
            });
          }
          return replaceAnimation(pr, a);
        });
      }
    }
  }
  if (getState().project.character) refreshAnalysis();
}

export async function setSourceDirection(direction: Direction): Promise<void> {
  const p = getState().project;
  if (p.setup.sourceDirection === direction) return;
  const target = activeAnimation(p).tracks[direction].frames[0];
  if (p.source && target?.image && target.status !== 'source' && target.status !== 'guide') {
    const choice = await confirmDialog({
      title: `Use ${direction} as the source direction?`,
      message: `${direction} already has an image. It will be replaced by the source sprite.`,
      confirmLabel: 'Replace',
    });
    if (choice !== 'confirm') return;
  }
  commitDoc(`Source direction → ${direction}`, (pr) => moveSourceDirection(pr, direction));
  setUi({ selected: direction });
  if (getState().project.character) refreshAnalysis();
}

export function setCharacterName(name: string): void {
  updateProject((p) => ({ ...p, setup: { ...p.setup, name } }));
}

/** Re-measures the source and keeps every user edit (no provider call). */
export function refreshAnalysis(): void {
  const p = getState().project;
  if (!p.source) return;
  const analysis = analyzeSprite(p.source.sprite, {
    sourceDirection: p.setup.sourceDirection,
    pixelArt: p.source.import.pixelArt,
    pixelScale: p.source.import.pixelScale,
  });
  updateProject((pr) => ({ ...pr, analysis, character: createCharacterModel(pr.source!.sprite, analysis, pr.character) }));
}

export async function analyze(): Promise<void> {
  const p = getState().project;
  if (!p.source) {
    toast('error', 'Upload a character image first.');
    return;
  }
  setUi({ analyzing: true });
  try {
    const analysis = analyzeSprite(p.source.sprite, {
      sourceDirection: p.setup.sourceDirection,
      pixelArt: p.source.import.pixelArt,
      pixelScale: p.source.import.pixelScale,
    });
    let model: CharacterModel = createCharacterModel(p.source.sprite, analysis, p.character);
    const hints = pendingHints.get(p.id);
    if (hints && !p.character) {
      model = {
        ...model,
        description: hints.description,
        handedness: hints.features.some((f) => f.side === 'right' && f.attachment === 'hand') ? 'right' : model.handedness,
        features: hints.features.map((f) => createFeature(f)),
      };
      pendingHints.delete(p.id);
    }
    const { settings } = getState();
    const provider = getProvider(settings.providerId);
    const notes: string[] = [];
    if (provider.capabilities.analysis && !p.character) {
      try {
        setUi({ busy: `Asking ${provider.label} to describe the character…` });
        const extra = await provider.analyzeCharacter(
          {
            sprite: p.source.sprite,
            analysis,
            character: characterReference(model, p.setup),
            settings: resolveProviderSettings(provider, settings.providers[provider.id]),
          },
          { codec: browserCodec, fetch: (...a) => fetch(...a) },
        );
        if (extra.description && !hints) model = { ...model, description: extra.description };
        if (extra.type) model = { ...model, type: extra.type };
        if (extra.handedness) model = { ...model, handedness: extra.handedness };
        if (extra.features?.length && model.features.length === 0) model = { ...model, features: extra.features.map((f) => createFeature(f)) };
        notes.push(...(extra.notes ?? []));
      } catch {
        notes.push(`${provider.label} could not describe the character; using the measured analysis only.`);
      } finally {
        setUi({ busy: null });
      }
    }
    updateProject((pr) => ({ ...pr, analysis, character: model }));
    const parts = [
      `${analysis.width}×${analysis.height}px`,
      analysis.pixelArt.value ? 'pixel art' : analysis.artStyle.value,
      `symmetry: ${analysis.symmetry.verdict}`,
      analysis.handedness.handedness ? `${analysis.handedness.handedness}-handed (guess)` : null,
    ].filter(Boolean);
    toast('success', 'Analysis complete — review and correct it before generating.', [parts.join(' · '), ...notes].join(' '));
  } catch (err) {
    errorToast(err, 'Analysis failed.');
  } finally {
    setUi({ analyzing: false });
  }
}

export function updateCharacter(updater: (c: CharacterModel) => CharacterModel): void {
  updateProject((p) => (p.character ? { ...p, character: updater(p.character) } : p));
}

export async function newProject(): Promise<void> {
  const p = getState().project;
  if (p.source) {
    const choice = await confirmDialog({
      title: 'Start a new project?',
      message: 'The current character will be removed from this browser. Save a project file first if you want to keep it.',
      confirmLabel: 'New project',
      danger: true,
    });
    if (choice !== 'confirm') return;
  }
  const fresh = createEmptyProject();
  store.setState((s) => ({
    ...s,
    project: { ...fresh, setup: { ...fresh.setup, symmetry: p.setup.symmetry } },
    history: EMPTY_HISTORY,
    ui: { ...s.ui, selected: 'S', frame: 0, jobs: {}, editorOpen: false },
  }));
  try {
    await clearCurrentProject();
  } catch {
    /* storage unavailable */
  }
}

export async function saveProjectFile(): Promise<void> {
  const p = getState().project;
  setUi({ busy: 'Saving project…' });
  try {
    const text = await serializeProject(p, browserCodec);
    downloadBlob(new Blob([text], { type: 'application/json' }), `${p.setup.name || 'character'}.sprite8.json`);
    toast('success', 'Project file saved.', 'Open it later with "Open project" to continue editing.');
  } catch (err) {
    errorToast(err, 'Could not save the project.');
  } finally {
    setUi({ busy: null });
  }
}

export async function openProjectFile(file?: File): Promise<void> {
  const chosen = file ?? (await pickFiles('.json,application/json'))[0];
  if (!chosen) return;
  if (hasManualWork(getState().project)) {
    const choice = await confirmDialog({
      title: 'Open another project?',
      message: 'The current character will be replaced.',
      confirmLabel: 'Open',
      danger: true,
    });
    if (choice !== 'confirm') return;
  }
  setUi({ busy: 'Opening project…' });
  try {
    const project = await deserializeProject(await chosen.text(), browserCodec);
    store.setState((s) => ({
      ...s,
      project,
      history: EMPTY_HISTORY,
      ui: { ...s.ui, selected: project.setup.sourceDirection, frame: 0, jobs: {}, editorOpen: false },
    }));
    toast('success', `Opened ${chosen.name}.`);
  } catch (err) {
    errorToast(err, 'Could not open this project file.');
  } finally {
    setUi({ busy: null });
  }
}
