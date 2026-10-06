import { delay, fetchChecked, joinUrl, readJson, withTimeout } from '../http';
import {
  ProviderError,
  settingNumber,
  settingString,
  type DirectionRequest,
  type DirectionResult,
  type ImageGenerationProvider,
  type ProviderContext,
  type ProviderSettings,
  type VariationRequest,
} from '../types';
import { DEFAULT_COMFY_WORKFLOW, fillWorkflow, imageOutputNodes, parseWorkflow, type PlaceholderValues } from './workflow';

interface ComfyImageRef {
  filename: string;
  subfolder: string;
  type: string;
}

interface ComfyHistoryEntry {
  outputs?: Record<string, { images?: ComfyImageRef[] }>;
  status?: { status_str?: string; completed?: boolean; messages?: unknown[] };
}

function baseUrl(settings: ProviderSettings): string {
  const url = settingString(settings, 'baseUrl').trim();
  if (!url) throw new ProviderError('No ComfyUI URL configured.');
  return url;
}

function randomId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function uploadImage(base: string, blob: Blob, name: string, ctx: ProviderContext): Promise<string> {
  const form = new FormData();
  form.append('image', blob, name);
  form.append('overwrite', 'true');
  form.append('type', 'input');
  const res = await fetchChecked(
    ctx.fetch,
    joinUrl(base, 'upload/image'),
    { method: 'POST', body: form, signal: withTimeout(ctx.signal, 60_000) },
    'Uploading the image to ComfyUI',
  );
  const json = await readJson<{ name?: string; subfolder?: string }>(res, 'ComfyUI upload');
  if (!json.name) throw new ProviderError('ComfyUI did not return a file name for the upload.');
  return json.subfolder ? `${json.subfolder}/${json.name}` : json.name;
}

function describeComfyError(json: unknown): string {
  const j = json as { error?: { message?: string; details?: string }; node_errors?: Record<string, { errors?: Array<{ message?: string; details?: string }>; class_type?: string }> };
  const parts: string[] = [];
  if (j?.error?.message) parts.push(j.error.message + (j.error.details ? ` (${j.error.details})` : ''));
  for (const [id, ne] of Object.entries(j?.node_errors ?? {})) {
    for (const e of ne.errors ?? []) parts.push(`node ${id} ${ne.class_type ?? ''}: ${e.message ?? ''} ${e.details ?? ''}`.trim());
  }
  return parts.join('; ') || 'unknown error';
}

