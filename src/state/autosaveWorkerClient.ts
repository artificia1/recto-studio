export type RecoveryJson = string | string[];

export interface AutosaveJob {
  json: RecoveryJson;
  updatedAt: number;
  checkpoint?: { id: string; fileName?: string; recoverable: boolean };
}

/** One worker per large save keeps an idle editor from retaining two copies of its project. */
export function saveProjectInWorker(job: AutosaveJob): Promise<boolean> {
  return new Promise(resolve => {
    let worker: Worker | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const finish = (saved: boolean) => {
      clearTimeout(timeout);
      worker?.terminate();
      resolve(saved);
    };
    try {
      worker = new Worker(new URL('./autosaveWorker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = event => finish(event.data === true);
      worker.onerror = event => { event.preventDefault(); finish(false); };
      worker.onmessageerror = () => finish(false);
      timeout = setTimeout(() => finish(false), 15_000);
      worker.postMessage(job);
    } catch {
      finish(false);
    }
  });
}
