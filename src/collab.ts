// Recto Real-Time Co-Editing & Peer Presence Synchronization Engine
// Dual transport: native BroadcastChannel (local tabs) + zero-server WebRTC P2P mesh across the internet

import { CanvasElement, PeerPresence, CollabMessage, ProjectState } from './types';
import { stateManager, StateManager } from './state';
import { fontManager } from './fontManager';
import type { CollaborativeDocument, SharedProject } from './engine/collaborativeDocument';
import { encodePeerMessage, decodePeerMessage, MAX_PEER_MESSAGE_BYTES } from './engine/collabWire';

async function baselineDigest(baseline: SharedProject) {
  const bytes = new TextEncoder().encode('recto-yjs-v2\n' + JSON.stringify(baseline));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
}

export type PeersChangeListener = (peers: PeerPresence[]) => void;

export function hashCollabPassword(password: string): string {
  if (!password || !password.trim()) return '';
  const clean = password.trim();
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export class CollabSession {
  private channel: BroadcastChannel | null = null;
  private p2pRoom: any = null;
  private p2pAction: any = null;
  private sessionId: string | null = null;
  private password: string = '';
  private passwordHash: string = '';
  private peerId: string;
  private userName: string;
  private userColor: string;
  private peers: Map<string, PeerPresence> = new Map();
  private listeners: Set<PeersChangeListener> = new Set();
  public isApplyingRemoteOp: boolean = false;
  private heartbeatTimer: any = null;
  private lastX: number = 0;
  private lastY: number = 0;
  private manager: StateManager = stateManager;
  private clock = 0;
  private versions = new Map<string, { clock: number; peerId: string }>();
  private syncRequest: string | null = null;
  private generation = 0;
  private syncRevision = 0;
  private shared: CollaborativeDocument | null = null;
  private baseline: SharedProject | null = null;
  private baselineId = '';
  private unsubscribeDocument: (() => void) | null = null;
  private lastSharedRevision = 0;
  private lastValidUpdate: Uint8Array | null = null;
  private sharedModule: typeof import('./engine/collaborativeDocument') | null = null;
  private protocolError: string | null = null;

  public getProtocolError() { return this.protocolError; }

  private installShared(baseline: SharedProject, id: string, update?: Uint8Array) {
    const document = new this.sharedModule!.CollaborativeDocument(baseline);
    try {
      if (update) document.apply(update);
      // Initial materialization is checked before replacing the current replica.
      if (update) this.manager.applySharedPublication(document.snapshot());
    } catch (error) { document.destroy(); throw error; }
    this.shared?.destroy(); this.shared = document;
    this.baseline = structuredClone(baseline); this.baselineId = id;
    this.lastValidUpdate = document.encode();
    document.onUpdate(bytes => {
      this.sendMessage({ type: 'crdt_update', peerId: this.peerId, baselineId: this.baselineId, update: bytes });
      this.lastValidUpdate = document.encode();
    });
    document.onRemoteChange(() => {
      if (this.isApplyingRemoteOp) return;
      this.isApplyingRemoteOp = true;
      try { this.manager.applySharedPublication(document.snapshot()); }
      finally { this.lastSharedRevision = this.manager.getDocumentRevision(); this.isApplyingRemoteOp = false; }
    });
    this.manager.setCollaborativeHistory(document);
    this.lastSharedRevision = this.manager.getDocumentRevision();
  }

  constructor(manager: StateManager = stateManager) {
    this.peerId = `peer_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
    const colors = ['#f43f5e', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ec4899', '#3b82f6', '#14b8a6'];
    this.userColor = colors[Math.floor(Math.random() * colors.length)];
    this.userName = `Designer ${this.peerId.slice(-4).toUpperCase()}`;

    this.attachToStateManager(manager);
  }

  public attachToStateManager(sm: StateManager) {
    this.manager = sm;
    sm.onMutation = (mut) => {
      if (!this.isConnected() || this.isApplyingRemoteOp) return;
      if (this.shared) return; // All document commands, including story edits, use CRDT transactions.
      this.syncRequest = null; // A late join snapshot must never overwrite new local work.
      if (mut.type === 'update') {
        this.broadcastUpdate(mut.elementId, mut.updates || {});
      } else if (mut.type === 'add' && mut.element) {
        this.broadcastAdd(mut.element);
      } else if (mut.type === 'delete') {
        this.broadcastDelete(mut.elementId);
      }
    };
  }

  public async connect(sessionId: string = 'recto-live', userName?: string, password?: string): Promise<void> {
    if (this.channel || this.p2pRoom) {
      this.disconnect();
    }

    this.sessionId = sessionId;
    this.generation++;
    this.clock = 0;
    this.versions.clear();
    this.syncRequest = `${this.peerId}-${this.generation}`;
    this.syncRevision = this.manager.getDocumentRevision();
    const generation = this.generation;
    this.protocolError = null;
    this.sharedModule = await import('./engine/collaborativeDocument');
    const baseline = this.sharedModule.sharedProject(structuredClone(this.manager.getState()));
    const id = await baselineDigest(baseline);
    if (generation !== this.generation) return;
    this.installShared(baseline, id);
    this.unsubscribeDocument = this.manager.subscribe(() => {
      const revision = this.manager.getDocumentRevision();
      if (!this.shared || this.isApplyingRemoteOp || revision === this.lastSharedRevision) return;
      this.lastSharedRevision = revision;
      this.syncRequest = null;
      this.shared.update(this.sharedModule!.sharedProject(this.manager.getState()));
    });
    if (userName) this.userName = userName;
    this.password = password ? password.trim() : '';
    this.passwordHash = hashCollabPassword(this.password);

    const chanKey = this.passwordHash ? `${sessionId}__p_${this.passwordHash}` : sessionId;

    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(`recto_collab_${chanKey}`);
      this.channel.onmessage = (event: MessageEvent<CollabMessage>) => {
        return this.handleMessage(event.data);
      };
    }

    this.initP2PMesh(chanKey);

    this.broadcastPresence(this.lastX, this.lastY);
    this.requestSync();

    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      this.broadcastPresence(this.lastX, this.lastY);
      this.cleanupStalePeers();
    }, 2500);

    this.notifyPeers();
  }

  private async initP2PMesh(chanKey: string): Promise<void> {
    const generation = this.generation;
    if (typeof window === 'undefined' || typeof (window as any).RTCPeerConnection === 'undefined') {
      return;
    }

    try {
      const { joinRoom } = await import('trystero/nostr');
      if (!this.sessionId || generation !== this.generation) return;

      const room = joinRoom(
        {
          appId: 'recto-studio',
          password: this.password ? this.password : undefined,
        },
        chanKey
      );

      this.p2pRoom = room;
      const action = room.makeAction('collab_stream');
      this.p2pAction = action;

      action.onMessage = (data: any) => {
        try { return this.handleMessage(decodePeerMessage(data)); }
        catch (error) { console.warn('Invalid peer message ignored:', error); }
      };
      action.onReceive = ({ byteLength }: { byteLength: number }) => Number.isSafeInteger(byteLength) && byteLength > 0 && byteLength <= MAX_PEER_MESSAGE_BYTES;

      room.onPeerJoin = () => {
        this.broadcastPresence(this.lastX, this.lastY);
        this.requestSync();
      };

      room.onPeerLeave = (remotePeerId: string) => {
        if (this.peers.has(remotePeerId)) {
          this.peers.delete(remotePeerId);
          this.notifyPeers();
        }
      };

      this.notifyPeers();
    } catch (err) {
      console.warn('P2P WebRTC mesh fallback to local channel:', err);
    }
  }

  public disconnect(): void {
    this.generation++;
    this.syncRequest = null;
    this.unsubscribeDocument?.(); this.unsubscribeDocument = null;
    this.shared?.destroy(); this.shared = null; this.baseline = null; this.lastValidUpdate = null;
    this.manager.setCollaborativeHistory(null);
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
    if (this.p2pRoom) {
      try {
        this.p2pRoom.leave();
      } catch {}
      this.p2pRoom = null;
      this.p2pAction = null;
    }
    this.sessionId = null;
    this.password = '';
    this.passwordHash = '';
    this.peers.clear();
    this.notifyPeers();
  }

  public isConnected(): boolean {
    return this.sessionId !== null && (this.channel !== null || this.p2pRoom !== null);
  }

  public isP2PActive(): boolean {
    return this.p2pRoom !== null;
  }

  public isPasswordProtected(): boolean {
    return Boolean(this.passwordHash);
  }

  public getPassword(): string {
    return this.password;
  }

  public getPasswordHash(): string {
    return this.passwordHash;
  }

  public getSessionId(): string | null {
    return this.sessionId;
  }

  public getPeerId(): string {
    return this.peerId;
  }

  public getUserName(): string {
    return this.userName;
  }

  public setUserName(name: string): void {
    this.userName = name.trim() || this.userName;
    if (this.isConnected()) {
      this.broadcastPresence(this.lastX, this.lastY);
    }
  }

  public getUserColor(): string {
    return this.userColor;
  }

  public setUserColor(color: string): void {
    this.userColor = color;
    if (this.isConnected()) {
      this.broadcastPresence(this.lastX, this.lastY);
    }
  }

  public getPeers(): PeerPresence[] {
    return Array.from(this.peers.values());
  }

  public onPeersChange(fn: PeersChangeListener): () => void {
    this.listeners.add(fn);
    fn(this.getPeers());
    return () => this.listeners.delete(fn);
  }

  private notifyPeers(): void {
    const list = this.getPeers();
    for (const listener of this.listeners) {
      listener(list);
    }
  }

  private sendMessage(msg: CollabMessage): void {
    const payload = { ...msg, protocol: 'recto-yjs-v2', sessionId: this.sessionId || undefined, ...(this.passwordHash ? { authHash: this.passwordHash } : {}) };
    if (this.channel) {
      try {
        this.channel.postMessage(payload);
      } catch (e) {
        console.warn('Failed to broadcast local collab message', e);
      }
    }
    if (this.p2pAction && typeof this.p2pAction.send === 'function') {
      try {
        this.p2pAction.send(encodePeerMessage(payload)).catch(() => {});
      } catch (e) {
        console.warn('Failed to broadcast WebRTC P2P message', e);
      }
    }
  }

  public broadcastPresence(x: number, y: number, selectedElementId?: string | null): void {
    this.lastX = x;
    this.lastY = y;
    if (!this.isConnected()) return;

    const state = this.manager.getState();
    const presence: PeerPresence = {
      peerId: this.peerId,
      name: this.userName,
      color: this.userColor,
      spreadIndex: state.activeSpreadIndex,
      x,
      y,
      selectedElementId: selectedElementId ?? state.selectedElementId,
      lastActive: Date.now(),
    };

    this.sendMessage({ type: 'presence', peer: presence });
  }

  public broadcastUpdate(elementId: string, updates: Partial<CanvasElement>): void {
    if (!this.isConnected() || this.isApplyingRemoteOp) return;
    this.sendMessage({
      type: 'op_update',
      peerId: this.peerId,
      elementId,
      updates,
      element: this.manager.getActiveSpread().elements.find(element => element.id === elementId),
      ...this.operationMetadata(elementId),
      timestamp: Date.now(),
    });
  }

  public broadcastAdd(element: CanvasElement): void {
    if (!this.isConnected() || this.isApplyingRemoteOp) return;
    this.sendMessage({
      type: 'op_add',
      peerId: this.peerId,
      element,
      ...this.operationMetadata(element.id),
      timestamp: Date.now(),
    });
  }

  public broadcastDelete(elementId: string): void {
    if (!this.isConnected() || this.isApplyingRemoteOp) return;
    this.sendMessage({
      type: 'op_delete',
      peerId: this.peerId,
      elementId,
      ...this.operationMetadata(elementId),
      timestamp: Date.now(),
    });
  }

  public async handleMessage(msg: CollabMessage): Promise<void> {
    if (!msg || typeof msg !== 'object') return;
    if (!this.isConnected() || (msg.sessionId && msg.sessionId !== this.sessionId)) return;
    if (msg.targetPeerId && msg.targetPeerId !== this.peerId) return;
    if ('peerId' in msg && msg.peerId === this.peerId) return;

    if (this.passwordHash) {
      if (!('authHash' in msg) || msg.authHash !== this.passwordHash) {
        return;
      }
    } else {
      if ('authHash' in msg && msg.authHash) {
        return;
      }
    }

    if (msg.type === 'crdt_update' || msg.type === 'crdt_sync') {
      if (msg.protocol !== 'recto-yjs-v2') {
        this.protocolError = 'Incompatible collaboration protocol. Update every participant to the same Recto version.';
        this.notifyPeers(); return;
      }
      if (!this.shared || !(msg.update instanceof Uint8Array) || msg.update.byteLength > 64 * 1024 * 1024) return;
      if (msg.type === 'crdt_sync') {
        if (!this.syncRequest || msg.requestId !== this.syncRequest || !msg.targetPeerId) return;
        if (this.manager.getDocumentRevision() !== this.syncRevision) { this.syncRequest = null; return; }
        const generation = this.generation, request = this.syncRequest;
        try {
          const baseline = this.sharedModule!.sharedProject(msg.baseline as ProjectState);
          if (await baselineDigest(baseline) !== msg.baselineId || generation !== this.generation || request !== this.syncRequest || this.manager.getDocumentRevision() !== this.syncRevision) return;
          this.isApplyingRemoteOp = true;
          this.installShared(baseline, msg.baselineId, msg.update);
          this.syncRequest = null;
          void fontManager.restoreFonts(this.manager.getState().embeddedFonts).catch(error => console.warn('Shared fonts could not be restored:', error));
        } catch (error) { this.protocolError = 'The shared publication could not be validated. Your local document was preserved.'; console.warn(this.protocolError, error); }
        finally { this.isApplyingRemoteOp = false; }
      } else {
        if (msg.baselineId !== this.baselineId) {
          this.protocolError = 'These peers have different document baselines. Rejoin the room from a saved copy to synchronize.'; this.notifyPeers(); return;
        }
        const checkpoint = this.lastValidUpdate!;
        this.isApplyingRemoteOp = true;
        try {
          this.shared.apply(msg.update);
          this.manager.applySharedPublication(this.shared.snapshot());
          this.lastValidUpdate = this.shared.encode();
        } catch (error) {
          // Rebuild from a validated checkpoint: malformed updates must not poison later edits.
          this.installShared(this.baseline!, this.baselineId, checkpoint);
          this.protocolError = 'An invalid shared edit was rejected.'; console.warn(this.protocolError, error);
        } finally { this.lastSharedRevision = this.manager.getDocumentRevision(); this.isApplyingRemoteOp = false; }
      }
    } else if (msg.type === 'presence') {
      if (msg.peer && msg.peer.peerId !== this.peerId) {
        this.peers.set(msg.peer.peerId, { ...msg.peer, lastActive: Date.now() });
        this.notifyPeers();
      }
    } else if (msg.type === 'op_update' || msg.type === 'op_add' || msg.type === 'op_delete') {
      if (this.shared) { this.protocolError = 'A peer is using an older collaboration protocol. All participants need Recto 1.3.2 or newer.'; this.notifyPeers(); return; }
      this.applyOperation(msg);
    } else if (msg.type === 'sync_request') {
      if (this.shared && this.baseline) {
        this.sendMessage({ type: 'crdt_sync', peerId: this.peerId, baseline: this.baseline, baselineId: this.baselineId,
          update: this.shared.encode(), targetPeerId: msg.peerId, requestId: msg.requestId });
        return;
      }
      this.sendMessage({
        type: 'sync_response',
        peerId: this.peerId,
        state: structuredClone(this.manager.getState()),
        targetPeerId: msg.peerId,
        requestId: msg.requestId,
        versions: Object.fromEntries(this.versions),
      });
    } else if (msg.type === 'sync_response') {
      if (this.shared) { this.protocolError = 'An older peer tried to send a legacy snapshot. Update every participant to the same Recto version.'; this.notifyPeers(); return; }
      if (!this.syncRequest || msg.requestId !== this.syncRequest || !msg.targetPeerId) return;
      if (this.manager.getDocumentRevision() !== this.syncRevision) {
        this.syncRequest = null;
        return;
      }
      this.isApplyingRemoteOp = true;
      try {
        const versions = Object.entries(msg.versions || {});
        if (versions.some(([, version]) => !version || !Number.isSafeInteger(version.clock) || version.clock < 0 || typeof version.peerId !== 'string')) return;
        const local = this.manager.getState();
        this.manager.loadFromJson(JSON.stringify({ ...msg.state,
          activeSpreadIndex: local.activeSpreadIndex, zoom: local.zoom, panX: local.panX, panY: local.panY,
          selectedElementId: null, selectedElementIds: [],
        }));
        void fontManager.restoreFonts(msg.state.embeddedFonts).catch(error => console.warn('Shared fonts could not be restored:', error));
        this.versions = new Map(versions);
        this.clock = Math.max(0, ...Array.from(this.versions.values(), version => version.clock));
        this.syncRequest = null;
      } catch (error) {
        console.warn('Invalid collaboration snapshot ignored:', error);
      } finally {
        this.isApplyingRemoteOp = false;
      }
    }
  }

  private requestSync() {
    if (this.syncRequest) this.sendMessage({ type: 'sync_request', peerId: this.peerId, requestId: this.syncRequest });
  }

  private operationMetadata(id: string) {
    const version = { clock: ++this.clock, peerId: this.peerId };
    this.versions.set(id, version);
    return { clock: version.clock, spreadId: this.manager.getActiveSpread().id };
  }

  private applyOperation(msg: Extract<CollabMessage, { type: 'op_add' | 'op_update' | 'op_delete' }>) {
    const id = msg.type === 'op_add' ? msg.element?.id : msg.elementId;
    if (typeof id !== 'string' || typeof msg.peerId !== 'string') return;
    const spreads = this.manager.getState().spreads;
    const matches = msg.spreadId
      ? spreads.filter(spread => spread.id === msg.spreadId)
      : spreads.filter(spread => msg.type === 'op_add'
        ? spread.pages.some(page => page.id === msg.element?.pageId)
        : spread.elements.some(element => element.id === id));
    if (matches.length !== 1) return;
    const spread = matches[0];
    if (msg.clock !== undefined) {
      if (!Number.isSafeInteger(msg.clock) || msg.clock < 0) return;
      const previous = this.versions.get(id);
      this.clock = Math.max(this.clock, msg.clock);
      if (previous && (previous.clock > msg.clock || (previous.clock === msg.clock && previous.peerId >= msg.peerId))) return;
    }
    const existing = spread.elements.find(element => element.id === id);
    const element = msg.type === 'op_delete' ? null : msg.type === 'op_add' ? msg.element
      : msg.element || (existing ? { ...existing, ...msg.updates } as CanvasElement : undefined);
    if (element === undefined) return;
    this.isApplyingRemoteOp = true;
    try {
      if (this.manager.applyRemoteElement(spread.id, id, element)) {
        if (msg.clock !== undefined) this.versions.set(id, { clock: msg.clock, peerId: msg.peerId });
        this.syncRequest = null;
      }
    } catch (error) {
      console.warn('Invalid collaboration edit ignored:', error);
    } finally {
      this.isApplyingRemoteOp = false;
    }
  }

  private cleanupStalePeers(): void {
    const now = Date.now();
    let changed = false;
    for (const [id, peer] of this.peers.entries()) {
      if (now - peer.lastActive > 9000) {
        this.peers.delete(id);
        changed = true;
      }
    }
    if (changed) {
      this.notifyPeers();
    }
  }
}

export const collabSession = new CollabSession();
