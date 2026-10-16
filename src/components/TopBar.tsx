/**
 * Recto Studio — High-Precision Desktop Publishing Engine
 * Copyright (c) 2022-2026 Abhinav. All rights reserved.
 * Licensed under the MIT License.
 */

import { useState, useEffect, useRef } from 'preact/hooks';
import { stateManager } from '../state';
import { PAGE_PRESETS, PagePreset, ProjectState, VersionSnapshot, PeerPresence } from '../types';
import { exportDocumentToPdf } from '../pdfExport';
import { exportDocumentToEpub } from '../epubExport';
import { exportDocumentToFlipbook } from '../flipbookExport';
import { packageDocument } from '../packageExport';
import { ingestManuscript } from '../contentImport';
import { parseCsv } from '../dataMerge';
import { collabSession } from '../collab';

interface TopBarProps {
  state: ProjectState;
}

export function TopBar({ state }: TopBarProps) {
  const [title, setTitle] = useState(state.settings.title);
  const [showDataMergeModal, setShowDataMergeModal] = useState(false);
  const [showVersionModal, setShowVersionModal] = useState(false);
  const [showCollabModal, setShowCollabModal] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [snapshots, setSnapshots] = useState<VersionSnapshot[]>(stateManager.getSnapshots());
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);
  const [diffResult, setDiffResult] = useState<{
    added: any[];
    removed: any[];
    modified: any[];
    summary: string;
  } | null>(null);

  const [collabRoom, setCollabRoom] = useState(collabSession.getSessionId() || 'recto-live');
  const [collabUserName, setCollabUserName] = useState(collabSession.getUserName());
  const [collabPeers, setCollabPeers] = useState<PeerPresence[]>(collabSession.getPeers());
  const [isConnected, setIsConnected] = useState(collabSession.isConnected());
  const [copiedLink, setCopiedLink] = useState(false);

  const [csvText, setCsvText] = useState('');
  const [showImportMenu, setShowImportMenu] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const importMenuRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const idmlInputRef = useRef<HTMLInputElement>(null);
  const placeInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (importMenuRef.current && !importMenuRef.current.contains(e.target as Node)) {
        setShowImportMenu(false);
      }
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('pointerdown', handleOutsideClick);
    return () => document.removeEventListener('pointerdown', handleOutsideClick);
  }, []);

  useEffect(() => {
    setTitle(state.settings.title);
  }, [state.settings.title]);

  useEffect(() => {
    return collabSession.onPeersChange((peers) => {
      setCollabPeers([...peers]);
      setIsConnected(collabSession.isConnected());
    });
  }, []);

  const handleTitleBlur = () => {
    if (title.trim() && title !== state.settings.title) {
      stateManager.updateSettings({ title: title.trim() });
    }
  };

  const handleTitleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    }
  };

  const handlePresetChange = (e: Event) => {
    const preset = (e.target as HTMLSelectElement).value as PagePreset;
    const dim = PAGE_PRESETS[preset];
    if (dim) {
      stateManager.updateSettings({
        preset,
        widthMm: dim.widthMm,
        heightMm: dim.heightMm,
      });
    }
  };

  const handleZoomChange = (e: Event) => {
    const val = (e.target as HTMLSelectElement).value;
    if (val === 'fit') {
      stateManager.setZoom(0.85);
      stateManager.setPan(0, 0);
    } else {
      stateManager.setZoom(parseFloat(val));
    }
  };

  const handleSave = () => {
    const json = stateManager.exportJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.settings.title.toLowerCase().replace(/\s+/g, '-')}.recto`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleOpenClick = () => {
    fileInputRef.current?.click();
  };

  const handleIdmlClick = () => {
    idmlInputRef.current?.click();
  };

  const handleFileChange = async (e: Event) => {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (file) {
      if (file.name.toLowerCase().endsWith('.idml')) {
        const buffer = await file.arrayBuffer();
        await stateManager.loadFromIdml(buffer);
        return;
      }
      const reader = new FileReader();
      reader.onload = (re) => {
        if (typeof re.target?.result === 'string') {
          stateManager.loadFromJson(re.target.result);
        }
      };
      reader.readAsText(file);
    }
  };

  const handleIdmlFileChange = async (e: Event) => {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (file) {
      const buffer = await file.arrayBuffer();
      await stateManager.loadFromIdml(buffer);
    }
  };

  const handlePlaceClick = () => {
    const textEl = selectedElements.find((el) => el.type === 'text');
    if (!textEl) {
      alert('Please select a text frame on the spread to place manuscript text.');
      return;
    }
    placeInputRef.current?.click();
  };

  const handlePlaceFileChange = async (e: Event) => {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    const textEl = selectedElements.find((el) => el.type === 'text');
    if (file && textEl) {
      const buffer = await file.arrayBuffer();
      const ingested = await ingestManuscript(file.name, buffer);
      stateManager.placeTextContent(textEl.id, ingested);
    }
  };

  const handleExportPdf = () => {
    exportDocumentToPdf(state, {
      includeCropMarks: true,
      includeBleed: true,
      exportFormat: 'pages',
    });
  };

  const handleExportEpub = () => {
    exportDocumentToEpub(state, { download: true });
  };

  const handleExportFlipbook = () => {
    exportDocumentToFlipbook(state, { download: true });
  };

  const handlePackageDocument = () => {
    packageDocument(state, { download: true });
  };

  const handleCsvUpload = async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) {
      const text = await file.text();
      setCsvText(text);
    }
  };

  const handleRunMerge = () => {
    if (!csvText.trim()) return;
    stateManager.executeDataMerge(csvText, 'generateSpreads');
    setShowDataMergeModal(false);
  };

  const parsedPreview = csvText.trim() ? parseCsv(csvText) : null;

  const openVersionModal = () => {
    const list = stateManager.getSnapshots();
    setSnapshots(list);
    if (list.length > 0) {
      setSelectedSnapshotId(list[0].id);
      setDiffResult(stateManager.diffSnapshot(list[0].id));
    } else {
      setSelectedSnapshotId(null);
      setDiffResult(null);
    }
    setShowVersionModal(true);
  };

  const handleSelectSnapshot = (id: string) => {
    setSelectedSnapshotId(id);
    setDiffResult(stateManager.diffSnapshot(id));
  };

  const handleCreateSnapshot = () => {
    if (!commitMessage.trim()) return;
    const snap = stateManager.createSnapshot(commitMessage.trim(), collabUserName || 'Designer');
    setCommitMessage('');
    const list = stateManager.getSnapshots();
    setSnapshots(list);
    setSelectedSnapshotId(snap.id);
    setDiffResult(stateManager.diffSnapshot(snap.id));
  };

  const handleRollback = (id: string) => {
    if (confirm('Rollback project state to this checkpoint? Current unsaved modifications will be replaced.')) {
      stateManager.rollbackToSnapshot(id);
      setShowVersionModal(false);
    }
  };

  const handleDeleteSnapshot = (id: string) => {
    stateManager.deleteSnapshot(id);
    const list = stateManager.getSnapshots();
    setSnapshots(list);
    if (selectedSnapshotId === id) {
      if (list.length > 0) {
        setSelectedSnapshotId(list[0].id);
        setDiffResult(stateManager.diffSnapshot(list[0].id));
      } else {
        setSelectedSnapshotId(null);
        setDiffResult(null);
      }
    }
  };

  const handleToggleCollab = () => {
    if (isConnected) {
      collabSession.disconnect();
      setIsConnected(false);
      setCollabPeers([]);
    } else {
      collabSession.connect(collabRoom.trim() || 'recto-live', collabUserName.trim());
      setIsConnected(true);
      setCollabPeers(collabSession.getPeers());
    }
  };

  const handleCopyShareLink = () => {
    const url = window.location.href.split('?')[0];
    navigator.clipboard.writeText(`${url}?room=${encodeURIComponent(collabRoom.trim() || 'recto-live')}`);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const currentSpreadNum = state.activeSpreadIndex + 1;
  const totalSpreads = state.spreads.length;

  const spread = stateManager.getActiveSpread();
  const selectedIds = state.selectedElementIds && state.selectedElementIds.length > 0
    ? state.selectedElementIds
    : (state.selectedElementId ? [state.selectedElementId] : []);
  const selectedElements = spread.elements.filter((el) => selectedIds.includes(el.id));
  const hasSelection = selectedElements.length > 0;
  const allLocked = hasSelection && selectedElements.every((el) => el.locked);

  return (
    <header className="top-bar">
      <div className="brand-section">
        <div className="brand-logo">
          <span>RECTO</span>
          <span className="brand-badge">STUDIO</span>
        </div>
        <input
          type="text"
          className="doc-title-input"
          value={title}
          onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
          onBlur={handleTitleBlur}
          onKeyDown={handleTitleKeyDown}
          title="Click to rename document"
        />
      </div>

      <div className="top-center-controls">
        <div className="control-group">
          <button
            className="icon-btn"
            onClick={() => stateManager.undo()}
            title="Undo (Ctrl+Z)"
          >
            ↺
          </button>
          <button
            className="icon-btn"
            onClick={() => stateManager.redo()}
            title="Redo (Ctrl+Y)"
          >
            ↻
          </button>
        </div>

        <div className="control-group">
          <button
            className="icon-btn"
            disabled={state.activeSpreadIndex <= 0}
            onClick={() => stateManager.setActiveSpread(state.activeSpreadIndex - 1)}
            title="Previous Spread"
          >
            ◀
          </button>
          <div className="spread-indicator" title={`Spread ${currentSpreadNum} of ${totalSpreads}`}>
            Sp. {currentSpreadNum}/{totalSpreads}
          </div>
          <button
            className="icon-btn"
            disabled={state.activeSpreadIndex >= totalSpreads - 1}
            onClick={() => stateManager.setActiveSpread(state.activeSpreadIndex + 1)}
            title="Next Spread"
          >
            ▶
          </button>
        </div>

        <select
          className="styled-select"
          value={state.settings.preset}
          onChange={handlePresetChange}
          title="Document Dimension Preset"
        >
          <option value="A4">A4 (210×297)</option>
          <option value="US-Letter">US Letter</option>
          <option value="Book-Trade-6x9">Trade 6×9</option>
          <option value="Digest-5.5x8.5">Digest</option>
          <option value="Zine-A5">Zine A5</option>
        </select>

        <select
          className="styled-select"
          value={state.zoom.toString()}
          onChange={handleZoomChange}
          title="Canvas Zoom"
        >
          <option value="fit">Fit Spread</option>
          <option value="0.5">50%</option>
          <option value="0.75">75%</option>
          <option value="1">100%</option>
          <option value="1.25">125%</option>
          <option value="1.5">150%</option>
          <option value="2">200%</option>
        </select>

        {hasSelection && (
          <div className="control-group">
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
            {selectedElements.length >= 3 && (
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
        )}
      </div>

      <div className="top-actions">
        <button
          className="action-btn"
          onClick={() => stateManager.addSpread()}
          title="Insert New Page Spread"
        >
          + Add Spread
        </button>
        <button
          className="action-btn"
          onClick={handleSave}
          title="Save .recto project to disk"
        >
          Save
        </button>
        <button
          className="action-btn"
          onClick={handleOpenClick}
          title="Load .recto project"
        >
          Open
        </button>
        <input
          type="file"
          ref={fileInputRef}
          accept=".recto,.papercut,.json,.idml"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
        <input
          type="file"
          ref={idmlInputRef}
          accept=".idml,application/vnd.adobe.indesign-idml-package"
          style={{ display: 'none' }}
          onChange={handleIdmlFileChange}
        />
        <input
          type="file"
          ref={placeInputRef}
          accept=".md,.markdown,.txt,.docx"
          style={{ display: 'none' }}
          onChange={handlePlaceFileChange}
        />

        {/* Content & Import Dropdown */}
        <div className="top-dropdown" ref={importMenuRef}>
          <button
            className={`action-btn ${showImportMenu ? 'active' : ''}`}
            onClick={() => setShowImportMenu((prev) => !prev)}
            title="Import Manuscript, InDesign IDML, or CSV Dataset"
          >
            Import ▾
          </button>
          {showImportMenu && (
            <div className="top-dropdown-menu">
              <button
                className="top-dropdown-item"
                onClick={() => {
                  setShowImportMenu(false);
                  handlePlaceClick();
                }}
                title="Place markdown, text, or Word document into selected frame"
              >
                <div>
                  <div className="dropdown-item-title">Place Manuscript Text...</div>
                  <div className="dropdown-item-sub">.md, .txt, .docx into text frame</div>
                </div>
              </button>
              <button
                className="top-dropdown-item"
                onClick={() => {
                  setShowImportMenu(false);
                  handleIdmlClick();
                }}
                title="Open Adobe InDesign (.idml) package"
              >
                <div>
                  <div className="dropdown-item-title">Open InDesign Package...</div>
                  <div className="dropdown-item-sub">Convert .idml publication spreads</div>
                </div>
              </button>
              <button
                className="top-dropdown-item"
                onClick={() => {
                  setShowImportMenu(false);
                  setShowDataMergeModal(true);
                }}
                title="Merge CSV dataset into publication spreads"
              >
                <div>
                  <div className="dropdown-item-title">Data Merge...</div>
                  <div className="dropdown-item-sub">Batch populate records via CSV</div>
                </div>
              </button>
              {selectedElements.length === 1 && selectedElements[0].type === 'text' && (
                <button
                  className="top-dropdown-item"
                  onClick={() => {
                    setShowImportMenu(false);
                    const note = prompt('Enter Footnote Reference Text:', 'Citation or footnote note');
                    if (note !== null) {
                      stateManager.insertFootnote(selectedElements[0].id, note);
                    }
                  }}
                  title="Insert Footnote into selected text frame"
                >
                  <div>
                    <div className="dropdown-item-title">Insert Footnote...</div>
                    <div className="dropdown-item-sub">Anchored reference and footnote block</div>
                  </div>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Version History Drawer Trigger */}
        <button
          className="action-btn"
          onClick={openVersionModal}
          title="Local-First Git Version Snapshots & Checkpoints"
        >
          History <span className="top-badge">{snapshots.length}</span>
        </button>

        {/* Real-time Collaboration Trigger */}
        <button
          className={`action-btn ${isConnected ? 'active' : ''}`}
          onClick={() => setShowCollabModal(true)}
          style={{
            borderColor: isConnected ? '#10b981' : undefined,
            color: isConnected ? '#10b981' : undefined,
          }}
          title="Live Peer-to-Peer Real-Time Collaboration"
        >
          <span
            className="status-dot"
            style={{ backgroundColor: isConnected ? '#10b981' : '#6b7280' }}
          />
          {isConnected ? `Live (${collabPeers.length + 1})` : 'Collaborate'}
        </button>

        {/* Unified Export Action Group */}
        <div className="top-dropdown" ref={exportMenuRef}>
          <div className="btn-group-joined">
            <button
              className="action-btn-primary"
              onClick={handleExportPdf}
              title="Export Print-Ready PDF with Crop Marks and Bleed"
            >
              Export PDF
            </button>
            <button
              className="action-btn-primary dropdown-arrow-btn"
              onClick={() => setShowExportMenu((prev) => !prev)}
              title="Export EPUB 3, Web Flipbook, or Print Package (.zip)"
            >
              ▾
            </button>
          </div>
          {showExportMenu && (
            <div className="top-dropdown-menu export-dropdown-menu">
              <button
                className="top-dropdown-item"
                onClick={() => {
                  setShowExportMenu(false);
                  handleExportPdf();
                }}
              >
                <div>
                  <div className="dropdown-item-title">Print PDF (PDF/X-1a)</div>
                  <div className="dropdown-item-sub">CMYK, 3mm Bleed, Crop Marks, Tagged PDF/UA</div>
                </div>
              </button>
              <button
                className="top-dropdown-item"
                onClick={() => {
                  setShowExportMenu(false);
                  handleExportEpub();
                }}
              >
                <div>
                  <div className="dropdown-item-title">Export EPUB 3</div>
                  <div className="dropdown-item-sub">Reflowable/Fixed package for Kindle & Apple Books</div>
                </div>
              </button>
              <button
                className="top-dropdown-item"
                onClick={() => {
                  setShowExportMenu(false);
                  handleExportFlipbook();
                }}
              >
                <div>
                  <div className="dropdown-item-title">Export Web Flipbook</div>
                  <div className="dropdown-item-sub">Single-file HTML5 with 3D page-flip animations</div>
                </div>
              </button>
              <div className="dropdown-divider" />
              <button
                className="top-dropdown-item"
                onClick={() => {
                  setShowExportMenu(false);
                  handlePackageDocument();
                }}
              >
                <div>
                  <div className="dropdown-item-title">Package Document for Print...</div>
                  <div className="dropdown-item-sub">Bundle project, PDF, assets, and instructions into ZIP</div>
                </div>
              </button>
            </div>
          )}
        </div>
      </div>

      {showDataMergeModal && (
        <div
          className="modal-overlay"
          onClick={() => setShowDataMergeModal(false)}
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
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#202020',
              border: '1px solid #444',
              borderRadius: '8px',
              width: '540px',
              maxWidth: '90vw',
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
                marginBottom: '14px',
              }}
            >
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>CSV Data Merge</h3>
              <button className="icon-btn" onClick={() => setShowDataMergeModal(false)}>
                ✕
              </button>
            </div>

            <p style={{ fontSize: '12px', color: '#aaa', marginTop: 0, marginBottom: '12px' }}>
              Use placeholders like <code>{'{{Title}}'}</code>, <code>{'{{Price}}'}</code>, <code>{'{{Author}}'}</code> in
              your text frames or table cells. Import or paste CSV data below to generate publication spreads.
            </p>

            <div style={{ marginBottom: '12px' }}>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                <button
                  className="sm-btn"
                  onClick={() => csvInputRef.current?.click()}
                >
                  Upload .CSV File
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
                  accept=".csv,text/csv"
                  style={{ display: 'none' }}
                  onChange={handleCsvUpload}
                />
              </div>
              <textarea
                rows={6}
                value={csvText}
                placeholder="Paste CSV data here with header row..."
                style={{
                  width: '100%',
                  background: '#151515',
                  color: '#e0e0e0',
                  border: '1px solid #333',
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

            {parsedPreview && (
              <div
                style={{
                  background: '#181818',
                  border: '1px solid #333',
                  borderRadius: '4px',
                  padding: '8px 12px',
                  marginBottom: '14px',
                  fontSize: '11px',
                }}
              >
                <div style={{ color: '#10b981', fontWeight: 600, marginBottom: '4px' }}>
                  ✓ Detected {parsedPreview.records.length} records, {parsedPreview.headers.length} columns:
                </div>
                <div style={{ color: '#93c5fd', fontFamily: 'monospace' }}>
                  {parsedPreview.headers.map((h) => `{{${h}}}`).join('  ')}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button className="action-btn" onClick={() => setShowDataMergeModal(false)}>
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
      )}

      {showVersionModal && (
        <div
          className="modal-overlay"
          onClick={() => setShowVersionModal(false)}
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
                onClick={() => setShowVersionModal(false)}
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
      )}

      {showCollabModal && (
        <div
          className="modal-overlay"
          onClick={() => setShowCollabModal(false)}
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
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Real-Time Collaboration</h3>
                <span style={{ fontSize: '11px', color: '#888' }}>
                  Peer-to-peer live co-editing and presence synchronization
                </span>
              </div>
              <button
                className="icon-btn"
                onClick={() => setShowCollabModal(false)}
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
                  {isConnected ? `Connected to '${collabSession.getSessionId()}'` : 'Disconnected'}
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
                    <span style={{ color: '#10b981', fontSize: '10px' }}>Spread {state.activeSpreadIndex + 1}</span>
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
                {copiedLink ? 'Copied Link!' : 'Copy Share Link'}
              </button>
              <button className="action-btn" onClick={() => setShowCollabModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
