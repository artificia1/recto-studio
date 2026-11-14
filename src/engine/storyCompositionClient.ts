import type { StoryComposition, StoryCompositionRequest } from './storyComposition';

export function requestStoryComposition(input: StoryCompositionRequest, signal: AbortSignal): Promise<StoryComposition | null> {
  if (signal.aborted || typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return Promise.resolve(null);
  return new Promise(resolve => {
    let worker: Worker | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => finish(null);
    function finish(result: StoryComposition | null) {
      if (timer !== undefined) clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      worker?.terminate();
      resolve(result);
    }
    try {
      worker = new Worker(new URL('./storyCompositionWorker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<StoryComposition | null>) => finish(event.data);
      worker.onerror = cancel;
      worker.onmessageerror = cancel;
      signal.addEventListener('abort', cancel, { once: true });
      timer = setTimeout(cancel, 15_000);
      worker.postMessage(input);
    } catch {
      finish(null);
    }
  });
}
