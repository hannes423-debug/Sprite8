import type { RasterImage } from '../sprite';
import { ProviderError, type ImageCodec } from './types';

/** Base64 (no data-URL prefix) of a Blob. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBlob(b64: string, type = 'image/png'): Blob {
  const clean = b64.replace(/^data:[^,]*,/, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

export async function rasterToBase64Png(img: RasterImage, codec: ImageCodec): Promise<string> {
  return blobToBase64(await codec.encodePng(img));
}

export async function base64ToRaster(b64: string, codec: ImageCodec): Promise<RasterImage> {
  const mime = /^data:([^;,]+)/.exec(b64)?.[1] ?? 'image/png';
  return codec.decode(base64ToBlob(b64, mime));
}

/** Combines an optional caller signal with a timeout. */
export function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(Math.max(1, ms));
  if (!signal) return timeout;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timeout]);
  const ctrl = new AbortController();
  const abort = (s: AbortSignal) => ctrl.abort(s.reason);
  if (signal.aborted) abort(signal);
  else signal.addEventListener('abort', () => abort(signal), { once: true });
  timeout.addEventListener('abort', () => abort(timeout), { once: true });
  return ctrl.signal;
}

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/** fetch() with friendly errors for the usual local-server problems. */
export async function fetchChecked(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
  what: string,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetchFn(url, init);
  } catch (err) {
    const e = err as Error;
    if (e?.name === 'AbortError' || e?.name === 'TimeoutError') {
      throw new ProviderError(
        e.name === 'TimeoutError' ? `${what} timed out.` : `${what} was cancelled.`,
        e.name === 'TimeoutError'
          ? 'Increase the timeout in the provider settings or use a faster model.'
          : undefined,
      );
    }
    throw new ProviderError(
      `Could not reach ${url}.`,
      'Is the server running? Browsers also require the server to allow this page via CORS (see docs/providers.md). When running Sprite8 locally you can use the built-in /proxy/... paths instead.',
    );
  }
  if (!res.ok) {
    let body = '';
    try {
      body = (await res.text()).slice(0, 400);
    } catch {
      /* ignore */
    }
    throw new ProviderError(
      `${what} failed: HTTP ${res.status} ${res.statusText}${body ? ` — ${body}` : ''}`,
    );
  }
  return res;
}

export async function readJson<T>(res: Response, what: string): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    throw new ProviderError(`${what} returned invalid JSON.`);
  }
}

/** Resolves after `ms`, rejecting early if the signal aborts. */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ProviderError('Cancelled.'));
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new ProviderError('Cancelled.'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
