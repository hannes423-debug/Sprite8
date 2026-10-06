import { getFrame, type Frame } from '../core/animation';
import { oppositeDirection, type Direction } from '../core/directions';
import { activeAnimation, type Project } from '../core/project';
import type { RasterImage } from '../core/sprite';
import { oppositeSilhouette } from '../core/symmetry';
import { useAppState } from '../app/store';
import type { GuideSpec } from './canvas/guides';

export function useProject(): Project {
  return useAppState((s) => s.project);
}

export function useFrame(direction: Direction): Frame | null {
  return useAppState((s) => getFrame(activeAnimation(s.project), direction, s.ui.frame));
}

const SILHOUETTE_COLOR = { r: 124, g: 156, b: 255, a: 255 };
const silhouettes = new WeakMap<RasterImage, Map<number, RasterImage>>();

/** Mirrored outline of the opposite view (cached per raster). */
export function silhouetteOf(opposite: RasterImage, anchorX: number): RasterImage {
  let byAnchor = silhouettes.get(opposite);
  if (!byAnchor) {
    byAnchor = new Map();
    silhouettes.set(opposite, byAnchor);
  }
  let s = byAnchor.get(anchorX);
  if (!s) {
    s = oppositeSilhouette(opposite, anchorX, SILHOUETTE_COLOR);
    byAnchor.set(anchorX, s);
  }
  return s;
}

/** The outline guide for a direction that has no pixels yet, if the opposite view exists. */
export function silhouetteGuideFor(
  project: Project,
  direction: Direction,
  frame: number,
): RasterImage | null {
  const anim = activeAnimation(project);
  const own = getFrame(anim, direction, frame);
  if (own?.image && own.status !== 'guide' && own.status !== 'empty') return null;
  const opp = getFrame(anim, oppositeDirection(direction), frame);
  if (!opp?.image || opp.status === 'empty' || opp.status === 'guide') return null;
  return silhouetteOf(opp.image, project.cell.anchorX);
}

export function guideSpec(
  project: Project,
  direction: Direction,
  compact: boolean,
  opts: { proportions: boolean; sideMarkers: boolean },
): GuideSpec {
  const character = project.character;
  return {
    cell: project.cell,
    direction,
    proportions: character?.proportions ?? null,
    referenceHeight: project.source?.sprite.height ?? null,
    showProportions: opts.proportions && !!character,
    showSideMarkers:
      opts.sideMarkers && !!project.source && project.setup.symmetry === 'asymmetric',
    compact,
  };
}

export function isPixelArt(project: Project): boolean {
  return project.character?.style.pixelArt ?? project.source?.import.pixelArt ?? true;
}
