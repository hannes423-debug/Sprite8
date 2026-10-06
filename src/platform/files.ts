/** Triggers a browser download of `data`. */
export function downloadBlob(data: Blob | Uint8Array | string, fileName: string, type = 'application/octet-stream'): void {
  const blob =
    data instanceof Blob
      ? data
      : new Blob([typeof data === 'string' ? data : (data as Uint8Array<ArrayBuffer>)], { type: typeof data === 'string' ? 'application/json' : type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser time to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Opens the native file picker. Resolves with the chosen files (empty if cancelled). */
export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    let settled = false;
    const finish = (files: File[]) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => finish(Array.from(input.files ?? [])));
    input.addEventListener('cancel', () => finish([]));
    document.body.appendChild(input);
    input.click();
  });
}

export const IMAGE_ACCEPT = 'image/png,image/gif,image/webp,image/jpeg,image/bmp';

export function isImageFile(f: File): boolean {
  return f.type.startsWith('image/') || /\.(png|gif|webp|jpe?g|bmp)$/i.test(f.name);
}
