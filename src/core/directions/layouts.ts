import { DIRECTIONS, directionInfo, isDirection, type Direction } from './directions';

export type OrderPresetId = 'clockwise-n' | 'clockwise-s' | 'counterclockwise-e' | 'counterclockwise-s' | 'custom';

export interface OrderPreset {
  id: OrderPresetId;
  label: string;
  order: Direction[];
}

/** Common orders used by engines and tools. The first one is Sprite8's default. */
export const ORDER_PRESETS: OrderPreset[] = [
  { id: 'clockwise-n', label: 'N → NW (clockwise from north)', order: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] },
  { id: 'clockwise-s', label: 'S → SE (clockwise from south)', order: ['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE'] },
  { id: 'counterclockwise-e', label: 'E → SE (counter-clockwise, math angle order)', order: ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'] },
  { id: 'counterclockwise-s', label: 'S → SW (counter-clockwise from south)', order: ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW'] },
];

export const DEFAULT_ORDER: Direction[] = [...DIRECTIONS];

export type GridPresetId = '8x1' | '4x2' | '2x4' | '1x8' | 'compass' | 'custom';

export interface GridPreset {
  id: GridPresetId;
  label: string;
  columns: number;
  rows: number;
}

export const GRID_PRESETS: GridPreset[] = [
  { id: '8x1', label: '8 × 1 (one row)', columns: 8, rows: 1 },
  { id: '4x2', label: '4 × 2', columns: 4, rows: 2 },
  { id: '2x4', label: '2 × 4', columns: 2, rows: 4 },
  { id: '1x8', label: '1 × 8 (one column)', columns: 1, rows: 8 },
  { id: 'compass', label: 'Compass 3 × 3', columns: 3, rows: 3 },
  { id: 'custom', label: 'Custom', columns: 8, rows: 1 },
];

export type FrameLayout = 'direction-rows' | 'direction-columns';

export interface SheetGridSettings {
  grid: GridPresetId;
  /** Used when grid = custom. */
  columns: number;
  rows: number;
  order: Direction[];
  /** How animation frames are laid out when there is more than one frame. */
  frameLayout: FrameLayout;
}

export interface CellPlacement {
  direction: Direction;
  frame: number;
  col: number;
  row: number;
}

/** Returns a valid permutation of all eight directions (keeps known entries in order). */
export function normalizeOrder(order: readonly unknown[] | null | undefined): Direction[] {
  const seen = new Set<Direction>();
  const out: Direction[] = [];
  for (const d of order ?? []) {
    if (isDirection(d) && !seen.has(d)) {
      seen.add(d);
      out.push(d);
    }
  }
  for (const d of DIRECTIONS) if (!seen.has(d)) out.push(d);
  return out;
}

export function matchOrderPreset(order: readonly Direction[]): OrderPresetId {
  const key = order.join(',');
  return ORDER_PRESETS.find((p) => p.order.join(',') === key)?.id ?? 'custom';
}

export function gridDimensions(settings: SheetGridSettings, frameCount: number): { columns: number; rows: number } {
  if (frameCount > 1) {
    return settings.frameLayout === 'direction-columns'
      ? { columns: 8, rows: frameCount }
      : { columns: frameCount, rows: 8 };
  }
  if (settings.grid === 'compass') return { columns: 3, rows: 3 };
  const preset = GRID_PRESETS.find((p) => p.id === settings.grid);
  let columns = Math.max(1, Math.floor(settings.grid === 'custom' || !preset ? settings.columns : preset.columns));
  let rows = Math.max(1, Math.floor(settings.grid === 'custom' || !preset ? settings.rows : preset.rows));
  columns = Math.min(columns, 8);
  if (columns * rows < 8) rows = Math.ceil(8 / columns);
  return { columns, rows };
}

/** Where every (direction, frame) goes on the sheet. */
export function computePlacements(settings: SheetGridSettings, frameCount: number): CellPlacement[] {
  const order = normalizeOrder(settings.order);
  const frames = Math.max(1, Math.floor(frameCount));
  const out: CellPlacement[] = [];
  if (frames > 1) {
    order.forEach((direction, i) => {
      for (let f = 0; f < frames; f++) {
        out.push(
          settings.frameLayout === 'direction-columns'
            ? { direction, frame: f, col: i, row: f }
            : { direction, frame: f, col: f, row: i },
        );
      }
    });
    return out;
  }
  if (settings.grid === 'compass') {
    for (const direction of order) {
      const { col, row } = directionInfo(direction).compass;
      out.push({ direction, frame: 0, col, row });
    }
    return out;
  }
  const { columns } = gridDimensions(settings, 1);
  order.forEach((direction, i) => {
    out.push({ direction, frame: 0, col: i % columns, row: Math.floor(i / columns) });
  });
  return out;
}
