import { featureHints, handednessHint } from '../asymmetry';
import type { ArtStyle, CameraAngle, CharacterReference, ShadingStyle } from '../character/model';
import { directionInfo, type Direction } from '../directions';

export type PromptStyle = 'tags' | 'instruction';

export interface DirectionPrompt {
  /** Tag-style positive prompt (Stable Diffusion family). */
  positive: string;
  negative: string;
  /** Natural-language instruction (image-edit models such as Qwen-Image-Edit or FLUX Kontext). */
  instruction: string;
  /** The prompt a provider should send, according to the chosen style. */
  primary: string;
  viewPhrase: string;
  /** Side-specific rules for asymmetric characters. */
  sideRules: string[];
}

const VIEW_TAGS: Record<Direction, string> = {
  N: 'back view, character facing away from the viewer, seen from behind',
  NE: 'three-quarter back view, character facing away and turned to the right (north-east)',
  E: 'side view, full profile, character facing right',
  SE: 'three-quarter front view, character facing the viewer and turned to the right (south-east)',
  S: 'front view, character facing the viewer',
  SW: 'three-quarter front view, character facing the viewer and turned to the left (south-west)',
  W: 'side view, full profile, character facing left',
  NW: 'three-quarter back view, character facing away and turned to the left (north-west)',
};

const CAMERA_TAGS: Record<CameraAngle, string> = {
  side: 'eye-level camera',
  elevated: 'slightly elevated camera, 3/4 top-down game perspective',
  isometric: 'isometric game perspective',
  'top-down': 'top-down view from above',
};

const STYLE_TAGS: Record<ArtStyle, string> = {
  'pixel-art': 'pixel art game sprite, crisp hard-edged pixels, limited color palette, no anti-aliasing',
  painted: 'hand-painted 2D game character sprite',
  'hand-drawn': 'hand-drawn 2D game character, clean line art',
  cartoon: 'cartoon 2D game character sprite, flat colors, bold outlines',
  anime: 'anime-style 2D game character sprite, cel shading',
  'ghibli-inspired': 'Ghibli-inspired painterly 2D game character, soft hand-painted shading',
  other: '2D game character sprite',
};

const SHADING_TAGS: Record<ShadingStyle, string> = {
  flat: 'flat colors',
  cel: 'cel shading',
  soft: 'soft shading',
};

function join(parts: Array<string | false | null | undefined>): string {
  return parts
    .filter((p): p is string => !!p && p.trim().length > 0)
    .map((p) => p.trim())
    .join(', ');
}

export interface PromptOptions {
  style: PromptStyle;
  extraPrompt?: string;
  extraNegative?: string;
  /** Background colour description for the plain background ("white"). */
  backgroundName?: string;
}

/**
 * Builds the prompt for one direction from the persistent character
 * reference. Every direction shares the same description, colours, style and
 * side rules — only the view phrase and the side placements change.
 */
export function buildDirectionPrompt(ref: CharacterReference, direction: Direction, opts: PromptOptions): DirectionPrompt {
  const info = directionInfo(direction);
  const bgName = opts.backgroundName ?? 'white';
  const colorNames = [...new Set(ref.colors.dominant.map((d) => d.name))].slice(0, 5);
  const asymmetric = ref.symmetry === 'asymmetric';
  const sideRules: string[] = [];
  if (asymmetric) {
    const hand = handednessHint(ref.handedness, direction);
    if (hand) sideRules.push(hand);
    for (const hint of featureHints(ref.features, direction)) {
      if (hint.screen !== null || hint.visibility !== 'n/a') sideRules.push(hint.text);
    }
  }
  const outline = ref.style.outline.enabled
    ? ref.style.pixelArt
      ? `${ref.style.outline.thickness}px dark outline`
      : 'clean dark outlines'
    : null;
  const positive = join([
    STYLE_TAGS[ref.style.art],
    ref.description,
    VIEW_TAGS[direction],
    CAMERA_TAGS[ref.camera],
    'full body, standing, feet visible',
    'same character as the reference image, identical outfit, identical proportions',
    SHADING_TAGS[ref.style.shading],
    outline,
    colorNames.length ? `colors: ${colorNames.join(', ')}` : null,
    ref.symmetry === 'symmetric' ? 'symmetrical character design' : null,
    ...sideRules.map((r) => r.replace(/\.$/, '')),
    `plain ${bgName} background, centered, single character`,
    opts.extraPrompt,
  ]);
  const otherHand = ref.handedness === 'right' ? 'left-handed' : ref.handedness === 'left' ? 'right-handed' : null;
  const negative = join([
    'multiple characters, duplicate, cropped, cut off feet, extra limbs, extra fingers',
    'different outfit, different colors, different proportions',
    'text, watermark, signature, background scenery, floor shadow, blurry',
    ref.style.pixelArt && 'anti-aliasing, smooth gradients, jpeg artifacts',
    asymmetric && 'mirrored, flipped, horizontally flipped',
    asymmetric && otherHand,
    opts.extraNegative,
  ]);
  const styleSentence = `Keep the art style: ${STYLE_TAGS[ref.style.art]}, ${SHADING_TAGS[ref.style.shading]}${outline ? `, ${outline}` : ''}.`;
  const instructionLines = [
    `Redraw the exact same character from the reference image, now seen in a ${info.view} (facing ${info.name.toLowerCase()}).`,
    `Keep everything identical: design, outfit, colours${colorNames.length ? ` (${colorNames.join(', ')})` : ''}, proportions and size.`,
    styleSentence,
    `Camera: ${CAMERA_TAGS[ref.camera]}. Show the full body standing on the ground, centred on a plain ${bgName} background.`,
    ...sideRules,
    asymmetric ? 'Do not mirror or flip the character: every item stays on the same side of the body as in the reference.' : null,
    opts.extraPrompt ? opts.extraPrompt : null,
  ].filter((l): l is string => !!l);
  const instruction = instructionLines.join('\n');
  return {
    positive,
    negative,
    instruction,
    primary: opts.style === 'instruction' ? instruction : positive,
    viewPhrase: VIEW_TAGS[direction],
    sideRules,
  };
}
