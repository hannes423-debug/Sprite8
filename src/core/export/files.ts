import type { Animation } from '../animation';
import type { Project } from '../project/project';
import type { ImageCodec } from '../providers/types';
import { buildMetadata, exportNames, type ExportNames, type SheetMetadata } from './metadata';
import { buildSheet, type BuiltSheet } from './sheet';
import { createZip } from './zip';

export interface ExportFile {
  name: string;
  data: Uint8Array;
  type: string;
}

export interface ExportBundle {
  sheet: BuiltSheet;
  metadata: SheetMetadata;
  names: ExportNames;
  files: ExportFile[];
}

export interface ExportSelection {
  sheet: boolean;
  cells: boolean;
  json: boolean;
}

async function png(
  codec: ImageCodec,
  img: Parameters<ImageCodec['encodePng']>[0],
): Promise<Uint8Array> {
  return new Uint8Array(await (await codec.encodePng(img)).arrayBuffer());
}

/** Renders the sheet and encodes the requested files. */
export async function buildExport(
  project: Project,
  codec: ImageCodec,
  selection: ExportSelection,
  animation?: Animation,
): Promise<ExportBundle> {
  const sheet = buildSheet(project, animation);
  const names = exportNames(project.setup.name, sheet.animation.name, sheet.frameCount);
  const metadata = buildMetadata(project, sheet, names);
  const files: ExportFile[] = [];
  if (selection.sheet)
    files.push({ name: names.sheet, data: await png(codec, sheet.image), type: 'image/png' });
  if (selection.cells) {
    for (const cell of sheet.cells) {
      files.push({
        name: names.cell(cell.direction, cell.frame),
        data: await png(codec, cell.image),
        type: 'image/png',
      });
    }
  }
  if (selection.json) {
    files.push({
      name: names.json,
      data: new TextEncoder().encode(`${JSON.stringify(metadata, null, 2)}\n`),
      type: 'application/json',
    });
  }
  return { sheet, metadata, names, files };
}

export function zipExport(bundle: ExportBundle): Uint8Array {
  return createZip(bundle.files.map((f) => ({ name: f.name, data: f.data })));
}
