import { getFrame, updateFrameImage } from '../../core/animation';
import { DIRECTIONS, type Direction } from '../../core/directions';
import {
  generateView,
  generationBlocker,
  generationOrder,
  manualWorkAt,
  seedFor,
  shouldApplyView,
  type GeneratedView,
} from '../../core/generation';
import { activeAnimation, replaceAnimation } from '../../core/project';
import { getProvider, resolveProviderSettings, type ProviderSettings } from '../../core/providers';
import { browserCodec } from '../../platform/canvas';
import { getState, setJob, setUi, store } from '../store';
import { commitDoc, pushUndoPoint } from './document';
import { confirmDialog, errorToast, toast } from './ui';

let controller: AbortController | null = null;

function providerSetup() {
  const { settings } = getState();
  const provider = getProvider(settings.providerId);
  return { provider, providerSettings: resolveProviderSettings(provider, settings.providers[provider.id]) };
}

function randomSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % 2_147_483_647;
}

function applyView(view: GeneratedView, label: string, recordHistory: boolean): boolean {
  const p = getState().project;
  const existing = getFrame(activeAnimation(p), view.direction, view.frame);
  if (!shouldApplyView(existing, view)) return false;
  const update = (pr: typeof p) =>
    replaceAnimation(pr, updateFrameImage(activeAnimation(pr), view.direction, view.frame, view.image, view.status, view.origin));
  if (recordHistory) commitDoc(label, update);
  else store.setState((s) => ({ ...s, project: { ...update(s.project), updatedAt: Date.now() } }));
  return true;
}

async function runOne(direction: Direction, mode: 'generate' | 'variation', seed: number, signal: AbortSignal, recordHistory: boolean): Promise<GeneratedView> {
  const { provider, providerSettings } = providerSetup();
  setJob(direction, { state: 'running', progress: 0.02, message: provider.capabilities.generatesNewViews ? 'Starting…' : undefined });
  const view = await generateView({
    project: getState().project,
    provider,
    providerSettings,
    direction,
    frame: getState().ui.frame,
    seed,
    mode,
    ctx: {
      codec: browserCodec,
      fetch: (...a) => fetch(...a),
      signal,
      onProgress: (progress, message) => setJob(direction, { state: 'running', progress, message }),
    },
  });
  const label = mode === 'variation' ? `Variation ${direction}` : view.status === 'mirror' ? `Mirror → ${direction}` : `Generate ${direction}`;
  applyView(view, label, recordHistory);
  setJob(direction, view.warnings.length ? { state: 'done', progress: 1, message: view.warnings[0] } : null);
  return view;
}

function ensureReady(): boolean {
  const blocker = generationBlocker(getState().project);
  if (blocker) {
    toast('warn', blocker);
    return false;
  }
  if (getState().ui.generating) {
    toast('info', 'Generation is already running.');
    return false;
  }
  return true;
}

