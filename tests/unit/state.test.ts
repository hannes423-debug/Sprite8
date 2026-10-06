import { describe, expect, it } from 'vitest';
import {
  createAnimation,
  directionsWithContent,
  frameAtTime,
  frameCount,
  insertFrame,
  removeFrame,
  setTrackLocked,
  updateFrameImage,
} from '../../src/core/animation';
import { DIRECTIONS } from '../../src/core/directions';
import {
  activeAnimation,
  changedFrames,
  createEmptyProject,
  createWorkingCell,
  historyBytes,
  moveSourceDirection,
  projectWithSource,
  pushHistory,
  redoHistory,
  replaceAnimation,
  undoHistory,
  EMPTY_HISTORY,
  type DocState,
} from '../../src/core/project';
import { createRaster, normalizeImport, rastersEqual } from '../../src/core/sprite';
import {
  defaultAppSettings,
  deserializeProject,
  loadSettings,
  normalizeProject,
  saveSettings,
  serializeProject,
  type KeyValueStore,
} from '../../src/core/storage';
import { analyzeSprite } from '../../src/core/analysis';
import { createCharacterModel } from '../../src/core/character';
import { humanoid, nodeCodec } from './helpers';

describe('animation model', () => {
  it('replacing one direction keeps every other frame identical (by reference)', () => {
    const anim = createAnimation('idle');
    const next = updateFrameImage(anim, 'NE', 0, createRaster(4, 4), 'ai', null);
    for (const d of DIRECTIONS) {
      if (d === 'NE') expect(next.tracks[d]).not.toBe(anim.tracks[d]);
      else expect(next.tracks[d]).toBe(anim.tracks[d]);
    }
    expect(directionsWithContent(next)).toEqual(new Set(['NE']));
  });

  it('keeps frame counts equal across directions', () => {
    let anim = createAnimation('walk', 1);
    anim = insertFrame(anim, 0, false);
    anim = insertFrame(anim, 1, true);
    expect(frameCount(anim)).toBe(3);
    for (const d of DIRECTIONS) expect(anim.tracks[d].frames).toHaveLength(3);
    anim = removeFrame(anim, 0);
    expect(frameCount(anim)).toBe(2);
    expect(frameCount(removeFrame(removeFrame(anim, 0), 0))).toBe(1);
  });

  it('plays frames over time', () => {
    const anim = {
      ...insertFrame(insertFrame(createAnimation('walk'), 0, false), 0, false),
      fps: 10,
    };
    expect(frameAtTime(anim, 0)).toBe(0);
    expect(frameAtTime(anim, 150)).toBe(1);
    expect(frameAtTime(anim, 350)).toBe(0); // loops
    expect(frameAtTime({ ...anim, loop: false }, 10_000)).toBe(2);
  });

  it('locks tracks', () => {
    expect(setTrackLocked(createAnimation(), 'E', true).tracks.E.locked).toBe(true);
  });
});

describe('project', () => {
  const imported = normalizeImport(humanoid());

  it('creates a square working cell with headroom and places the source on the anchor', () => {
    const cell = createWorkingCell(40, 48);
    expect(cell.width).toBe(cell.height);
    expect(cell.width % 8).toBe(0);
    expect(cell.anchorY).toBeLessThan(cell.height);
    const p = projectWithSource(createEmptyProject(), imported, 'my hero.png');
    expect(p.setup.name).toBe('my_hero');
    expect(activeAnimation(p).tracks.S.frames[0].status).toBe('source');
  });

  it('moves the source to a new direction without losing other work', () => {
    let p = projectWithSource(createEmptyProject(), imported, 'a.png');
    p = replaceAnimation(
      p,
      updateFrameImage(
        activeAnimation(p),
        'N',
        0,
        createRaster(p.cell.width, p.cell.height),
        'edited',
        null,
      ),
    );
    const moved = moveSourceDirection(p, 'E');
    const anim = activeAnimation(moved);
    expect(moved.setup.sourceDirection).toBe('E');
    expect(anim.tracks.E.frames[0].status).toBe('source');
    expect(anim.tracks.S.frames[0].status).toBe('empty');
    expect(anim.tracks.N.frames[0].status).toBe('edited');
  });
});

