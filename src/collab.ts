// Recto Real-Time Co-Editing & Peer Presence Synchronization Engine
// Dual transport: native BroadcastChannel (local tabs) + zero-server WebRTC P2P mesh across the internet

import { CanvasElement, PeerPresence, CollabMessage, ProjectState } from './types';
import { stateManager, StateManager } from './state';
import { fontManager } from './fontManager';

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

  public connect(sessionId: string = 'recto-live', userName?: string, password?: string): void {
    if (this.channel || this.p2pRoom) {
      this.disconnect();
    }

    this.sessionId = sessionId;
    this.generation++;
    this.clock = 0;
    this.versions.clear();
    this.syncRequest = `${this.peerId}-${this.generation}`;
    this.syncRevision = this.manager.getDocumentRevision();
    if (userName) this.userName = userName;
    this.password = password ? password.trim() : '';
    this.passwordHash = hashCollabPassword(this.password);

    const chanKey = this.passwordHash ? `${sessionId}__p_${this.passwordHash}` : sessionId;

    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(`recto_collab_${chanKey}`);
      this.channel.onmessage = (event: MessageEvent<CollabMessage>) => {
        this.handleMessage(event.data);
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
        this.handleMessage(data as CollabMessage);
      };

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
    const payload = { ...msg, sessionId: this.sessionId || undefined, ...(this.passwordHash ? { authHash: this.passwordHash } : {}) };
    if (this.channel) {
      try {
        this.channel.postMessage(payload);
      } catch (e) {
        console.warn('Failed to broadcast local collab message', e);
      }
    }
    if (this.p2pAction && typeof this.p2pAction.send === 'function') {
      try {
        this.p2pAction.send(payload).catch(() => {});
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

  public handleMessage(msg: CollabMessage): void {
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

    if (msg.type === 'presence') {
      if (msg.peer && msg.peer.peerId !== this.peerId) {
        this.peers.set(msg.peer.peerId, { ...msg.peer, lastActive: Date.now() });
        this.notifyPeers();
      }
    } else if (msg.type === 'op_update' || msg.type === 'op_add' || msg.type === 'op_delete') {
      this.applyOperation(msg);
    } else if (msg.type === 'sync_request') {
      this.sendMessage({
        type: 'sync_response',
        peerId: this.peerId,
        state: structuredClone(this.manager.getState()),
        targetPeerId: msg.peerId,
        requestId: msg.requestId,
        versions: Object.fromEntries(this.versions),
      });
    } else if (msg.type === 'sync_response') {
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
