import { useRef } from 'preact/hooks';
import type { Dispatch, StateUpdater } from 'preact/hooks';
import { collabSession } from '../collab';
import type { PeerPresence } from '../types';
import { useModalFocus } from '../hooks/useModalFocus';
import './editorDialogs.css';

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
  const dialogRef = useRef<HTMLElement>(null);
  useModalFocus(true, dialogRef);
  const passwordProtected = Boolean(collabPassword.trim());
  const protocolError = collabSession.getProtocolError();

  return (
    <div className="editor-dialog-backdrop" onClick={onClose}>
      <section
        ref={dialogRef}
        className="modal-dialog editor-dialog collaboration-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="collaboration-title"
        onClick={event => event.stopPropagation()}
        onKeyDown={event => {
          event.stopPropagation();
          if (event.key === 'Escape') onClose();
        }}
      >
        <header className="editor-dialog-header">
          <div>
            <h2 id="collaboration-title">Real-Time P2P WebRTC Collaboration</h2>
            <p>Peer-to-peer live co-editing across different machines and networks</p>
          </div>
          <button type="button" className="editor-dialog-close" aria-label="Close Collaboration" onClick={onClose}>×</button>
        </header>

        <div className="editor-dialog-fields">
          <label className="editor-dialog-field">
            Session Room ID
            <input
              type="text"
              value={collabRoom}
              disabled={isConnected}
              onInput={event => setCollabRoom(event.currentTarget.value)}
            />
          </label>

          <div className="editor-dialog-field">
            <div className="editor-dialog-field-heading">
              <label htmlFor="collaboration-password">Room Password</label>
              {passwordProtected && <span className="editor-dialog-tag">Protected Session</span>}
            </div>
            <div className="collaboration-password-field">
              <input
                id="collaboration-password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Set a password"
                value={collabPassword}
                disabled={isConnected}
                aria-describedby="collaboration-password-hint"
                onInput={event => setCollabPassword(event.currentTarget.value)}
              />
              <button
                type="button"
                onClick={() => setShowPassword(previous => !previous)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <p id="collaboration-password-hint" className="editor-dialog-hint">
              {passwordProtected
                ? 'Peers need this password to connect, synchronize, and edit.'
                : 'Set a password to lock this session, or leave it blank for open collaboration.'}
            </p>
          </div>

          <label className="editor-dialog-field">
            Your Designer Handle
            <span className="collaboration-identity">
              <input
                type="text"
                value={collabUserName}
                onInput={event => {
                  const name = event.currentTarget.value;
                  setCollabUserName(name);
                  collabSession.setUserName(name);
                }}
              />
              <span
                className="collaboration-user-color"
                style={{ backgroundColor: collabSession.getUserColor() }}
                title="Your cursor & badge color"
              />
            </span>
          </label>
        </div>

        <div className="collaboration-status">
          <div className="collaboration-identity" role="status">
            <span className="collaboration-status-dot" data-connected={isConnected} aria-hidden="true" />
            <span>
              {isConnected
                ? `Connected to '${collabSession.getSessionId()}' ${collabSession.isPasswordProtected() ? '(Protected)' : '(Public)'} · Yjs collaboration`
                : 'Disconnected'}
            </span>
          </div>
          <button
            type="button"
            className={isConnected ? 'action-btn collaboration-disconnect' : 'action-btn-primary'}
            onClick={handleToggleCollab}
          >
            {isConnected ? 'Disconnect' : 'Connect Session'}
          </button>
        </div>
        {protocolError && <p className="editor-dialog-message collaboration-error" role="alert">{protocolError}</p>}

        {isConnected && (
          <section className="collaboration-peers" aria-labelledby="collaboration-peers-title">
            <h3 id="collaboration-peers-title">Active Collaborators ({collabPeers.length + 1})</h3>
            <ul>
              <li>
                <span className="collaboration-identity">
                  <span className="collaboration-peer-color" style={{ backgroundColor: collabSession.getUserColor() }} />
                  {collabUserName} (You)
                </span>
                <span className="collaboration-peer-spread">Spread {currentSpreadNum}</span>
              </li>
              {collabPeers.map(peer => (
                <li key={peer.peerId}>
                  <span className="collaboration-identity">
                    <span className="collaboration-peer-color" style={{ backgroundColor: peer.color }} />
                    {peer.name}
                  </span>
                  <span className="collaboration-peer-spread">Spread {peer.spreadIndex + 1}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <footer className="editor-dialog-actions">
          <button
            type="button"
            className="action-btn"
            onClick={handleCopyShareLink}
            title="Copy shareable room link to clipboard"
          >
            {copiedLink
              ? (passwordProtected ? 'Copied Secure Link!' : 'Copied Link!')
              : (passwordProtected ? 'Copy Secure Share Link' : 'Copy Share Link')}
          </button>
          <button type="button" className="action-btn" onClick={onClose}>Close</button>
        </footer>
      </section>
    </div>
  );
}
