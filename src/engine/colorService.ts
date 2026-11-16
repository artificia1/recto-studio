import type { ColorCommand } from './colorWorker';
import type { IccTransformOptions } from './iccEngine';

let worker: Worker | undefined;
let nextId = 0;
const pending = new Map<number, { resolve(value: unknown): void; reject(reason: Error): void; timer: ReturnType<typeof setTimeout> }>();

function stop(reason: Error) {
  worker?.terminate(); worker = undefined;
  for (const job of pending.values()) { clearTimeout(job.timer); job.reject(reason); }
  pending.clear();
}

async function execute<T>(command: ColorCommand, transferPixels = false): Promise<T> {
  if (typeof Worker === 'undefined') {
    const engine = await import('./iccEngine');
    await engine.initializeCms();
    return (command.kind === 'describe' ? engine.describeOutputProfile(command.profile) : engine.transformIcc(command)) as T;
  }
  if (pending.size >= 8) throw new Error('Colour processing is busy. Wait for the current operation to finish.');
  if (!worker) {
    worker = new Worker(new URL('./colorWorker.ts', import.meta.url), { type: 'module' });
    const active = worker;
    worker.onerror = () => { if (worker === active) stop(new Error('The colour engine could not run. Reopen the panel and try again.')); };
    worker.onmessage = event => {
      if (worker !== active) return;
      const job = pending.get(event.data.id);
      if (!job) return;
      pending.delete(event.data.id); clearTimeout(job.timer);
      if (event.data.error) job.reject(new Error(event.data.error)); else job.resolve(event.data.value);
    };
  }
  return new Promise<T>((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => stop(new Error('ICC processing exceeded 45 seconds. Try a smaller profile or image tile.')), 45000);
    pending.set(id, { resolve: value => resolve(value as T), reject, timer });
    try {
      const pixels = transferPixels && command.kind === 'transform' ? command.pixels : undefined;
      const buffer = pixels?.buffer;
      const transfer = buffer instanceof ArrayBuffer && pixels?.byteOffset === 0 && pixels.byteLength === buffer.byteLength ? [buffer] : [];
      worker!.postMessage({ id, command }, transfer);
    }
    catch (reason) {
      pending.delete(id); clearTimeout(timer);
      reject(reason instanceof Error ? reason : new Error(String(reason)));
    }
  });
}

export const describeIcc = (profile: Uint8Array) => execute<string>({ kind: 'describe', profile });
// A caller may hand over an owned tile once it has finished reading it.
export const convertIcc = (options: IccTransformOptions, transferPixels = false) =>
  execute<Uint8Array>({ kind: 'transform', ...options }, transferPixels);
