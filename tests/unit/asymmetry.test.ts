import { describe, expect, it } from 'vitest';
import {
  checkHandedness,
  describeSide,
  featureHint,
  frontBackPlacement,
  guessHandedness,
  handednessHint,
  sidePlacement,
  sideVisibility,
} from '../../src/core/asymmetry';
import { createFeature } from '../../src/core/character';
import { DIRECTIONS, mirroredDirection, oppositeDirection } from '../../src/core/directions';
import { flipHorizontal, mirrorAroundAxis } from '../../src/core/sprite';
import { humanoid } from './helpers';

describe('side visibility geometry', () => {
  // Where the character's RIGHT side appears in every facing direction.
  const expected: Record<string, [string, string]> = {
    N: ['right', 'level'],
    NE: ['right', 'near'],
    E: ['center', 'near'],
    SE: ['left', 'near'],
    S: ['left', 'level'],
    SW: ['left', 'far'],
    W: ['center', 'far'],
    NW: ['right', 'far'],
  };

  it.each(DIRECTIONS)('right side placement for %s', (d) => {
    const p = sidePlacement(d, 'right');
    expect([p.screen, p.placement]).toEqual(expected[d]);
  });

  it('left side is always the opposite of the right side', () => {
    for (const d of DIRECTIONS) {
      const r = sidePlacement(d, 'right');
      const l = sidePlacement(d, 'left');
      expect(l.screenX).toBeCloseTo(-r.screenX);
      expect(l.depth).toBeCloseTo(-r.depth);
    }
  });

  it('a mirrored view is NOT the same character: mirroring swaps which body side is on screen-left', () => {
    // Mirroring the image maps screenX -> -screenX. For the true view of the
    // mirrored direction the right side keeps its depth but its screen side
    // flips relative to a plain image flip — so a flipped right-handed sprite
    // turns into a left-handed one.
    for (const d of DIRECTIONS) {
      const m = mirroredDirection(d);
      const trueView = sidePlacement(m, 'right');
      const flippedImage = {
        screenX: -sidePlacement(d, 'right').screenX,
        depth: sidePlacement(d, 'right').depth,
      };
      if (Math.abs(trueView.screenX) > 0.3 || Math.abs(trueView.depth) > 0.3) {
        const sameScreen = Math.sign(trueView.screenX) === Math.sign(flippedImage.screenX);
        const sameDepth = Math.sign(trueView.depth) === Math.sign(flippedImage.depth);
        expect(sameScreen && sameDepth).toBe(false);
      }
    }
  });

  it('opposite views put a body side on mirrored screen positions', () => {
    for (const d of DIRECTIONS) {
      const a = sidePlacement(d, 'right');
      const b = sidePlacement(oppositeDirection(d), 'right');
      expect(b.screenX).toBeCloseTo(-a.screenX);
      expect(b.depth).toBeCloseTo(-a.depth);
    }
  });

  it('describes sides in plain language', () => {
    expect(describeSide('S', 'right')).toContain('LEFT side of the image');
    expect(describeSide('N', 'right')).toContain('RIGHT side of the image');
    expect(describeSide('E', 'right')).toContain('faces the camera');
    expect(describeSide('W', 'right')).toContain('hidden behind the body');
    expect(sideVisibility('E').nearSide).toBe('right');
    expect(sideVisibility('W').nearSide).toBe('left');
    expect(sideVisibility('S').nearSide).toBeNull();
  });

  it('knows when the front or back is visible', () => {
    expect(frontBackPlacement('S').front).toBe('near');
    expect(frontBackPlacement('N').back).toBe('near');
    expect(frontBackPlacement('E')).toEqual({ front: 'level', back: 'level' });
  });
});

describe('feature placement hints', () => {
  const stick = createFeature({ name: 'Hockey stick', side: 'right', attachment: 'hand' });
  const backpack = createFeature({ name: 'Backpack', side: 'center', attachment: 'back' });

  it('keeps a right-hand hockey stick on the correct side in every view', () => {
    expect(featureHint(stick, 'S').screen).toBe('left');
    expect(featureHint(stick, 'N').screen).toBe('right');
    expect(featureHint(stick, 'SE')).toMatchObject({ screen: 'left', visibility: 'visible' });
    expect(featureHint(stick, 'NW')).toMatchObject({
      screen: 'right',
      visibility: 'partly hidden',
    });
    expect(featureHint(stick, 'E').text).toContain('in front of the body');
    expect(featureHint(stick, 'W')).toMatchObject({ visibility: 'hidden' });
  });

  it('handles back-mounted items', () => {
    expect(featureHint(backpack, 'N').visibility).toBe('visible');
    expect(featureHint(backpack, 'S').visibility).toBe('hidden');
  });

  it('builds a handedness sentence', () => {
    expect(handednessHint('right', 'S')).toMatch(
      /^Right-handed: the character's right side appears on the LEFT/,
    );
    expect(handednessHint('none', 'S')).toBeNull();
  });
});

describe('handedness detection', () => {
  it('guesses right-handed from a front view with equipment on screen-left', () => {
    const g = guessHandedness(humanoid({ stick: 'screen-left' }), 'S');
    expect(g.handedness).toBe('right');
    expect(g.confidence).toBeGreaterThan(0.3);
  });

  it('guesses left-handed for the same silhouette seen from behind', () => {
    expect(guessHandedness(humanoid({ stick: 'screen-left' }), 'N').handedness).toBe('left');
  });

  it('refuses to guess from a profile or a balanced silhouette', () => {
    expect(guessHandedness(humanoid({ stick: 'screen-left' }), 'E').handedness).toBeNull();
    expect(guessHandedness(humanoid(), 'S').handedness).toBeNull();
  });

  it('flags a generated view whose equipment ended up on the wrong side', () => {
    const source = humanoid({ stick: 'screen-left' }); // S view, right-handed
    // Correct back view: right side is on screen-right.
    const goodN = flipHorizontal(source);
    // A wrongly mirrored three-quarter view: equipment stays screen-left in NE.
    const ok = checkHandedness({
      source,
      sourceDirection: 'S',
      target: goodN,
      targetDirection: 'N',
    });
    expect(ok.status).toBe('ok');
    const bad = checkHandedness({
      source,
      sourceDirection: 'S',
      target: source,
      targetDirection: 'NE',
    });
    expect(bad.status).toBe('warning');
    expect(bad.message).toMatch(/mirrored/);
    const profile = checkHandedness({
      source,
      sourceDirection: 'S',
      target: mirrorAroundAxis(source, 20),
      targetDirection: 'E',
    });
    expect(profile.status).toBe('skipped');
  });
});
