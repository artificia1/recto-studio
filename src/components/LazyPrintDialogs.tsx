import { Component, type ComponentChildren } from 'preact';
import { lazy, Suspense } from 'preact/compat';
import { useRef } from 'preact/hooks';
import type { ProjectState } from '../types';
import { useModalFocus } from '../hooks/useModalFocus';

interface WorkspaceDialogProps {
  state: ProjectState;
  onClose: () => void;
}

const Booklet = lazy(async () => ({ default: (await import('./BookletImpositionModal')).BookletImpositionModal }));
const Cover = lazy(async () => ({ default: (await import('./CoverSpineModal')).CoverSpineModal }));
const SpreadOverview = lazy(() => import('./SpatialWorkspace'));

function LoadingDialog({ label, onClose, failed = false }: { label: string; onClose: () => void; failed?: boolean }) {
  const dialog = useRef<HTMLDivElement>(null);
  useModalFocus(true, dialog);
  return (
    <div className="modal-overlay deferred-dialog-overlay" onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape') onClose();
    }}>
      <div className="deferred-dialog" role="dialog" aria-modal="true" aria-label={label} ref={dialog}>
        <p role={failed ? 'alert' : 'status'}>
          {failed ? `${label} could not be opened. Reload the app to try again.` : `Loading ${label.toLowerCase()}…`}
        </p>
        <button type="button" className="action-btn" onClick={onClose}>{failed ? 'Close' : 'Cancel'}</button>
      </div>
    </div>
  );
}

class DeferredDialog extends Component<{ label: string; onClose: () => void; children: ComponentChildren }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    const { label, onClose, children } = this.props;
    return this.state.failed ? <LoadingDialog label={label} onClose={onClose} failed />
      : <Suspense fallback={<LoadingDialog label={label} onClose={onClose} />}>{children}</Suspense>;
  }
}

export function BookletImpositionModal(props: WorkspaceDialogProps) {
  return <DeferredDialog label="Print tools" onClose={props.onClose}><Booklet {...props} /></DeferredDialog>;
}

export function CoverSpineModal(props: WorkspaceDialogProps) {
  return <DeferredDialog label="Print tools" onClose={props.onClose}><Cover {...props} /></DeferredDialog>;
}

export function SpreadOverviewDialog(props: WorkspaceDialogProps) {
  return <DeferredDialog label="All spreads" onClose={props.onClose}><SpreadOverview {...props} /></DeferredDialog>;
}
