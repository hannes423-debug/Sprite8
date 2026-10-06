import type { CharacterFeature, Handedness } from '../character/model';
import type { Direction } from '../directions';
import { describeSide, frontBackPlacement, sidePlacement, type DepthPlacement, type ScreenSide } from './sides';

export interface FeatureHint {
  featureId: string;
  name: string;
  text: string;
  screen: ScreenSide | null;
  visibility: 'visible' | 'partly hidden' | 'hidden' | 'n/a';
}

function visibilityFor(placement: DepthPlacement, screen: ScreenSide): FeatureHint['visibility'] {
  if (screen === 'center') return placement === 'far' ? 'hidden' : 'visible';
  return placement === 'far' ? 'partly hidden' : 'visible';
}

const SCREEN_TEXT: Record<ScreenSide, string> = {
  left: 'on the LEFT side of the image',
  center: 'over the middle of the body',
  right: 'on the RIGHT side of the image',
};

/** Where one feature must appear in a given direction. */
export function featureHint(feature: CharacterFeature, direction: Direction): FeatureHint {
  const base = { featureId: feature.id, name: feature.name };
  if (feature.side === 'right' || feature.side === 'left') {
    const p = sidePlacement(direction, feature.side);
    const where =
      p.screen === 'center'
        ? p.placement === 'near'
          ? 'facing the camera, in front of the body'
          : 'on the far side, mostly hidden behind the body'
        : `${SCREEN_TEXT[p.screen]}${p.placement === 'near' ? ', in front (near side)' : p.placement === 'far' ? ', behind the body (far side)' : ''}`;
    return {
      ...base,
      screen: p.screen,
      visibility: visibilityFor(p.placement, p.screen),
      text: `${feature.name} (${feature.side} ${feature.attachment}): ${where}.`,
    };
  }
  if (feature.side === 'both') {
    return { ...base, screen: null, visibility: 'visible', text: `${feature.name}: on both sides of the body.` };
  }
  // Centre features: visibility depends on whether they sit on the front or back.
  const fb = frontBackPlacement(direction);
  if (feature.attachment === 'back') {
    const visibility = fb.back === 'near' ? 'visible' : fb.back === 'far' ? 'hidden' : 'partly hidden';
    const text =
      visibility === 'visible'
        ? `${feature.name} (on the back): clearly visible.`
        : visibility === 'hidden'
          ? `${feature.name} (on the back): hidden behind the body, maybe peeking out at the edges.`
          : `${feature.name} (on the back): seen from the side.`;
    return { ...base, screen: null, visibility, text };
  }
  if (feature.attachment === 'face' || feature.attachment === 'torso') {
    const visibility = fb.front === 'near' ? 'visible' : fb.front === 'far' ? 'hidden' : 'partly hidden';
    const text =
      visibility === 'visible'
        ? `${feature.name} (front): visible.`
        : visibility === 'hidden'
          ? `${feature.name} (front): not visible from behind.`
          : `${feature.name} (front): seen from the side.`;
    return { ...base, screen: null, visibility, text };
  }
  return { ...base, screen: null, visibility: 'n/a', text: `${feature.name}: centred on the body.` };
}

export function featureHints(features: CharacterFeature[], direction: Direction): FeatureHint[] {
  return features.map((f) => featureHint(f, direction));
}

/** Sentence about the dominant hand, or null when handedness does not apply. */
export function handednessHint(handedness: Handedness, direction: Direction): string | null {
  if (handedness !== 'right' && handedness !== 'left') return null;
  return `${handedness === 'right' ? 'Right' : 'Left'}-handed: ${describeSide(direction, handedness).replace(/^The /, 'the ')}`;
}
