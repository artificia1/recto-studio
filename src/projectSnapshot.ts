import type { ProjectState } from './types';

/** Project state is JSON data. Batch its tokens so saving does not stringify the entire project. */
export function projectSnapshotBlob(state: ProjectState, maxBytes: number): Blob {
  const chunks: Blob[] = [];
  const encoder = new TextEncoder();
  let pending = '';
  let byteLength = 0;

  function flush() {
    if (!pending) return;
    const bytes = encoder.encode(pending);
    byteLength += bytes.length;
    if (byteLength > maxBytes) throw new Error('This project exceeds the 128 MB desktop save limit.');
    chunks.push(new Blob([bytes]));
    pending = '';
  }

  function append(token: string) {
    if (pending.length + token.length > 64 * 1024) flush();
    pending += token;
    if (pending.length >= 64 * 1024) flush();
  }

  function write(value: unknown) {
    if (typeof value === 'string' && value.length > 16384) {
      append('"');
      for (let offset = 0; offset < value.length;) {
        let end = Math.min(offset + 16384, value.length);
        const previous = value.charCodeAt(end - 1);
        if (end < value.length && previous >= 0xd800 && previous <= 0xdbff) end--;
        append(JSON.stringify(value.slice(offset, end)).slice(1, -1));
        offset = end;
      }
      append('"');
    } else if (Array.isArray(value)) {
      append('[');
      for (let index = 0; index < value.length; index++) {
        if (index) append(',');
        write(value[index]);
      }
      append(']');
    } else if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
      append('{');
      let first = true;
      for (const key of Object.keys(value)) {
        const item = (value as Record<string, unknown>)[key];
        if (item === undefined || typeof item === 'function' || typeof item === 'symbol') continue;
        if (!first) append(',');
        first = false;
        append(JSON.stringify(key));
        append(':');
        write(item);
      }
      append('}');
    } else {
      append(JSON.stringify(value) ?? 'null');
    }
  }

  write(state);
  flush();
  return new Blob(chunks, { type: 'application/json' });
}
