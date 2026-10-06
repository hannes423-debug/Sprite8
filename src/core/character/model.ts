import type { Direction } from '../directions';
import type { Rect } from '../sprite';

/**
 * Character Representation — the persistent reference every direction is
 * generated and checked against. It is created by the analysis step, edited
 * by the user, stored with the project and sent to AI providers, so the eight
 * views are never eight unrelated generations.
 *
 *   Character Model
 *   ├── proportions        (measured from the source silhouette)
 *   ├── anatomy            head · torso · arms · hands · legs · feet
 *   ├── features           clothing · equipment · accessories, each with a body side
 *   ├── colors             palette · dominant colours · outline colour
 *   ├── style              art style · shading · outline · pixel art
 *   ├── handedness         (+ symmetry mode, kept in the project setup)
 *   └── locks              what the consistency system must enforce
 */
export type CharacterType = 'humanoid' | 'creature' | 'robot' | 'vehicle' | 'object' | 'other';
export type SymmetryMode = 'symmetric' | 'asymmetric';
export type Handedness = 'right' | 'left' | 'ambidextrous' | 'none';
export type CameraAngle = 'side' | 'elevated' | 'isometric' | 'top-down';
export type ArtStyle = 'pixel-art' | 'painted' | 'hand-drawn' | 'cartoon' | 'anime' | 'ghibli-inspired' | 'other';
export type ShadingStyle = 'flat' | 'cel' | 'soft';

export type FeatureCategory = 'clothing' | 'equipment' | 'accessory' | 'marking' | 'body';
export type FeatureSide = 'right' | 'left' | 'center' | 'both';
export type FeatureAttachment =
  | 'hand'
  | 'arm'
  | 'shoulder'
  | 'head'
  | 'face'
  | 'torso'
  | 'back'
  | 'hip'
  | 'leg'
  | 'foot'
  | 'other';

export interface CharacterFeature {
  id: string;
  name: string;
  category: FeatureCategory;
  /** Body side (the CHARACTER's side, not the screen side). */
  side: FeatureSide;
  attachment: FeatureAttachment;
  notes: string;
}

export interface BodyPart {
  description: string;
  /** Estimated region in source-sprite pixels (null when not estimated). */
  region: Rect | null;
}

export type AnatomyPart = 'head' | 'torso' | 'arms' | 'hands' | 'legs' | 'feet';
export const ANATOMY_PARTS: AnatomyPart[] = ['head', 'torso', 'arms', 'hands', 'legs', 'feet'];

export interface Proportions {
  /** Silhouette size of the source sprite (native pixels). */
  heightPx: number;
  widthPx: number;
  /** Landmarks as fractions of the height, measured from the top. */
  neckY: number;
  shoulderY: number;
  hipY: number;
  kneeY: number;
  /** Height divided by head height ("heads tall"). */
  headsTall: number;
  /** True when the landmarks were measured rather than defaulted. */
  measured: boolean;
}

export interface StyleLocks {
  palette: boolean;
  outline: boolean;
  shading: boolean;
  resolution: boolean;
  proportions: boolean;
  scale: boolean;
  style: boolean;
}

export const LOCK_LABELS: Record<keyof StyleLocks, string> = {
  palette: 'Palette',
  outline: 'Outline',
  shading: 'Shading style',
  resolution: 'Resolution',
  proportions: 'Proportions',
  scale: 'Character scale',
  style: 'Visual style',
};

export interface CharacterModel {
  version: 1;
  type: CharacterType;
  description: string;
  handedness: Handedness;
  camera: CameraAngle;
  style: {
    art: ArtStyle;
    shading: ShadingStyle;
    pixelArt: boolean;
    outline: { enabled: boolean; color: string | null; thickness: number };
  };
  proportions: Proportions;
  anatomy: Record<AnatomyPart, BodyPart>;
  features: CharacterFeature[];
  colors: {
    palette: string[];
    dominant: Array<{ hex: string; share: number; name: string }>;
  };
  locks: StyleLocks;
}

/** The model plus the project-level choices made before analysis. */
export interface CharacterReference extends CharacterModel {
  name: string;
  symmetry: SymmetryMode;
  sourceDirection: Direction;
}

export const CHARACTER_TYPE_LABELS: Record<CharacterType, string> = {
  humanoid: 'Humanoid',
  creature: 'Creature',
  robot: 'Robot / mech',
  vehicle: 'Vehicle',
  object: 'Object',
  other: 'Other',
};

export const HANDEDNESS_LABELS: Record<Handedness, string> = {
  right: 'Right',
  left: 'Left',
  ambidextrous: 'Ambidextrous',
  none: 'Not applicable',
};

export const CAMERA_LABELS: Record<CameraAngle, string> = {
  side: 'Side-on (eye level)',
  elevated: 'Elevated 2.5D (3/4 top-down)',
  isometric: 'Isometric (~30°)',
  'top-down': 'Top-down',
};

export const ART_STYLE_LABELS: Record<ArtStyle, string> = {
  'pixel-art': 'Pixel art',
  painted: 'Painted',
  'hand-drawn': 'Hand-drawn',
  cartoon: 'Cartoon',
  anime: 'Anime',
  'ghibli-inspired': 'Ghibli-inspired painterly',
  other: 'Other',
};

export const SHADING_LABELS: Record<ShadingStyle, string> = {
  flat: 'Flat',
  cel: 'Cel / banded',
  soft: 'Soft / painted',
};

export const FEATURE_CATEGORY_LABELS: Record<FeatureCategory, string> = {
  clothing: 'Clothing',
  equipment: 'Equipment',
  accessory: 'Accessory',
  marking: 'Marking',
  body: 'Body',
};

export const FEATURE_SIDE_LABELS: Record<FeatureSide, string> = {
  right: 'Right side',
  left: 'Left side',
  center: 'Centre',
  both: 'Both sides',
};

export const ATTACHMENT_LABELS: Record<FeatureAttachment, string> = {
  hand: 'Hand',
  arm: 'Arm',
  shoulder: 'Shoulder',
  head: 'Head',
  face: 'Face',
  torso: 'Torso',
  back: 'Back',
  hip: 'Hip',
  leg: 'Leg',
  foot: 'Foot',
  other: 'Other',
};

export const SYMMETRY_LABELS: Record<SymmetryMode, string> = {
  symmetric: 'Symmetric',
  asymmetric: 'Asymmetric',
};
