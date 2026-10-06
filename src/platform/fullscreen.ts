export function fullscreenSupported(): boolean {
  return typeof document !== 'undefined' && !!document.fullscreenEnabled;
}

export function isFullscreen(): boolean {
  return !!document.fullscreenElement;
}

export async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
  } catch {
    /* denied or unsupported — ignore */
  }
}
