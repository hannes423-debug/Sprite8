import { delay, fetchChecked, joinUrl, readJson, withTimeout } from '../http';
import {
  ProviderError,
  settingBool,
  settingNumber,
  settingString,
  type DirectionRequest,
  type DirectionResult,
  type ImageGenerationProvider,
  type ProviderContext,
  type ProviderSettings,
  type VariationRequest,
} from '../types';
import { createRaster } from '../../sprite';
import { poseGuideForInput, repaintMaskForInput } from '../../pose';
import {
  COMFY_PRESETS,
  DEFAULT_COMFY_WORKFLOW,
  fillWorkflow,
  findPlaceholders,
  imageOutputNodes,
  isComfyPreset,
  parseWorkflow,
  type ComfyPresetId,
  type PlaceholderValues,
} from './workflow';

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

async function uploadImage(
  base: string,
  blob: Blob,
  name: string,
  ctx: ProviderContext,
): Promise<string> {
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

/** The workflow to run: a pasted custom one wins, otherwise the selected preset. */
function chooseWorkflow(settings: ProviderSettings): string {
  const custom = settingString(settings, 'workflow').trim();
  // Older versions stored the basic template as the field's default value.
  if (custom && custom !== DEFAULT_COMFY_WORKFLOW) return custom;
  const preset = settingString(settings, 'preset', 'basic');
  return COMFY_PRESETS[isComfyPreset(preset) ? preset : 'basic'].workflow;
}

/** What to tell the user when a placeholder has no value. */
const MISSING_HINTS: Record<string, string> = {
  CHECKPOINT:
    'Set a checkpoint in the ComfyUI provider settings ("Test connection" lists the installed ones).',
  LORA: 'Set a LoRA file in the ComfyUI provider settings, or choose a preset without a LoRA.',
  CONTROLNET:
    'Set the pose ControlNet file in the ComfyUI provider settings ("Test connection" lists the installed ones).',
};

/** Values a loader node accepts, from ComfyUI's /object_info. */
async function listChoices(
  base: string,
  nodeClass: string,
  input: string,
  ctx: ProviderContext,
): Promise<string[]> {
  const res = await fetchChecked(
    ctx.fetch,
    joinUrl(base, `object_info/${nodeClass}`),
    { signal: withTimeout(ctx.signal, 8000) },
    `Listing ${nodeClass} options`,
  );
  const json = await readJson<
    Record<string, { input?: { required?: Record<string, [string[]?]> } }>
  >(res, 'ComfyUI');
  const list = json[nodeClass]?.input?.required?.[input]?.[0];
  return Array.isArray(list) ? list : [];
}

function describeComfyError(json: unknown): string {
  const j = json as {
    error?: { message?: string; details?: string };
    node_errors?: Record<
      string,
      { errors?: Array<{ message?: string; details?: string }>; class_type?: string }
    >;
  };
  const parts: string[] = [];
  if (j?.error?.message)
    parts.push(j.error.message + (j.error.details ? ` (${j.error.details})` : ''));
  for (const [id, ne] of Object.entries(j?.node_errors ?? {})) {
    for (const e of ne.errors ?? [])
      parts.push(`node ${id} ${ne.class_type ?? ''}: ${e.message ?? ''} ${e.details ?? ''}`.trim());
  }
  return parts.join('; ') || 'unknown error';
}

async function run(
  req: DirectionRequest,
  ctx: ProviderContext,
  variation?: VariationRequest,
): Promise<DirectionResult> {
  const base = baseUrl(req.settings);
  const timeoutMs = settingNumber(req.settings, 'timeoutSec', 600) * 1000;
  const template = parseWorkflow(chooseWorkflow(req.settings));
  const tag = `${req.direction}_${req.seed}_${randomId().slice(0, 6)}`;

  ctx.onProgress?.(0.02, 'Uploading images…');
  const mainInput = variation ? variation.base : req.input;
  const sourceName = await uploadImage(
    base,
    await ctx.codec.encodePng(mainInput.image),
    `sprite8_src_${tag}.png`,
    ctx,
  );
  // Pose guide and repaint mask: only rendered and uploaded when the workflow uses them.
  const used = findPlaceholders(template);
  let poseName: string | undefined;
  let maskName: string | undefined;
  let initName: string | undefined;
  if (used.has('INIT_IMAGE')) {
    // New views start from a blank background so nothing of the source pose survives; a variation
    // starts from the current view.
    initName = variation
      ? sourceName
      : await uploadImage(
          base,
          await ctx.codec.encodePng(
            createRaster(mainInput.image.width, mainInput.image.height, mainInput.background),
          ),
          `sprite8_init_${tag}.png`,
          ctx,
        );
  }
  if (used.has('MASK_IMAGE')) {
    const mask = repaintMaskForInput(req.direction, req.character, mainInput, {
      wholeImage: !settingBool(req.settings, 'protectBackground', true),
      includeSilhouette: !!variation,
    });
    maskName = await uploadImage(
      base,
      await ctx.codec.encodePng(mask),
      `sprite8_mask_${tag}.png`,
      ctx,
    );
  }
  if (used.has('POSE_IMAGE')) {
    const pose = poseGuideForInput(req.direction, req.character, mainInput);
    poseName = await uploadImage(
      base,
      await ctx.codec.encodePng(pose),
      `sprite8_pose_${tag}.png`,
      ctx,
    );
  }
  const refNames: string[] = [];
  for (const [i, ref] of req.references.slice(0, 4).entries()) {
    refNames.push(
      await uploadImage(
        base,
        await ctx.codec.encodePng(ref.input.image),
        `sprite8_ref${i + 1}_${tag}.png`,
        ctx,
      ),
    );
  }
  // Workflows that draw from a pose guide must repaint everything (denoise 1) or the source's own
  // pose wins; plain image-to-image keeps more of the source.
  const configuredDenoise = settingNumber(req.settings, 'denoise', 0);
  const denoise =
    configuredDenoise > 0
      ? configuredDenoise
      : findPlaceholders(template).has('POSE_IMAGE')
        ? 1
        : 0.8;
  const checkpoint = settingString(req.settings, 'checkpoint').trim();
  const lora = settingString(req.settings, 'lora').trim();
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
    DENOISE: variation ? variation.strength : denoise,
    WIDTH: mainInput.image.width,
    HEIGHT: mainInput.image.height,
    DIRECTION: req.direction,
    SOURCE_DIRECTION: req.character.sourceDirection,
    CONTROLNET:
      settingString(req.settings, 'controlnet').trim() ||
      'control_v11p_sd15_openpose_fp16.safetensors',
    CONTROL_STRENGTH: settingNumber(req.settings, 'controlStrength', 1),
    LORA_STRENGTH: settingNumber(req.settings, 'loraStrength', 0.8),
    IPADAPTER_WEIGHT: settingNumber(req.settings, 'ipAdapterWeight', 0.5),
    IPADAPTER_MODE: settingString(req.settings, 'ipAdapterMode', 'standard'),
    ...(poseName ? { POSE_IMAGE: poseName } : {}),
    ...(maskName ? { MASK_IMAGE: maskName } : {}),
    ...(initName ? { INIT_IMAGE: initName } : {}),
    ...(checkpoint ? { CHECKPOINT: checkpoint } : {}),
    ...(lora ? { LORA: lora } : {}),
  };
  let workflow;
  try {
    workflow = fillWorkflow(template, values);
  } catch (err) {
    const msg = (err as Error).message;
    const key = Object.keys(MISSING_HINTS).find((k) => msg.includes(`{{${k}}}`));
    throw new ProviderError(msg, key ? MISSING_HINTS[key] : undefined);
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
    throw new ProviderError(
      `Could not reach ComfyUI at ${base}.`,
      'Start ComfyUI with --enable-cors-header (see docs/providers.md).',
    );
  }
  const queuedJson = await readJson<{ prompt_id?: string; node_errors?: Record<string, unknown> }>(
    queued,
    'ComfyUI',
  );
  if (!queued.ok || !queuedJson.prompt_id) {
    const reason = describeComfyError(queuedJson);
    throw new ProviderError(
      `ComfyUI rejected the workflow: ${reason}`,
      /does not exist|missing_node_type|not found/i.test(reason)
        ? 'A node of this workflow is not installed in ComfyUI. The IP-Adapter workflow needs the ComfyUI_IPAdapter_plus custom nodes (see models/comfyui/README.md).'
        : undefined,
    );
  }
  const promptId = queuedJson.prompt_id;

  const started = Date.now();
  let entry: ComfyHistoryEntry | undefined;
  while (!entry) {
    if (Date.now() - started > timeoutMs)
      throw new ProviderError(
        'ComfyUI did not finish in time.',
        'Increase the timeout or use fewer steps.',
      );
    await delay(800, ctx.signal);
    const res = await fetchChecked(
      ctx.fetch,
      joinUrl(base, `history/${promptId}`),
      { signal: withTimeout(ctx.signal, 15_000) },
      'Polling ComfyUI',
    );
    const hist = await readJson<Record<string, ComfyHistoryEntry>>(res, 'ComfyUI history');
    const e = hist[promptId];
    if (e?.status?.status_str === 'error') {
      throw new ProviderError(
        `ComfyUI failed while running the workflow: ${JSON.stringify(e.status.messages ?? []).slice(0, 400)}`,
      );
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
  if (!image)
    throw new ProviderError(
      'The workflow finished but produced no image output (add a SaveImage node).',
    );
  ctx.onProgress?.(0.95, 'Downloading result…');
  const params = new URLSearchParams({
    filename: image.filename,
    subfolder: image.subfolder ?? '',
    type: image.type ?? 'output',
  });
  const res = await fetchChecked(
    ctx.fetch,
    `${joinUrl(base, 'view')}?${params}`,
    { signal: withTimeout(ctx.signal, 60_000) },
    'Downloading the ComfyUI result',
  );
  const decoded = await ctx.codec.decode(await res.blob());
  return { kind: 'ai', image: decoded, seed: req.seed, notes: [`ComfyUI prompt ${promptId}`] };
}

export const comfyUIProvider: ImageGenerationProvider = {
  id: 'comfyui',
  label: 'ComfyUI (local)',
  kind: 'local-ai',
  description:
    'Runs your own ComfyUI workflow (exported with "Save (API Format)"). Sprite8 uploads the source view, fills {{PLACEHOLDERS}} and downloads the result. Works with any local model ComfyUI supports.',
  capabilities: {
    generatesNewViews: true,
    variations: true,
    analysis: false,
    references: true,
    seeds: true,
  },
  settingsFields: [
    {
      key: 'baseUrl',
      label: 'ComfyUI URL',
      type: 'url',
      default: 'http://127.0.0.1:8188',
      help: 'Start ComfyUI with --enable-cors-header so the browser may call it, or use "/proxy/comfyui" with `npm run dev`.',
    },
    {
      key: 'preset',
      label: 'Workflow',
      type: 'select',
      default: 'basic',
      options: (Object.keys(COMFY_PRESETS) as ComfyPresetId[]).map((id) => ({
        value: id,
        label: COMFY_PRESETS[id].label,
      })),
      help: 'The pose presets turn the character with an OpenPose ControlNet guide that Sprite8 draws for every direction (needs an SD 1.5 checkpoint and a pose ControlNet; see models/comfyui/README.md). A workflow pasted under Advanced overrides this choice.',
    },
    {
      key: 'checkpoint',
      label: 'Checkpoint',
      type: 'text',
      default: '',
      placeholder: 'e.g. v1-5-pruned-emaonly.safetensors',
      help: 'Fills {{CHECKPOINT}} in the workflow. "Test connection" lists installed checkpoints. The pose presets need an SD 1.5 model.',
    },
    {
      key: 'lora',
      label: 'Style LoRA',
      type: 'text',
      default: '',
      placeholder: 'e.g. pixel-art-xl.safetensors',
      help: 'Only used by the "+ style LoRA" workflow (for example a pixel-art LoRA for SD 1.5).',
    },
    {
      key: 'denoise',
      label: 'Denoise (0 = auto)',
      type: 'number',
      default: 0,
      min: 0,
      max: 1,
      step: 0.05,
      help: 'How far a view may move away from the source. 0 = automatic (1.0 for the pose workflows, 0.8 for plain image-to-image). Lower keeps more of the source; higher allows more rotation.',
    },
    {
      key: 'protectBackground',
      label: 'Keep the background plain',
      type: 'checkbox',
      default: true,
      help: 'Pose workflows only repaint the area around the character; the rest keeps the source background. Small models otherwise like to paint scenery that cannot be removed again.',
      advanced: true,
    },
    {
      key: 'controlnet',
      label: 'Pose ControlNet',
      type: 'text',
      default: 'control_v11p_sd15_openpose_fp16.safetensors',
      help: 'File name of an OpenPose ControlNet in ComfyUI/models/controlnet (pose workflows only).',
      advanced: true,
    },
    {
      key: 'controlStrength',
      label: 'Pose strength',
      type: 'number',
      default: 1,
      min: 0,
      max: 2,
      step: 0.05,
      help: 'How strictly the generated view follows the pose guide.',
      advanced: true,
    },
    {
      key: 'ipAdapterWeight',
      label: 'IP-Adapter weight',
      type: 'number',
      default: 0.5,
      min: 0,
      max: 2,
      step: 0.05,
      help: "How strongly the IP-Adapter workflow copies the look of the source view (colours, outfit, hair). Higher values copy more of the source's front-facing composition too, which makes back and side views come out facing the camera; 0.5 is a good start.",
      advanced: true,
    },
    {
      key: 'ipAdapterMode',
      label: 'IP-Adapter mode',
      type: 'select',
      default: 'standard',
      options: [
        { value: 'standard', label: 'Standard — copy look and composition' },
        {
          value: 'style transfer',
          label: 'Style transfer — copy look, leave the pose to the guide',
        },
        { value: 'prompt is more important', label: 'Prompt is more important' },
      ],
      help: 'How the IP-Adapter workflow uses the source view. "Style transfer" keeps colours and outfit but not the front-facing composition, which helps back and side views.',
      advanced: true,
    },
    {
      key: 'loraStrength',
      label: 'LoRA strength',
      type: 'number',
      default: 0.8,
      min: 0,
      max: 2,
      step: 0.05,
      advanced: true,
    },
    { key: 'steps', label: 'Steps', type: 'number', default: 24, min: 1, max: 150 },
    { key: 'cfg', label: 'CFG', type: 'number', default: 6.5, min: 0, max: 30, step: 0.5 },
    {
      key: 'workflow',
      label: 'Workflow (API format JSON)',
      type: 'textarea',
      default: '',
      advanced: true,
      help: 'Leave empty to use the workflow chosen above. Or paste one saved with "Save (API Format)". Placeholders: {{SOURCE_IMAGE}}, {{POSE_IMAGE}}, {{REFERENCE_IMAGE_1}}…{{REFERENCE_IMAGE_4}}, {{PROMPT}}, {{NEGATIVE_PROMPT}}, {{INSTRUCTION}}, {{SEED}}, {{STEPS}}, {{CFG}}, {{DENOISE}}, {{WIDTH}}, {{HEIGHT}}, {{CHECKPOINT}}, {{CONTROLNET}}, {{CONTROL_STRENGTH}}, {{LORA}}, {{LORA_STRENGTH}}, {{DIRECTION}}.',
    },
    {
      key: 'outputNode',
      label: 'Output node id',
      type: 'text',
      default: '',
      advanced: true,
      help: 'Leave empty to use the first image output.',
    },
    {
      key: 'timeoutSec',
      label: 'Timeout (seconds)',
      type: 'number',
      default: 600,
      min: 10,
      max: 7200,
      advanced: true,
    },
  ],

  async checkStatus(settings, ctx) {
    try {
      const base = baseUrl(settings);
      const res = await fetchChecked(
        ctx.fetch,
        joinUrl(base, 'system_stats'),
        { signal: withTimeout(ctx.signal, 8000) },
        'Connecting to ComfyUI',
      );
      const stats = await readJson<{
        system?: { comfyui_version?: string };
        devices?: Array<{ name?: string }>;
      }>(res, 'ComfyUI');
      const details: string[] = [];
      if (stats.devices?.length)
        details.push(`Device: ${stats.devices.map((d) => d.name).join(', ')}`);
      const preset = settingString(settings, 'preset', 'basic');
      const wants = {
        controlnet: preset.startsWith('sd15-pose'),
        lora: preset === 'sd15-pose-lora',
      };
      const checks: Array<{
        label: string;
        node: string;
        input: string;
        setting: string;
        wanted: boolean;
        none: string;
      }> = [
        {
          label: 'Checkpoints',
          node: 'CheckpointLoaderSimple',
          input: 'ckpt_name',
          setting: 'checkpoint',
          wanted: true,
          none: 'No checkpoints found in models/checkpoints.',
        },
        {
          label: 'ControlNet models',
          node: 'ControlNetLoader',
          input: 'control_net_name',
          setting: 'controlnet',
          wanted: wants.controlnet,
          none: 'No ControlNet models found in models/controlnet (the pose workflows need an OpenPose one).',
        },
        {
          label: 'LoRAs',
          node: 'LoraLoader',
          input: 'lora_name',
          setting: 'lora',
          wanted: wants.lora,
          none: 'No LoRAs found in models/loras.',
        },
      ];
      if (preset === 'sd15-pose-ipadapter') {
        try {
          const probe = await fetchChecked(
            ctx.fetch,
            joinUrl(base, 'object_info/IPAdapterUnifiedLoader'),
            { signal: withTimeout(ctx.signal, 8000) },
            'Checking for the IP-Adapter nodes',
          );
          const json = await readJson<Record<string, unknown>>(probe, 'ComfyUI');
          details.push(
            json.IPAdapterUnifiedLoader
              ? 'IP-Adapter nodes: installed'
              : 'Warning: the IP-Adapter nodes are missing — install ComfyUI_IPAdapter_plus.',
          );
        } catch {
          details.push('Could not check for the IP-Adapter nodes.');
        }
      }
      for (const c of checks) {
        if (!c.wanted) continue;
        try {
          const names = await listChoices(base, c.node, c.input, ctx);
          details.push(names.length ? `${c.label}: ${names.join(', ')}` : c.none);
          const chosen = settingString(settings, c.setting).trim();
          if (chosen && names.length && !names.includes(chosen))
            details.push(
              `Warning: "${chosen}" is not among the installed ${c.label.toLowerCase()}.`,
            );
        } catch {
          details.push(`Could not list ${c.label.toLowerCase()}.`);
        }
      }
      return {
        ok: true,
        message: `Connected to ComfyUI${stats.system?.comfyui_version ? ` ${stats.system.comfyui_version}` : ''}.`,
        details,
      };
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
