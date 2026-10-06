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
  comfyUIProvider,
  DEFAULT_COMFY_WORKFLOW,
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
