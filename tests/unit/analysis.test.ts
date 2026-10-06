import { describe, expect, it } from 'vitest';
import { analyzeSprite, estimateProportions, symmetryScore } from '../../src/core/analysis';
import { createCharacterModel } from '../../src/core/character';
import { readFileSync } from 'node:fs';
import { decodePng } from '../../models/reference-server/png.mjs';
import { createRaster, findFeet } from '../../src/core/sprite';
import { C, humanoid, outlined } from './helpers';

describe('character analysis', () => {
  it('measures a symmetric humanoid', () => {
    const sprite = outlined(humanoid());
    const a = analyzeSprite(sprite, { sourceDirection: 'S', pixelArt: true });
    expect(a.symmetry.verdict).toBe('symmetric');
    expect(a.sourceDirectionHint.candidates).toEqual(['S', 'N']);
    expect(a.characterType.value).toBe('humanoid');
    // The outline hides the 2-row neck, so defaults are used (and labelled as such).
    expect(a.proportions.measured).toBe(false);
    expect(a.notes.join(' ')).toMatch(/default proportions/);
    expect(a.proportions.headsTall).toBeGreaterThan(3);
    expect(a.proportions.headsTall).toBeLessThan(6);
    expect(a.outline.detected).toBe(true);
    expect(a.outline.color).toBe('#1b1a29');
    expect(a.pixelArt.value).toBe(true);
    expect(a.artStyle.value).toBe('pixel-art');
    expect(a.palette.length).toBe(4);
    expect(a.dominant[0].name).toBe('red');
    expect(a.handedness.handedness).toBeNull();
    expect(a.camera.confidence).toBe(0); // honest: not measurable
  });

  it('detects one-sided equipment and suggests handedness', () => {
    const a = analyzeSprite(humanoid({ stick: 'screen-left' }), { sourceDirection: 'S', pixelArt: true });
    expect(a.symmetry.verdict).not.toBe('symmetric');
    expect(a.handedness.handedness).toBe('right');
    const model = createCharacterModel(humanoid({ stick: 'screen-left' }), a);
    expect(model.handedness).toBe('right');
    expect(model.features).toHaveLength(1);
    expect(model.features[0]).toMatchObject({ side: 'right', attachment: 'hand', category: 'equipment' });
  });

  it('symmetry score is near 1 for mirror-symmetric images', () => {
    const s = symmetryScore(humanoid());
    expect(s.score).toBeGreaterThan(0.95);
    expect(s.axisX).toBeCloseTo(20, 0);
  });

  it('keeps user-authored fields when re-analysing', () => {
    const sprite = humanoid();
    const a = analyzeSprite(sprite, { sourceDirection: 'S', pixelArt: true });
    const first = createCharacterModel(sprite, a);
    const edited = { ...first, description: 'hockey player', handedness: 'left' as const, locks: { ...first.locks, palette: false } };
    const again = createCharacterModel(sprite, a, edited);
    expect(again.description).toBe('hockey player');
    expect(again.handedness).toBe('left');
    expect(again.locks.palette).toBe(false);
  });

  it('measures body landmarks from the width profile', () => {
    const p = estimateProportions(humanoid({ scale: 1 }));
    expect(p.measured).toBe(true);
    expect(p.legsSeparated).toBe(true);
    expect(p.neckY).toBeGreaterThan(0.15);
    expect(p.neckY).toBeLessThan(0.3);
    expect(p.hipY).toBeGreaterThan(p.shoulderY);
    expect(p.kneeY).toBeGreaterThan(p.hipY);
    expect(p.hipY).toBeGreaterThan(0.45);
    expect(p.hipY).toBeLessThan(0.6);
  });

  it('falls back to default proportions when no neck is visible', () => {
    const blob = estimateProportions(createRaster(6, 20, C.red));
    expect(blob.measured).toBe(false);
    expect(blob.neckY).toBe(0.25);
  });
});

describe('bundled examples', () => {
  const load = (name: string) => {
    const { width, height, data } = decodePng(new Uint8Array(readFileSync(new URL(`../../assets/examples/${name}`, import.meta.url))));
    return { width, height, data };
  };

  it('reads the hockey player as an asymmetric, right-handed front view', () => {
    const sprite = load('hockey-player.png');
    const feet = findFeet(sprite)!;
    // The stick blade rests on the ice on the left; the feet are the skates.
    expect(feet.feetX).toBeGreaterThan(18);
    expect(feet.feetX).toBeLessThan(24);
    const a = analyzeSprite(sprite, { sourceDirection: 'S', pixelArt: true });
    expect(a.symmetry.verdict).toBe('asymmetric');
    expect(a.handedness.handedness).toBe('right');
    expect(a.outline.detected).toBe(true);
    expect(a.characterType.value).toBe('humanoid');
  });

  it('reads the robot as symmetric', () => {
    const a = analyzeSprite(load('robot.png'), { sourceDirection: 'S', pixelArt: true });
    expect(a.symmetry.verdict).toBe('symmetric');
    expect(a.handedness.handedness).toBeNull();
    expect(a.sourceDirectionHint.candidates).toEqual(['S', 'N']);
  });
});
