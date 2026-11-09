import { afterEach, expect, it, vi } from 'vitest';
import { CollabSession } from '../src/collab';
import { StateManager, INITIAL_STATE } from '../src/state/stateManager';

const network = vi.hoisted(() => ({ rooms: [] as any[], deliveries: [] as (() => unknown)[], packets: [] as unknown[] }));
vi.mock('trystero/nostr', () => ({ joinRoom: (_config: unknown, name: string) => {
  const room: any = { name, onPeerJoin: null, onPeerLeave: null,
    leave() { network.rooms = network.rooms.filter(item => item !== room); } };
  room.makeAction = () => room.action = { onMessage: null, onReceive: null,
    send(data: unknown) {
      network.packets.push(data);
      // Match the SDK boundary: binary stays binary, objects are JSON-encoded.
      for (const receiver of network.rooms.filter(item => item !== room && item.name === name)) {
        const copy = data instanceof Uint8Array ? data.slice() : JSON.parse(JSON.stringify(data));
        network.deliveries.push(() => receiver.action.onMessage?.(copy));
      }
      return Promise.resolve();
    } };
  network.rooms.push(room); return room;
} }));

const sessions: CollabSession[] = [];
afterEach(() => {
  sessions.splice(0).forEach(session => session.disconnect());
  network.rooms = []; network.deliveries = []; network.packets = []; vi.unstubAllGlobals();
});

it('synchronizes edits over the network transport with local-tab channels disabled', async () => {
  vi.stubGlobal('BroadcastChannel', undefined);
  vi.stubGlobal('window', { RTCPeerConnection: class {} });
  const a = new StateManager(); a.loadFromJson(JSON.stringify(INITIAL_STATE));
  const b = new StateManager(); b.loadFromJson(a.exportJson());
  for (const manager of [a, b]) {
    const session = new CollabSession(manager); sessions.push(session);
    await session.connect('network-only-room'); await vi.dynamicImportSettled();
  }
  for (const room of network.rooms) room.onPeerJoin?.('transport-peer');
  const flush = async () => { while (network.deliveries.length) await network.deliveries.shift()!(); };
  await flush();
  const frame = a.getActiveSpread().elements.find(element => element.type === 'text')!;
  a.setStoryText(frame.id, 'Copy edited on another computer');
  b.updateElement(frame.id, { width: 91 });
  await flush();
  expect(b.getStoryContent(frame.id)).toEqual(a.getStoryContent(frame.id));
  expect(b.getStoryContent(frame.id).paragraphs[0].runs[0].text).toBe('Copy edited on another computer');
  expect(a.getElementById(frame.id)?.width).toBe(91);
  expect(network.packets.some(packet => packet instanceof Uint8Array)).toBe(true);
});
