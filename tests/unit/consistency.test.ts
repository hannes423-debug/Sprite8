import { describe, expect, it } from 'vitest';
import { analyzeSprite } from '../../src/core/analysis';
import { createCharacterModel } from '../../src/core/character';
import { conformToCharacter, consistencyReport, reportStatus, type ConformContext } from '../../src/core/consistency';
import { createWorkingCell, placeOnAnchor } from '../../src/core/project';
import {
  blit,
  createRaster,
  findFeet,
  flipHorizontal,
  hexToRgba,
  paletteCoverage,
  scaleNearest,
  type Rgba,
} from '../../src/core/sprite';
import { C, humanoid, outlined, rng } from './helpers';

const sprite = outlined(humanoid({ stick: 'screen-left' }));
const cell = createWorkingCell(sprite.width, sprite.height);
const analysis = analyzeSprite(sprite, { sourceDirection: 'S', pixelArt: true });
const model = createCharacterModel(sprite, analysis);
const palette = model.colors.palette.map((h) => hexToRgba(h)!) as Rgba[];

function ctx(over: Partial<ConformContext> = {}): ConformContext {
  return {
    cell,
    pixelArt: true,
    locks: model.locks,
    palette,
    outline: null,
    referenceHeight: sprite.height,
    scaleMode: 'height',
    backgroundHint: C.white,
    ...over,
  };
}

/** Simulates an AI render: upscaled ~10×, off-centre, on white, with colour noise. */
function fakeAiRender(src = sprite): ReturnType<typeof createRaster> {
  const big = scaleNearest(src, src.width * 10 + 7, src.height * 10 + 7);
  const canvas = blit(createRaster(768, 768, C.white), big, 120, 210);
  const r = rng(42);
  for (let i = 0; i < canvas.data.length; i += 4) {
    if (canvas.data[i] === 255 && canvas.data[i + 1] === 255 && canvas.data[i + 2] === 255) continue;
    for (let c = 0; c < 3; c++) canvas.data[i + c] = Math.max(0, Math.min(255, canvas.data[i + c] + Math.round((r() - 0.5) * 16)));
  }
  return canvas;
}

describe('conform pipeline', () => {
  it('turns a noisy high-res render into a sprite matching the reference', () => {
    const res = conformToCharacter(fakeAiRender(), ctx());
    expect(res.image.width).toBe(cell.width);
    const feet = findFeet(res.image)!;
    expect(feet.groundY).toBe(cell.anchorY); // stands on the ground line
    expect(Math.abs(feet.feetX - cell.anchorX)).toBeLessThanOrEqual(1);
    expect(Math.abs(feet.bounds.height - sprite.height)).toBeLessThanOrEqual(1); // same height
    expect(paletteCoverage(res.image, palette)).toBe(1); // palette lock
    expect(res.metrics.removedBackground).toBe(true);
  });

  it('keeps colours when the palette is unlocked', () => {
    const res = conformToCharacter(fakeAiRender(), ctx({ locks: { ...model.locks, palette: false } }));
    expect(paletteCoverage(res.image, palette)).toBeLessThan(0.9);
  });

  it('can keep the generation scale instead of matching height', () => {
    const res = conformToCharacter(fakeAiRender(), ctx({ scaleMode: 'generation', generationScale: 5 }));
    expect(res.metrics.contentHeight).toBeGreaterThan(sprite.height * 1.8); // ≈ 507 / 5
    expect(res.warnings.join(' ')).toMatch(/clipped/);
  });

  it('rejects empty results', () => {
    expect(() => conformToCharacter(createRaster(64, 64, C.white), ctx())).toThrow(/empty/);
  });
});

describe('consistency report', () => {
  const sourceImage = placeOnAnchor(sprite, cell).image;
  const base = { direction: 'N' as const, sourceDirection: 'S' as const, sourceImage, cell, character: model, symmetry: 'asymmetric' as const };

  it('accepts a well-formed view', () => {
    const goodBack = placeOnAnchor(flipHorizontal(sprite), cell).image;
    const checks = consistencyReport({ ...base, frame: { id: 'x', image: goodBack, status: 'ai', origin: null } });
    expect(checks.find((c) => c.id === 'height')?.status).toBe('ok');
    expect(checks.find((c) => c.id === 'ground')?.status).toBe('ok');
    expect(checks.find((c) => c.id === 'palette')?.status).toBe('ok');
    expect(checks.find((c) => c.id === 'handedness')?.status).toBe('ok');
    expect(reportStatus(checks)).toBe('ok');
  });

  it('flags floating feet, wrong height and mirrored handedness', () => {
    const small = scaleNearest(sprite, Math.round(sprite.width * 0.7), Math.round(sprite.height * 0.7));
    const floating = blit(createRaster(cell.width, cell.height), small, 10, 5);
    const checks = consistencyReport({ ...base, direction: 'NE', frame: { id: 'x', image: floating, status: 'ai', origin: null } });
    expect(checks.find((c) => c.id === 'height')?.status).toBe('warn');
    expect(checks.find((c) => c.id === 'ground')?.message).toMatch(/float/);
    expect(checks.find((c) => c.id === 'handedness')?.status).toBe('warn');
    expect(reportStatus(checks)).toBe('warn');
  });

  it('explains guide-only frames', () => {
    const checks = consistencyReport({ ...base, frame: { id: 'x', image: null, status: 'guide', origin: null } });
    expect(checks[0].message).toMatch(/Guides only/);
  });
});
