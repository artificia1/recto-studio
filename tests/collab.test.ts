import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CollabSession } from '../src/collab';
import { StateManager, INITIAL_STATE } from '../src/state/stateManager';
import type { CollabMessage } from '../src/types';

describe('Collaboration between independent peers', () => {
  const sessions: CollabSession[] = [];
  let channels: Channel[];
  let delivery: (() => unknown)[];
  class Channel {
    onmessage?: (event: { data: CollabMessage }) => unknown;
    constructor(readonly name: string) { channels.push(this); }
    postMessage(message: CollabMessage) {
      for (const channel of channels) {
        if (channel !== this && channel.name === this.name) {
          const data = structuredClone(message);
          delivery.push(() => channel.onmessage?.({ data }));
        }
      }
    }
    close() { channels = channels.filter(channel => channel !== this); }
  }
  async function flush() {
    while (delivery.length) await delivery.shift()!();
  }
  function peer() {
    const manager = new StateManager();
    manager.loadFromJson(JSON.stringify(INITIAL_STATE));
    const session = new CollabSession(manager);
    sessions.push(session);
    return { manager, session };
  }
  beforeEach(() => {
    vi.useFakeTimers();
    channels = [];
    delivery = [];
    vi.stubGlobal('BroadcastChannel', Channel);
  });
  afterEach(() => {
    sessions.splice(0).forEach(session => session.disconnect());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('initially syncs the existing document while preserving the joining viewport', async () => {
    const host = peer();
    host.manager.updateSettings({ title: 'Shared publication' });
    await host.session.connect('room');
    const guest = peer();
    guest.manager.setPan(55, 66);
    await guest.session.connect('room');
    guest.manager.setActiveSpread(1);
    await flush();
    expect(guest.manager.getState().settings.title).toBe('Shared publication');
    expect(guest.manager.getState().activeSpreadIndex).toBe(1);
    expect(guest.manager.getState().panX).toBe(55);
  });

  it('routes add, update and delete to the sender spread without changing receiver selection', async () => {
    const host = peer();
    const guest = peer();
    await host.session.connect('room');
    await guest.session.connect('room');
    await flush();
    host.manager.setActiveSpread(0);
    guest.manager.setActiveSpread(1);
    const selected = guest.manager.getActiveSpread().elements[0].id;
    guest.manager.selectElement(selected);
    const element = { ...host.manager.getActiveSpread().elements[0], id: 'shared-item' };
    host.manager.addElement(element);
    await flush();
    expect(guest.manager.getState().spreads[0].elements.some(item => item.id === element.id)).toBe(true);
    host.manager.updateElement(element.id, { width: 88 });
    await flush();
    expect(guest.manager.getState().spreads[0].elements.find(item => item.id === element.id)?.width).toBe(88);
    host.manager.deleteElement(element.id);
    await flush();
    expect(guest.manager.getState().spreads[0].elements.some(item => item.id === element.id)).toBe(false);
    expect(guest.manager.getState().activeSpreadIndex).toBe(1);
    expect(guest.manager.getState().selectedElementId).toBe(selected);
  });

  it('converges after simultaneous edits delivered in opposite directions', async () => {
    const a = peer();
    const b = peer();
    await a.session.connect('room');
    await b.session.connect('room');
    await flush();
    const id = a.manager.getActiveSpread().elements[0].id;
    a.manager.updateElement(id, { width: 77 });
    b.manager.updateElement(id, { width: 99 });
    await flush();
    expect(a.manager.getElementById(id)?.width).toBe(b.manager.getElementById(id)?.width);
  });

  it('rejects older protocol edits, wrong rooms, and malformed edits', async () => {
    const { manager, session } = peer();
    await session.connect('room');
    const spread = manager.getActiveSpread();
    const element = structuredClone(spread.elements[0]);
    const base = { peerId: 'remote', spreadId: spread.id, sessionId: 'room', timestamp: 0 };
    session.handleMessage({ ...base, type: 'op_delete', elementId: element.id, clock: 2 });
    session.handleMessage({ ...base, type: 'op_add', element, clock: 1 });
    expect(manager.getElementById(element.id)).not.toBeNull();
    expect(session.getProtocolError()).toContain('older collaboration protocol');
    const current = structuredClone(manager.getState());
    session.handleMessage({ ...base, sessionId: 'other', type: 'op_add', element, clock: 3 });
    session.handleMessage({ ...base, type: 'op_add', element: { ...element, width: -1 }, clock: 4 });
    expect(manager.getState()).toEqual(current);
  });

  it('does not apply a late initial snapshot after a local edit', async () => {
    const a = peer();
    const b = peer();
    await a.session.connect('room');
    await b.session.connect('room');
    const id = b.manager.getActiveSpread().elements[0].id;
    b.manager.updateElement(id, { width: 123 });
    await flush();
    expect(b.manager.getElementById(id)?.width).toBe(123);
  });

  it('protects local document settings from late join snapshots too', async () => {
    const a = peer();
    const b = peer();
    await a.session.connect('room');
    await b.session.connect('room');
    b.manager.updateSettings({ title: 'New local work' });
    await flush();
    expect(b.manager.getState().settings.title).toBe('New local work');
  });

  it('rejects incompatible seeded replicas before applying their operations', async () => {
    const { manager, session } = peer(); await session.connect('room');
    const before = manager.exportJson();
    await session.handleMessage({ type: 'crdt_update', peerId: 'older-peer', baselineId: 'old-seed', update: new Uint8Array([1]) });
    expect(manager.exportJson()).toBe(before);
    expect(session.getProtocolError()).toContain('Incompatible collaboration protocol');
  });

  it('keeps completed gestures in separate local undo groups', async () => {
    const a = peer(), b = peer(); await a.session.connect('room'); await b.session.connect('room'); await flush();
    const id = a.manager.getActiveSpread().elements[0].id;
    a.manager.updateElement(id, { width: 77 }); a.manager.finishUndoGroup();
    a.manager.updateElement(id, { width: 88 }); a.manager.finishUndoGroup(); await flush();
    a.manager.undo(); await flush();
    expect(a.manager.getElementById(id)?.width).toBe(77); expect(b.manager.getElementById(id)?.width).toBe(77);
    a.manager.redo(); await flush(); expect(b.manager.getElementById(id)?.width).toBe(88);
  });

  it('merges manuscript edits with layout and settings edits and keeps undo local', async () => {
    const a = peer(), b = peer();
    await a.session.connect('room'); await b.session.connect('room'); await flush();
    const text = a.manager.getActiveSpread().elements.find(element => element.type === 'text')!;
    a.manager.setStoryContent(text.id, { version: 1, paragraphs: [{ runs: [{ text: 'Editorial copy' }] }] });
    b.manager.updateElement(text.id, { x: 72 }); b.manager.updateSettings({ title: 'New title' });
    await flush();
    for (const { manager } of [a, b]) {
      expect(manager.getElementById(text.id)).toMatchObject({ x: 72 });
      expect(manager.getStoryContent(text.id).paragraphs[0].runs[0].text).toBe('Editorial copy');
      expect(manager.getState().settings.title).toBe('New title');
    }
    a.manager.undo(); await flush();
    expect(a.manager.getElementById(text.id)).toMatchObject({ x: 72 });
    expect(a.manager.getState().settings.title).toBe('New title');
    expect(a.manager.getStoryContent(text.id)).toEqual(b.manager.getStoryContent(text.id));
  });
});
