import type { SpriteAnalysis } from '../analysis/analyzeSprite';
import type { FrameStatus } from '../animation';
import type { CharacterFeature, CharacterReference, CharacterType, Handedness } from '../character/model';
import type { Direction } from '../directions';
import type { DirectionPrompt } from '../generation/prompt';
import type { PreparedInput } from '../generation/prepareInput';
import type { WorkingCell } from '../project/project';
import type { RasterImage } from '../sprite';

/**
 * AI Provider abstraction.
 *
 * Sprite8 never talks to a model directly. Everything goes through an
 * `ImageGenerationProvider`, so local servers (ComfyUI, Stable Diffusion
 * WebUI, any custom server speaking the Sprite8 HTTP protocol), browser/WebGPU
 * models or remote APIs can be added without touching the rest of the app.
 */

/** Encodes/decodes images. Injected so providers run in browsers and in tests. */
export interface ImageCodec {
  encodePng(img: RasterImage): Promise<Blob>;
  decode(blob: Blob): Promise<RasterImage>;
}

export type ProviderSettingValue = string | number | boolean;
export type ProviderSettings = Record<string, ProviderSettingValue>;

export interface ProviderSettingField {
  key: string;
  label: string;
  type: 'text' | 'url' | 'number' | 'select' | 'textarea' | 'checkbox' | 'password';
  default: ProviderSettingValue;
  options?: Array<{ value: string; label: string }>;
  help?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Hidden behind "Advanced" in the settings dialog. */
  advanced?: boolean;
}

export interface ProviderCapabilities {
  /** True only for providers that can create genuinely new (unseen) views. */
  generatesNewViews: boolean;
  variations: boolean;
  /** Can describe the character (captioning / vision model). */
  analysis: boolean;
  /** Accepts additional reference views besides the source. */
  references: boolean;
  seeds: boolean;
}

export interface ProviderStatus {
  ok: boolean;
  message: string;
  details?: string[];
}

export interface ProviderContext {
  codec: ImageCodec;
  fetch: typeof fetch;
  signal?: AbortSignal;
  onProgress?: (fraction: number, message?: string) => void;
}

export interface ViewSnapshot {
  direction: Direction;
  /** Working-cell image. */
  image: RasterImage;
  status: FrameStatus;
}

export interface DirectionRequest {
  direction: Direction;
  character: CharacterReference;
  prompt: DirectionPrompt;
  /** The source sprite prepared on a square generation canvas. */
  input: PreparedInput;
  /** Other already-approved views, prepared the same way. */
  references: Array<{ direction: Direction; input: PreparedInput }>;
  /** Current working-cell frames of every direction that has pixels. */
  views: ViewSnapshot[];
  cell: WorkingCell;
  seed: number;
  options: { symmetryShortcut: boolean };
  settings: ProviderSettings;
}

export interface VariationRequest extends DirectionRequest {
  /** The current view of this direction, prepared like `input`. */
  base: PreparedInput;
  /** 0…1 — how far the variation may move away from `base`. */
  strength: number;
}

export interface DirectionResult {
  /**
   * ai: `image` is raw provider output (any size, any background); the
   *     consistency pipeline conforms it to the character afterwards.
   * guide / mirror / source: `image` is already a working-cell image (or null).
   */
  kind: 'ai' | 'guide' | 'mirror' | 'source';
  image: RasterImage | null;
  seed?: number;
  mirroredFrom?: Direction;
  notes?: string[];
}

export interface AnalyzeRequest {
  sprite: RasterImage;
  analysis: SpriteAnalysis;
  character: CharacterReference;
  settings: ProviderSettings;
}

export interface CharacterAnalysisHints {
  description?: string;
  type?: CharacterType;
  handedness?: Handedness;
  features?: Array<Omit<CharacterFeature, 'id'>>;
  notes?: string[];
}

export interface ImageGenerationProvider {
  readonly id: string;
  readonly label: string;
  readonly kind: 'deterministic' | 'local-ai' | 'remote-ai';
  readonly description: string;
  readonly capabilities: ProviderCapabilities;
  readonly settingsFields: ProviderSettingField[];
  checkStatus(settings: ProviderSettings, ctx: ProviderContext): Promise<ProviderStatus>;
  analyzeCharacter(req: AnalyzeRequest, ctx: ProviderContext): Promise<CharacterAnalysisHints>;
  generateDirection(req: DirectionRequest, ctx: ProviderContext): Promise<DirectionResult>;
  generateVariation(req: VariationRequest, ctx: ProviderContext): Promise<DirectionResult>;
}

export class ProviderError extends Error {
  readonly hint?: string;
  constructor(message: string, hint?: string) {
    super(message);
    this.name = 'ProviderError';
    this.hint = hint;
  }
}

export function defaultSettings(fields: ProviderSettingField[]): ProviderSettings {
  const out: ProviderSettings = {};
  for (const f of fields) out[f.key] = f.default;
  return out;
}

export function settingString(settings: ProviderSettings, key: string, fallback = ''): string {
  const v = settings[key];
  return v === undefined || v === null ? fallback : String(v);
}

export function settingNumber(settings: ProviderSettings, key: string, fallback: number): number {
  const v = Number(settings[key]);
  return Number.isFinite(v) ? v : fallback;
}

export function settingBool(settings: ProviderSettings, key: string, fallback = false): boolean {
  const v = settings[key];
  return typeof v === 'boolean' ? v : v === undefined ? fallback : v === 'true';
}
