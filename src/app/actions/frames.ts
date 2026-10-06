import {
  getFrame,
  insertFrame,
  removeFrame,
  setTrackLocked,
  updateFrameImage,
  type FrameOrigin,
} from '../../core/animation';
import { conformToCharacter } from '../../core/consistency';
import {
  mirroredDirection,
  oppositeDirection,
  parseDirectionFromName,
  type Direction,
} from '../../core/directions';
import {
  activeAnimation,
  replaceAnimation,
  type Project,
  type WorkingCell,
} from '../../core/project';
import {
  hexToRgba,
  normalizeImport,
  resizeCanvas,
  type RasterImage,
  type Rgba,
} from '../../core/sprite';
import { mirrorFrame, mirrorShortcutAllowed, oppositeSilhouette } from '../../core/symmetry';
import { decodeImage } from '../../platform/canvas';
import { isImageFile, pickFiles } from '../../platform/files';
import { getState, setUi } from '../store';
import { commitDoc } from './document';
import { confirmDialog, errorToast, toast } from './ui';

/** Commits pixels for one frame (editor strokes, transforms). */
export function commitFrameImage(
  direction: Direction,
  frame: number,
  image: RasterImage,
  label: string,
): void {
  commitDoc(`${label} (${direction})`, (p) => {
    const anim = activeAnimation(p);
    const current = getFrame(anim, direction, frame);
    // Editing the source sprite keeps it the reference but marks it edited.
    const origin: FrameOrigin | null = current?.origin ?? { kind: 'manual', createdAt: Date.now() };
    return replaceAnimation(p, updateFrameImage(anim, direction, frame, image, 'edited', origin));
  });
}

export function clearDirection(direction: Direction, frame = getState().ui.frame): void {
  commitDoc(`Clear ${direction}`, (p) =>
    replaceAnimation(
      p,
      updateFrameImage(activeAnimation(p), direction, frame, null, 'empty', null),
    ),
  );
}

export function toggleLock(direction: Direction): void {
  commitDoc(`Lock ${direction}`, (p) => {
    const anim = activeAnimation(p);
    return replaceAnimation(p, setTrackLocked(anim, direction, !anim.tracks[direction].locked));
  });
}

function conformImported(p: Project, raw: RasterImage): { image: RasterImage; warnings: string[] } {
  const character = p.character;
  const pixelArt = character?.style.pixelArt ?? p.source?.import.pixelArt ?? true;
  if (!character || !p.source) {
    // Without a reference just clean it up and stand it on the anchor.
    const n = normalizeImport(raw, { maxDimension: Math.max(p.cell.width, p.cell.height) });
    return {
      image: conformToCharacter(n.sprite, {
        cell: p.cell,
        pixelArt,
        locks: {
          palette: false,
          outline: false,
          shading: false,
          resolution: false,
          proportions: false,
          scale: false,
          style: false,
        },
        palette: [],
        outline: null,
        referenceHeight: n.sprite.height,
        scaleMode: 'off',
      }).image,
      warnings: n.warnings,
    };
  }
  const outlineColor = character.style.outline.color
    ? hexToRgba(character.style.outline.color)
    : null;
  const res = conformToCharacter(raw, {
    cell: p.cell,
    pixelArt,
    locks: character.locks,
    palette: character.colors.palette.map((h) => hexToRgba(h)).filter((c): c is Rgba => !!c),
    outline:
      character.style.outline.enabled && outlineColor
        ? { color: outlineColor, thickness: character.style.outline.thickness }
        : null,
    referenceHeight: p.source.sprite.height,
    scaleMode: 'height',
    detectUpscale: true,
  });
  return { image: res.image, warnings: res.warnings };
}

/** Imports an image (e.g. a view drawn elsewhere or made with another AI tool) into one direction. */
export async function importDirectionFile(direction: Direction, file: File): Promise<void> {
  try {
    const raw = await decodeImage(file);
    const p = getState().project;
    const { image, warnings } = conformImported(p, raw);
    const frame = getState().ui.frame;
    commitDoc(`Import ${direction}`, (pr) =>
      replaceAnimation(
        pr,
        updateFrameImage(activeAnimation(pr), direction, frame, image, 'imported', {
          kind: 'imported',
          fileName: file.name,
          createdAt: Date.now(),
          notes: warnings,
        }),
      ),
    );
    toast(
      'success',
      `Imported ${file.name} into ${direction}.`,
      warnings.join(' ') ||
        'Scaled to the character height, aligned on the feet and matched to the palette lock.',
    );
  } catch (err) {
    errorToast(err, `Could not import ${file.name}.`);
  }
}

export async function chooseDirectionImport(direction: Direction): Promise<void> {
  const [file] = await pickFiles('image/*');
  if (file) await importDirectionFile(direction, file);
}