async function run(req: DirectionRequest, ctx: ProviderContext, variation?: VariationRequest): Promise<DirectionResult> {
  const base = baseUrl(req.settings);
  const timeoutMs = settingNumber(req.settings, 'timeoutSec', 600) * 1000;
  const workflowText = settingString(req.settings, 'workflow').trim() || DEFAULT_COMFY_WORKFLOW;
  const template = parseWorkflow(workflowText);
  const tag = `${req.direction}_${req.seed}_${randomId().slice(0, 6)}`;

  ctx.onProgress?.(0.02, 'Uploading images…');
  const mainInput = variation ? variation.base : req.input;
  const sourceName = await uploadImage(base, await ctx.codec.encodePng(mainInput.image), `sprite8_src_${tag}.png`, ctx);
  const refNames: string[] = [];
  for (const [i, ref] of req.references.slice(0, 4).entries()) {
    refNames.push(await uploadImage(base, await ctx.codec.encodePng(ref.input.image), `sprite8_ref${i + 1}_${tag}.png`, ctx));
  }
  const checkpoint = settingString(req.settings, 'checkpoint').trim();
  const values: PlaceholderValues = {
    SOURCE_IMAGE: sourceName,
    REFERENCE_IMAGE_1: refNames[0] ?? sourceName,
    REFERENCE_IMAGE_2: refNames[1] ?? refNames[0] ?? sourceName,
    REFERENCE_IMAGE_3: refNames[2] ?? refNames[0] ?? sourceName,
    REFERENCE_IMAGE_4: refNames[3] ?? refNames[0] ?? sourceName,
    PROMPT: req.prompt.primary,
    NEGATIVE_PROMPT: req.prompt.negative,
    INSTRUCTION: req.prompt.instruction,
    SEED: req.seed,
    STEPS: settingNumber(req.settings, 'steps', 24),
    CFG: settingNumber(req.settings, 'cfg', 6.5),
    DENOISE: variation ? variation.strength : settingNumber(req.settings, 'denoise', 0.8),
    WIDTH: mainInput.image.width,
    HEIGHT: mainInput.image.height,
    DIRECTION: req.direction,
    SOURCE_DIRECTION: req.character.sourceDirection,
    ...(checkpoint ? { CHECKPOINT: checkpoint } : {}),
  };
  let workflow;
  try {
    workflow = fillWorkflow(template, values);
  } catch (err) {
    const msg = (err as Error).message;
    throw new ProviderError(
      msg,
      msg.includes('CHECKPOINT') ? 'Set a checkpoint in the ComfyUI provider settings ("Test connection" lists the installed ones).' : undefined,
    );
  }

  ctx.onProgress?.(0.08, 'Queueing in ComfyUI…');
  const clientId = randomId();
  let queued: Response;
  try {
    queued = await ctx.fetch(joinUrl(base, 'prompt'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: clientId }),
      signal: withTimeout(ctx.signal, 30_000),
    });
  } catch {
    throw new ProviderError(`Could not reach ComfyUI at ${base}.`, 'Start ComfyUI with --enable-cors-header (see docs/providers.md).');
  }
  const queuedJson = await readJson<{ prompt_id?: string; node_errors?: Record<string, unknown> }>(queued, 'ComfyUI');
  if (!queued.ok || !queuedJson.prompt_id) {
    throw new ProviderError(`ComfyUI rejected the workflow: ${describeComfyError(queuedJson)}`);
  }
  const promptId = queuedJson.prompt_id;

  const started = Date.now();
  let entry: ComfyHistoryEntry | undefined;
  while (!entry) {
    if (Date.now() - started > timeoutMs) throw new ProviderError('ComfyUI did not finish in time.', 'Increase the timeout or use fewer steps.');
    await delay(800, ctx.signal);
    const res = await fetchChecked(ctx.fetch, joinUrl(base, `history/${promptId}`), { signal: withTimeout(ctx.signal, 15_000) }, 'Polling ComfyUI');
    const hist = await readJson<Record<string, ComfyHistoryEntry>>(res, 'ComfyUI history');
    const e = hist[promptId];
    if (e?.status?.status_str === 'error') {
      throw new ProviderError(`ComfyUI failed while running the workflow: ${JSON.stringify(e.status.messages ?? []).slice(0, 400)}`);
    }
    if (e && (e.status?.completed || (e.outputs && Object.keys(e.outputs).length > 0))) entry = e;
    else {
      const secs = Math.round((Date.now() - started) / 1000);
      ctx.onProgress?.(Math.min(0.9, 0.1 + secs / 120), `ComfyUI is working… ${secs}s`);
    }
  }

  const wanted = settingString(req.settings, 'outputNode').trim();
  const outputs = entry.outputs ?? {};
  const order = wanted ? [wanted] : [...imageOutputNodes(workflow), ...Object.keys(outputs)];
  let image: ComfyImageRef | undefined;
  for (const id of order) {
    image = outputs[id]?.images?.[0];
    if (image) break;
  }
  if (!image) throw new ProviderError('The workflow finished but produced no image output (add a SaveImage node).');
  ctx.onProgress?.(0.95, 'Downloading result…');
  const params = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder ?? '', type: image.type ?? 'output' });
  const res = await fetchChecked(ctx.fetch, `${joinUrl(base, 'view')}?${params}`, { signal: withTimeout(ctx.signal, 60_000) }, 'Downloading the ComfyUI result');
  const decoded = await ctx.codec.decode(await res.blob());
  return { kind: 'ai', image: decoded, seed: req.seed, notes: [`ComfyUI prompt ${promptId}`] };
}

