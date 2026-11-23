import { expect, it } from 'vitest';
import { readProjectJson } from '../src/state/projectJsonStream';

it('streams Unicode, escaped values and keys across UTF-8 boundaries', async () => {
  const text = '{"name":"' + '𐐷日本'.repeat(50000) + '\\n","__proto__":{"own":true},"rows":[null,1e-7,false]}';
  const data = new TextEncoder().encode('\uFEFF' + text);
  const file = new Blob([data.subarray(0, 13), data.subarray(13)]);
  const parsed = await readProjectJson(file);
  expect(parsed).toEqual(JSON.parse(text));
  expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
});

it.each(['', '{"spreads":[', '{"done":true} {}', '{"done":true}' + ' '.repeat(70000) + 'oops'])(
  'rejects a malformed or incomplete project stream',
  async text => {
    await expect(readProjectJson(new Blob([text]))).rejects.toThrow('not valid JSON');
  },
);

it('cancels a pending stream read and preserves the cancellation reason', async () => {
  let cancelled = false;
  const file = new Blob([]);
  Object.defineProperty(file, 'stream', { value: () => new ReadableStream<Uint8Array>({
    cancel: () => { cancelled = true; },
  }) });
  const controller = new AbortController();
  const opening = readProjectJson(file, controller.signal);
  const reason = new Error('Newer file selected');
  controller.abort(reason);
  await expect(opening).rejects.toBe(reason);
  expect(cancelled).toBe(true);
});
