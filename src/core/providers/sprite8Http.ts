import { rgbaToHex } from '../sprite';
import {
  base64ToRaster,
  fetchChecked,
  joinUrl,
  rasterToBase64Png,
  readJson,
  withTimeout,
} from './http';
import {
  ProviderError,
  settingNumber,
  settingString,
  type AnalyzeRequest,
  type CharacterAnalysisHints,
  type DirectionRequest,
  type DirectionResult,
  type ImageGenerationProvider,
  type ProviderContext,
  type ProviderSettings,
  type VariationRequest,
} from './types';

/**
 * Sprite8 HTTP protocol v1 — a tiny JSON protocol so anyone can wrap any
 * model (diffusers, a Hugging Face pipeline, a WebUI, a cloud API…) in a
 * small server. Spec: docs/providers.md. Reference server:
 * models/reference-server/.
 *
 *   GET  {endpoint}/health    → { name, version, capabilities? }
 *   POST {endpoint}/generate  → { image: base64 PNG, seed?, notes? }
 *   POST {endpoint}/analyze   → { description?, type?, handedness?, features?, notes? }  (optional)
 */
export const SPRITE8_PROTOCOL = 'sprite8/1';

export interface Sprite8GenerateRequestBody {
  protocol: typeof SPRITE8_PROTOCOL;
  mode: 'direction' | 'variation';
  direction: string;
  sourceDirection: string;
  prompt: string;
  negativePrompt: string;
  instruction: string;
  promptStyle: string;
  seed: number;
  width: number;
  height: number;
  background: string;
  sourceImage: string;
  references: Array<{ direction: string; image: string }>;
  baseImage?: string;
  strength?: number;
  character: Record<string, unknown>;
}

function headers(settings: ProviderSettings): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = settingString(settings, 'apiKey');
  if (key) h.Authorization = `Bearer ${key}`;
  return h;
}

function characterPayload(req: DirectionRequest): Record<string, unknown> {
  const c = req.character;
  return {
    name: c.name,
    type: c.type,
    description: c.description,
    symmetry: c.symmetry,
    handedness: c.handedness,
    camera: c.camera,
    sourceDirection: c.sourceDirection,
    style: c.style,
    proportions: c.proportions,
    features: c.features,
    palette: c.colors.palette,
  };
}

async function buildBody(req: DirectionRequest, ctx: ProviderContext, variation?: VariationRequest): Promise<Sprite8GenerateRequestBody> {
  const refs = await Promise.all(
    req.references.map(async (r) => ({ direction: r.direction, image: await rasterToBase64Png(r.input.image, ctx.codec) })),
  );
  return {
    protocol: SPRITE8_PROTOCOL,
    mode: variation ? 'variation' : 'direction',
    direction: req.direction,
    sourceDirection: req.character.sourceDirection,
    prompt: req.prompt.positive,
    negativePrompt: req.prompt.negative,
    instruction: req.prompt.instruction,
    promptStyle: req.prompt.primary === req.prompt.instruction ? 'instruction' : 'tags',
    seed: req.seed,
    width: req.input.image.width,
    height: req.input.image.height,
    background: rgbaToHex(req.input.background),
    sourceImage: await rasterToBase64Png(req.input.image, ctx.codec),
    references: refs,
    ...(variation
      ? { baseImage: await rasterToBase64Png(variation.base.image, ctx.codec), strength: variation.strength }
      : {}),
    character: characterPayload(req),
  };
}

