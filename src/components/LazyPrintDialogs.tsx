import { Component, type ComponentChildren } from 'preact';
import { lazy, Suspense } from 'preact/compat';
import type { ProjectState } from '../types';

interface PrintDialogProps {
  state: ProjectState;
  onClose: () => void;
}

const Booklet = lazy(async () => ({ default: (await import('./BookletImpositionModal')).BookletImpositionModal }));
const Cover = lazy(async () => ({ default: (await import('./CoverSpineModal')).CoverSpineModal }));

function LoadingDialog({ onClose, failed = false }: { onClose: () => void; failed?: boolean }) {
  return (
    <div className="modal-overlay" style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,.65)' }}>
      <div role="dialog" aria-modal="true" aria-label="Print tools" style={{ padding: '24px', background: 'var(--bg-panel)', borderRadius: '8px', maxWidth: '90vw' }}>
        <p role={failed ? 'alert' : 'status'}>
          {failed ? 'Print tools could not be loaded. Reload the app to try again.' : 'Loading print tools…'}
        </p>
        <button className="action-btn" style={{ marginTop: '16px' }} onClick={onClose}>{failed ? 'Close' : 'Cancel'}</button>
      </div>
    </div>
  );
}

class PrintDialogBoundary extends Component<{ onClose: () => void; children: ComponentChildren }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <LoadingDialog onClose={this.props.onClose} failed /> : this.props.children;
  }
}

export function BookletImpositionModal(props: PrintDialogProps) {
  return <PrintDialogBoundary onClose={props.onClose}><Suspense fallback={<LoadingDialog onClose={props.onClose} />}><Booklet {...props} /></Suspense></PrintDialogBoundary>;
}

export function CoverSpineModal(props: PrintDialogProps) {
  return <PrintDialogBoundary onClose={props.onClose}><Suspense fallback={<LoadingDialog onClose={props.onClose} />}><Cover {...props} /></Suspense></PrintDialogBoundary>;
}
