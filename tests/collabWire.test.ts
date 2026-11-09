import { describe, expect, it } from 'vitest';
import { encodePeerMessage, decodePeerMessage } from '../src/engine/collabWire';
import { CollaborativeDocument, sharedProject } from '../src/engine/collaborativeDocument';
import { INITIAL_STATE } from '../src/state/stateManager';
import type { CollabMessage } from '../src/types';

describe('network collaboration envelopes', () => {
  it('preserves every CRDT byte and routing field through top-level binary transport', () => {
    const message: CollabMessage = { type: 'crdt_update', peerId: 'sender', sessionId: 'room', protocol: 'recto-yjs-v2', baselineId: 'baseline', update: new Uint8Array([0, 128, 255, 1]) };
    const encoded = encodePeerMessage(message);
    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(decodePeerMessage(structuredClone(encoded))).toEqual(message);
    expect(decodePeerMessage((encoded as Uint8Array).buffer)).toEqual(message);
    expect(() => decodePeerMessage(JSON.parse(JSON.stringify(message)))).toThrow('binary envelope');
  });
  it('syncs a late replica with a real shared document update and Unicode baseline', () => {
    const baseline = sharedProject(structuredClone(INITIAL_STATE)); baseline.settings.title = '日本語 · Ελληνικά';
    const a = new CollaborativeDocument(baseline), b = new CollaborativeDocument(baseline);
    try {
      const next = a.snapshot(); next.settings.title = 'Éditorial partagé'; a.update(next);
      const message = decodePeerMessage(encodePeerMessage({ type: 'crdt_sync', peerId: 'host', baselineId: 'baseline', baseline, update: a.encode() }));
      expect(message.type).toBe('crdt_sync');
      if (message.type !== 'crdt_sync') throw new Error('Expected a shared snapshot.');
      expect(message.baseline).toEqual(baseline); b.apply(message.update); expect(b.snapshot()).toEqual(a.snapshot());
    } finally { a.destroy(); b.destroy(); }
  });
  it('handles byte-array slices and rejects malformed headers before parsing their bodies', () => {
    const encoded = encodePeerMessage({ type: 'crdt_update', peerId: 'peer', baselineId: 'baseline', update: new Uint8Array([1, 2]) }) as Uint8Array;
    const storage = new Uint8Array(encoded.length + 12); storage.set(encoded, 6);
    expect(decodePeerMessage(storage.subarray(6, -6))).toMatchObject({ update: new Uint8Array([1, 2]) });
    const invalid = encoded.slice(); new DataView(invalid.buffer).setUint32(4, 0xffffffff);
    expect(() => decodePeerMessage(invalid)).toThrow('header');
    expect(() => decodePeerMessage(encoded.slice(0, 8))).toThrow('size');
    expect(() => decodePeerMessage(null)).toThrow('Invalid peer message');
  });
  it('keeps lightweight control messages JSON-compatible', () => {
    const request: CollabMessage = { type: 'sync_request', peerId: 'guest', requestId: 'request' };
    expect(decodePeerMessage(JSON.parse(JSON.stringify(encodePeerMessage(request))))).toEqual(request);
  });
});