/** Batch import: directions are read from file names (hero_NE.png, hero-north-west.png …). */
export async function importDirectionFiles(files: File[]): Promise<void> {
  const images = files.filter(isImageFile);
  const unmatched: string[] = [];
  let count = 0;
  for (const file of images) {
    const d = parseDirectionFromName(file.name);
    if (!d) {
      unmatched.push(file.name);
      continue;
    }
    await importDirectionFile(d, file);
    count++;
  }
  if (unmatched.length) {
    toast(
      'warn',
      `Skipped ${unmatched.length} file(s) without a direction in the name.`,
      `${unmatched.join(', ')} — name files like hero_NE.png or hero_south_west.png.`,
    );
  } else if (count > 1) {
    toast('success', `Imported ${count} directions.`);
  }
}

export async function chooseBatchImport(): Promise<void> {
  const files = await pickFiles('image/*', true);
  if (files.length) await importDirectionFiles(files);
}

/** Symmetry shortcut for one direction: mirror its partner view around the foot anchor. */
export async function deriveMirror(direction: Direction): Promise<void> {
  const p = getState().project;
  const partner = mirroredDirection(direction);
  if (partner === direction) return;
  if (!mirrorShortcutAllowed(p.setup.symmetry, true)) {
    toast(
      'warn',
      'Mirroring is disabled for asymmetric characters.',
      'A mirrored view would put the dominant hand and one-sided details on the wrong side.',
    );
    return;
  }
  const frame = getState().ui.frame;
  const src = getFrame(activeAnimation(p), partner, frame);
  if (!src?.image || src.status === 'empty' || src.status === 'guide') {
    toast('info', `${partner} has no image to mirror yet.`);
    return;
  }
  const target = getFrame(activeAnimation(p), direction, frame);
  if (target?.image && (target.status === 'edited' || target.status === 'imported')) {
    const choice = await confirmDialog({
      title: `Replace ${direction}?`,
      message: `${direction} has manual work. Replace it with a mirror of ${partner}?`,
      confirmLabel: 'Replace',
    });
    if (choice !== 'confirm') return;
  }
  commitDoc(`Mirror ${partner} → ${direction}`, (pr) =>
    replaceAnimation(
      pr,
      updateFrameImage(
        activeAnimation(pr),
        direction,
        frame,
        mirrorFrame(src.image!, pr.cell.anchorX),
        'mirror',
        {
          kind: 'mirror',
          mirroredFrom: partner,
          createdAt: Date.now(),
        },
      ),
    ),
  );
}

/** Bakes the opposite view's mirrored outline into the frame as a flat base to paint over. */
export function stampSilhouette(direction: Direction, color: Rgba): boolean {
  const p = getState().project;
  const frame = getState().ui.frame;
  const opposite = getFrame(activeAnimation(p), oppositeDirection(direction), frame);
  if (!opposite?.image || opposite.status === 'empty' || opposite.status === 'guide') return false;
  const guide = oppositeSilhouette(opposite.image, p.cell.anchorX, { ...color, a: 255 });
  commitFrameImage(direction, frame, guide, 'Stamp silhouette');
  return true;
}

/** Resizes the shared working canvas for every frame, keeping the anchor in place. */
export function resizeWorkingCanvas(width: number, height: number): void {
  commitDoc('Resize canvas', (p) => {
    const w = Math.max(8, Math.min(1024, Math.round(width)));
    const h = Math.max(8, Math.min(1024, Math.round(height)));
    const dx = Math.round(w / 2 - p.cell.anchorX);
    const dy = Math.round(h - (p.cell.height - p.cell.anchorY) - p.cell.anchorY);
    const cell: WorkingCell = {
      width: w,
      height: h,
      anchorX: p.cell.anchorX + dx,
      anchorY: p.cell.anchorY + dy,
    };
    const animations = p.animations.map((anim) => {
      const tracks = { ...anim.tracks };
      for (const d of Object.keys(tracks) as Direction[]) {
        tracks[d] = {
          ...tracks[d],
          frames: tracks[d].frames.map((f) =>
            f.image ? { ...f, image: resizeCanvas(f.image, w, h, dx, dy) } : f,
          ),
        };
      }
      return { ...anim, tracks };
    });
    return { ...p, cell, animations };
  });
}

export function addFrame(duplicate: boolean): void {
  const frame = getState().ui.frame;
  commitDoc(duplicate ? 'Duplicate frame' : 'Add frame', (p) =>
    replaceAnimation(p, insertFrame(activeAnimation(p), frame, duplicate)),
  );
  setUi({ frame: frame + 1 });
}

export async function deleteFrame(): Promise<void> {
  const frame = getState().ui.frame;
  const anim = activeAnimation(getState().project);
  if (anim.tracks.N.frames.length <= 1) return;
  const choice = await confirmDialog({
    title: `Delete frame ${frame + 1}?`,
    message: 'The frame is removed from all eight directions.',
    confirmLabel: 'Delete',
    danger: true,
  });
  if (choice !== 'confirm') return;
  commitDoc('Delete frame', (p) => replaceAnimation(p, removeFrame(activeAnimation(p), frame)));
  setUi({ frame: Math.max(0, frame - 1) });
}
