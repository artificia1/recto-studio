import { useMemo, useRef, useState } from 'preact/hooks';
import { parseMergeData } from '../dataMerge';
import { stateManager } from '../state';
import { useModalFocus } from '../hooks/useModalFocus';

interface DataMergeDialogProps {
  csvText: string;
  setCsvText: (text: string) => void;
  onClose: () => void;
}

export default function DataMergeDialog({ csvText, setCsvText, onClose }: DataMergeDialogProps) {
  const dialog = useRef<HTMLDivElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [mergeError, setMergeError] = useState('');
  useModalFocus(true, dialog);
  const { parsedPreview, previewError } = useMemo(() => {
    try {
      return { parsedPreview: csvText.trim() ? parseMergeData(csvText) : null, previewError: '' };
    } catch (error) {
      return { parsedPreview: null, previewError: error instanceof Error ? error.message : String(error) };
    }
  }, [csvText]);

  const handleCsvUpload = async (event: Event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      if (file.size > 4 * 1024 * 1024) throw new Error('Choose a data file smaller than 4 MB.');
      setCsvText(await file.text());
      setMergeError('');
    } catch (error) {
      setMergeError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleRunMerge = () => {
    if (!parsedPreview?.records.length) return;
    try {
      stateManager.executeDataMerge(csvText, 'generateSpreads');
      onClose();
    } catch (error) {
      setMergeError(error instanceof Error ? error.message : String(error));
    }
  };

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
        background: 'rgba(0, 0, 0, 0.65)',
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
        aria-labelledby="data-merge-title"
        onKeyDown={event => {
          event.stopPropagation();
          if (event.key === 'Escape') onClose();
        }}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-modal)',
          border: '1px solid var(--border-light)',
          borderRadius: '8px',
          width: 'min(540px, 92vw)',
          maxHeight: '92dvh',
          boxSizing: 'border-box',
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
            marginBottom: '14px',
          }}
        >
          <h3 id="data-merge-title" style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>CSV / JSON Data Merge</h3>
          <button className="icon-btn" aria-label="Close data merge" onClick={onClose}>
            ✕
          </button>
        </div>

        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: 0, marginBottom: '12px' }}>
          Use placeholders like <code>{'{{Title}}'}</code>, <code>{'{{Price}}'}</code>, <code>{'{{Author}}'}</code> in
          your text frames or table cells. Import or paste CSV data below to generate publication spreads.
        </p>

        <div style={{ marginBottom: '12px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
            <button
              className="sm-btn"
              onClick={() => csvInputRef.current?.click()}
            >
              Upload CSV / JSON
            </button>
            <button
              className="sm-btn"
              onClick={() => {
                setCsvText(
                  `Title,Price,Author\n"The Master and Margarita","$18.99","Mikhail Bulgakov"\n"Invisible Cities","$15.50","Italo Calvino"\n"Ficciones","$14.00","Jorge Luis Borges"`
                );
              }}
            >
              Load Sample CSV
            </button>
            <input
              type="file"
              ref={csvInputRef}
              accept=".csv,.json,text/csv,application/json"
              style={{ display: 'none' }}
              onChange={handleCsvUpload}
            />
          </div>
          <textarea
            rows={6}
            value={csvText}
            aria-label="CSV or JSON data"
            placeholder="Paste CSV data here with header row..."
            style={{
              width: '100%',
              background: 'var(--bg-input)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-light)',
              borderRadius: '4px',
              fontFamily: 'monospace',
              fontSize: '11px',
              padding: '8px',
              boxSizing: 'border-box',
              resize: 'vertical',
            }}
            onInput={(e) => setCsvText((e.target as HTMLTextAreaElement).value)}
          />
        </div>

        {(previewError || mergeError) && (
          <p role="alert" style={{ color: 'var(--accent-red)', overflowWrap: 'anywhere' }}>{previewError || mergeError}</p>
        )}

        {parsedPreview && (
          <div
            style={{
              background: 'var(--bg-panel)',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              padding: '8px 12px',
              marginBottom: '14px',
              fontSize: '11px',
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: '4px' }}>
              Detected {parsedPreview.records.length} records, {parsedPreview.headers.length} columns:
            </div>
            <div style={{ color: 'var(--text-secondary)', fontFamily: 'monospace', overflowWrap: 'anywhere' }}>
              {parsedPreview.headers.map((h) => `{{${h}}}`).join('  ')}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '8px' }}>
          <button className="action-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="action-btn-primary"
            disabled={!parsedPreview || parsedPreview.records.length === 0}
            onClick={handleRunMerge}
          >
            Generate Merged Spreads ({parsedPreview?.records.length || 0})
          </button>
        </div>
      </div>
    </div>
  );
}
