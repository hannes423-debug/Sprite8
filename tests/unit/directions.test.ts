import { describe, expect, it } from 'vitest';
import {
  DIRECTIONS,
  ORDER_PRESETS,
  angleBetween,
  computePlacements,
  directionsByDistance,
  gridDimensions,
  matchOrderPreset,
  mirroredDirection,
  normalizeOrder,
  oppositeDirection,
  parseDirectionFromName,
  rotateDirection,
  type SheetGridSettings,
} from '../../src/core/directions';

describe('direction system', () => {
  it('uses the required default order', () => {
    expect([...DIRECTIONS]).toEqual(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']);
  });

  it('knows opposite and mirrored directions', () => {
    expect(DIRECTIONS.map(oppositeDirection)).toEqual(['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE']);
    expect(DIRECTIONS.map(mirroredDirection)).toEqual(['N', 'NW', 'W', 'SW', 'S', 'SE', 'E', 'NE']);
  });

  it('rotates and measures angles', () => {
    expect(rotateDirection('N', 1)).toBe('NE');
    expect(rotateDirection('N', -1)).toBe('NW');
    expect(rotateDirection('SW', 12)).toBe('NE');
    expect(angleBetween('N', 'S')).toBe(180);
    expect(angleBetween('NW', 'NE')).toBe(90);
    expect(angleBetween('E', 'E')).toBe(0);
    expect(directionsByDistance('S').slice(0, 2)).toEqual(['SE', 'SW']);
    expect(directionsByDistance('S').at(-1)).toBe('N');
  });

  it('parses directions from file names', () => {
    expect(parseDirectionFromName('knight_NE.png')).toBe('NE');
    expect(parseDirectionFromName('hero-se-01.png')).toBe('SE');
    expect(parseDirectionFromName('player_north_west.png')).toBe('NW');
    expect(parseDirectionFromName('player-back.png')).toBe('N');
    expect(parseDirectionFromName('upper_body.png')).toBeNull();
    expect(parseDirectionFromName('hero.png')).toBeNull();
  });
});

describe('sheet layouts', () => {
  const base: SheetGridSettings = {
    grid: '8x1',
    columns: 8,
    rows: 1,
    order: [...DIRECTIONS],
    frameLayout: 'direction-rows',
  };

  it('8 × 1 keeps the order left to right', () => {
    const p = computePlacements(base, 1);
    expect(p.map((c) => `${c.direction}@${c.col},${c.row}`)).toEqual([
      'N@0,0',
      'NE@1,0',
      'E@2,0',
      'SE@3,0',
      'S@4,0',
      'SW@5,0',
      'W@6,0',
      'NW@7,0',
    ]);
  });

  it('4 × 2 wraps to a second row', () => {
    const s = { ...base, grid: '4x2' as const };
    expect(gridDimensions(s, 1)).toEqual({ columns: 4, rows: 2 });
    const p = computePlacements(s, 1);
    expect(p.find((c) => c.direction === 'S')).toMatchObject({ col: 0, row: 1 });
    expect(p.find((c) => c.direction === 'NW')).toMatchObject({ col: 3, row: 1 });
  });

  it('compass layout places directions around the centre', () => {
    const p = computePlacements({ ...base, grid: 'compass' }, 1);
    expect(p.find((c) => c.direction === 'N')).toMatchObject({ col: 1, row: 0 });
    expect(p.find((c) => c.direction === 'W')).toMatchObject({ col: 0, row: 1 });
    expect(p.find((c) => c.direction === 'SE')).toMatchObject({ col: 2, row: 2 });
    expect(p.some((c) => c.col === 1 && c.row === 1)).toBe(false);
  });

  it('custom grids always have room for eight cells', () => {
    expect(gridDimensions({ ...base, grid: 'custom', columns: 3, rows: 1 }, 1)).toEqual({
      columns: 3,
      rows: 3,
    });
  });

  it('multi-frame animations use one row per direction', () => {
    const p = computePlacements(base, 3);
    expect(p).toHaveLength(24);
    expect(gridDimensions(base, 3)).toEqual({ columns: 3, rows: 8 });
    expect(p.find((c) => c.direction === 'E' && c.frame === 2)).toMatchObject({ col: 2, row: 2 });
    const cols = computePlacements({ ...base, frameLayout: 'direction-columns' }, 3);
    expect(cols.find((c) => c.direction === 'E' && c.frame === 2)).toMatchObject({
      col: 2,
      row: 2,
    });
    expect(cols.find((c) => c.direction === 'NW' && c.frame === 1)).toMatchObject({
      col: 7,
      row: 1,
    });
  });

  it('honours custom orders and repairs invalid ones', () => {
    const order = ORDER_PRESETS[1].order;
    expect(computePlacements({ ...base, order }, 1)[0].direction).toBe('S');
    expect(matchOrderPreset(order)).toBe('clockwise-s');
    expect(normalizeOrder(['S', 'S', 'bogus', 'N'])).toEqual([
      'S',
      'N',
      'NE',
      'E',
      'SE',
      'SW',
      'W',
      'NW',
    ]);
  });
});
