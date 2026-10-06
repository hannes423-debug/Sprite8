/**
 * Direction System.
 *
 * A direction is the way the character FACES on screen. The camera looks
 * "north" (up the screen) from the south, so:
 *   S  = facing the viewer (front view)      N  = facing away (back view)
 *   E  = facing screen-right (right profile) W  = facing screen-left
 *
 *            N
 *       NW       NE
 *     W             E
 *       SW       SE
 *            S
 *
 * World axes used throughout: +x = east (screen right), +y = north (away from
 * the camera). Angles are compass degrees clockwise from north.
 */
export const DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export type Direction = (typeof DIRECTIONS)[number];

export interface Vec2 {
  x: number;
  y: number;
}

export interface DirectionInfo {
  id: Direction;
  name: string;
  angle: number;
  /** Unit facing vector on the ground plane (+x east, +y north). */
  facing: Vec2;
  /** Human-readable view name for the UI and prompts. */
  view: string;
  /** Cell in the 3×3 compass layout (row 0 = top). */
  compass: { col: number; row: number };
}

const S2 = Math.SQRT1_2;

const INFO: Record<Direction, DirectionInfo> = {
  N: {
    id: 'N',
    name: 'North',
    angle: 0,
    facing: { x: 0, y: 1 },
    view: 'back view',
    compass: { col: 1, row: 0 },
  },
  NE: {
    id: 'NE',
    name: 'Northeast',
    angle: 45,
    facing: { x: S2, y: S2 },
    view: 'three-quarter back view, turned to the right',
    compass: { col: 2, row: 0 },
  },
  E: {
    id: 'E',
    name: 'East',
    angle: 90,
    facing: { x: 1, y: 0 },
    view: 'side view facing right',
    compass: { col: 2, row: 1 },
  },
  SE: {
    id: 'SE',
    name: 'Southeast',
    angle: 135,
    facing: { x: S2, y: -S2 },
    view: 'three-quarter front view, turned to the right',
    compass: { col: 2, row: 2 },
  },
  S: {
    id: 'S',
    name: 'South',
    angle: 180,
    facing: { x: 0, y: -1 },
    view: 'front view',
    compass: { col: 1, row: 2 },
  },
  SW: {
    id: 'SW',
    name: 'Southwest',
    angle: 225,
    facing: { x: -S2, y: -S2 },
    view: 'three-quarter front view, turned to the left',
    compass: { col: 0, row: 2 },
  },
  W: {
    id: 'W',
    name: 'West',
    angle: 270,
    facing: { x: -1, y: 0 },
    view: 'side view facing left',
    compass: { col: 0, row: 1 },
  },
  NW: {
    id: 'NW',
    name: 'Northwest',
    angle: 315,
    facing: { x: -S2, y: S2 },
    view: 'three-quarter back view, turned to the left',
    compass: { col: 0, row: 0 },
  },
};

export function isDirection(value: unknown): value is Direction {
  return typeof value === 'string' && (DIRECTIONS as readonly string[]).includes(value);
}

export function directionInfo(d: Direction): DirectionInfo {
  return INFO[d];
}

export function directionIndex(d: Direction): number {
  return DIRECTIONS.indexOf(d);
}

/** Rotates clockwise by `steps` × 45°. */
export function rotateDirection(d: Direction, steps: number): Direction {
  const i = directionIndex(d);
  return DIRECTIONS[(((i + steps) % 8) + 8) % 8];
}

/** The direction facing the opposite way (180°): N↔S, NE↔SW, E↔W, SE↔NW. */
export function oppositeDirection(d: Direction): Direction {
  return rotateDirection(d, 4);
}

/**
 * Reflection across the screen's vertical axis: E↔W, NE↔NW, SE↔SW; N and S map
 * to themselves. Only for truly symmetric characters is the view in the
 * mirrored direction equal to the mirrored image.
 */
export function mirroredDirection(d: Direction): Direction {
  return rotateDirection('N', (8 - directionIndex(d)) % 8);
}

/** Smallest angle between two directions in degrees (0…180). */
export function angleBetween(a: Direction, b: Direction): number {
  const diff = Math.abs(INFO[a].angle - INFO[b].angle) % 360;
  return diff > 180 ? 360 - diff : diff;
}

export function isDiagonal(d: Direction): boolean {
  return d.length === 2;
}

/** Directions sorted by angular distance from `from` (nearest first, `from` excluded). */
export function directionsByDistance(from: Direction): Direction[] {
  return DIRECTIONS.filter((d) => d !== from).sort(
    (a, b) =>
      angleBetween(from, a) - angleBetween(from, b) || directionIndex(a) - directionIndex(b),
  );
}

// Matched against "_token_token_" so whole words are required ("upper" ≠ "up").
const TOKEN_ALIASES: Array<[RegExp, Direction]> = [
  [/_(north_?east|up_?right|back_?right)_/, 'NE'],
  [/_(north_?west|up_?left|back_?left)_/, 'NW'],
  [/_(south_?east|down_?right|front_?right)_/, 'SE'],
  [/_(south_?west|down_?left|front_?left)_/, 'SW'],
  [/_(north|back|up)_/, 'N'],
  [/_(south|front|down)_/, 'S'],
  [/_(east|right)_/, 'E'],
  [/_(west|left)_/, 'W'],
];

/**
 * Finds a direction in a file name such as `knight_NE.png`, `hero-se-01.png`
 * or `player_north_west.png`. Returns null when nothing matches.
 */
export function parseDirectionFromName(fileName: string): Direction | null {
  const base = fileName.replace(/\.[a-z0-9]+$/i, '');
  // Short tokens must be delimited so "hero" does not match "E".
  const tokens = base.split(/[^a-zA-Z]+/).filter(Boolean);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i].toUpperCase();
    if (isDirection(t)) return t;
  }
  const joined = `_${tokens.join('_').toLowerCase()}_`;
  for (const [re, d] of TOKEN_ALIASES) if (re.test(joined)) return d;
  return null;
}
