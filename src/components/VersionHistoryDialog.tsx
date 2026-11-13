import { useRef } from 'preact/hooks';
import type { VersionSnapshot } from '../types';
import type { StateManager } from '../state/stateManager';
import { useModalFocus } from '../hooks/useModalFocus';

interface Props {
  snapshots: VersionSnapshot[];
  selectedSnapshotId: string | null;
  diffResult: ReturnType<StateManager['diffSnapshot']> | null;
  commitMessage: string;
  setCommitMessage(value: string): void;
  onClose(): void;
  handleCreateSnapshot(): void;
  handleSelectSnapshot(id: string): void;
  handleDeleteSnapshot(id: string): void;
  handleRollback(id: string): void;
}

export default function VersionHistoryDialog({ snapshots, selectedSnapshotId, diffResult, commitMessage, setCommitMessage,
  onClose, handleCreateSnapshot, handleSelectSnapshot, handleDeleteSnapshot, handleRollback }: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  useModalFocus(true, dialog);

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
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="version-history-title"
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') onClose();
        }}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-modal)',
          border: '1px solid var(--border-light)',
          borderRadius: '8px',
          width: 'min(720px, 92vw)',
          maxHeight: '92dvh',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          padding: 'clamp(12px, 3vw, 20px)',
          overflowY: 'auto',
          color: 'var(--text-primary)',
          boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '16px',
            borderBottom: '1px solid var(--border-color)',
            paddingBottom: '12px',
          }}
        >
          <div>
            <h3 id="version-history-title" style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Version History & Snapshots</h3>
          </div>
          <button
            className="icon-btn"
            aria-label="Close version history"
            onClick={onClose}
            style={{ fontSize: '16px', color: 'var(--text-secondary)' }}
          >
            ✕
          </button>
        </div>

        {/* Create Snapshot Bar */}
        <div
          style={{
            display: 'flex',
            gap: '8px',
            marginBottom: '16px',
            padding: '10px',
            background: 'var(--bg-panel)',
            borderRadius: '6px',
            border: '1px solid var(--border-color)',
            flexWrap: 'wrap',
          }}
        >
          <input
            type="text"
            aria-label="Snapshot description"
            placeholder="Describe the changes…"
            value={commitMessage}
            onInput={(e) => setCommitMessage((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateSnapshot();
            }}
            style={{
              flex: '1 1 160px',
              minWidth: 0,
              background: 'var(--bg-input)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-light)',
              borderRadius: '4px',
              padding: '6px 10px',
              fontSize: '12px',
            }}
          />
          <button
            className="action-btn-primary"
            onClick={handleCreateSnapshot}
            disabled={!commitMessage.trim()}
          >
            + Create Snapshot
          </button>
        </div>

        {/* Split View: Snapshot List & Diff Details */}
        <div
          style={{
            display: 'flex',
            gap: '16px',
            flex: 1,
            minHeight: '260px',
            overflow: 'hidden',
          }}
        >
          {/* Snapshot List */}
          <div
            style={{
              flex: '0 0 min(44%, 280px)',
              minWidth: 0,
              borderRight: '1px solid var(--border-color)',
              paddingRight: '12px',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            {snapshots.length === 0 ? (
              <div style={{ color: 'var(--text-secondary)', fontSize: '12px', padding: '16px 0', textAlign: 'center' }}>
                No snapshots yet.
              </div>
            ) : (
              snapshots.map((snap) => {
                const isSelected = selectedSnapshotId === snap.id;
                const dateStr = new Date(snap.timestamp).toLocaleString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                });
                return (
                  <button
                    type="button"
                    key={snap.id}
                    aria-pressed={isSelected}
                    onClick={() => handleSelectSnapshot(snap.id)}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '6px',
                      background: isSelected ? 'var(--accent-surface)' : 'var(--bg-input)',
                      border: `1px solid var(${isSelected ? '--accent-cyan' : '--border-color'})`,
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                      overflowWrap: 'anywhere',
                      textAlign: 'start',
                    }}
                  >
                    <span style={{ display: 'block', fontWeight: 600, fontSize: '12px', marginBottom: '2px' }}>
                      {snap.message}
                    </span>
                    <span style={{ fontSize: '10px', color: 'var(--text-secondary)', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '2px 8px' }}>
                      <span>{dateStr}</span>
                      <span>by {snap.author}</span>
                    </span>
                    <span style={{ display: 'block', fontSize: '10px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                      {snap.spreadCount} spreads · {snap.elementCount} elements
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {/* Diff & Actions Panel */}
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              paddingLeft: '4px',
              overflowY: 'auto',
              overflowWrap: 'anywhere',
            }}
          >
            {selectedSnapshotId ? (
              <div>
                <h4 style={{ margin: '0 0 8px 0', fontSize: '13px' }}>
                  Snapshot Inspection
                </h4>
                {diffResult && (
                  <div
                    style={{
                      background: 'var(--bg-input)',
                      padding: '12px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color)',
                      fontSize: '11px',
                      marginBottom: '16px',
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: '6px' }}>
                      Diff vs Active Canvas:
                    </div>
                    <div style={{ marginBottom: '3px' }}>
                      + Added in Current: {diffResult.added.length} elements
                    </div>
                    <div style={{ marginBottom: '3px' }}>
                      ~ Modified in Current: {diffResult.modified.length} elements
                    </div>
                    <div style={{ marginBottom: '8px' }}>
                      - Deleted in Current: {diffResult.removed.length} elements
                    </div>
                    <div style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                      Summary: {diffResult.summary}
                    </div>
                  </div>
                )}
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  Restoring this snapshot will reset spreads and elements back to this checkpoint.
                  All intermediate history will be saved as a local undo step.
                </div>
              </div>
            ) : (
              <div style={{ color: 'var(--text-secondary)', fontSize: '12px', padding: '16px 0', textAlign: 'center' }}>
                Select a snapshot on the left to inspect its diff and restore state.
              </div>
            )}

            {selectedSnapshotId && (
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '8px',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingTop: '16px',
                  borderTop: '1px solid var(--border-color)',
                }}
              >
                <button
                  className="action-btn danger-btn"
                  onClick={() => handleDeleteSnapshot(selectedSnapshotId)}
                >
                  Delete Snapshot
                </button>
                <button
                  className="action-btn-primary"
                  onClick={() => handleRollback(selectedSnapshotId)}
                >
                  Restore This Snapshot ⤶
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
