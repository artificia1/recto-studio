import { JSONParser } from '@streamparser/json';
import { ProjectValidationError } from './projectValidation';

/** Build the editor's JSON object from UTF-8 chunks without creating a full text copy. */
export async function readProjectJson(file: Blob): Promise<unknown> {
  const parser = new JSONParser({ paths: ['$'], stringBufferSize: 64 * 1024 });
  let value: unknown;
  let complete = false;
  parser.onValue = event => {
    value = event.value;
    complete = true;
  };
  const reader = file.stream().getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const text = decoder.decode(chunk.value, { stream: true });
      if (text) parser.write(text);
    }
    const tail = decoder.decode();
    if (tail) parser.write(tail);
    if (!parser.isEnded) parser.end();
    if (!complete) throw new Error('Incomplete project');
    return value;
  } catch {
    await reader.cancel().catch(() => {});
    throw new ProjectValidationError('Project', 'the file is not valid JSON');
  } finally {
    reader.releaseLock();
  }
}
