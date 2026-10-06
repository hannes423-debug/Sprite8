import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { expect, type Page } from '@playwright/test';
import { decodePng } from '../../models/reference-server/png.mjs';
import { startServer } from '../../models/reference-server/server.mjs';

export interface DecodedPng {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Clicks something that triggers a download and returns the file. */
export async function download(page: Page, trigger: () => Promise<unknown>): Promise<{ name: string; bytes: Uint8Array }> {
  const [dl] = await Promise.all([page.waitForEvent('download'), trigger()]);
  const path = await dl.path();
  return { name: dl.suggestedFilename(), bytes: new Uint8Array(readFileSync(path)) };
}

export function png(bytes: Uint8Array): DecodedPng {
  return decodePng(bytes);
}

/** Minimal reader for Sprite8's store-only ZIP files. */
export function readZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = bytes.length - 22;
  if (v.getUint32(eocd, true) !== 0x06054b50) throw new Error('Not a ZIP file');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    const size = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const local = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const localNameLen = v.getUint16(local + 26, true);
    out.set(name, bytes.subarray(local + 30 + localNameLen, local + 30 + localNameLen + size));
    p += 46 + nameLen;
  }
  return out;
}

export function countColor(img: DecodedPng, rgb: [number, number, number], region?: { x: number; y: number; w: number; h: number }): number {
  const r = region ?? { x: 0, y: 0, w: img.width, h: img.height };
  let n = 0;
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const i = (y * img.width + x) * 4;
      if (img.data[i + 3] > 0 && img.data[i] === rgb[0] && img.data[i + 1] === rgb[1] && img.data[i + 2] === rgb[2]) n++;
    }
  }
  return n;
}

export function opaqueCount(img: DecodedPng, region: { x: number; y: number; w: number; h: number }): number {
  let n = 0;
  for (let y = region.y; y < region.y + region.h; y++) {
    for (let x = region.x; x < region.x + region.w; x++) if (img.data[(y * img.width + x) * 4 + 3] > 0) n++;
  }
  return n;
}

/** Counts pixels of one colour in a direction's current frame (via window.sprite8). */
export async function frameColorCount(page: Page, direction: string, rgb: [number, number, number]): Promise<number> {
  return page.evaluate(
    ({ direction, rgb }) => {
      const s = window.sprite8!.getState();
      const anim = s.project.animations.find((a) => a.id === s.project.activeAnimationId)!;
      const img = anim.tracks[direction as 'N'].frames[s.ui.frame].image;
      if (!img) return 0;
      let n = 0;
      for (let i = 0; i < img.data.length; i += 4) {
        if (img.data[i + 3] > 0 && img.data[i] === rgb[0] && img.data[i + 1] === rgb[1] && img.data[i + 2] === rgb[2]) n++;
      }
      return n;
    },
    { direction, rgb },
  );
}

/** Drags the pencil from image pixel a to b inside the editor canvas. */
export async function paintLine(page: Page, a: [number, number], b: [number, number]): Promise<void> {
  const canvas = page.getByTestId('editor-canvas');
  const box = (await canvas.boundingBox())!;
  const zoom = Number(await canvas.getAttribute('data-zoom'));
  const panX = Number(await canvas.getAttribute('data-pan-x'));
  const panY = Number(await canvas.getAttribute('data-pan-y'));
  const at = (p: [number, number]) => [box.x + panX + (p[0] + 0.5) * zoom, box.y + panY + (p[1] + 0.5) * zoom] as const;
  const [x0, y0] = at(a);
  const [x1, y1] = at(b);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps: 8 });
  await page.mouse.up();
}

export async function workingCell(page: Page): Promise<{ width: number; height: number; anchorX: number; anchorY: number }> {
  return page.evaluate(() => window.sprite8!.getState().project.cell);
}

export async function expectStatus(page: Page, direction: string, status: string): Promise<void> {
  await expect(page.getByTestId(`cell-${direction}`)).toHaveAttribute('data-status', status);
}

/** Starts the reference server (mock backend) on a random port. */
export async function startMockAi(options: { mirrorBug?: string[] } = {}): Promise<{ url: string; close: () => Promise<void> }> {
  const server = await startServer({ port: 0, host: '127.0.0.1', backend: 'mock', mirrorBug: options.mirrorBug ?? [], outScale: 1, delay: 0 });
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) };
}

/** Selects and configures the Sprite8 HTTP provider through the dialog. */
export async function useHttpProvider(page: Page, url: string): Promise<void> {
  await page.getByTestId('provider-pill').click();
  await page.getByTestId('provider-sprite8-http').click();
  await page.getByTestId('setting-endpoint').fill(url);
  await page.getByTestId('test-connection').click();
  await expect(page.getByTestId('provider-status')).toContainText('Connected');
  await page.getByTestId('provider-done').click();
}
