export const MAX_EDGE = 1280;
export const TARGET_BYTES = 150 * 1024;

export interface EncodeStep {
  mime: 'image/webp' | 'image/jpeg';
  quality: number;
}

export interface EncodeState {
  producedMime: string | null;
  bytes: number | null;
  triedFallback: boolean;
  triedShrink: boolean;
}

export function scaledSize(width: number, height: number, maxEdge = MAX_EDGE): { width: number; height: number; scale: number } {
  const edge = Math.max(width, height);
  const scale = edge === 0 ? 1 : Math.min(1, maxEdge / edge);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

/** WebP 0.75 first. PNG (or any other type) falls back to JPEG 0.8. One smaller pass if still over 150 KB. */
export function nextEncode(state: EncodeState): EncodeStep | null {
  if (state.producedMime == null) return { mime: 'image/webp', quality: 0.75 };
  const acceptable = state.producedMime === 'image/webp' || state.producedMime === 'image/jpeg';
  if (!acceptable && !state.triedFallback) return { mime: 'image/jpeg', quality: 0.8 };
  if ((state.bytes ?? 0) > TARGET_BYTES && !state.triedShrink) {
    const mime = state.producedMime === 'image/webp' ? 'image/webp' : 'image/jpeg';
    return { mime, quality: mime === 'image/webp' ? 0.5 : 0.6 };
  }
  return null;
}
