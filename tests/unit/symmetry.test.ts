import { describe, expect, it } from 'vitest';
import { createCharacterModel, characterReference } from '../../src/core/character';
import { analyzeSprite } from '../../src/core/analysis';
import { buildDirectionPrompt } from '../../src/core/generation';
import { guidesProvider } from '../../src/core/providers';
import type { DirectionRequest } from '../../src/core/providers';
import { createRaster, findFeet, getPixel, setPixelInPlace } from '../../src/core/sprite';
import {
  isMirrorDerivable,
  mirrorFrame,
  mirrorShortcutAllowed,
  oppositeSilhouette,
  planMirrorDerivations,
  silhouetteGuideSource,
  symmetrize,
} from '../../src/core/symmetry';
import { createWorkingCell, placeOnAnchor } from '../../src/core/project';
import { C, humanoid, nodeCodec } from './helpers';

describe('mirror rules', () => {
  it('only allows the shortcut for symmetric characters that opted in', () => {
    expect(mirrorShortcutAllowed('symmetric', true)).toBe(true);
    expect(mirrorShortcutAllowed('symmetric', false)).toBe(false);
    expect(mirrorShortcutAllowed('asymmetric', true)).toBe(false);
  });

  it('never derives N or S by mirroring', () => {
    expect(isMirrorDerivable('N')).toBe(false);
    expect(isMirrorDerivable('S')).toBe(false);
    expect(planMirrorDerivations(new Set(['S']))).toEqual([]);
  });

  it('plans partner mirrors only across the vertical axis', () => {
    expect(planMirrorDerivations(new Set(['E', 'NE']))).toEqual([
      { target: 'W', from: 'E' },
      { target: 'NW', from: 'NE' },
    ]);
  });

  it('mirrors around the foot anchor so the feet stay in place', () => {
    const sprite = humanoid({ stick: 'screen-right' });
    const cell = createWorkingCell(sprite.width, sprite.height);
    const placed = placeOnAnchor(sprite, cell).image;
    const before = findFeet(placed)!;
    const after = findFeet(mirrorFrame(placed, cell.anchorX))!;
    expect(after.groundY).toBe(before.groundY);
    expect(Math.abs(after.feetX - cell.anchorX)).toBeLessThanOrEqual(1);
  });

  it('symmetrize copies one half onto the other', () => {
    const img = createRaster(6, 1);
    setPixelInPlace(img, 0, 0, C.red);
    setPixelInPlace(img, 5, 0, C.blue);
    const s = symmetrize(img, 3, 'left');
    expect(getPixel(s, 5, 0)).toEqual(C.red);
    expect(getPixel(s, 0, 0)).toEqual(C.red);
  });

  it('opposite-view silhouette is the mirrored outline', () => {
    const img = createRaster(6, 2);
    setPixelInPlace(img, 1, 1, C.red);
    const guide = oppositeSilhouette(img, 3, { r: 1, g: 2, b: 3, a: 99 });
    expect(getPixel(guide, 4, 1)).toEqual({ r: 1, g: 2, b: 3, a: 99 });
    expect(getPixel(guide, 1, 1).a).toBe(0);
    expect(silhouetteGuideSource('N', new Set(['S']))?.from).toBe('S');
    expect(silhouetteGuideSource('NE', new Set(['S']))).toBeNull();
  });
});

describe('guides provider (no AI)', () => {
  const sprite = humanoid({ stick: 'screen-left' });
  const cell = createWorkingCell(sprite.width, sprite.height);
  const placed = placeOnAnchor(sprite, cell).image;
  const analysis = analyzeSprite(sprite, { sourceDirection: 'E', pixelArt: true });
  const model = createCharacterModel(sprite, analysis);

  function request(
    symmetry: 'symmetric' | 'asymmetric',
    shortcut: boolean,
    direction: DirectionRequest['direction'],
  ): DirectionRequest {
    const ref = characterReference(model, { name: 'hero', symmetry, sourceDirection: 'E' });
    return {
      direction,
      character: ref,
      prompt: buildDirectionPrompt(ref, direction, { style: 'tags' }),
      input: { image: createRaster(4, 4), scale: 1, background: C.white, backgroundName: 'white' },
      references: [],
      views: [{ direction: 'E', image: placed, status: 'source' }],
      cell,
      seed: 1,
      options: { symmetryShortcut: shortcut },
      settings: {},
    };
  }
  const ctx = { codec: nodeCodec, fetch: globalThis.fetch };

  it('never mirrors an asymmetric character, even with the shortcut on', async () => {
    const res = await guidesProvider.generateDirection(request('asymmetric', true, 'W'), ctx);
    expect(res.kind).toBe('guide');
    expect(res.image).toBeNull();
    expect(res.notes?.join(' ')).toMatch(/Asymmetric/);
    expect(res.notes?.join(' ')).toMatch(/Outline mirrored from E/); // silhouette guide is offered
  });

  it('does not mirror a symmetric character unless the shortcut is enabled', async () => {
    expect(
      (await guidesProvider.generateDirection(request('symmetric', false, 'W'), ctx)).kind,
    ).toBe('guide');
    const res = await guidesProvider.generateDirection(request('symmetric', true, 'W'), ctx);
    expect(res.kind).toBe('mirror');
    expect(res.mirroredFrom).toBe('E');
    expect(res.image?.width).toBe(cell.width);
  });

  it('never invents non-partner views', async () => {
    for (const d of ['N', 'NE', 'SE', 'S', 'SW', 'NW'] as const) {
      const res = await guidesProvider.generateDirection(request('symmetric', true, d), ctx);
      expect(res.kind).toBe('guide');
    }
  });

  it('refuses variations', async () => {
    await expect(
      guidesProvider.generateVariation(
        {
          ...request('symmetric', true, 'W'),
          base: request('symmetric', true, 'W').input,
          strength: 0.5,
        },
        ctx,
      ),
    ).rejects.toThrow(/AI provider/);
  });
});
