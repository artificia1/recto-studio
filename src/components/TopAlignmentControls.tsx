import { stateManager } from '../state';

export default function TopAlignmentControls({ count, selectedIds, allLocked }: {
  count: number; selectedIds: string[]; allLocked: boolean;
}) {
  return (
    <div className="control-group top-bar-align-group">
      <button
        className="icon-btn"
        onClick={() => stateManager.alignElements('left')}
        title="Align Left (2+ elements)"
      >
        ⇤
      </button>
      <button
        className="icon-btn"
        onClick={() => stateManager.alignElements('center')}
        title="Align Horizontal Center (2+ elements)"
      >
        ↔
      </button>
      <button
        className="icon-btn"
        onClick={() => stateManager.alignElements('right')}
        title="Align Right (2+ elements)"
      >
        ⇥
      </button>
      <button
        className="icon-btn"
        onClick={() => stateManager.alignElements('top')}
        title="Align Top (2+ elements)"
      >
        ↥
      </button>
      <button
        className="icon-btn"
        onClick={() => stateManager.alignElements('middle')}
        title="Align Vertical Middle (2+ elements)"
      >
        ↕
      </button>
      <button
        className="icon-btn"
        onClick={() => stateManager.alignElements('bottom')}
        title="Align Bottom (2+ elements)"
      >
        ↧
      </button>
      {count >= 3 && (
        <>
          <button
            className="icon-btn"
            onClick={() => stateManager.distributeElements('horizontal')}
            title="Distribute Horizontally (3+ elements)"
          >
            ⫴
          </button>
          <button
            className="icon-btn"
            onClick={() => stateManager.distributeElements('vertical')}
            title="Distribute Vertically (3+ elements)"
          >
            ⩕
          </button>
        </>
      )}
      <button
        className={`icon-btn lock-toggle-btn ${allLocked ? 'locked' : ''}`}
        onClick={() => stateManager.toggleLock(selectedIds)}
        title={allLocked ? 'Unlock Selected Elements (Ctrl+L)' : 'Lock Selected Elements (Ctrl+L)'}
      >
        {allLocked ? 'Unlock' : 'Lock'}
      </button>
    </div>
  );
}