describe('history', () => {
  const doc = (n: number): DocState => {
    const anim = updateFrameImage(createAnimation(), 'N', 0, createRaster(n, n), 'edited', null);
    return { cell: { width: 8, height: 8, anchorX: 4, anchorY: 7 }, animations: [anim] };
  };

  it('undoes and redoes', () => {
    const a = doc(1);
    const b = doc(2);
    let h = pushHistory(EMPTY_HISTORY, a, 'Paint N');
    const u = undoHistory(h, b)!;
    expect(u.doc).toBe(a);
    expect(u.label).toBe('Paint N');
    h = u.history;
    const r = redoHistory(h, a)!;
    expect(r.doc).toBe(b);
    expect(undoHistory(EMPTY_HISTORY, a)).toBeNull();
  });

  it('a new action clears redo', () => {
    const h = undoHistory(pushHistory(EMPTY_HISTORY, doc(1), 'x'), doc(2))!.history;
    expect(h.future).toHaveLength(1);
    expect(pushHistory(h, doc(3), 'y').future).toHaveLength(0);
  });

  it('prunes old entries over the memory budget', () => {
    let h = EMPTY_HISTORY;
    for (let i = 1; i <= 10; i++)
      h = pushHistory(h, doc(32), `step ${i}`, { maxEntries: 100, maxBytes: 32 * 32 * 4 * 3 });
    expect(h.past.length).toBe(3);
    expect(historyBytes(h)).toBeLessThanOrEqual(32 * 32 * 4 * 3);
    expect(h.past.at(-1)!.label).toBe('step 10');
  });

  it('finds which frames changed', () => {
    const a = doc(1);
    const anim = a.animations[0];
    const b = {
      ...a,
      animations: [updateFrameImage(anim, 'SE', 0, createRaster(1, 1), 'ai', null)],
    };
    expect(changedFrames(a, b)).toEqual([{ animationId: 'idle', direction: 'SE', frame: 0 }]);
  });
});

describe('storage', () => {
  it('saves and loads settings with defaults for missing keys', () => {
    const mem = new Map<string, string>();
    const store: KeyValueStore = {
      getItem: (k) => mem.get(k) ?? null,
      setItem: (k, v) => void mem.set(k, v),
    };
    expect(loadSettings(store)).toEqual(defaultAppSettings());
    const s = defaultAppSettings();
    s.providerId = 'comfyui';
    s.providers.comfyui = { baseUrl: 'http://x' };
    saveSettings(s, store);
    expect(loadSettings(store).providers.comfyui.baseUrl).toBe('http://x');
    mem.set('sprite8.settings.v1', JSON.stringify({ providerId: 'a1111' }));
    expect(loadSettings(store).editor.brushSize).toBe(1);
    mem.set('sprite8.settings.v1', '{broken');
    expect(loadSettings(store).providerId).toBe('guides');
  });

  it('round-trips a project through the portable file format', async () => {
    const sprite = humanoid({ stick: 'screen-left' });
    let p = projectWithSource(createEmptyProject(), normalizeImport(sprite), 'hero.png');
    const analysis = analyzeSprite(p.source!.sprite, { sourceDirection: 'S', pixelArt: true });
    p = { ...p, analysis, character: createCharacterModel(p.source!.sprite, analysis) };
    const text = await serializeProject(p, nodeCodec);
    expect(text).toContain('"format":"sprite8-project-file"');
    const back = await deserializeProject(text, nodeCodec);
    expect(back.id).toBe(p.id);
    expect(rastersEqual(back.source!.sprite, p.source!.sprite)).toBe(true);
    const f0 = activeAnimation(back).tracks.S.frames[0];
    expect(f0.status).toBe('source');
    expect(rastersEqual(f0.image!, activeAnimation(p).tracks.S.frames[0].image!)).toBe(true);
    expect(back.character!.handedness).toBe('right');
    expect(back.character!.features).toHaveLength(1);
  });

  it('rejects foreign files and fills defaults for old projects', async () => {
    await expect(deserializeProject('{"format":"other"}', nodeCodec)).rejects.toThrow(
      /not a Sprite8 project/,
    );
    const old = normalizeProject({
      format: 'sprite8-project',
      version: 1,
      setup: { name: 'x' },
      sheet: { padding: 9 },
    });
    expect(old.sheet.padding).toBe(9);
    expect(old.sheet.exportScale).toBe(1);
    expect(old.setup.symmetry).toBe('asymmetric');
    expect(() => normalizeProject({ format: 'sprite8-project', version: 99 })).toThrow(
      /newer Sprite8/,
    );
  });
});
