/// <reference lib="webworker" />
import wasmPath from '../../node_modules/@kittl/little-cms/dist/lcms.wasm?url';
import { initializeCms, describeOutputProfile, transformIcc, type IccTransformOptions } from './iccEngine';

export type ColorCommand = { kind: 'describe'; profile: Uint8Array } | ({ kind: 'transform' } & IccTransformOptions);
let queue = Promise.resolve();
self.onmessage = (event: MessageEvent<{ id: number; command: ColorCommand }>) => {
  const { id, command } = event.data;
  queue = queue.then(async () => {
    try {
      await initializeCms(wasmPath);
      const value = command.kind === 'describe' ? describeOutputProfile(command.profile) : transformIcc(command);
      if (value instanceof Uint8Array) self.postMessage({ id, value }, { transfer: [value.buffer] });
      else self.postMessage({ id, value });
    } catch (reason) { self.postMessage({ id, error: reason instanceof Error ? reason.message : 'ICC conversion failed.' }); }
  });
};
