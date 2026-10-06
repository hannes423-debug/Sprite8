import { describe, expect, it } from 'vitest';
import { encodePng } from '../../models/reference-server/png.mjs';
import { analyzeSprite } from '../../src/core/analysis';
import { createCharacterModel } from '../../src/core/character';
import {
  activeAnimation,
  createEmptyProject,
  projectWithSource,
  type Project,
} from '../../src/core/project';
import {
  a1111Provider,
  COMFY_PRESETS,
  comfyUIProvider,
  DEFAULT_COMFY_WORKFLOW,
  KNOWN_PLACEHOLDERS,
  fillWorkflow,
  findPlaceholders,
  getProvider,
  parseWorkflow,
  resolveProviderSettings,
  sprite8HttpProvider,
  type ProviderContext,
  type Sprite8GenerateRequestBody,
} from '../../src/core/providers';
import {
  buildDirectionPrompt,
  generateView,
  generationBlocker,
  generationOrder,
  seedFor,
  shouldApplyView,
} from '../../src/core/generation';
import { characterReference } from '../../src/core/character';
import { foregroundMask } from '../../src/core/pose';
import { prepareProviderInput } from '../../src/core/generation';
import {
  findFeet,
  flipHorizontal,
  normalizeImport,
  paletteCoverage,
  scaleNearest,
  blit,
  createRaster,
  hexToRgba,
  type Rgba,
} from '../../src/core/sprite';
import { C, humanoid, nodeCodec, outlined } from './helpers';

function pngBase64(img: { width: number; height: number; data: Uint8ClampedArray }): string {
  return Buffer.from(encodePng(img.width, img.height, img.data)).toString('base64');
}

/** A high-res "AI render" of the back view: flipped sprite, upscaled, on white. */
function backViewRender(): { width: number; height: number; data: Uint8ClampedArray } {
  const back = flipHorizontal(outlined(humanoid({ stick: 'screen-left' })));
  return blit(
    createRaster(512, 512, C.white),
    scaleNearest(back, back.width * 8, back.height * 8),
    90,
    50,
  );
}

function readyProject(): Project {
  const sprite = outlined(humanoid({ stick: 'screen-left' }));
  let project = projectWithSource(createEmptyProject(), normalizeImport(sprite), 'hockey.png');
  const analysis = analyzeSprite(project.source!.sprite, { sourceDirection: 'S', pixelArt: true });
  project = {
    ...project,
    analysis,
    character: createCharacterModel(project.source!.sprite, analysis),
  };
  project = { ...project, generation: { ...project.generation, generationSize: 512 } };
  return project;
}

type Handler = (url: URL, init: RequestInit | undefined) => Promise<Response> | Response;

