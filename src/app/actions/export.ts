import { buildExport, zipExport, type ExportSelection } from '../../core/export';
import type { Direction } from '../../core/directions';
import type { SheetSettings } from '../../core/project';
import { browserCodec } from '../../platform/canvas';
import { downloadBlob } from '../../platform/files';
import { getState, setUi } from '../store';
import { updateProject } from './document';
import { errorToast, toast } from './ui';

export function updateSheet(patch: Partial<SheetSettings>): void {
  updateProject((p) => {
    const sheet = { ...p.sheet, ...patch };
    // Pixel preservation implies nearest-neighbour scaling.
    if (sheet.pixelPreservation) sheet.nearestNeighbor = true;
    return { ...p, sheet };
  });
}

async function exportWith(
  selection: ExportSelection,
  deliver: (bundle: Awaited<ReturnType<typeof buildExport>>) => void,
): Promise<void> {
  const p = getState().project;
  if (!p.source) {
    toast('warn', 'Nothing to export yet — upload a character first.');
    return;
  }
  setUi({ busy: 'Exporting…' });
  try {
    const bundle = await buildExport(p, browserCodec, selection);
    deliver(bundle);
    if (bundle.sheet.warnings.length)
      toast('warn', 'Exported with warnings.', bundle.sheet.warnings.join(' '));
  } catch (err) {
    errorToast(err, 'Export failed.');
  } finally {
    setUi({ busy: null });
  }
}

export function exportSheetPng(): Promise<void> {
  return exportWith({ sheet: true, cells: false, json: false }, (b) => {
    downloadBlob(b.files[0].data, b.names.sheet, 'image/png');
    toast('success', `Saved ${b.names.sheet} (${b.sheet.image.width}×${b.sheet.image.height}).`);
  });
}

export function exportJson(): Promise<void> {
  return exportWith({ sheet: false, cells: false, json: true }, (b) => {
    downloadBlob(b.files[0].data, b.names.json, 'application/json');
    toast('success', `Saved ${b.names.json}.`);
  });
}

/** Everything in one ZIP: sheet PNG, one PNG per direction/frame and the JSON metadata. */
export function exportZip(): Promise<void> {
  return exportWith({ sheet: true, cells: true, json: true }, (b) => {
    const name = `${b.names.base}_sprite8.zip`;
    downloadBlob(zipExport(b), name, 'application/zip');
    toast(
      'success',
      `Saved ${name}.`,
      `${b.files.length} files: sheet, ${b.files.length - 2} individual PNGs and JSON metadata.`,
    );
  });
}

/** Individual PNGs only, zipped. */
export function exportIndividualPngs(): Promise<void> {
  return exportWith({ sheet: false, cells: true, json: true }, (b) => {
    const name = `${b.names.base}_directions.zip`;
    downloadBlob(zipExport(b), name, 'application/zip');
    toast('success', `Saved ${name}.`);
  });
}

/** One direction's exported cell as a PNG. */
export function exportDirectionPng(direction: Direction): Promise<void> {
  return exportWith({ sheet: false, cells: true, json: false }, (b) => {
    const frame = getState().ui.frame;
    const idx = b.sheet.cells.findIndex((c) => c.direction === direction && c.frame === frame);
    if (idx < 0) return;
    const name = b.names.cell(direction, frame);
    downloadBlob(b.files[idx].data, name, 'image/png');
    toast('success', `Saved ${name}.`);
  });
}

export async function copyMetadata(): Promise<void> {
  await exportWith({ sheet: false, cells: false, json: true }, (b) => {
    const text = new TextDecoder().decode(b.files[0].data);
    navigator.clipboard?.writeText(text).then(
      () => toast('success', 'JSON metadata copied to the clipboard.'),
      () => toast('warn', 'Clipboard not available — use "JSON" to download instead.'),
    );
  });
}
