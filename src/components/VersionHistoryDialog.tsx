import type { VersionSnapshot } from '../types';
import type { StateManager } from '../state/stateManager';

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
          width: '720px',
          maxWidth: '92vw',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
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
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Version History & Snapshots</h3>
            <span style={{ fontSize: '11px', color: '#888' }}>
              Local-first Git-style revision checkpoints with immutable states & diffing
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

        {/* Create Snapshot Bar */}
        <div
          style={{
            display: 'flex',
            gap: '8px',
            marginBottom: '16px',
            padding: '10px',
            background: '#181818',
            borderRadius: '6px',
            border: '1px solid #333',
          }}
        >
          <input
            type="text"
            placeholder="Commit message (e.g. 'Completed cover headline layout')..."
            value={commitMessage}
            onInput={(e) => setCommitMessage((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateSnapshot();
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
              flex: '0 0 280px',
              borderRight: '1px solid #333',
              paddingRight: '12px',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            {snapshots.length === 0 ? (
              <div style={{ color: '#666', fontSize: '12px', padding: '16px 0', textAlign: 'center' }}>
                No snapshots recorded yet. Create one above to establish a baseline checkpoint!
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
                  <div
                    key={snap.id}
                    onClick={() => handleSelectSnapshot(snap.id)}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '6px',
                      background: isSelected ? '#1e3a5f' : '#262626',
                      border: isSelected ? '1px solid #3b82f6' : '1px solid #333',
                      cursor: 'pointer',
                      transition: 'background 0.15s ease',
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: '12px', color: '#fff', marginBottom: '2px' }}>
                      {snap.message}
                    </div>
                    <div style={{ fontSize: '10px', color: isSelected ? '#93c5fd' : '#888', display: 'flex', justifyContent: 'space-between' }}>
                      <span>{dateStr}</span>
                      <span>by {snap.author}</span>
                    </div>
                    <div style={{ fontSize: '9px', color: '#777', marginTop: '4px' }}>
                      {snap.spreadCount} spreads · {snap.elementCount} elements
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Diff & Actions Panel */}
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              paddingLeft: '4px',
              overflowY: 'auto',
            }}
          >
            {selectedSnapshotId ? (
              <div>
                <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', color: '#93c5fd' }}>
                  Snapshot Inspection
                </h4>
                {diffResult && (
                  <div
                    style={{
                      background: '#181818',
                      padding: '12px',
                      borderRadius: '6px',
                      border: '1px solid #333',
                      fontSize: '11px',
                      marginBottom: '16px',
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: '6px', color: '#e0e0e0' }}>
                      Diff vs Active Canvas:
                    </div>
                    <div style={{ color: '#10b981', marginBottom: '3px' }}>
                      + Added in Current: {diffResult.added.length} elements
                    </div>
                    <div style={{ color: '#f59e0b', marginBottom: '3px' }}>
                      ~ Modified in Current: {diffResult.modified.length} elements
                    </div>
                    <div style={{ color: '#ef4444', marginBottom: '8px' }}>
                      - Deleted in Current: {diffResult.removed.length} elements
                    </div>
                    <div style={{ color: '#888', fontStyle: 'italic' }}>
                      Summary: {diffResult.summary}
                    </div>
                  </div>
                )}
                <div style={{ fontSize: '11px', color: '#888', lineHeight: 1.5 }}>
                  Restoring this snapshot will reset spreads and elements back to this checkpoint.
                  All intermediate history will be saved as a local undo step.
                </div>
              </div>
            ) : (
              <div style={{ color: '#666', fontSize: '12px', padding: '24px', textAlign: 'center' }}>
                Select a snapshot on the left to inspect its diff and restore state.
              </div>
            )}

            {selectedSnapshotId && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingTop: '16px',
                  borderTop: '1px solid #333',
                }}
              >
                <button
                  className="action-btn"
                  style={{ color: '#ef4444', borderColor: '#7f1d1d' }}
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