async function generate(
  req: DirectionRequest,
  ctx: ProviderContext,
  variation?: VariationRequest,
): Promise<DirectionResult> {
  const endpoint = settingString(req.settings, 'endpoint').trim();
  if (!endpoint) throw new ProviderError('No endpoint configured for the Sprite8 HTTP provider.');
  const timeoutMs = settingNumber(req.settings, 'timeoutSec', 300) * 1000;
  ctx.onProgress?.(0.05, 'Sending request…');
  const body = await buildBody(req, ctx, variation);
  const res = await fetchChecked(
    ctx.fetch,
    joinUrl(endpoint, 'generate'),
    {
      method: 'POST',
      headers: headers(req.settings),
      body: JSON.stringify(body),
      signal: withTimeout(ctx.signal, timeoutMs),
    },
    `Generating ${req.direction}`,
  );
  const json = await readJson<{ image?: string; seed?: number; notes?: string[]; error?: string }>(res, 'The server');
  if (json.error) throw new ProviderError(`Server error: ${json.error}`);
  if (!json.image) throw new ProviderError('The server response contains no "image".');
  ctx.onProgress?.(0.95, 'Decoding…');
  const image = await base64ToRaster(json.image, ctx.codec);
  return { kind: 'ai', image, seed: json.seed ?? req.seed, notes: json.notes };
}

export const sprite8HttpProvider: ImageGenerationProvider = {
  id: 'sprite8-http',
  label: 'Custom server (Sprite8 HTTP protocol)',
  kind: 'local-ai',
  description:
    'Talks to any server that implements the small Sprite8 HTTP protocol — wrap diffusers, a Hugging Face model, a WebUI or a cloud API in a few lines. See models/reference-server for a ready-made example.',
  capabilities: { generatesNewViews: true, variations: true, analysis: true, references: true, seeds: true },
  settingsFields: [
    {
      key: 'endpoint',
      label: 'Endpoint URL',
      type: 'url',
      default: 'http://127.0.0.1:7861',
      placeholder: 'http://127.0.0.1:7861',
      help: 'Base URL of the server. When running Sprite8 with `npm run dev`, "/proxy/sprite8" avoids CORS setup.',
    },
    { key: 'apiKey', label: 'API key (optional)', type: 'password', default: '', help: 'Sent as "Authorization: Bearer …".' },
    { key: 'timeoutSec', label: 'Timeout (seconds)', type: 'number', default: 300, min: 5, max: 3600, advanced: true },
  ],

  async checkStatus(settings, ctx) {
    const endpoint = settingString(settings, 'endpoint').trim();
    if (!endpoint) return { ok: false, message: 'No endpoint configured.' };
    try {
      const res = await fetchChecked(ctx.fetch, joinUrl(endpoint, 'health'), { signal: withTimeout(ctx.signal, 8000) }, 'Health check');
      const json = await readJson<{ name?: string; version?: string; protocol?: string; capabilities?: string[]; model?: string }>(
        res,
        'Health check',
      );
      return {
        ok: true,
        message: `Connected to ${json.name ?? 'server'}${json.version ? ` ${json.version}` : ''}.`,
        details: [
          json.protocol ? `Protocol: ${json.protocol}` : '',
          json.model ? `Model: ${json.model}` : '',
          json.capabilities?.length ? `Capabilities: ${json.capabilities.join(', ')}` : '',
        ].filter(Boolean),
      };
    } catch (err) {
      const e = err as ProviderError;
      return { ok: false, message: e.message, details: e.hint ? [e.hint] : undefined };
    }
  },

  async analyzeCharacter(req: AnalyzeRequest, ctx): Promise<CharacterAnalysisHints> {
    const endpoint = settingString(req.settings, 'endpoint').trim();
    if (!endpoint) return {};
    try {
      const res = await fetchChecked(
        ctx.fetch,
        joinUrl(endpoint, 'analyze'),
        {
          method: 'POST',
          headers: headers(req.settings),
          body: JSON.stringify({
            protocol: SPRITE8_PROTOCOL,
            image: await rasterToBase64Png(req.sprite, ctx.codec),
            sourceDirection: req.character.sourceDirection,
            symmetry: req.character.symmetry,
          }),
          signal: withTimeout(ctx.signal, 60_000),
        },
        'Character analysis',
      );
      return await readJson<CharacterAnalysisHints>(res, 'Character analysis');
    } catch {
      // /analyze is optional in the protocol.
      return {};
    }
  },

  generateDirection(req, ctx) {
    return generate(req, ctx);
  },

  generateVariation(req, ctx) {
    return generate(req, ctx, req);
  },
};
