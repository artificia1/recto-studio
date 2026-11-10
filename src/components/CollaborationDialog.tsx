import type { Dispatch, StateUpdater } from 'preact/hooks';
import { collabSession } from '../collab';
import type { PeerPresence } from '../types';

interface CollaborationDialogProps {
  collabRoom: string;
  setCollabRoom: (value: string) => void;
  collabPassword: string;
  setCollabPassword: (value: string) => void;
  showPassword: boolean;
  setShowPassword: Dispatch<StateUpdater<boolean>>;
  collabUserName: string;
  setCollabUserName: (value: string) => void;
  collabPeers: PeerPresence[];
  isConnected: boolean;
  copiedLink: boolean;
  currentSpreadNum: number;
  handleToggleCollab: () => Promise<void>;
  handleCopyShareLink: () => void;
  onClose: () => void;
}

export default function CollaborationDialog({
  collabRoom, setCollabRoom, collabPassword, setCollabPassword, showPassword, setShowPassword,
  collabUserName, setCollabUserName, collabPeers, isConnected, copiedLink, currentSpreadNum,
  handleToggleCollab, handleCopyShareLink, onClose,
}: CollaborationDialogProps) {
  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#202020',
          border: '1px solid #444',
          borderRadius: '8px',
          width: '500px',
          maxWidth: '92vw',
          padding: '20px',
          color: '#fff',
          boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '16px',
            borderBottom: '1px solid #333',
            paddingBottom: '12px',
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Real-Time P2P WebRTC Collaboration</h3>
            <span style={{ fontSize: '11px', color: '#888' }}>
              Peer-to-peer live co-editing across different machines and networks
            </span>
          </div>
          <button
            className="icon-btn"
            onClick={onClose}
            style={{ fontSize: '16px', color: '#888' }}
          >
            ✕
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '11px', color: '#aaa', marginBottom: '4px' }}>
              Session Room ID:
            </label>
            <input
              type="text"
              value={collabRoom}
              disabled={isConnected}
              onInput={(e) => setCollabRoom((e.target as HTMLInputElement).value)}
              style={{
                width: '100%',
                background: isConnected ? '#181818' : '#242424',
                color: '#fff',
                border: '1px solid #444',
                borderRadius: '4px',
                padding: '6px 10px',
                fontSize: '12px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <label style={{ fontSize: '11px', color: '#aaa' }}>
                Room Password (Required to Secure Access):
              </label>
              {collabPassword.trim() && (
                <span style={{ fontSize: '10px', color: '#10b981', display: 'flex', alignItems: 'center', gap: '3px' }}>
                  [Protected Session]
                </span>
              )}
            </div>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Set password to block random users from joining..."
                value={collabPassword}
                disabled={isConnected}
                onInput={(e) => setCollabPassword((e.target as HTMLInputElement).value)}
                style={{
                  width: '100%',
                  background: isConnected ? '#181818' : '#242424',
                  color: '#fff',
                  border: '1px solid #444',
                  borderRadius: '4px',
                  padding: '6px 52px 6px 10px',
                  fontSize: '12px',
                  boxSizing: 'border-box',
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword((p) => !p)}
                style={{
                  position: 'absolute',
                  right: '6px',
                  background: 'transparent',
                  border: 'none',
                  color: '#9ca3af',
                  cursor: 'pointer',
                  fontSize: '11px',
                  padding: '2px 6px',
                }}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <span style={{ fontSize: '10px', color: '#777', marginTop: '3px', display: 'block' }}>
              {collabPassword.trim()
                ? 'Only peers entering this exact password can connect, synchronize, and edit.'
                : 'Set a password to lock this session, or leave blank for open collaboration.'}
            </span>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '11px', color: '#aaa', marginBottom: '4px' }}>
              Your Designer Handle:
            </label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                type="text"
                value={collabUserName}
                onInput={(e) => {
                  const name = (e.target as HTMLInputElement).value;
                  setCollabUserName(name);
                  collabSession.setUserName(name);
                }}
                style={{
                  flex: 1,
                  background: '#242424',
                  color: '#fff',
                  border: '1px solid #444',
                  borderRadius: '4px',
                  padding: '6px 10px',
                  fontSize: '12px',
                }}
              />
              <div
                style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: '50%',
                  background: collabSession.getUserColor(),
                  border: '2px solid #fff',
                }}
                title="Your cursor & badge color"
              />
            </div>
          </div>
        </div>

        {/* Connection Status & Toggle */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px',
            background: '#181818',
            borderRadius: '6px',
            border: '1px solid #333',
            marginBottom: '16px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div
              style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                background: isConnected ? '#10b981' : '#6b7280',
                boxShadow: isConnected ? '0 0 8px #10b981' : 'none',
              }}
            />
            <span style={{ fontSize: '12px', fontWeight: 600 }}>
              {isConnected
                ? `Connected to '${collabSession.getSessionId()}' ${collabSession.isPasswordProtected() ? '(Protected)' : '(Public)'} · Yjs collaboration`
                : 'Disconnected'}
            </span>
          </div>
          <button
            className={isConnected ? 'action-btn' : 'action-btn-primary'}
            onClick={handleToggleCollab}
            style={{
              color: isConnected ? '#ef4444' : undefined,
              borderColor: isConnected ? '#7f1d1d' : undefined,
            }}
          >
            {isConnected ? 'Disconnect' : 'Connect Session'}
          </button>
        </div>
        {collabSession.getProtocolError() && <p role="alert">{collabSession.getProtocolError()}</p>}

        {/* Active Peers List */}
        {isConnected && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '11px', color: '#aaa', marginBottom: '6px' }}>
              Active Collaborators ({collabPeers.length + 1}):
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                maxHeight: '120px',
                overflowY: 'auto',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 10px',
                  background: '#242424',
                  borderRadius: '4px',
                  fontSize: '11px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div
                    style={{
                      width: '10px',
                      height: '10px',
                      borderRadius: '50%',
                      background: collabSession.getUserColor(),
                    }}
                  />
                  <span>{collabUserName} (You)</span>
                </div>
                <span style={{ color: '#10b981', fontSize: '10px' }}>Spread {currentSpreadNum}</span>
              </div>

              {collabPeers.map((peer) => (
                <div
                  key={peer.peerId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 10px',
                    background: '#242424',
                    borderRadius: '4px',
                    fontSize: '11px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div
                      style={{
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        background: peer.color,
                      }}
                    />
                    <span>{peer.name}</span>
                  </div>
                  <span style={{ color: '#93c5fd', fontSize: '10px' }}>
                    Spread {peer.spreadIndex + 1}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button
            className="action-btn"
            onClick={handleCopyShareLink}
            title="Copy shareable room link to clipboard"
          >
            {copiedLink
              ? (collabPassword.trim() ? 'Copied Secure Link!' : 'Copied Link!')
              : (collabPassword.trim() ? 'Copy Secure Share Link' : 'Copy Share Link')}
          </button>
          <button className="action-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
