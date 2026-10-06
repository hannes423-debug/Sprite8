import { APP_NAME, APP_VERSION } from '../export/metadata';
import type { Project } from '../project/project';
import { blobToBase64, base64ToBlob } from '../providers/http';
import type { ImageCodec } from '../providers/types';
import type { RasterImage } from '../sprite';
import { normalizeProject } from './normalize';

/**
 * Portable project file (`*.sprite8.json`): the whole project as JSON with
 * every raster stored as a PNG data URL. Human-inspectable, diff-friendly
 * metadata and lossless images.
 */
export const PROJECT_FILE_FORMAT = 'sprite8-project-file';

interface EncodedRaster {
  $raster: 'png';
  width: number;
  height: number;
  data: string;
}

function isRaster(v: unknown): v is RasterImage {
  const r = v as RasterImage;
  return (
    !!r &&
    typeof r === 'object' &&
    r.data instanceof Uint8ClampedArray &&
    typeof r.width === 'number' &&
    typeof r.height === 'number'
  );
}

function isEncoded(v: unknown): v is EncodedRaster {
  return !!v && typeof v === 'object' && (v as EncodedRaster).$raster === 'png';
}

async function mapDeep(
  value: unknown,
  fn: (v: unknown) => Promise<unknown> | undefined,
  cache: Map<unknown, Promise<unknown>>,
): Promise<unknown> {
  // Shared rasters (the same image referenced twice) are converted once.
  if (value && typeof value === 'object' && cache.has(value)) return cache.get(value);
  const direct = fn(value);
  if (direct) {
    cache.set(value, direct);
    return direct;
  }
  if (Array.isArray(value)) return Promise.all(value.map((v) => mapDeep(v, fn, cache)));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      out[k] = await mapDeep(v, fn, cache);
    }
    return out;
  }
  return value;
}

export async function serializeProject(project: Project, codec: ImageCodec): Promise<string> {
  const cache = new Map<unknown, Promise<unknown>>();
  const encoded = await mapDeep(
    project,
    (v) =>
      isRaster(v)
        ? (async () => ({
            $raster: 'png',
            width: v.width,
            height: v.height,
            data: `data:image/png;base64,${await blobToBase64(await codec.encodePng(v))}`,
          }))()
        : undefined,
    cache,
  );
  return JSON.stringify({
    format: PROJECT_FILE_FORMAT,
    version: 1,
    savedAt: new Date().toISOString(),
    app: { name: APP_NAME, version: APP_VERSION },
    project: encoded,
  });
}

export async function deserializeProject(text: string, codec: ImageCodec): Promise<Project> {
  let json: { format?: string; project?: unknown };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('The file is not valid JSON.');
  }
  if (json.format !== PROJECT_FILE_FORMAT || !json.project)
    throw new Error('This is not a Sprite8 project file.');
  const cache = new Map<unknown, Promise<unknown>>();
  const decoded = await mapDeep(
    json.project,
    (v) =>
      isEncoded(v)
        ? (async () => {
            const img = await codec.decode(base64ToBlob(v.data));
            if (img.width !== v.width || img.height !== v.height)
              throw new Error('A stored image has unexpected dimensions.');
            return img;
          })()
        : undefined,
    cache,
  );
  return normalizeProject(decoded);
}
