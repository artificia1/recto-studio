import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CollabSession } from '../src/collab';
import { StateManager, INITIAL_STATE } from '../src/state/stateManager';
import type { CollabMessage } from '../src/types';

describe('Collaboration between independent peers', () => {
  const sessions: CollabSession[] = [];
  let channels: Channel[];
  let delivery: (() => void)[];
  class Channel {
    onmessage?: (event: { data: CollabMessage }) => void;
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
  function flush() {
    while (delivery.length) delivery.shift()!();
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

  it('initially syncs the existing document while preserving the joining viewport', () => {
    const host = peer();
    host.manager.updateSettings({ title: 'Shared publication' });
    host.session.connect('room');
    const guest = peer();
    guest.manager.setPan(55, 66);
    guest.session.connect('room');
    guest.manager.setActiveSpread(1);
    flush();
    expect(guest.manager.getState().settings.title).toBe('Shared publication');
    expect(guest.manager.getState().activeSpreadIndex).toBe(1);
    expect(guest.manager.getState().panX).toBe(55);
  });

  it('routes add, update and delete to the sender spread without changing receiver selection', () => {
    const host = peer();
    const guest = peer();
    host.session.connect('room');
    guest.session.connect('room');
    flush();
    host.manager.setActiveSpread(0);
    guest.manager.setActiveSpread(1);
    const selected = guest.manager.getActiveSpread().elements[0].id;
    guest.manager.selectElement(selected);
    const element = { ...host.manager.getActiveSpread().elements[0], id: 'shared-item' };
    host.manager.addElement(element);
    flush();
    expect(guest.manager.getState().spreads[0].elements.some(item => item.id === element.id)).toBe(true);
    host.manager.updateElement(element.id, { width: 88 });
    flush();
    expect(guest.manager.getState().spreads[0].elements.find(item => item.id === element.id)?.width).toBe(88);
    host.manager.deleteElement(element.id);
    flush();
    expect(guest.manager.getState().spreads[0].elements.some(item => item.id === element.id)).toBe(false);
    expect(guest.manager.getState().activeSpreadIndex).toBe(1);
    expect(guest.manager.getState().selectedElementId).toBe(selected);
  });

  it('converges after simultaneous edits delivered in opposite directions', () => {
    const a = peer();
    const b = peer();
    a.session.connect('room');
    b.session.connect('room');
    flush();
    const id = a.manager.getActiveSpread().elements[0].id;
    a.manager.updateElement(id, { width: 77 });
    b.manager.updateElement(id, { width: 99 });
    flush();
    expect(a.manager.getElementById(id)?.width).toBe(b.manager.getElementById(id)?.width);
  });

  it('ignores stale updates after deletion, wrong rooms, and malformed edits', () => {
    const { manager, session } = peer();
    session.connect('room');
    const spread = manager.getActiveSpread();
    const element = structuredClone(spread.elements[0]);
    const base = { peerId: 'remote', spreadId: spread.id, sessionId: 'room', timestamp: 0 };
    session.handleMessage({ ...base, type: 'op_delete', elementId: element.id, clock: 2 });
    session.handleMessage({ ...base, type: 'op_add', element, clock: 1 });
    expect(manager.getElementById(element.id)).toBeNull();
    const current = structuredClone(manager.getState());
    session.handleMessage({ ...base, sessionId: 'other', type: 'op_add', element, clock: 3 });
    session.handleMessage({ ...base, type: 'op_add', element: { ...element, width: -1 }, clock: 4 });
    expect(manager.getState()).toEqual(current);
  });

  it('does not apply a late initial snapshot after a local edit', () => {
    const a = peer();
    const b = peer();
    a.session.connect('room');
    b.session.connect('room');
    const id = b.manager.getActiveSpread().elements[0].id;
    b.manager.updateElement(id, { width: 123 });
    flush();
    expect(b.manager.getElementById(id)?.width).toBe(123);
  });

  it('protects local document settings from late join snapshots too', () => {
    const a = peer();
    const b = peer();
    a.session.connect('room');
    b.session.connect('room');
    b.manager.updateSettings({ title: 'New local work' });
    flush();
    expect(b.manager.getState().settings.title).toBe('New local work');
  });
});
