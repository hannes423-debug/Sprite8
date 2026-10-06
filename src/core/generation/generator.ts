import type { Animation, Frame, FrameOrigin, FrameStatus } from '../animation';
import { characterReference } from '../character/createModel';
import { conformToCharacter, type ConformResult } from '../consistency/conform';
import { DIRECTIONS, angleBetween, directionsByDistance, type Direction } from '../directions';
import { activeAnimation, placeOnAnchor, type Project } from '../project/project';
import type {
  DirectionResult,
  ImageGenerationProvider,
  ProviderContext,
  ProviderSettings,
  ViewSnapshot,
} from '../providers/types';
import { hexToRgba, type RasterImage, type Rgba } from '../sprite';
import { chooseInputBackground, prepareProviderInput } from './prepareInput';
import { buildDirectionPrompt } from './prompt';

/**
 * Direction Generator — produces ONE direction at a time from the persistent
 * character reference. Regenerating NE therefore never touches N, E, S…:
 * the caller replaces exactly one frame with the returned view.
 */
export class GenerationError extends Error {
  readonly hint?: string;
  constructor(message: string, hint?: string) {
    super(message);
    this.name = 'GenerationError';
    this.hint = hint;
  }
}

export interface GeneratedView {
  direction: Direction;
  frame: number;
  image: RasterImage | null;
  status: FrameStatus;
  origin: FrameOrigin;
  warnings: string[];
}

export interface GenerateViewArgs {
  project: Project;
  provider: ImageGenerationProvider;
  providerSettings: ProviderSettings;
  direction: Direction;
  frame?: number;
  seed: number;
  mode: 'generate' | 'variation';
  ctx: ProviderContext;
}

/** Why generation cannot start yet (null = ready). */
export function generationBlocker(project: Project): string | null {
  if (!project.source) return 'Upload a character image first.';
  if (!project.character)
    return 'Analyze the character first, so every direction can be generated from the same reference.';
  return null;
}

/** Order for "generate all": nearest to the source first, so neighbours can serve as references. */
export function generationOrder(project: Project): Direction[] {
  const anim = activeAnimation(project);
  const src = project.setup.sourceDirection;
  return [src, ...directionsByDistance(src)].filter((d) => !anim.tracks[d].locked);
}

/** Directions that `generationOrder` would overwrite although they hold manual work. */
export function manualWorkAt(project: Project, directions: Direction[], frame = 0): Direction[] {
  const anim = activeAnimation(project);
  return directions.filter((d) => {
    const f = anim.tracks[d].frames[frame];
    return !!f?.image && (f.status === 'edited' || f.status === 'imported');
  });
}

function collectViews(anim: Animation, frame: number): ViewSnapshot[] {
  const views: ViewSnapshot[] = [];
  for (const d of DIRECTIONS) {
    const f = anim.tracks[d].frames[frame];
    if (f?.image && f.status !== 'empty' && f.status !== 'guide')
      views.push({ direction: d, image: f.image, status: f.status });
  }
  return views;
}

function paletteRgba(hexes: string[]): Rgba[] {
  return hexes.map((h) => hexToRgba(h)).filter((c): c is Rgba => !!c);
}

/**
 * Conforms raw model output to the character (background removal, scale, palette and outline
 * locks, ground line). `generationScale` is the provider-pixels-per-working-pixel factor of the
 * input the model was given.
 */
export function conformAiImage(
  project: Project,
  raw: RasterImage,
  generationScale: number,
  background: Rgba | null,
): ConformResult {
  const character = project.character!;
  const outlineColor = character.style.outline.color
    ? hexToRgba(character.style.outline.color)
    : null;
  return conformToCharacter(raw, {
    cell: project.cell,
    pixelArt: character.style.pixelArt,
    locks: character.locks,
    palette: paletteRgba(character.colors.palette),
    outline:
      character.style.outline.enabled && outlineColor
        ? { color: outlineColor, thickness: character.style.outline.thickness }
        : null,
    referenceHeight: project.source!.sprite.height,
    scaleMode: project.generation.scaleMode,
    generationScale,
    backgroundHint: background,
    // Image models often leave a colour cast along the canvas edge.
    trimBorder: 0.015,
  });
}