function mockFetch(handler: Handler): {
  fetch: typeof fetch;
  calls: Array<{ url: string; method: string }>;
} {
  const calls: Array<{ url: string; method: string }> = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url: url.pathname + url.search, method: init?.method ?? 'GET' });
    return handler(url, init);
  }) as typeof fetch;
  return { fetch: fn, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('ComfyUI workflow templates', () => {
  it('ships a valid default workflow with the expected placeholders', () => {
    const wf = parseWorkflow(DEFAULT_COMFY_WORKFLOW);
    expect(Object.values(wf).some((n) => n.class_type === 'SaveImage')).toBe(true);
    expect([...findPlaceholders(wf)].sort()).toEqual([
      'CFG',
      'CHECKPOINT',
      'DENOISE',
      'DIRECTION',
      'NEGATIVE_PROMPT',
      'PROMPT',
      'SEED',
      'SOURCE_IMAGE',
      'STEPS',
    ]);
  });

  it('fills placeholders with typed values', () => {
    const filled = fillWorkflow(
      { a: '{{SEED}}', b: 'x_{{DIRECTION}}', c: ['{{PROMPT}}', 1] },
      { SEED: 42, DIRECTION: 'NE', PROMPT: 'hi' },
    );
    expect(filled).toEqual({ a: 42, b: 'x_NE', c: ['hi', 1] });
  });

  it('reports unfilled placeholders and UI-format files', () => {
    expect(() => fillWorkflow({ a: '{{CHECKPOINT}}' }, {})).toThrow(/CHECKPOINT/);
    expect(() => parseWorkflow('{"nodes": [], "links": []}')).toThrow(/API Format/);
    expect(() => parseWorkflow('not json')).toThrow(/valid JSON/);
  });
});

describe('provider registry', () => {
  it('falls back to the guides provider and merges defaults', () => {
    expect(getProvider('nope').id).toBe('guides');
    const settings = resolveProviderSettings(comfyUIProvider, { checkpoint: 'x.safetensors' });
    expect(settings.baseUrl).toBe('http://127.0.0.1:8188');
    expect(settings.checkpoint).toBe('x.safetensors');
  });
});

describe('generation orchestrator', () => {
  it('requires a source and an analysis first', () => {
    expect(generationBlocker(createEmptyProject())).toMatch(/Upload/);
    const p = readyProject();
    expect(generationBlocker({ ...p, character: null })).toMatch(/Analyze/);
    expect(generationBlocker(p)).toBeNull();
  });

  it('generates outward from the source and skips locked directions', () => {
    const p = readyProject();
    expect(generationOrder(p).slice(0, 3)).toEqual(['S', 'SE', 'SW']);
    const anim = activeAnimation(p);
    const locked = {
      ...p,
      animations: [{ ...anim, tracks: { ...anim.tracks, N: { ...anim.tracks.N, locked: true } } }],
    };
    expect(generationOrder(locked)).not.toContain('N');
    expect(seedFor(100, 'N')).not.toBe(seedFor(100, 'NE'));
  });

  it('builds direction prompts with handedness rules for asymmetric characters', () => {
    const p = readyProject();
    const ref = characterReference(p.character!, p.setup);
    const n = buildDirectionPrompt(ref, 'N', { style: 'tags' });
    expect(n.positive).toContain('back view');
    expect(n.positive).toContain("character's right side appears on the RIGHT side of the image");
    expect(n.negative).toContain('mirrored');
    expect(n.negative).toContain('left-handed');
    const se = buildDirectionPrompt(ref, 'SE', { style: 'instruction' });
    expect(se.primary).toBe(se.instruction);
    expect(se.instruction).toMatch(/Do not mirror/);
    const sym = buildDirectionPrompt({ ...ref, symmetry: 'symmetric' }, 'E', { style: 'tags' });
    expect(sym.sideRules).toEqual([]);
    expect(sym.negative).not.toContain('mirrored');
  });

  it('leads with the view, asks for a plain background early and names view-specific mistakes', () => {
    const p = readyProject();
    const ref = characterReference(p.character!, p.setup);
    const tokens = (text: string) => text.split(', ');
    for (const d of ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const) {
      const prompt = buildDirectionPrompt(ref, d, { style: 'tags', backgroundName: 'gray' });
      // Text encoders weight the start of a prompt most: the view must come first.
      expect(prompt.positive.startsWith(prompt.viewPhrase), d).toBe(true);
      expect(tokens(prompt.positive).slice(0, 12)).toContain('plain gray background');
      expect(prompt.negative).toContain('gradient background');
    }
    const neg = (d: 'N' | 'NE' | 'NW' | 'S' | 'E') =>
      buildDirectionPrompt(ref, d, { style: 'tags' }).negative;
    // Back views must not show a face; front and side views must not turn their back.
    for (const d of ['N', 'NE', 'NW'] as const) expect(neg(d), d).toContain('eyes');
    expect(neg('S')).toContain('seen from behind');
    expect(neg('S')).not.toContain('eyes, nose');
    expect(neg('E')).toContain('front view');
  });

  it('returns the source unchanged for the source direction', async () => {
    const p = readyProject();
    const view = await generateView({
      project: p,
      provider: sprite8HttpProvider,
      providerSettings: {},
      direction: 'S',
      seed: 1,
      mode: 'generate',
      ctx: { codec: nodeCodec, fetch: () => Promise.reject(new Error('no network')) },
    });
    expect(view.status).toBe('source');
  });

  it('conforms an AI result from the Sprite8 HTTP protocol to the character', async () => {
    const p = readyProject();
    let body: Sprite8GenerateRequestBody | null = null;
    const { fetch } = mockFetch(async (url, init) => {
      expect(url.pathname).toBe('/generate');
      body = JSON.parse(String(init?.body));
      return json({ image: pngBase64(backViewRender()), seed: 99 });
    });
    const progress: number[] = [];
    const ctx: ProviderContext = { codec: nodeCodec, fetch, onProgress: (f) => progress.push(f) };
    const view = await generateView({
      project: p,
      provider: sprite8HttpProvider,
      providerSettings: resolveProviderSettings(sprite8HttpProvider, {
        endpoint: 'http://ai.local',
      }),
      direction: 'N',
      seed: 7,
      mode: 'generate',
      ctx,
    });
    expect(body!.protocol).toBe('sprite8/1');
    expect(body!.direction).toBe('N');
    expect(body!.sourceDirection).toBe('S');
    expect(body!.seed).toBe(7);
    expect(body!.character.symmetry).toBe('asymmetric');
    expect(body!.character.handedness).toBe('right');
    expect(body!.sourceImage.length).toBeGreaterThan(100);
    expect(view.status).toBe('ai');
    expect(view.origin.seed).toBe(99);
    expect(view.image!.width).toBe(p.cell.width);
    const palette = p.character!.colors.palette.map((h) => hexToRgba(h)!) as Rgba[];
    expect(paletteCoverage(view.image!, palette)).toBe(1);
    expect(findFeet(view.image!)!.groundY).toBe(p.cell.anchorY);
    expect(
      Math.abs(findFeet(view.image!)!.bounds.height - p.source!.sprite.height),
    ).toBeLessThanOrEqual(1);
    expect(progress.length).toBeGreaterThan(0);
  });

  it('never lets a guide result wipe existing pixels', () => {
    const view = {
      direction: 'N' as const,
      frame: 0,
      image: null,
      status: 'guide' as const,
      origin: { kind: 'guide' as const, createdAt: 0 },
      warnings: [],
    };
    expect(
      shouldApplyView({ id: 'a', image: createRaster(2, 2), status: 'edited', origin: null }, view),
    ).toBe(false);
    expect(shouldApplyView({ id: 'a', image: null, status: 'empty', origin: null }, view)).toBe(
      true,
    );
  });
});

describe('ComfyUI provider', () => {
  it('uploads, queues the filled workflow, polls history and downloads the image', async () => {
    const p = readyProject();
    let queued: Record<string, { class_type: string; inputs: Record<string, unknown> }> = {};
    let polls = 0;
    const { fetch, calls } = mockFetch(async (url, init) => {
      if (url.pathname === '/upload/image') {
        const form = init?.body as FormData;
        const file = form.get('image') as File;
        expect(form.get('type')).toBe('input');
        return json({ name: file.name, subfolder: '', type: 'input' });
      }
      if (url.pathname === '/prompt') {
        queued = JSON.parse(String(init?.body)).prompt;
        return json({ prompt_id: 'p1', number: 1, node_errors: {} });
      }
      if (url.pathname === '/history/p1') {
        polls++;
        if (polls < 2) return json({});
        return json({
          p1: {
            status: { completed: true, status_str: 'success' },
            outputs: { '8': { images: [{ filename: 'out.png', subfolder: '', type: 'output' }] } },
          },
        });
      }
      if (url.pathname === '/view') {
        expect(url.searchParams.get('filename')).toBe('out.png');
        return new Response(encodePng(512, 512, backViewRender().data) as Uint8Array<ArrayBuffer>, {
          headers: { 'Content-Type': 'image/png' },
        });
      }
      return new Response('not found', { status: 404 });
    });
    const view = await generateView({
      project: p,
      provider: comfyUIProvider,
      providerSettings: resolveProviderSettings(comfyUIProvider, {
        baseUrl: 'http://comfy.local',
        checkpoint: 'sd15.safetensors',
        steps: 12,
      }),
      direction: 'N',
      seed: 1234,
      mode: 'generate',
      ctx: { codec: nodeCodec, fetch },
    });
    expect(view.status).toBe('ai');
    expect(queued['1'].inputs.ckpt_name).toBe('sd15.safetensors');
    expect(String(queued['2'].inputs.image)).toMatch(/^sprite8_src_N_1234_/);
    expect(queued['6'].inputs.seed).toBe(1234);
    expect(queued['6'].inputs.steps).toBe(12);
    expect(String(queued['4'].inputs.text)).toContain('back view');
    expect(calls.map((c) => c.url.split('?')[0])).toEqual([
      '/upload/image',
      '/prompt',
      '/history/p1',
      '/history/p1',
      '/view',
    ]);
  });

  it('surfaces workflow errors from ComfyUI', async () => {
    const p = readyProject();
    const { fetch } = mockFetch(async (url) => {
      if (url.pathname === '/upload/image') return json({ name: 'a.png' });
      return json(
        {
          error: { message: 'Prompt outputs failed validation' },
          node_errors: {
            '1': {
              class_type: 'CheckpointLoaderSimple',
              errors: [{ message: 'Value not in list', details: 'ckpt_name' }],
            },
          },
        },
        400,
      );
    });
    await expect(
      generateView({
        project: p,
        provider: comfyUIProvider,
        providerSettings: resolveProviderSettings(comfyUIProvider, {
          baseUrl: 'http://comfy.local',
          checkpoint: 'missing',
        }),
        direction: 'N',
        seed: 1,
        mode: 'generate',
        ctx: { codec: nodeCodec, fetch },
      }),
    ).rejects.toThrow(/Value not in list/);
  });

  it('asks for a checkpoint when the template needs one', async () => {
    const p = readyProject();
    const { fetch } = mockFetch(async () => json({ name: 'a.png' }));
    await expect(
      generateView({
        project: p,
        provider: comfyUIProvider,
        providerSettings: resolveProviderSettings(comfyUIProvider, {}),
        direction: 'N',
        seed: 1,
        mode: 'generate',
        ctx: { codec: nodeCodec, fetch },
      }),
    ).rejects.toThrow(/CHECKPOINT/);
  });

  it('lists checkpoints in the status check', async () => {
    const { fetch } = mockFetch(async (url) =>
      url.pathname === '/system_stats'
        ? json({ system: { comfyui_version: '0.3.60' }, devices: [{ name: 'cuda:0' }] })
        : json({
            CheckpointLoaderSimple: {
              input: { required: { ckpt_name: [['a.safetensors', 'b.ckpt']] } },
            },
          }),
    );
    const status = await comfyUIProvider.checkStatus(
      { baseUrl: 'http://comfy.local' },
      { codec: nodeCodec, fetch },
    );
    expect(status.ok).toBe(true);
    expect(status.details?.join(' ')).toContain('a.safetensors, b.ckpt');
  });
});

describe('Stable Diffusion WebUI provider', () => {
  it('calls img2img with the prepared source and reads the seed back', async () => {
    const p = readyProject();
    let req: Record<string, unknown> = {};
    const { fetch } = mockFetch(async (url, init) => {
      if (url.pathname === '/sdapi/v1/progress') return json({ progress: 0.5 });
      req = JSON.parse(String(init?.body));
      return json({ images: [pngBase64(backViewRender())], info: JSON.stringify({ seed: 77 }) });
    });
    const view = await generateView({
      project: p,
      provider: a1111Provider,
      providerSettings: resolveProviderSettings(a1111Provider, {
        baseUrl: 'http://sd.local',
        denoise: 0.6,
      }),
      direction: 'N',
      seed: 5,
      mode: 'generate',
      ctx: { codec: nodeCodec, fetch },
    });
    expect(req.denoising_strength).toBe(0.6);
    expect(req.seed).toBe(5);
    expect((req.init_images as string[])[0].length).toBeGreaterThan(100);
    expect(view.origin.seed).toBe(77);
  });

  it('uses CLIP interrogate to describe the character', async () => {
    const p = readyProject();
    const { fetch } = mockFetch(async () => json({ caption: 'a hockey player holding a stick' }));
    const hints = await a1111Provider.analyzeCharacter(
      {
        sprite: p.source!.sprite,
        analysis: p.analysis!,
        character: characterReference(p.character!, p.setup),
        settings: resolveProviderSettings(a1111Provider, { baseUrl: 'http://sd.local' }),
      },
      { codec: nodeCodec, fetch },
    );
    expect(hints.description).toBe('a hockey player holding a stick');
  });
});

describe('friendly network errors', () => {
  it('explains CORS / server problems', async () => {
    const p = readyProject();
    const fetch = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof globalThis.fetch;
    const status = await sprite8HttpProvider.checkStatus(
      { endpoint: 'http://127.0.0.1:9' },
      { codec: nodeCodec, fetch },
    );
    expect(status.ok).toBe(false);
    expect(status.details?.join(' ')).toMatch(/CORS/);
    await expect(
      generateView({
        project: p,
        provider: sprite8HttpProvider,
        providerSettings: { endpoint: 'http://127.0.0.1:9' },
        direction: 'N',
        seed: 1,
        mode: 'generate',
        ctx: { codec: nodeCodec, fetch },
      }),
    ).rejects.toThrow(/Could not reach/);
  });
});

/** A tiny ComfyUI stand-in that records what was queued. */
function fakeComfy(onQueue?: (wf: Record<string, { inputs: Record<string, unknown> }>) => void) {
  const uploads: string[] = [];
  const files = new Map<string, File>();
  const handler: Handler = async (url, init) => {
    if (url.pathname === '/upload/image') {
      const file = (init!.body as FormData).get('image') as File;
      uploads.push(file.name);
      files.set(file.name, file);
      return json({ name: file.name, subfolder: '', type: 'input' });
    }
    if (url.pathname === '/prompt') {
      onQueue?.(JSON.parse(String(init?.body)).prompt);
      return json({ prompt_id: 'p1', number: 1, node_errors: {} });
    }
    if (url.pathname === '/history/p1')
      return json({
        p1: {
          status: { completed: true, status_str: 'success' },
          outputs: Object.fromEntries(
            ['8', '11'].map((id) => [
              id,
              { images: [{ filename: 'out.png', subfolder: '', type: 'output' }] },
            ]),
          ),
        },
      });
    if (url.pathname === '/view')
      return new Response(encodePng(512, 512, backViewRender().data) as Uint8Array<ArrayBuffer>, {
        headers: { 'Content-Type': 'image/png' },
      });
    return new Response('not found', { status: 404 });
  };
  return { uploads, files, ...mockFetch(handler) };
}

describe('ComfyUI presets', () => {
  const STOCK = new Set([
    'CheckpointLoaderSimple',
    'LoadImage',
    'VAEEncode',
    'VAEDecode',
    'CLIPTextEncode',
    'KSampler',
    'SaveImage',
    'ControlNetLoader',
    'ControlNetApplyAdvanced',
    'LoraLoader',
    'LoadImageMask',
    'SetLatentNoiseMask',
  ]);
  const CUSTOM = new Set(['IPAdapterUnifiedLoader', 'IPAdapter']);

  for (const [id, preset] of Object.entries(COMFY_PRESETS)) {
    it(`"${id}" is a consistent API-format workflow`, () => {
      const wf = parseWorkflow(preset.workflow);
      const ids = new Set(Object.keys(wf));
      for (const [nodeId, node] of Object.entries(wf)) {
        expect(STOCK.has(node.class_type) || CUSTOM.has(node.class_type), node.class_type).toBe(
          true,
        );
        for (const [input, value] of Object.entries(node.inputs)) {
          // Links are [nodeId, outputIndex] and must point at an existing node.
          if (Array.isArray(value))
            expect(ids.has(String(value[0])), `${nodeId}.${input}`).toBe(true);
        }
      }
      expect(Object.values(wf).some((n) => n.class_type === 'SaveImage')).toBe(true);
      for (const name of findPlaceholders(wf)) expect(KNOWN_PLACEHOLDERS).toContain(name);
    });
  }

  it('only the IP-Adapter preset needs custom nodes', () => {
    for (const [id, preset] of Object.entries(COMFY_PRESETS)) {
      const classes = Object.values(parseWorkflow(preset.workflow)).map((n) => n.class_type);
      expect(
        classes.some((c) => CUSTOM.has(c)),
        id,
      ).toBe(id === 'sd15-pose-ipadapter');
    }
  });

  it('draws and uploads the pose guide only for workflows that use it', async () => {
    const p = readyProject();
    const base = { baseUrl: 'http://comfy.local', checkpoint: 'sd15.safetensors' };
    let basicQueued: Record<string, { inputs: Record<string, unknown> }> = {};
    const basic = fakeComfy((wf) => (basicQueued = wf));
    await generateView({
      project: p,
      provider: comfyUIProvider,
      providerSettings: resolveProviderSettings(comfyUIProvider, base),
      direction: 'E',
      seed: 1,
      mode: 'generate',
      ctx: { codec: nodeCodec, fetch: basic.fetch },
    });
    expect(basic.uploads.some((n) => n.startsWith('sprite8_pose_'))).toBe(false);
    expect(basicQueued['6'].inputs.denoise).toBe(0.8); // automatic: plain image-to-image

    let queued: Record<string, { inputs: Record<string, unknown> }> = {};
    const pose = fakeComfy((wf) => (queued = wf));
    await generateView({
      project: p,
      provider: comfyUIProvider,
      providerSettings: resolveProviderSettings(comfyUIProvider, {
        ...base,
        preset: 'sd15-pose',
        controlStrength: 0.65,
        controlnet: 'openpose.safetensors',
      }),
      direction: 'E',
      seed: 1,
      mode: 'generate',
      ctx: { codec: nodeCodec, fetch: pose.fetch },
    });
    const poseUpload = pose.uploads.find((n) => n.startsWith('sprite8_pose_E_'));
    expect(poseUpload).toBeTruthy();
    expect(queued['3'].inputs.image).toBe(poseUpload);
    expect(queued['4'].inputs.control_net_name).toBe('openpose.safetensors');
    expect(queued['7'].inputs.strength).toBe(0.65);
    expect(queued['9'].inputs.denoise).toBe(1); // automatic: pose workflows repaint everything
    const maskUpload = pose.uploads.find((n) => n.startsWith('sprite8_mask_E_'));
    expect(maskUpload).toBeTruthy();
    expect(queued['14'].inputs.image).toBe(maskUpload);
    expect(queued['15'].inputs.samples).toEqual(['8', 0]);
    expect(queued['9'].inputs.latent_image).toEqual(['15', 0]);
    // New views start from a blank background, not from the source image.
    const initUpload = pose.uploads.find((n) => n.startsWith('sprite8_init_E_'));
    expect(initUpload).toBeTruthy();
    expect(queued['16'].inputs.image).toBe(initUpload);
    const init = await nodeCodec.decode(pose.files.get(initUpload!)!);
    const first = init.data.slice(0, 4);
    for (let i = 0; i < init.data.length; i += 4)
      expect([...init.data.slice(i, i + 4)]).toEqual([...first]);
  });

  it('starts a variation from the current view', async () => {
    let queued: Record<string, { inputs: Record<string, unknown> }> = {};
    const fake = fakeComfy((wf) => (queued = wf));
    const p = readyProject();
    const withE = {
      ...p,
      animations: p.animations.map((a) => ({
        ...a,
        tracks: {
          ...a.tracks,
          E: {
            ...a.tracks.E,
            frames: [{ ...a.tracks.S.frames[0], id: 'e0', status: 'edited' as const }],
          },
        },
      })),
    };
    await generateView({
      project: withE,
      provider: comfyUIProvider,
      providerSettings: resolveProviderSettings(comfyUIProvider, {
        baseUrl: 'http://comfy.local',
        checkpoint: 'x.safetensors',
        preset: 'sd15-pose',
      }),
      direction: 'E',
      seed: 1,
      mode: 'variation',
      ctx: { codec: nodeCodec, fetch: fake.fetch },
    });
    expect(String(queued['16'].inputs.image)).toMatch(/^sprite8_src_E_/);
    expect(fake.uploads.some((n) => n.startsWith('sprite8_init_'))).toBe(false);
  });

  it('can repaint the whole image when the background protection is off', async () => {
    const brightness = async (settings: Record<string, string | number | boolean>) => {
      const fake = fakeComfy();
      await generateView({
        project: readyProject(),
        provider: comfyUIProvider,
        providerSettings: resolveProviderSettings(comfyUIProvider, {
          baseUrl: 'http://comfy.local',
          checkpoint: 'x.safetensors',
          preset: 'sd15-pose',
          ...settings,
        }),
        direction: 'E',
        seed: 1,
        mode: 'generate',
        ctx: { codec: nodeCodec, fetch: fake.fetch },
      });
      const name = fake.uploads.find((n) => n.startsWith('sprite8_mask_'))!;
      const img = await nodeCodec.decode(fake.files.get(name)!);
      let white = 0;
      for (let i = 0; i < img.data.length; i += 4) if (img.data[i] === 255) white++;
      return white / (img.width * img.height);
    };
    expect(await brightness({})).toBeLessThan(0.5);
    expect(await brightness({ protectBackground: false })).toBe(1);
  });

  it('honours an explicit denoise and uses the variation strength for variations', async () => {
    const p = readyProject();
    const run = async (
      settings: Record<string, string | number>,
      mode: 'generate' | 'variation',
    ) => {
      let queued: Record<string, { inputs: Record<string, unknown> }> = {};
      const fake = fakeComfy((wf) => (queued = wf));
      const project =
        mode === 'variation'
          ? {
              ...p,
              animations: p.animations.map((a) => ({
                ...a,
                tracks: {
                  ...a.tracks,
                  E: {
                    ...a.tracks.E,
                    frames: [
                      {
                        ...a.tracks.S.frames[0],
                        id: 'e0',
                        status: 'edited' as const,
                        image: a.tracks.S.frames[0].image,
                      },
                    ],
                  },
                },
              })),
            }
          : p;
      await generateView({
        project,
        provider: comfyUIProvider,
        providerSettings: resolveProviderSettings(comfyUIProvider, {
          baseUrl: 'http://comfy.local',
          checkpoint: 'x.safetensors',
          preset: 'sd15-pose',
          ...settings,
        }),
        direction: 'E',
        seed: 1,
        mode,
        ctx: { codec: nodeCodec, fetch: fake.fetch },
      });
      return queued['9'].inputs.denoise;
    };
    expect(await run({ denoise: 0.55 }, 'generate')).toBe(0.55);
    expect(await run({ denoise: 0.55 }, 'variation')).toBe(p.generation.variationStrength);
  });

  it('lets a pasted workflow override the preset, but ignores the old default text', async () => {
    const p = readyProject();
    const base = { baseUrl: 'http://comfy.local', checkpoint: 'x.safetensors' };
    const run = async (settings: Record<string, string | number>) => {
      let queued: Record<string, unknown> = {};
      const fake = fakeComfy((wf) => (queued = wf));
      await generateView({
        project: p,
        provider: comfyUIProvider,
        providerSettings: resolveProviderSettings(comfyUIProvider, { ...base, ...settings }),
        direction: 'E',
        seed: 1,
        mode: 'generate',
        ctx: { codec: nodeCodec, fetch: fake.fetch },
      });
      return Object.keys(queued);
    };
    // Older versions stored the basic template as the field default — it must not beat the preset.
    expect(await run({ preset: 'sd15-pose', workflow: DEFAULT_COMFY_WORKFLOW })).toContain('7');
    const custom = JSON.stringify({
      '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: '{{CHECKPOINT}}' } },
      '2': { class_type: 'SaveImage', inputs: { images: ['1', 0], filename_prefix: 'x' } },
    });
    expect(await run({ preset: 'sd15-pose', workflow: custom })).toEqual(['1', '2']);
  });

  it('asks for a LoRA when the LoRA preset has none', async () => {
    const fake = fakeComfy();
    await expect(
      generateView({
        project: readyProject(),
        provider: comfyUIProvider,
        providerSettings: resolveProviderSettings(comfyUIProvider, {
          baseUrl: 'http://comfy.local',
          checkpoint: 'x.safetensors',
          preset: 'sd15-pose-lora',
        }),
        direction: 'E',
        seed: 1,
        mode: 'generate',
        ctx: { codec: nodeCodec, fetch: fake.fetch },
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('{{LORA}}') });
  });

  it('warns when the configured models are not installed', async () => {
    const { fetch } = mockFetch(async (url) => {
      if (url.pathname === '/system_stats') return json({ devices: [{ name: 'cuda:0' }] });
      const node = url.pathname.split('/').pop()!;
      const choices: Record<string, [string, string[]]> = {
        CheckpointLoaderSimple: ['ckpt_name', ['sd15.safetensors']],
        ControlNetLoader: ['control_net_name', ['canny.safetensors']],
      };
      const c = choices[node];
      return json(c ? { [node]: { input: { required: { [c[0]]: [c[1]] } } } } : {});
    });
    const status = await comfyUIProvider.checkStatus(
      {
        baseUrl: 'http://comfy.local',
        preset: 'sd15-pose',
        checkpoint: 'sd15.safetensors',
        controlnet: 'openpose.safetensors',
      },
      { codec: nodeCodec, fetch },
    );
    const text = status.details?.join('\n') ?? '';
    expect(text).toContain('ControlNet models: canny.safetensors');
    expect(text).toMatch(/Warning: "openpose.safetensors" is not among the installed controlnet/);
    expect(text).not.toMatch(/Warning: "sd15/);
  });

  it('detects missing IP-Adapter nodes', async () => {
    const { fetch } = mockFetch(async (url) =>
      url.pathname === '/system_stats' ? json({}) : json({}),
    );
    const status = await comfyUIProvider.checkStatus(
      { baseUrl: 'http://comfy.local', preset: 'sd15-pose-ipadapter' },
      { codec: nodeCodec, fetch },
    );
    expect(status.details?.join(' ')).toMatch(/IP-Adapter nodes are missing/);
  });

  it('adds an install hint when ComfyUI does not know a node', async () => {
    const { fetch } = mockFetch(async (url) =>
      url.pathname === '/upload/image'
        ? json({ name: 'a.png' })
        : json(
            { error: { message: 'Cannot execute because node IPAdapter does not exist.' } },
            400,
          ),
    );
    await expect(
      generateView({
        project: readyProject(),
        provider: comfyUIProvider,
        providerSettings: resolveProviderSettings(comfyUIProvider, {
          baseUrl: 'http://comfy.local',
          checkpoint: 'x.safetensors',
          preset: 'sd15-pose-ipadapter',
        }),
        direction: 'E',
        seed: 1,
        mode: 'generate',
        ctx: { codec: nodeCodec, fetch },
      }),
    ).rejects.toMatchObject({ hint: expect.stringContaining('ComfyUI_IPAdapter_plus') });
  });
});

describe('Sprite8 HTTP provider pose guide', () => {
  it('sends an aligned pose image with every request', async () => {
    let body: Sprite8GenerateRequestBody | null = null;
    const { fetch } = mockFetch(async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return json({ image: pngBase64(backViewRender()) });
    });
    await generateView({
      project: readyProject(),
      provider: sprite8HttpProvider,
      providerSettings: { endpoint: 'http://srv.local' },
      direction: 'E',
      seed: 1,
      mode: 'generate',
      ctx: { codec: nodeCodec, fetch },
    });
    const sent = body as Sprite8GenerateRequestBody | null;
    expect(sent?.poseImage.length).toBeGreaterThan(100);
    const pose = await nodeCodec.decode(
      new Blob([Buffer.from(sent!.poseImage, 'base64')], { type: 'image/png' }),
    );
    expect(pose.width).toBe(sent!.width);
  });
});

describe('prepareProviderInput framing', () => {
  it('keeps a wide, lopsided character fully inside the canvas', () => {
    // Legs far to the right, a long stick reaching far to the left (a crouching player).
    const sprite = createRaster(80, 60);
    const ink = { r: 20, g: 20, b: 20, a: 255 };
    for (let y = 10; y < 58; y++)
      for (let x = 60; x < 70; x++) blit(sprite, createRaster(1, 1, ink), x, y);
    for (let y = 20; y < 24; y++)
      for (let x = 0; x < 70; x++) blit(sprite, createRaster(1, 1, ink), x, y);
    const size = 256;
    const white = { color: { r: 255, g: 255, b: 255, a: 255 }, name: 'white' };
    const input = prepareProviderInput(sprite, size, { pixelArt: true, background: white });
    const { mask } = foregroundMask(input.image, white.color);
    let minX = size;
    let maxX = -1;
    for (let i = 0; i < mask.length; i++)
      if (mask[i]) {
        minX = Math.min(minX, i % size);
        maxX = Math.max(maxX, i % size);
      }
    expect(minX).toBeGreaterThanOrEqual(Math.round(size * 0.02));
    expect(maxX).toBeLessThan(size - Math.round(size * 0.02));
    // The reported body centre is where the feet really are.
    const feet = findFeet(input.image)!;
    expect(Math.abs(input.body!.centerX - feet.feetX)).toBeLessThanOrEqual(2);
    // A normal character is still centred on its feet.
    const normal = prepareProviderInput(outlined(humanoid({ stick: 'screen-left' })), size, {
      pixelArt: true,
      background: white,
    });
    expect(Math.abs(normal.body!.centerX - size / 2)).toBeLessThanOrEqual(1);
  });
});