export const comfyUIProvider: ImageGenerationProvider = {
  id: 'comfyui',
  label: 'ComfyUI (local)',
  kind: 'local-ai',
  description:
    'Runs your own ComfyUI workflow (exported with "Save (API Format)"). Sprite8 uploads the source view, fills {{PLACEHOLDERS}} and downloads the result. Works with any local model ComfyUI supports.',
  capabilities: { generatesNewViews: true, variations: true, analysis: false, references: true, seeds: true },
  settingsFields: [
    {
      key: 'baseUrl',
      label: 'ComfyUI URL',
      type: 'url',
      default: 'http://127.0.0.1:8188',
      help: 'Start ComfyUI with --enable-cors-header so the browser may call it, or use "/proxy/comfyui" with `npm run dev`.',
    },
    {
      key: 'checkpoint',
      label: 'Checkpoint',
      type: 'text',
      default: '',
      placeholder: 'e.g. sd_xl_base_1.0.safetensors',
      help: 'Fills {{CHECKPOINT}} in the workflow. "Test connection" lists installed checkpoints.',
    },
    { key: 'denoise', label: 'Denoise', type: 'number', default: 0.8, min: 0, max: 1, step: 0.05, help: 'How far a view may move away from the source. Higher = more rotation, less identity.' },
    { key: 'steps', label: 'Steps', type: 'number', default: 24, min: 1, max: 150 },
    { key: 'cfg', label: 'CFG', type: 'number', default: 6.5, min: 0, max: 30, step: 0.5 },
    {
      key: 'workflow',
      label: 'Workflow (API format JSON)',
      type: 'textarea',
      default: DEFAULT_COMFY_WORKFLOW,
      advanced: true,
      help: 'Paste a workflow saved with "Save (API Format)". Placeholders: {{SOURCE_IMAGE}}, {{REFERENCE_IMAGE_1}}…{{REFERENCE_IMAGE_4}}, {{PROMPT}}, {{NEGATIVE_PROMPT}}, {{INSTRUCTION}}, {{SEED}}, {{STEPS}}, {{CFG}}, {{DENOISE}}, {{WIDTH}}, {{HEIGHT}}, {{CHECKPOINT}}, {{DIRECTION}}.',
    },
    { key: 'outputNode', label: 'Output node id', type: 'text', default: '', advanced: true, help: 'Leave empty to use the first image output.' },
    { key: 'timeoutSec', label: 'Timeout (seconds)', type: 'number', default: 600, min: 10, max: 7200, advanced: true },
  ],

  async checkStatus(settings, ctx) {
    try {
      const base = baseUrl(settings);
      const res = await fetchChecked(ctx.fetch, joinUrl(base, 'system_stats'), { signal: withTimeout(ctx.signal, 8000) }, 'Connecting to ComfyUI');
      const stats = await readJson<{ system?: { comfyui_version?: string }; devices?: Array<{ name?: string }> }>(res, 'ComfyUI');
      const details: string[] = [];
      if (stats.devices?.length) details.push(`Device: ${stats.devices.map((d) => d.name).join(', ')}`);
      try {
        const info = await fetchChecked(ctx.fetch, joinUrl(base, 'object_info/CheckpointLoaderSimple'), { signal: withTimeout(ctx.signal, 8000) }, 'Listing checkpoints');
        const json = await readJson<{ CheckpointLoaderSimple?: { input?: { required?: { ckpt_name?: [string[]] } } } }>(info, 'ComfyUI');
        const names = json.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] ?? [];
        details.push(names.length ? `Checkpoints: ${names.join(', ')}` : 'No checkpoints found in models/checkpoints.');
      } catch {
        details.push('Could not list checkpoints.');
      }
      return { ok: true, message: `Connected to ComfyUI${stats.system?.comfyui_version ? ` ${stats.system.comfyui_version}` : ''}.`, details };
    } catch (err) {
      const e = err as ProviderError;
      return { ok: false, message: e.message, details: e.hint ? [e.hint] : undefined };
    }
  },

  async analyzeCharacter() {
    return {};
  },

  generateDirection(req, ctx) {
    return run(req, ctx);
  },

  generateVariation(req, ctx) {
    return run(req, ctx, req);
  },
};