export async function generateView(args: GenerateViewArgs): Promise<GeneratedView> {
  const { project, provider, direction } = args;
  const frame = args.frame ?? 0;
  const blocker = generationBlocker(project);
  if (blocker) throw new GenerationError(blocker);
  const source = project.source!;
  const character = project.character!;
  const anim = activeAnimation(project);
  const pixelArt = character.style.pixelArt;
  const now = Date.now();

  // The source direction is the reference itself — never "generated".
  if (direction === project.setup.sourceDirection && frame === 0 && args.mode === 'generate') {
    return {
      direction,
      frame,
      image: placeOnAnchor(source.sprite, project.cell).image,
      status: 'source',
      origin: { kind: 'source', fileName: source.fileName, createdAt: now },
      warnings: [],
    };
  }

  const ref = characterReference(character, project.setup);
  const dominant = character.colors.dominant
    .map((d) => ({ color: hexToRgba(d.hex), share: d.share }))
    .filter((d): d is { color: Rgba; share: number } => !!d.color);
  const background = chooseInputBackground(dominant);
  const size = project.generation.generationSize;
  const input = prepareProviderInput(source.sprite, size, { pixelArt, background });
  const prompt = buildDirectionPrompt(ref, direction, {
    style: project.generation.promptStyle,
    extraPrompt: project.generation.extraPrompt,
    extraNegative: project.generation.extraNegative,
    backgroundName: background.name,
  });
  const views = collectViews(anim, frame);
  const references =
    provider.capabilities.references && project.generation.includeReferences
      ? views
          .filter(
            (v) =>
              v.direction !== direction &&
              v.direction !== project.setup.sourceDirection &&
              v.status !== 'mirror',
          )
          .sort(
            (a, b) => angleBetween(direction, a.direction) - angleBetween(direction, b.direction),
          )
          .slice(0, 4)
          .map((v) => ({
            direction: v.direction,
            input: prepareProviderInput(v.image, size, { pixelArt, background }),
          }))
      : [];
  const request = {
    direction,
    character: ref,
    prompt,
    input,
    references,
    views,
    cell: project.cell,
    seed: args.seed,
    options: { symmetryShortcut: project.generation.symmetryShortcut },
    settings: args.providerSettings,
  };

  let result: DirectionResult;
  let generationScale = input.scale;
  if (args.mode === 'variation') {
    const current = anim.tracks[direction].frames[frame];
    if (!current?.image || current.status === 'empty' || current.status === 'guide') {
      throw new GenerationError(
        'There is no view to vary yet — generate, import or draw it first.',
      );
    }
    const base = prepareProviderInput(current.image, size, { pixelArt, background });
    generationScale = base.scale;
    result = await provider.generateVariation(
      { ...request, base, strength: project.generation.variationStrength },
      args.ctx,
    );
  } else {
    result = await provider.generateDirection(request, args.ctx);
  }

  const origin: FrameOrigin = {
    kind: result.kind,
    providerId: provider.id,
    providerLabel: provider.label,
    seed: result.seed,
    prompt: result.kind === 'ai' ? prompt.primary : undefined,
    mirroredFrom: result.mirroredFrom,
    createdAt: now,
    notes: result.notes,
  };
  if (result.kind !== 'ai') {
    return { direction, frame, image: result.image, status: result.kind, origin, warnings: [] };
  }
  if (!result.image) throw new GenerationError('The provider returned no image.');
  const conformed = conformAiImage(project, result.image, generationScale, background.color);
  return {
    direction,
    frame,
    image: conformed.image,
    status: 'ai',
    origin: { ...origin, notes: [...(result.notes ?? []), ...conformed.warnings] },
    warnings: conformed.warnings,
  };
}

/**
 * Whether a generated view should replace the existing frame. A "guide"
 * result (nothing generated) never wipes pixels someone already made.
 */
export function shouldApplyView(existing: Frame | null | undefined, view: GeneratedView): boolean {
  if (view.status !== 'guide') return true;
  return !existing?.image || existing.status === 'empty' || existing.status === 'guide';
}

/** A seed for direction `d` derived from the project's base seed (reproducible "generate all"). */
export function seedFor(baseSeed: number, d: Direction): number {
  return (Math.abs(Math.floor(baseSeed)) + DIRECTIONS.indexOf(d) * 7919) % 2_147_483_647;
}
