import type { Frame } from '../animation';
import { checkHandedness } from '../asymmetry';
import type { CharacterModel, SymmetryMode } from '../character/model';
import type { Direction } from '../directions';
import type { WorkingCell } from '../project/project';
import {
  findFeet,
  hexToRgba,
  paletteCoverage,
  rgbDistance,
  type RasterImage,
  type Rgba,
} from '../sprite';
import { MIRROR_CAVEATS } from '../symmetry';

export type CheckStatus = 'ok' | 'warn' | 'info';

export interface ConsistencyCheck {
  id: string;
  label: string;
  status: CheckStatus;
  message: string;
}

export interface ReportInput {
  frame: Frame | null;
  direction: Direction;
  sourceDirection: Direction;
  /** Working-cell image of the source direction. */
  sourceImage: RasterImage | null;
  cell: WorkingCell;
  character: CharacterModel | null;
  symmetry: SymmetryMode;
}

function colorShare(img: RasterImage, color: Rgba, tolerance = 40): number {
  let total = 0;
  let near = 0;
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    total++;
    if (rgbDistance({ r: d[i], g: d[i + 1], b: d[i + 2], a: 255 }, color) <= tolerance) near++;
  }
  return total ? near / total : 0;
}

/**
 * Checks one direction against the character reference: height, ground,
 * centring, palette, main colours and (asymmetric) handedness.
 */
export function consistencyReport(input: ReportInput): ConsistencyCheck[] {
  const { frame, cell, character } = input;
  const checks: ConsistencyCheck[] = [];
  const img = frame?.image ?? null;
  if (!img || !frame || frame.status === 'empty' || frame.status === 'guide') {
    checks.push({
      id: 'content',
      label: 'Content',
      status: 'info',
      message:
        frame?.status === 'guide'
          ? 'Guides only: draw this view, import an image for it, or connect an AI provider and regenerate.'
          : 'Nothing here yet.',
    });
    return checks;
  }
  const feet = findFeet(img);
  if (!feet) {
    checks.push({
      id: 'content',
      label: 'Content',
      status: 'warn',
      message: 'This view is empty.',
    });
    return checks;
  }
  const ref = input.sourceImage ? findFeet(input.sourceImage) : null;
  if (ref && input.direction !== input.sourceDirection) {
    const diff = feet.bounds.height / ref.bounds.height - 1;
    const pct = Math.round(diff * 100);
    checks.push({
      id: 'height',
      label: 'Height',
      status: Math.abs(diff) <= 0.08 ? 'ok' : 'warn',
      message: `${feet.bounds.height}px tall vs ${ref.bounds.height}px reference (${pct >= 0 ? '+' : ''}${pct}%).`,
    });
  }
  const groundOff = Math.round(cell.anchorY - feet.groundY);
  checks.push({
    id: 'ground',
    label: 'Ground line',
    status: Math.abs(groundOff) <= 1 ? 'ok' : 'warn',
    message:
      groundOff === 0
        ? 'Feet stand on the ground line.'
        : groundOff > 0
          ? `Feet float ${groundOff}px above the ground line.`
          : `Feet sink ${-groundOff}px below the ground line.`,
  });
  const centreOff = Math.round(feet.feetX - cell.anchorX);
  checks.push({
    id: 'centre',
    label: 'Centring',
    status: Math.abs(centreOff) <= 2 ? 'ok' : 'warn',
    message:
      Math.abs(centreOff) <= 2
        ? 'Feet are centred on the anchor.'
        : `Feet are ${Math.abs(centreOff)}px ${centreOff > 0 ? 'right' : 'left'} of the anchor.`,
  });
  if (
    character &&
    character.colors.palette.length &&
    (character.locks.palette || character.style.pixelArt)
  ) {
    const palette = character.colors.palette.map((h) => hexToRgba(h)).filter((c): c is Rgba => !!c);
    const coverage = paletteCoverage(img, palette);
    checks.push({
      id: 'palette',
      label: 'Palette',
      status: coverage >= 0.97 ? 'ok' : 'warn',
      message:
        coverage >= 0.999
          ? 'Uses only source palette colours.'
          : `${Math.round((1 - coverage) * 100)}% of pixels use colours outside the source palette.`,
    });
  }
  if (character && input.direction !== input.sourceDirection) {
    const missing = character.colors.dominant
      .filter((c) => c.share >= 0.15)
      .filter((c) => {
        const rgba = hexToRgba(c.hex);
        return rgba ? colorShare(img, rgba) < c.share * 0.25 : false;
      });
    checks.push({
      id: 'colors',
      label: 'Main colours',
      status: missing.length ? 'warn' : 'ok',
      message: missing.length
        ? `Barely uses ${missing.map((m) => `${m.name} (${m.hex})`).join(', ')} — a main colour of the source.`
        : 'Main colours of the source are present.',
    });
  }
  if (
    input.symmetry === 'asymmetric' &&
    input.sourceImage &&
    input.direction !== input.sourceDirection
  ) {
    const h = checkHandedness({
      source: input.sourceImage,
      sourceDirection: input.sourceDirection,
      target: img,
      targetDirection: input.direction,
    });
    checks.push({
      id: 'handedness',
      label: 'Handedness',
      status: h.status === 'ok' ? 'ok' : h.status === 'warning' ? 'warn' : 'info',
      message: h.message,
    });
  }
  if (frame.status === 'mirror') {
    checks.push({
      id: 'mirror',
      label: 'Mirrored view',
      status: 'info',
      message: `Mirrored from ${frame.origin?.mirroredFrom ?? 'its partner view'} (symmetry shortcut). ${MIRROR_CAVEATS.slice(0, 2).join(' ')}`,
    });
  }
  return checks;
}

/** Worst status of a report, for compact badges. */
export function reportStatus(checks: ConsistencyCheck[]): CheckStatus {
  if (checks.some((c) => c.status === 'warn')) return 'warn';
  // Informational checks (e.g. "not measurable in a profile view") do not downgrade.
  if (checks.some((c) => c.status === 'ok')) return 'ok';
  return 'info';
}
