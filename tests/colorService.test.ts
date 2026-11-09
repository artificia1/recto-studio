import { afterEach, expect, it, vi } from 'vitest';
import { describeIcc } from '../src/engine/colorService';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it('cleans failed worker submissions without exhausting the queue or leaving timers', async () => {
  vi.useFakeTimers();
  class WorkerStub {
    onerror: (() => void) | null = null;
    onmessage: (() => void) | null = null;
    postMessage() { throw new Error('The profile could not be cloned.'); }
    terminate() {}
  }
  vi.stubGlobal('Worker', WorkerStub);
  for (let attempt = 0; attempt < 12; attempt++) await expect(describeIcc(new Uint8Array([1, 2]))).rejects.toThrow('could not be cloned');
  expect(vi.getTimerCount()).toBe(0);
});