/** Generates every unlocked direction, nearest to the source first. */
export async function generateAll(): Promise<void> {
  if (!ensureReady()) return;
  const project = getState().project;
  let order = generationOrder(project);
  const manual = manualWorkAt(project, order, getState().ui.frame);
  if (manual.length) {
    const choice = await confirmDialog({
      title: 'Overwrite manual work?',
      message: `${manual.join(', ')} ${manual.length === 1 ? 'contains' : 'contain'} edited or imported pixels. Lock a direction to protect it from "Generate".`,
      confirmLabel: 'Skip edited views',
      extraLabel: 'Overwrite them',
    });
    if (choice === 'cancel') return;
    if (choice === 'confirm') order = order.filter((d) => !manual.includes(d));
  }
  const { provider } = providerSetup();
  controller = new AbortController();
  const signal = controller.signal;
  setUi({ generating: true });
  for (const d of order) setJob(d, { state: 'queued', progress: 0 });
  // One undo step for the whole batch.
  const dropIfUnchanged = pushUndoPoint(`Generate ${order.length} directions`);
  let done = 0;
  let failed = 0;
  const baseSeed = project.generation.seed;
  try {
    for (const d of order) {
      if (signal.aborted) break;
      try {
        await runOne(d, 'generate', seedFor(baseSeed, d), signal, false);
        done++;
      } catch (err) {
        if (signal.aborted) break;
        failed++;
        const e = err as { message?: string; hint?: string };
        setJob(d, { state: 'error', progress: 0, error: e.message ?? 'Failed', hint: e.hint });
        if (failed === 1) errorToast(err, `Generating ${d} failed.`);
        // A provider that is unreachable will fail for every direction.
        if (/Could not reach|No endpoint|No ComfyUI|No Stable/i.test(e.message ?? '')) break;
      }
    }
  } finally {
    controller = null;
    setUi((ui) => {
      const jobs = { ...ui.jobs };
      for (const d of DIRECTIONS) if (jobs[d]?.state === 'queued' || jobs[d]?.state === 'running') delete jobs[d];
      return { generating: false, jobs };
    });
    dropIfUnchanged();
  }
  if (signal.aborted) toast('info', `Stopped after ${done} direction(s).`);
  else if (!provider.capabilities.generatesNewViews) {
    toast(
      'info',
      'Guides are ready.',
      getState().project.setup.symmetry === 'symmetric' && getState().project.generation.symmetryShortcut
        ? 'Partner views were mirrored where possible. Draw the remaining views in the editor, import images, or connect an AI provider.'
        : 'Without an AI provider the missing views must be drawn (guides, side markers and outlines help) or imported. Connect a local AI provider to generate them.',
      7000,
    );
  } else if (failed === 0) toast('success', `Generated ${done} direction(s).`);
}

/** Regenerates exactly one direction — every other direction is left untouched. */
export async function regenerate(direction: Direction, mode: 'generate' | 'variation' = 'generate'): Promise<void> {
  if (!ensureReady()) return;
  const p = getState().project;
  const frame = getFrame(activeAnimation(p), direction, getState().ui.frame);
  if (mode === 'generate' && frame?.image && (frame.status === 'edited' || frame.status === 'imported')) {
    const choice = await confirmDialog({
      title: `Regenerate ${direction}?`,
      message: `${direction} contains manual work that will be replaced (you can undo).`,
      confirmLabel: 'Regenerate',
    });
    if (choice !== 'confirm') return;
  }
  controller = new AbortController();
  setUi({ generating: true });
  try {
    const view = await runOne(direction, mode, randomSeed(), controller.signal, true);
    if (view.status === 'guide') {
      toast('info', `${direction}: guides only.`, view.origin.notes?.join(' '));
    }
  } catch (err) {
    const e = err as { message?: string; hint?: string };
    if (!controller?.signal.aborted) {
      setJob(direction, { state: 'error', progress: 0, error: e.message ?? 'Failed', hint: e.hint });
      errorToast(err, `Generating ${direction} failed.`);
    } else setJob(direction, null);
  } finally {
    controller = null;
    setUi({ generating: false });
  }
}

export function cancelGeneration(): void {
  controller?.abort();
}

export function setProvider(id: string): void {
  store.setState((s) => ({
    ...s,
    settings: { ...s.settings, providerId: id },
    ui: { ...s.ui, providerStatus: { checking: false, status: null } },
  }));
}

export function updateProviderSettings(id: string, patch: ProviderSettings): void {
  store.setState((s) => ({
    ...s,
    settings: { ...s.settings, providers: { ...s.settings.providers, [id]: { ...(s.settings.providers[id] ?? {}), ...patch } } },
  }));
}

export async function checkProvider(): Promise<void> {
  const { provider, providerSettings } = providerSetup();
  setUi({ providerStatus: { checking: true, status: null } });
  try {
    const status = await provider.checkStatus(providerSettings, { codec: browserCodec, fetch: (...a) => fetch(...a) });
    setUi({ providerStatus: { checking: false, status } });
  } catch (err) {
    setUi({ providerStatus: { checking: false, status: { ok: false, message: (err as Error).message } } });
  }
}

export function dismissJob(direction: Direction): void {
  setJob(direction, null);
}
