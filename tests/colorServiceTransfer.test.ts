import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it('transfers consumed ICC tiles and leaves shared or caller-owned data readable', async () => {
  class ColorWorker {
    onmessage!: (event: { data: { id: number; value: Uint8Array } }) => void;
    postMessage(payload: { id: number; command: { pixels: Uint8Array } }, transfer: ArrayBuffer[]) {
      const { id, command } = structuredClone(payload, { transfer });
      queueMicrotask(() => this.onmessage({ data: { id, value: command.pixels } }));
    }
  }
  vi.stubGlobal('Worker', ColorWorker);
  const { convertIcc } = await import('../src/engine/colorService');
  const options = { profile: Uint8Array.of(9), direction: 'rgb-to-cmyk' as const, intent: 'relative' as const, blackPointCompensation: false };

  const owned = Uint8Array.of(1, 2, 3);
  expect(await convertIcc({ ...options, pixels: owned }, true)).toEqual(Uint8Array.of(1, 2, 3));
  expect(owned.byteLength).toBe(0);

  const full = Uint8Array.of(1, 2, 3, 4, 5, 6);
  expect(await convertIcc({ ...options, pixels: full.subarray(3) }, true)).toEqual(Uint8Array.of(4, 5, 6));
  expect(full.byteLength).toBe(6);
  expect(await convertIcc({ ...options, pixels: full })).toEqual(full);
  expect(full.byteLength).toBe(6);
});
