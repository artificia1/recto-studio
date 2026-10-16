// Recto Real-Time Co-Editing & Peer Presence Synchronization Engine
// Uses native BroadcastChannel with operational vector synchronization (zero third-party dependencies)

import { CanvasElement, PeerPresence, CollabMessage, ProjectState } from './types';
import { stateManager, StateManager } from './state';

export type PeersChangeListener = (peers: PeerPresence[]) => void;

export class CollabSession {
  private channel: BroadcastChannel | null = null;
  private sessionId: string | null = null;
  private peerId: string;
  private userName: string;
  private userColor: string;
  private peers: Map<string, PeerPresence> = new Map();
  private listeners: Set<PeersChangeListener> = new Set();
  public isApplyingRemoteOp: boolean = false;
  private heartbeatTimer: any = null;
  private lastX: number = 0;
  private lastY: number = 0;

  constructor() {
    this.peerId = `peer_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
    const colors = ['#f43f5e', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ec4899', '#3b82f6', '#14b8a6'];
    this.userColor = colors[Math.floor(Math.random() * colors.length)];
    this.userName = `Designer ${this.peerId.slice(-4).toUpperCase()}`;

    // Auto-attach to StateManager mutations
    this.attachToStateManager(stateManager);
  }

  public attachToStateManager(sm: StateManager) {
    sm.onMutation = (mut) => {
      if (!this.isConnected() || this.isApplyingRemoteOp) return;
      if (mut.type === 'update') {
        this.broadcastUpdate(mut.elementId, mut.updates || {});
      } else if (mut.type === 'add' && mut.element) {
        this.broadcastAdd(mut.element);
      } else if (mut.type === 'delete') {
        this.broadcastDelete(mut.elementId);
      }
    };
  }

  public connect(sessionId: string = 'recto-live', userName?: string): void {
    if (this.channel) {
      this.disconnect();
    }

    this.sessionId = sessionId;
    if (userName) this.userName = userName;

    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(`recto_collab_${sessionId}`);
      this.channel.onmessage = (event: MessageEvent<CollabMessage>) => {
        this.handleMessage(event.data);
      };
    }

    // Send initial join presence and sync request
    this.broadcastPresence(this.lastX, this.lastY);
    this.sendMessage({ type: 'sync_request', peerId: this.peerId });

    // Periodic heartbeat & peer cleanup
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      this.broadcastPresence(this.lastX, this.lastY);
      this.cleanupStalePeers();
    }, 2500);

    this.notifyPeers();
  }

  public disconnect(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
    this.sessionId = null;
    this.peers.clear();
    this.notifyPeers();
  }

  public isConnected(): boolean {
    return this.channel !== null && this.sessionId !== null;
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
    if (this.channel) {
      try {
        this.channel.postMessage(msg);
      } catch (e) {
        console.warn('Failed to broadcast collab message', e);
      }
    }
  }

  public broadcastPresence(x: number, y: number, selectedElementId?: string | null): void {
    this.lastX = x;
    this.lastY = y;
    if (!this.isConnected()) return;

    const state = stateManager.getState();
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
      timestamp: Date.now(),
    });
  }

  public broadcastAdd(element: CanvasElement): void {
    if (!this.isConnected() || this.isApplyingRemoteOp) return;
    this.sendMessage({
      type: 'op_add',
      peerId: this.peerId,
      element,
      timestamp: Date.now(),
    });
  }

  public broadcastDelete(elementId: string): void {
    if (!this.isConnected() || this.isApplyingRemoteOp) return;
    this.sendMessage({
      type: 'op_delete',
      peerId: this.peerId,
      elementId,
      timestamp: Date.now(),
    });
  }

  public handleMessage(msg: CollabMessage): void {
    if (!msg || typeof msg !== 'object') return;

    // Ignore self messages
    if ('peerId' in msg && msg.peerId === this.peerId) return;

    if (msg.type === 'presence') {
      if (msg.peer && msg.peer.peerId !== this.peerId) {
        this.peers.set(msg.peer.peerId, { ...msg.peer, lastActive: Date.now() });
        this.notifyPeers();
      }
    } else if (msg.type === 'op_update') {
      this.isApplyingRemoteOp = true;
      try {
        stateManager.updateElement(msg.elementId, msg.updates);
      } finally {
        this.isApplyingRemoteOp = false;
      }
    } else if (msg.type === 'op_add') {
      this.isApplyingRemoteOp = true;
      try {
        // Prevent duplicate addition
        const spread = stateManager.getActiveSpread();
        if (!spread.elements.some((el) => el.id === msg.element.id)) {
          stateManager.addElement(msg.element);
        }
      } finally {
        this.isApplyingRemoteOp = false;
      }
    } else if (msg.type === 'op_delete') {
      this.isApplyingRemoteOp = true;
      try {
        stateManager.deleteElement(msg.elementId);
      } finally {
        this.isApplyingRemoteOp = false;
      }
    } else if (msg.type === 'sync_request') {
      // Reply with current state
      this.sendMessage({
        type: 'sync_response',
        peerId: this.peerId,
        state: stateManager.getState(),
      });
    } else if (msg.type === 'sync_response') {
      // Optional state sync when requested
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
