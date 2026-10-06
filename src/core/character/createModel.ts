import type { SpriteAnalysis } from '../analysis/analyzeSprite';
import { estimateAnatomy } from '../analysis/proportions';
import type { Direction } from '../directions';
import type { RasterImage } from '../sprite';
import {
  ART_STYLE_LABELS,
  CHARACTER_TYPE_LABELS,
  type CharacterFeature,
  type CharacterModel,
  type CharacterReference,
  type StyleLocks,
  type SymmetryMode,
} from './model';

let featureCounter = 0;

export function newFeatureId(): string {
  featureCounter = (featureCounter + 1) % 1e6;
  return `f${Date.now().toString(36)}${featureCounter.toString(36)}`;
}

export function createFeature(partial: Partial<CharacterFeature> = {}): CharacterFeature {
  return {
    id: partial.id ?? newFeatureId(),
    name: partial.name ?? 'New feature',
    category: partial.category ?? 'equipment',
    side: partial.side ?? 'right',
    attachment: partial.attachment ?? 'hand',
    notes: partial.notes ?? '',
  };
}

export function defaultLocks(pixelArt: boolean, outlineDetected: boolean): StyleLocks {
  return {
    palette: pixelArt,
    outline: pixelArt && outlineDetected,
    shading: true,
    resolution: true,
    proportions: true,
    scale: true,
    style: true,
  };
}

function autoDescription(analysis: SpriteAnalysis): string {
  const type = CHARACTER_TYPE_LABELS[analysis.characterType.value].toLowerCase();
  const style = ART_STYLE_LABELS[analysis.artStyle.value].toLowerCase();
  const names = [...new Set(analysis.dominant.map((d) => d.name))].slice(0, 4);
  return `${type} character, ${style}, main colours: ${names.join(', ')}`;
}

/**
 * Builds the persistent Character Model from the analysis. When `previous`
 * is given, user-authored fields (description, features, anatomy notes,
 * handedness, camera, locks) are kept and only measurements are refreshed.
 */
export function createCharacterModel(
  sprite: RasterImage,
  analysis: SpriteAnalysis,
  previous?: CharacterModel | null,
): CharacterModel {
  const anatomy = estimateAnatomy(sprite, analysis.proportions);
  if (previous) {
    for (const key of Object.keys(anatomy) as Array<keyof typeof anatomy>) {
      anatomy[key].description = previous.anatomy[key]?.description ?? '';
    }
  }
  const features: CharacterFeature[] = previous?.features ?? [];
  if (!previous && analysis.handedness.handedness && analysis.handedness.confidence >= 0.4) {
    features.push(
      createFeature({
        name: 'One-sided equipment',
        category: 'equipment',
        side: analysis.handedness.handedness,
        attachment: 'hand',
        notes: 'Detected from the silhouette — rename it (e.g. "hockey stick") or remove it.',
      }),
    );
  }
  const pixelArt = analysis.pixelArt.value;
  return {
    version: 1,
    type: previous?.type ?? analysis.characterType.value,
    description: previous?.description ?? autoDescription(analysis),
    handedness: previous?.handedness ?? analysis.handedness.handedness ?? 'none',
    camera: previous?.camera ?? analysis.camera.value,
    style: {
      art: previous?.style.art ?? analysis.artStyle.value,
      shading: previous?.style.shading ?? analysis.shading.value,
      pixelArt: previous?.style.pixelArt ?? pixelArt,
      outline: {
        enabled: analysis.outline.detected,
        color: analysis.outline.color,
        thickness: analysis.outline.thickness || 1,
      },
    },
    proportions: {
      heightPx: analysis.proportions.heightPx,
      widthPx: analysis.proportions.widthPx,
      neckY: analysis.proportions.neckY,
      shoulderY: analysis.proportions.shoulderY,
      hipY: analysis.proportions.hipY,
      kneeY: analysis.proportions.kneeY,
      headsTall: analysis.proportions.headsTall,
      measured: analysis.proportions.measured,
    },
    anatomy,
    features,
    colors: { palette: analysis.palette, dominant: analysis.dominant },
    locks: previous?.locks ?? defaultLocks(pixelArt, analysis.outline.detected),
  };
}

export function characterReference(
  model: CharacterModel,
  setup: { name: string; symmetry: SymmetryMode; sourceDirection: Direction },
): CharacterReference {
  return {
    ...model,
    name: setup.name,
    symmetry: setup.symmetry,
    sourceDirection: setup.sourceDirection,
  };
}
