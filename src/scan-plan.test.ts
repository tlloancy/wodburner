import { describe, expect, it } from 'vitest';
import { nextEncode, scaledSize, TARGET_BYTES } from './scan-plan';

describe('scaledSize', () => {
  it('never upscales and caps the long edge at 1280', () => {
    expect(scaledSize(800, 600)).toEqual({ width: 800, height: 600, scale: 1 });
    expect(scaledSize(2560, 1280).width).toBe(1280);
    expect(scaledSize(2560, 1280).height).toBe(640);
    expect(scaledSize(100, 4000).height).toBe(1280);
    expect(scaledSize(100, 4000).scale).toBeLessThan(1);
  });
});

describe('nextEncode', () => {
  it('starts with webp 0.75 and shrinks once', () => {
    const first = nextEncode({ producedMime: null, bytes: null, triedFallback: false, triedShrink: false });
    expect(first).toEqual({ mime: 'image/webp', quality: 0.75 });
    const shrink = nextEncode({ producedMime: 'image/webp', bytes: TARGET_BYTES + 1, triedFallback: false, triedShrink: false });
    expect(shrink).toEqual({ mime: 'image/webp', quality: 0.5 });
    expect(nextEncode({ producedMime: 'image/webp', bytes: TARGET_BYTES + 1, triedFallback: false, triedShrink: true })).toBeNull();
  });

  it('re-encodes a PNG as JPEG 0.8, then shrinks once', () => {
    const jpeg = nextEncode({ producedMime: 'image/png', bytes: 10_000, triedFallback: false, triedShrink: false });
    expect(jpeg).toEqual({ mime: 'image/jpeg', quality: 0.8 });
    const shrink = nextEncode({ producedMime: 'image/jpeg', bytes: TARGET_BYTES + 1, triedFallback: true, triedShrink: false });
    expect(shrink).toEqual({ mime: 'image/jpeg', quality: 0.6 });
  });

  it('keeps a small webp', () => {
    expect(nextEncode({ producedMime: 'image/webp', bytes: 40_000, triedFallback: false, triedShrink: false })).toBeNull();
  });
});
