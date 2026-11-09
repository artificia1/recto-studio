import type { CollabMessage } from '../types';

const MAGIC = 0x52435432; // RCT2: JSON metadata followed by unmodified CRDT bytes.
const MAX_PART_BYTES = 64 * 1024 * 1024;
export const MAX_PEER_MESSAGE_BYTES = 8 + 2 * MAX_PART_BYTES;

/** Trystero preserves top-level binary payloads; nested typed arrays become JSON objects. */
export function encodePeerMessage(message: CollabMessage): CollabMessage | Uint8Array {
  if (message.type !== 'crdt_update' && message.type !== 'crdt_sync') return message;
  const { update, ...metadata } = message;
  if (!(update instanceof Uint8Array) || !update.length || update.length > MAX_PART_BYTES) throw new Error('Invalid shared document update size.');
  const json = new TextEncoder().encode(JSON.stringify(metadata));
  if (json.length > MAX_PART_BYTES) throw new Error('Shared document metadata exceeds 64 MiB.');
  const result = new Uint8Array(8 + json.length + update.length);
  const header = new DataView(result.buffer);
  header.setUint32(0, MAGIC); header.setUint32(4, json.length);
  result.set(json, 8); result.set(update, 8 + json.length);
  return result;
}

export function decodePeerMessage(value: unknown): CollabMessage {
  if (value instanceof ArrayBuffer) value = new Uint8Array(value);
  if (!(value instanceof Uint8Array)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid peer message.');
    const message = value as CollabMessage;
    if (message.type === 'crdt_update' || message.type === 'crdt_sync') throw new Error('Shared document updates require a binary envelope.');
    return message;
  }
  if (value.byteLength < 10 || value.byteLength > MAX_PEER_MESSAGE_BYTES) throw new Error('Invalid binary peer message size.');
  const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
  const length = view.getUint32(4), updateSize = value.byteLength - 8 - length;
  if (view.getUint32(0) !== MAGIC || !length || length > MAX_PART_BYTES || updateSize < 1 || updateSize > MAX_PART_BYTES) throw new Error('Invalid binary peer message header.');
  const metadata: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(value.subarray(8, 8 + length)));
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || !('type' in metadata) || !['crdt_update', 'crdt_sync'].includes(String(metadata.type))) throw new Error('Invalid shared document metadata.');
  return { ...metadata, update: value.slice(8 + length) } as CollabMessage;
}
