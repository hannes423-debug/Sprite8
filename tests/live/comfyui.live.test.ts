import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { encodePng } from '../../models/reference-server/png.mjs';
import { analyzeSprite } from '../../src/core/analysis';
import { createCharacterModel } from '../../src/core/character';
import { parseDirectionFromName, type Direction } from '../../src/core/directions';
import { generateView } from '../../src/core/generation';
import { consistencyReport } from '../../src/core/consistency';
import { activeAnimation, createEmptyProject, projectWithSource } from '../../src/core/project';
import { comfyUIProvider, resolveProviderSettings } from '../../src/core/providers';
import { normalizeImport } from '../../src/core/sprite';
import { nodeCodec } from '../unit/helpers';

const env = process.env;
const checkpoint = env.SPRITE8_COMFYUI_CHECKPOINT;
const out = env.SPRITE8_LIVE_OUT;
const directions = (env.SPRITE8_LIVE_DIRECTIONS ?? 'E')
  .split(',')
  .map((d) => parseDirectionFromName(`_${d.trim()}_`))
  .filter((d): d is Direction => !!d);

function save(name: string, img: { width: number; height: number; data: Uint8ClampedArray }) {
  if (!out) return;
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, name), encodePng(img.width, img.height, img.data));
}

describe.skipIf(!checkpoint)('ComfyUI (live)', () => {
  it('generates directions with the selected workflow and conforms them to the character', async () => {
    const file = env.SPRITE8_LIVE_IMAGE ?? 'assets/examples/hockey-player.png';
    const png = new Uint8Array(readFileSync(file));
    const raw = await nodeCodec.decode(new Blob([png]));
    // Same import settings as the app.
    const imported = normalizeImport(raw, { maxDimension: 512 });
    let project = projectWithSource(createEmptyProject(), imported, file.split('/').pop()!);
    const analysis = analyzeSprite(project.source!.sprite, {
      sourceDirection: 'S',
      pixelArt: imported.pixelArt,
      pixelScale: imported.pixelScale.scale,
    });
    project = {
      ...project,
      analysis,
      character: createCharacterModel(project.source!.sprite, analysis),
      generation: {
        ...project.generation,
        generationSize: Number(env.SPRITE8_LIVE_SIZE ?? 512),
        extraPrompt: env.SPRITE8_LIVE_EXTRA_PROMPT ?? '',
      },
    };

    const settings = resolveProviderSettings(comfyUIProvider, {
      baseUrl: env.SPRITE8_COMFYUI_URL ?? 'http://127.0.0.1:8188',
      checkpoint: checkpoint!,
      preset: env.SPRITE8_LIVE_PRESET ?? 'sd15-pose',
      steps: Number(env.SPRITE8_LIVE_STEPS ?? 20),
      ...(env.SPRITE8_LIVE_DENOISE ? { denoise: Number(env.SPRITE8_LIVE_DENOISE) } : {}),
      ...(env.SPRITE8_LIVE_CONTROL_STRENGTH
        ? { controlStrength: Number(env.SPRITE8_LIVE_CONTROL_STRENGTH) }
        : {}),
      ...(env.SPRITE8_LIVE_IPA_WEIGHT
        ? { ipAdapterWeight: Number(env.SPRITE8_LIVE_IPA_WEIGHT) }
        : {}),
      ...(env.SPRITE8_LIVE_IPA_MODE ? { ipAdapterMode: env.SPRITE8_LIVE_IPA_MODE } : {}),
      ...(env.SPRITE8_COMFYUI_LORA ? { lora: env.SPRITE8_COMFYUI_LORA } : {}),
    });

    const ctx = { codec: nodeCodec, fetch: globalThis.fetch };
    const status = await comfyUIProvider.checkStatus(settings, ctx);
    console.log(status.message, status.details);
    expect(status.ok).toBe(true);

    save('source.png', project.source!.sprite);
    if (out)
      writeFileSync(
        join(out, 'analysis.json'),
        JSON.stringify(
          {
            pixelArt: imported.pixelArt,
            warnings: imported.warnings,
            character: project.character,
          },
          null,
          2,
        ),
      );
    const report: Array<Record<string, unknown>> = [];
    let n = 0;
    for (const direction of directions) {
      // Keep the files ComfyUI is sent: the pose guide and the raw model output.
      const spy: typeof fetch = async (input, init) => {
        const body = init?.body;
        if (body instanceof FormData) {
          const upload = body.get('image');
          if (upload instanceof File && upload.name.startsWith('sprite8_pose_') && out) {
            mkdirSync(out, { recursive: true });
            writeFileSync(
              join(out, `${direction}_pose.png`),
              new Uint8Array(await upload.arrayBuffer()),
            );
          }
        }
        return fetch(input, init);
      };
      const codec = {
        ...nodeCodec,
        decode: async (blob: Blob) => {
          const img = await nodeCodec.decode(blob);
          save(`${direction}_raw.png`, img);
          return img;
        },
      };
      const started = Date.now();
      const view = await generateView({
        project,
        provider: comfyUIProvider,
        providerSettings: settings,
        direction,
        seed: 1000 + n++,
        mode: 'generate',
        ctx: { ...ctx, fetch: spy, codec },
      });
      const checks = consistencyReport({
        frame: { id: 'live', image: view.image, status: view.status, origin: view.origin },
        direction,
        sourceDirection: project.setup.sourceDirection,
        sourceImage: activeAnimation(project).tracks[project.setup.sourceDirection].frames[0].image,
        cell: project.cell,
        character: project.character,
        symmetry: project.setup.symmetry,
      });
      report.push({
        direction,
        seconds: Math.round((Date.now() - started) / 1000),
        warnings: view.warnings,
        checks: checks.map((c) => `${c.status}: ${c.label} — ${c.message}`),
      });
      if (out) writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
      expect(view.status).toBe('ai');
      expect(view.image!.width).toBe(project.cell.width);
      save(`${direction}_conformed.png`, view.image!);
    }
  });
});
