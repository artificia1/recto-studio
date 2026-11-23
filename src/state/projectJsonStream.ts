import { JSONParser } from '@streamparser/json';
import { ProjectValidationError } from './projectValidation';

const PARSE_SLICE_BYTES = 32 * 1024;
const PARSE_BATCH_MS = 8;

/** Build the editor's JSON object from bounded UTF-8 slices, yielding for input between batches. */
export async function readProjectJson(file: Blob, signal?: AbortSignal): Promise<unknown> {
  signal?.throwIfAborted();
  const parser = new JSONParser({ paths: ['$'], stringBufferSize: 64 * 1024 });
  let value: unknown;
  let complete = false;
  parser.onValue = event => {
    value = event.value;
    complete = true;
  };
  const reader = file.stream().getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  let deadline = performance.now() + PARSE_BATCH_MS;
  try {
    for (;;) {
      const chunk = await reader.read();
      signal?.throwIfAborted();
      if (chunk.done) break;
      for (let offset = 0; offset < chunk.value.length; offset += PARSE_SLICE_BYTES) {
        if (performance.now() >= deadline) {
          await new Promise<void>(resolve => setTimeout(resolve, 0));
          signal?.throwIfAborted();
          deadline = performance.now() + PARSE_BATCH_MS;
        }
        parser.write(chunk.value.subarray(offset, offset + PARSE_SLICE_BYTES));
      }
    }
    if (!parser.isEnded) parser.end();
    if (!complete) throw new Error('Incomplete project');
    return value;
  } catch {
    await reader.cancel().catch(() => {});
    signal?.throwIfAborted();
    throw new ProjectValidationError('Project', 'the file is not valid JSON');
  } finally {
    signal?.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}
