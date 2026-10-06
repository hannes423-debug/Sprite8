import { directionInfo, type Direction } from '../directions';

/**
 * Asymmetry System — where each side of the character's body appears on
 * screen for every facing direction.
 *
 * With facing vector f (+x east/screen-right, +y north/away from camera), the
 * character's RIGHT side points along r = (f.y, −f.x). Its screen position is
 * r.x and its depth toward the camera (which sits in the south) is −r.y = f.x.
 *
 *   dir  right side on screen   right side depth
 *   N    right                  level   (back view: their right is your right)
 *   NE   right                  near
 *   E    centre                 near    (right profile faces the camera)
 *   SE   left                   near
 *   S    left                   level   (front view: their right is your left)
 *   SW   left                   far
 *   W    centre                 far     (right side hidden behind the body)
 *   NW   right                  far
 *
 * This is pure geometry — it is what lets Sprite8 keep a right-handed hockey
 * player right-handed in every direction instead of mirroring them.
 */
export type BodySide = 'right' | 'left';
export type ScreenSide = 'left' | 'center' | 'right';
export type DepthPlacement = 'near' | 'level' | 'far';

export interface SidePlacement {
  /** −1 (screen left) … +1 (screen right). */
  screenX: number;
  /** −1 (away from the camera) … +1 (toward the camera). */
  depth: number;
  screen: ScreenSide;
  placement: DepthPlacement;
}

const T = 0.3;

function classify(screenX: number, depth: number): SidePlacement {
  return {
    screenX,
    depth,
    screen: screenX < -T ? 'left' : screenX > T ? 'right' : 'center',
    placement: depth > T ? 'near' : depth < -T ? 'far' : 'level',
  };
}

export function sidePlacement(direction: Direction, side: BodySide): SidePlacement {
  const f = directionInfo(direction).facing;
  const sign = side === 'right' ? 1 : -1;
  const screenX = sign * f.y;
  const depth = sign * f.x;
  // Normalise −0 so comparisons and snapshots stay clean.
  return classify(screenX === 0 ? 0 : screenX, depth === 0 ? 0 : depth);
}

/** How much of the character's front / back faces the camera. */
export function frontBackPlacement(direction: Direction): {
  front: DepthPlacement;
  back: DepthPlacement;
} {
  const fy = directionInfo(direction).facing.y;
  const front = -fy > T ? 'near' : -fy < -T ? 'far' : 'level';
  const back = fy > T ? 'near' : fy < -T ? 'far' : 'level';
  return { front, back };
}

export interface SideVisibility {
  direction: Direction;
  right: SidePlacement;
  left: SidePlacement;
  /** The body side turned toward the camera, if any. */
  nearSide: BodySide | null;
}

export function sideVisibility(direction: Direction): SideVisibility {
  const right = sidePlacement(direction, 'right');
  const left = sidePlacement(direction, 'left');
  const nearSide = right.placement === 'near' ? 'right' : left.placement === 'near' ? 'left' : null;
  return { direction, right, left, nearSide };
}

const SCREEN_WORD: Record<ScreenSide, string> = {
  left: 'the LEFT side of the image',
  center: 'the middle of the silhouette',
  right: 'the RIGHT side of the image',
};

/** One-sentence description of where a body side appears, e.g. for prompts and hints. */
export function describeSide(direction: Direction, side: BodySide): string {
  const p = sidePlacement(direction, side);
  const sideName = side === 'right' ? "character's right side" : "character's left side";
  if (p.screen === 'center') {
    return p.placement === 'near'
      ? `The ${sideName} faces the camera (profile) — fully visible, in front of the body.`
      : `The ${sideName} is on the far side — mostly hidden behind the body.`;
  }
  const depth =
    p.placement === 'near'
      ? ', closer to the camera'
      : p.placement === 'far'
        ? ', farther from the camera and partly hidden by the body'
        : '';
  return `The ${sideName} appears on ${SCREEN_WORD[p.screen]}${depth}.`;
}

/** Compact marker text for overlays: e.g. "R ◀ near". */
export function sideMarker(
  direction: Direction,
  side: BodySide,
): { label: string; screen: ScreenSide; placement: DepthPlacement } {
  const p = sidePlacement(direction, side);
  return { label: side === 'right' ? 'R' : 'L', screen: p.screen, placement: p.placement };
}
