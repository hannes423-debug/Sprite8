import { base64ToRaster, delay, fetchChecked, joinUrl, rasterToBase64Png, readJson, withTimeout } from './http';
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
} from './types';

function baseUrl(settings: ProviderSettings): string {
  const url = settingString(settings, 'baseUrl').trim();
  if (!url) throw new ProviderError('No Stable Diffusion WebUI URL configured.');
  return url;
}

async function img2img(req: DirectionRequest, ctx: ProviderContext, variation?: VariationRequest): Promise<DirectionResult> {
  const base = baseUrl(req.settings);
  const input = variation ? variation.base : req.input;
  const model = settingString(req.settings, 'model').trim();
  const body = {
    init_images: [await rasterToBase64Png(input.image, ctx.codec)],
    prompt: req.prompt.primary,
    negative_prompt: req.prompt.negative,
    seed: req.seed,
    steps: settingNumber(req.settings, 'steps', 24),
    cfg_scale: settingNumber(req.settings, 'cfg', 7),
    denoising_strength: variation ? variation.strength : settingNumber(req.settings, 'denoise', 0.8),
    sampler_name: settingString(req.settings, 'sampler', 'Euler a'),
    width: input.image.width,
    height: input.image.height,
    batch_size: 1,
    n_iter: 1,
    resize_mode: 0,
    send_images: true,
    save_images: false,
    ...(model ? { override_settings: { sd_model_checkpoint: model }, override_settings_restore_afterwards: true } : {}),
  };
  ctx.onProgress?.(0.05, 'Sending to Stable Diffusion WebUI…');
  const state = { done: false };
  const poll = (async () => {
    while (!state.done) {
      try {
        await delay(1000, ctx.signal);
      } catch {
        return;
      }
      if (state.done) return;
      try {
        const res = await ctx.fetch(joinUrl(base, 'sdapi/v1/progress?skip_current_image=true'), { signal: withTimeout(ctx.signal, 5000) });
        if (res.ok) {
          const p = (await res.json()) as { progress?: number; eta_relative?: number };
          if (!state.done && typeof p.progress === 'number') {
            ctx.onProgress?.(0.05 + p.progress * 0.85, `Generating… ${Math.round(p.progress * 100)}%${p.eta_relative ? ` (~${Math.ceil(p.eta_relative)}s left)` : ''}`);
          }
        }
      } catch {
        /* progress is best-effort */
      }
    }
  })();
  try {
    const res = await fetchChecked(
      ctx.fetch,
      joinUrl(base, 'sdapi/v1/img2img'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: withTimeout(ctx.signal, settingNumber(req.settings, 'timeoutSec', 600) * 1000),
      },
      `Generating ${req.direction}`,
    );
    const json = await readJson<{ images?: string[]; info?: string }>(res, 'Stable Diffusion WebUI');
    if (!json.images?.length) throw new ProviderError('Stable Diffusion WebUI returned no image.');
    let seed = req.seed;
    try {
      const info = JSON.parse(json.info ?? '{}') as { seed?: number };
      if (typeof info.seed === 'number') seed = info.seed;
    } catch {
      /* info is optional */
    }
    ctx.onProgress?.(0.95, 'Decoding…');
    return { kind: 'ai', image: await base64ToRaster(json.images[0], ctx.codec), seed };
  } finally {
    state.done = true;
    await poll;
  }
}

export const a1111Provider: ImageGenerationProvider = {
  id: 'a1111',
  label: 'Stable Diffusion WebUI (A1111 / Forge API)',
  kind: 'local-ai',
  description:
    'Uses the img2img API of AUTOMATIC1111, Forge or SD.Next running on your machine. Start it with --api and --cors-allow-origins (see docs/providers.md).',
  capabilities: { generatesNewViews: true, variations: true, analysis: true, references: false, seeds: true },
  settingsFields: [
    {
      key: 'baseUrl',
      label: 'WebUI URL',
      type: 'url',
      default: 'http://127.0.0.1:7860',
      help: 'Launch with --api --cors-allow-origins=<this page origin>, or use "/proxy/a1111" with `npm run dev`.',
    },
    { key: 'model', label: 'Checkpoint (optional)', type: 'text', default: '', help: 'Model title as listed by "Test connection". Empty = the currently loaded model.' },
    { key: 'denoise', label: 'Denoising strength', type: 'number', default: 0.8, min: 0, max: 1, step: 0.05 },
    { key: 'steps', label: 'Steps', type: 'number', default: 24, min: 1, max: 150 },
    { key: 'cfg', label: 'CFG scale', type: 'number', default: 7, min: 1, max: 30, step: 0.5 },
    { key: 'sampler', label: 'Sampler', type: 'text', default: 'Euler a', advanced: true },
    { key: 'interrogate', label: 'Describe the character with CLIP during analysis', type: 'checkbox', default: true, advanced: true },
    { key: 'timeoutSec', label: 'Timeout (seconds)', type: 'number', default: 600, min: 10, max: 7200, advanced: true },
  ],

  async checkStatus(settings, ctx) {
    try {
      const base = baseUrl(settings);
      const res = await fetchChecked(ctx.fetch, joinUrl(base, 'sdapi/v1/sd-models'), { signal: withTimeout(ctx.signal, 8000) }, 'Connecting to the WebUI');
      const models = await readJson<Array<{ title?: string }>>(res, 'Stable Diffusion WebUI');
      return {
        ok: true,
        message: 'Connected to Stable Diffusion WebUI.',
        details: [models.length ? `Models: ${models.map((m) => m.title).join(', ')}` : 'No models found.'],
      };
    } catch (err) {
      const e = err as ProviderError;
      return { ok: false, message: e.message, details: e.hint ? [e.hint] : undefined };
    }
  },

  async analyzeCharacter(req, ctx) {
    if (!settingBool(req.settings, 'interrogate', true)) return {};
    try {
      const base = baseUrl(req.settings);
      const res = await fetchChecked(
        ctx.fetch,
        joinUrl(base, 'sdapi/v1/interrogate'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: `data:image/png;base64,${await rasterToBase64Png(req.sprite, ctx.codec)}`, model: 'clip' }),
          signal: withTimeout(ctx.signal, 120_000),
        },
        'Describing the character',
      );
      const json = await readJson<{ caption?: string }>(res, 'Interrogate');
      return json.caption ? { description: json.caption.trim(), notes: ['Description generated with CLIP interrogate — please review it.'] } : {};
    } catch {
      return {};
    }
  },

  generateDirection(req, ctx) {
    return img2img(req, ctx);
  },

  generateVariation(req, ctx) {
    return img2img(req, ctx, req);
  },
};
