import { parseScanResult } from './validate';
import type { ScanResult } from './types';
import { nextEncode, scaledSize, type EncodeState } from './scan-plan';

export class ScanError extends Error {
  constructor(readonly code: 'decode' | 'size' | 'network' | 'invalid' | 'upstream', readonly detail = '') {
    super(code);
    this.name = 'ScanError';
  }
}

export async function fileToBlob(file: Blob): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      throw new ScanError('decode');
    }
  }
  try {
    const size = scaledSize(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new ScanError('decode');
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    let state: EncodeState = { producedMime: null, bytes: null, triedFallback: false, triedShrink: false };
    let blob: Blob | null = null;
    for (let i = 0; i < 4; i++) {
      const step = nextEncode(state);
      if (!step) break;
      const encoded = await canvasToBlob(canvas, step.mime, step.quality);
      blob = encoded;
      state = {
        producedMime: encoded.type || step.mime,
        bytes: encoded.size,
        triedFallback: state.triedFallback || (step.mime === 'image/jpeg' && step.quality === 0.8 && state.producedMime != null),
        triedShrink: state.triedShrink || step.quality <= 0.6,
      };
    }
    if (!blob) throw new ScanError('decode');
    if (blob.size > 512 * 1024) throw new ScanError('size');
    return blob;
  } finally {
    bitmap.close();
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new ScanError('decode'))), type, quality);
  });
}

export async function postScan(blob: Blob, opts: { endpoint: string; turnstileToken: string; license?: string }): Promise<ScanResult> {
  const headers: Record<string, string> = {
    'content-type': blob.type || 'application/octet-stream',
    'x-turnstile': opts.turnstileToken,
  };
  if (opts.license) headers['x-license'] = opts.license;
  let response: Response;
  try {
    response = await fetch(opts.endpoint, { method: 'POST', body: blob, headers });
  } catch {
    throw new ScanError('network');
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isObj(payload) && typeof payload.message === 'string' ? payload.message : '';
    throw new ScanError('upstream', message);
  }
  try {
    return parseScanResult(payload);
  } catch {
    throw new ScanError('invalid');
  }
}

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
