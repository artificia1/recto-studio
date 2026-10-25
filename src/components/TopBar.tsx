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
import { exportDocumentToIdml } from '../export/idmlExport';
import { ingestManuscript } from '../contentImport';
import { parseCsv } from '../dataMerge';
import { collabSession } from '../collab';
import { BookletImpositionModal } from './BookletImpositionModal';
import { CoverSpineModal } from './CoverSpineModal';

interface TopBarProps {
  state: ProjectState;
  onOpenFindChange?: () => void;
  onOpenQuickApply?: () => void;
  onOpenImposition?: () => void;
  onOpenCoverSpine?: () => void;
  onOpenShortcuts?: () => void;
  onOpenStoryEditor?: () => void;
  onOpenBarcode?: () => void;
  onOpenQr?: () => void;
  onOpenScripts?: () => void;
}

export function TopBar({
  state,
  onOpenFindChange,
  onOpenQuickApply,
  onOpenImposition,
  onOpenCoverSpine,
  onOpenShortcuts,
  onOpenStoryEditor,
  onOpenBarcode,
  onOpenQr,
  onOpenScripts,
}: TopBarProps) {
  const [showImpositionModal, setShowImpositionModal] = useState(false);
  const [showCoverSpineModal, setShowCoverSpineModal] = useState(false);

  const handleOpenImposition = onOpenImposition || (() => setShowImpositionModal(true));
  const handleOpenCoverSpine = onOpenCoverSpine || (() => setShowCoverSpineModal(true));

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
  const [collabPassword, setCollabPassword] = useState(collabSession.getPassword() || '');
  const [showPassword, setShowPassword] = useState(false);
  const [collabUserName, setCollabUserName] = useState(collabSession.getUserName());
  const [collabPeers, setCollabPeers] = useState<PeerPresence[]>(collabSession.getPeers());
  const [isConnected, setIsConnected] = useState(collabSession.isConnected());
  const [copiedLink, setCopiedLink] = useState(false);

  const [csvText, setCsvText] = useState('');
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [showFileMenu, setShowFileMenu] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const newMenuRef = useRef<HTMLDivElement>(null);
  const fileMenuRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const idmlInputRef = useRef<HTMLInputElement>(null);
  const placeInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (newMenuRef.current && !newMenuRef.current.contains(e.target as Node)) {
        setShowNewMenu(false);
      }
      if (fileMenuRef.current && !fileMenuRef.current.contains(e.target as Node)) {
        setShowFileMenu(false);
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
    try {
      if (typeof window !== 'undefined' && window.location?.search) {
        const params = new URLSearchParams(window.location.search);
        const roomParam = params.get('room');
        const pwdParam = params.get('pwd');
        if (roomParam) {
          setCollabRoom(roomParam);
          if (pwdParam) setCollabPassword(pwdParam);
          collabSession.connect(roomParam, undefined, pwdParam || undefined);
          setIsConnected(true);
        }
      }
    } catch {}

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

  const handleCreateBlank = (preset: PagePreset = 'A4', facing: boolean = true) => {
    if (confirm('Create a new blank document? All unsaved modifications in current session will be cleared.')) {
      stateManager.createBlankProject(preset, 'Untitled Publication', facing);
      setShowNewMenu(false);
      setShowFileMenu(false);
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

  const handleExportPdfClean = () => {
    exportDocumentToPdf(state, {
      includeCropMarks: false,
      includeBleed: false,
      includeRegistrationMarks: false,
      includeColorBars: false,
      exportFormat: 'pages',
    });
  };

  const handleExportPdfPress = () => {
    exportDocumentToPdf(state, {
      includeCropMarks: true,
      includeBleed: true,
      includeRegistrationMarks: true,
      includeColorBars: true,
      exportFormat: 'pages',
    });
  };

  const handleExportPdf = () => {
    handleExportPdfClean();
  };

  const handleExportEpub = () => {
    exportDocumentToEpub(state, { download: true });
  };

  const handleExportFlipbook = () => {
    exportDocumentToFlipbook(state, { download: true });
  };

  const handleExportSpreadPng = () => {
    setShowExportMenu(false);
    const canvas = (window as any).recto?.spreadCanvas;
    if (canvas && typeof canvas.exportSpreadAsPng === 'function') {
      const dataUrl = canvas.exportSpreadAsPng(3);
      if (dataUrl) {
        const link = document.createElement('a');
        const spreadNum = state.activeSpreadIndex + 1;
        const safeTitle = (state.settings.title || 'recto-spread').toLowerCase().replace(/[^a-z0-9_-]/g, '-');
        link.download = `${safeTitle}-spread-${spreadNum}.png`;
        link.href = dataUrl;
        link.click();
      }
    }
  };

  const handlePackageDocument = () => {
    packageDocument(state, { download: true });
  };

  const handleExportIdml = () => {
    const idmlBytes = exportDocumentToIdml(state);
    const blob = new Blob([idmlBytes as any], { type: 'application/vnd.adobe.indesign-idml-package' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeTitle = (state.settings.title || 'publication').toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    a.download = `${safeTitle}.idml`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
      collabSession.connect(
        collabRoom.trim() || 'recto-live',
        collabUserName.trim(),
        collabPassword.trim()
      );
      setIsConnected(true);
      setCollabPeers(collabSession.getPeers());
    }
  };

  const handleCopyShareLink = () => {
    const url = window.location.href.split('?')[0];
    let shareUrl = `${url}?room=${encodeURIComponent(collabRoom.trim() || 'recto-live')}`;
    if (collabPassword.trim()) {
      shareUrl += `&pwd=${encodeURIComponent(collabPassword.trim())}`;
    }
    navigator.clipboard.writeText(shareUrl);
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
        <div className="brand-logo" title="Recto Studio · Designed by Abhinav Sidhu">
          <svg className="brand-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="1.5" y="2.5" width="5.5" height="11" rx="0.5" stroke="#71717a" strokeWidth="1" />
            <rect x="9" y="2.5" width="5.5" height="11" rx="0.5" fill="#e4e4e7" stroke="#e4e4e7" strokeWidth="1" />
            <line x1="10.5" y1="5.5" x2="13" y2="5.5" stroke="#18181b" strokeWidth="0.8" />
            <line x1="10.5" y1="7.5" x2="13" y2="7.5" stroke="#18181b" strokeWidth="0.8" />
            <line x1="10.5" y1="9.5" x2="12" y2="9.5" stroke="#18181b" strokeWidth="0.8" />
          </svg>
          <span className="brand-name">RECTO</span>
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
          {onOpenShortcuts && (
            <button
              className="icon-btn"
              onClick={onOpenShortcuts}
              title="Keyboard Shortcuts Matrix (?)"
              style={{ fontSize: '11px', fontWeight: 700 }}
            >
              ?
            </button>
          )}
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
        {/* New Blank Book / Document Dropdown */}
        <div className="top-dropdown" ref={newMenuRef}>
          <div className="btn-group-joined">
            <button
              className="action-btn"
              onClick={() => handleCreateBlank(state.settings.preset || 'A4', state.settings.facingPages !== false)}
              title="Create New Blank Document (0 canvas elements)"
            >
              + New Blank
            </button>
            <button
              className="action-btn dropdown-arrow-btn"
              onClick={() => setShowNewMenu((prev) => !prev)}
              title="Choose Blank Book Preset: A4, 6x9 Novel, US Letter, Square..."
            >
              ▾
            </button>
          </div>
          {showNewMenu && (
            <div className="top-dropdown-menu new-dropdown-menu">
              <button
                className="top-dropdown-item"
                onClick={() => handleCreateBlank('A4', true)}
                title="Create blank facing spread magazine (210 x 297 mm)"
              >
                <div>
                  <div className="dropdown-item-title">Blank Editorial Magazine (A4)</div>
                  <div className="dropdown-item-sub">210 × 297 mm · Facing Pages · Pristine Canvas</div>
                </div>
              </button>
              <button
                className="top-dropdown-item"
                onClick={() => handleCreateBlank('Book-Trade-6x9', true)}
                title="Create blank fiction / trade paperback book (6 x 9 in)"
              >
                <div>
                  <div className="dropdown-item-title">Blank Novel / Trade Book (6 × 9 in)</div>
                  <div className="dropdown-item-sub">152.4 × 228.6 mm · Standard Fiction & Nonfiction</div>
                </div>
              </button>
              <button
                className="top-dropdown-item"
                onClick={() => handleCreateBlank('US-Letter', true)}
                title="Create blank North American standard publication (8.5 x 11 in)"
              >
                <div>
                  <div className="dropdown-item-title">Blank Magazine (US Letter)</div>
                  <div className="dropdown-item-sub">8.5 × 11 in · North American Standard</div>
                </div>
              </button>
              <button
                className="top-dropdown-item"
                onClick={() => handleCreateBlank('Digest-5.5x8.5', true)}
                title="Create blank digest journal / essay book (5.5 x 8.5 in)"
              >
                <div>
                  <div className="dropdown-item-title">Blank Digest (5.5 × 8.5 in)</div>
                  <div className="dropdown-item-sub">139.7 × 215.9 mm · Literary Journal & Memoir</div>
                </div>
              </button>
              <button
                className="top-dropdown-item"
                onClick={() => handleCreateBlank('Zine-A5', true)}
                title="Create blank compact zine or chapbook (148 x 210 mm)"
              >
                <div>
                  <div className="dropdown-item-title">Blank Zine / Pamphlet (A5)</div>
                  <div className="dropdown-item-sub">148 × 210 mm · Underground Press & Poetry</div>
                </div>
              </button>
              <button
                className="top-dropdown-item"
                onClick={() => handleCreateBlank('A4', false)}
                title="Create blank single page poster or flyer (210 x 297 mm)"
              >
                <div>
                  <div className="dropdown-item-title">Single Sheet / Poster (A4)</div>
                  <div className="dropdown-item-sub">210 × 297 mm · Non-facing Single Pages</div>
                </div>
              </button>
            </div>
          )}
        </div>

        {/* Quick Save Project */}
        <button
          className="action-btn"
          onClick={handleSave}
          title="Save .recto project to disk (Ctrl+S)"
        >
          Save
        </button>

        {/* Unified File & Content Menu */}
        <div className="top-dropdown" ref={fileMenuRef}>
          <button
            className={`action-btn ${showFileMenu ? 'active' : ''}`}
            onClick={() => setShowFileMenu((prev) => !prev)}
            title="File Management, Project IO, and Document Imports"
          >
            File ▾
          </button>
          {showFileMenu && (
            <div className="top-dropdown-menu file-dropdown-menu">
              <button
                className="top-dropdown-item"
                onClick={() => {
                  setShowFileMenu(false);
                  handleCreateBlank(state.settings.preset || 'A4', state.settings.facingPages !== false);
                }}
                title="Create a brand new blank document (Ctrl+N)"
              >
                <span>New Blank Document...</span>
                <span className="dropdown-item-shortcut">Ctrl+N</span>
              </button>
              <button
                className="top-dropdown-item"
                onClick={() => {
                  setShowFileMenu(false);
                  handleOpenClick();
                }}
                title="Load .recto, .idml, or .json project file (Ctrl+O)"
              >
                <span>Open Project...</span>
                <span className="dropdown-item-shortcut">Ctrl+O</span>
              </button>
              <button
                className="top-dropdown-item"
                onClick={() => {
                  setShowFileMenu(false);
                  handleSave();
                }}
                title="Save current project to .recto package (Ctrl+S)"
              >
                <span>Save Project (.recto)</span>
                <span className="dropdown-item-shortcut">Ctrl+S</span>
              </button>
              <button
                className="top-dropdown-item"
                onClick={() => {
                  setShowFileMenu(false);
                  stateManager.addSpread();
                }}
                title="Insert New Page Spread"
              >
                <span>+ Add Page Spread</span>
              </button>

              <div className="dropdown-menu-divider" />

              <button
                className="top-dropdown-item"
                onClick={() => {
                  setShowFileMenu(false);
                  handlePlaceClick();
                }}
                title="Place markdown, text, or Word document into selected frame (Ctrl+D)"
              >
                <span>Place Manuscript Text...</span>
                <span className="dropdown-item-shortcut">Ctrl+D</span>
              </button>
              <button
                className="top-dropdown-item"
                onClick={() => {
                  setShowFileMenu(false);
                  handleIdmlClick();
                }}
                title="Open Adobe InDesign (.idml) package"
              >
                <span>Open InDesign Package (.idml)...</span>
              </button>
              <button
                className="top-dropdown-item"
                onClick={() => {
                  setShowFileMenu(false);
                  setShowDataMergeModal(true);
                }}
                title="Batch populate records via CSV dataset"
              >
                <span>Data Merge (CSV)...</span>
              </button>
              {selectedElements.length === 1 && selectedElements[0].type === 'text' && (
                <button
                  className="top-dropdown-item"
                  onClick={() => {
                    setShowFileMenu(false);
                    const note = prompt('Enter Footnote Reference Text:', 'Citation or footnote note');
                    if (note !== null) {
                      stateManager.insertFootnote(selectedElements[0].id, note);
                    }
                  }}
                  title="Insert Footnote into selected text frame"
                >
                  <span>Insert Footnote...</span>
                </button>
              )}

              <div className="dropdown-menu-divider" />

              <button
                className="top-dropdown-item"
                onClick={() => {
                  setShowFileMenu(false);
                  onOpenQr?.();
                }}
                title="Generate native vector ISO/IEC 18004 QR code"
              >
                <span>Insert Vector QR Code...</span>
              </button>
              <button
                className="top-dropdown-item"
                onClick={() => {
                  setShowFileMenu(false);
                  onOpenBarcode?.();
                }}
                title="Generate vector ISBN-13 / EAN-13 bookland barcode"
              >
                <span>Insert ISBN / Barcode...</span>
              </button>

              <div className="dropdown-menu-divider" />

              <button
                className="top-dropdown-item"
                onClick={() => {
                  setShowFileMenu(false);
                  onOpenStoryEditor?.();
                }}
                title="Open distraction-free Story Focus typewriter editor (Ctrl+Y)"
              >
                <span>Story Focus Editor...</span>
                <span className="dropdown-item-shortcut">Ctrl+Y</span>
              </button>
              <button
                className="top-dropdown-item"
                onClick={() => {
                  setShowFileMenu(false);
                  onOpenScripts?.();
                }}
                title="InDesign-style publishing automation & JavaScript scripts (Alt+F11)"
              >
                <span>Scripts & Automation...</span>
                <span className="dropdown-item-shortcut">Alt+F11</span>
              </button>
              <button
                className="top-dropdown-item"
                onClick={() => {
                  setShowFileMenu(false);
                  stateManager.insertIndexStory();
                }}
                title="Compiles alphabetical multi-level A-Z index"
              >
                <span>Generate Book Index Spread</span>
              </button>
              <button
                className="top-dropdown-item"
                onClick={() => {
                  setShowFileMenu(false);
                  handleOpenCoverSpine();
                }}
                title="Mathematical spine caliper, 3D jacket wrap & barcode zone"
              >
                <span>Book Cover & Spine Calculator...</span>
              </button>
              <button
                className="top-dropdown-item"
                onClick={() => {
                  setShowFileMenu(false);
                  handleOpenImposition();
                }}
                title="Duplex booklet imposition for saddle-stitch and multi-signature print"
              >
                <span>Booklet Imposition Studio...</span>
              </button>

              <div className="dropdown-menu-divider" />

              <button
                className="top-dropdown-item"
                onClick={() => {
                  setShowFileMenu(false);
                  stateManager.toggleReadingOrder();
                }}
                title="Toggle visual reading order inspection badges (PDF/UA a11y)"
              >
                <span>Reading Order Overlay (PDF/UA)</span>
                <span className="dropdown-item-shortcut">{state.showReadingOrder ? 'Hide' : 'Show'}</span>
              </button>
              <button
                className="top-dropdown-item"
                onClick={() => {
                  setShowFileMenu(false);
                  stateManager.toggleSlugBanner();
                }}
                title="Toggle prepress slug information area & CMYK color bars"
              >
                <span>Prepress Slug Area & Bars</span>
                <span className="dropdown-item-shortcut">{state.showSlugBanner ? 'Hide' : 'Show'}</span>
              </button>

              <div className="dropdown-menu-divider" />

              <button
                className="top-dropdown-item"
                onClick={() => {
                  setShowFileMenu(false);
                  onOpenShortcuts?.();
                }}
                title="View complete keyboard shortcut matrix (Press ? or Ctrl+/)"
              >
                <span>Keyboard Shortcuts Matrix...</span>
                <span className="dropdown-item-shortcut">?</span>
              </button>
            </div>
          )}
        </div>

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
          accept=".md,.markdown,.txt,.docx,.indd"
          style={{ display: 'none' }}
          onChange={handlePlaceFileChange}
        />

        {onOpenQuickApply && (
          <button
            className="action-btn top-btn-quick-apply"
            onClick={onOpenQuickApply}
            title="Quick Apply Styles & Commands (Ctrl+/ or Ctrl+Enter)"
          >
            Quick Apply
          </button>
        )}

        {onOpenFindChange && (
          <button
            className="action-btn top-btn-find"
            onClick={onOpenFindChange}
            title="Find / Change (GREP) (Ctrl+F)"
          >
            Find
          </button>
        )}

        {/* Version History Drawer Trigger */}
        <button
          className="action-btn top-btn-history"
          onClick={openVersionModal}
          title="Local-First Git Version Snapshots & Checkpoints"
        >
          History <span className="top-badge">{snapshots.length}</span>
        </button>

        {/* Real-time Collaboration Trigger */}
        <button
          className={`action-btn top-btn-collab ${isConnected ? 'active' : ''}`}
          onClick={() => setShowCollabModal(true)}
          style={{
            borderColor: isConnected ? '#10b981' : undefined,
            color: isConnected ? '#10b981' : undefined,
          }}
          title={
            isConnected
              ? (collabSession.isPasswordProtected()
                  ? `Live Session (Password Protected) · ${collabPeers.length + 1} connected`
                  : `Live Session (Public) · ${collabPeers.length + 1} connected`)
              : 'Live Peer-to-Peer Real-Time Collaboration'
          }
        >
          <span
            className="status-dot"
            style={{ backgroundColor: isConnected ? '#10b981' : '#6b7280' }}
          />
          {isConnected
            ? (collabSession.isPasswordProtected()
                ? `Protected (${collabPeers.length + 1})`
                : `Live (${collabPeers.length + 1})`)
            : 'Collaborate'}
        </button>

        {/* Unified Export Action Group */}
        <div className="top-dropdown" ref={exportMenuRef}>
          <div className="btn-group-joined">
            <button
              className="action-btn-primary"
              onClick={handleExportPdfClean}
              title="Export Clean Digital PDF (Exact Trim Dimensions)"
            >
              Export PDF
            </button>
            <button
              className="action-btn-primary dropdown-arrow-btn"
              onClick={() => setShowExportMenu((prev) => !prev)}
              title="Export Clean PDF, PDF/X-1a Prepress, EPUB 3, Web Flipbook, or Package"
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
                  handleExportPdfClean();
                }}
              >
                <div>
                  <div className="dropdown-item-title">Standard PDF (Clean / Proof)</div>
                  <div className="dropdown-item-sub">Exact trim size, perfect for digital sharing & screen</div>
                </div>
              </button>
              <button
                className="top-dropdown-item"
                onClick={() => {
                  setShowExportMenu(false);
                  handleExportPdfPress();
                }}
              >
                <div>
                  <div className="dropdown-item-title">Print PDF (PDF/X-1a Prepress)</div>
                  <div className="dropdown-item-sub">CMYK, 3mm Bleed, Crop Marks, Color Bars, Registration</div>
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
              <button
                className="top-dropdown-item"
                onClick={handleExportSpreadPng}
                title="Export current spread as high-resolution PNG image"
              >
                <div>
                  <div className="dropdown-item-title">Export Spread as Image (PNG)...</div>
                  <div className="dropdown-item-sub">High-resolution raster preview for client review and sharing</div>
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
              <button
                className="top-dropdown-item"
                onClick={() => {
                  setShowExportMenu(false);
                  handleExportIdml();
                }}
              >
                <div>
                  <div className="dropdown-item-title">Adobe InDesign Package (.idml)</div>
                  <div className="dropdown-item-sub">Two-way exchange package for agency handoff</div>
                </div>
              </button>
              <div className="dropdown-divider" />
              <button
                className="top-dropdown-item"
                onClick={() => {
                  setShowExportMenu(false);
                  handleOpenImposition();
                }}
                title="Export imposed duplex printer spreads"
              >
                <div>
                  <div className="dropdown-item-title">Export Imposed Booklet PDF...</div>
                  <div className="dropdown-item-sub">Duplex signature printer spreads with crop marks and creep compensation</div>
                </div>
              </button>
              <button
                className="top-dropdown-item"
                onClick={() => {
                  setShowExportMenu(false);
                  handleOpenCoverSpine();
                }}
                title="Export print-ready wrap jacket cover"
              >
                <div>
                  <div className="dropdown-item-title">Export Full Wrap Cover PDF...</div>
                  <div className="dropdown-item-sub">Complete jacket with calculated spine, fold guides, and bleed</div>
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
                  Detected {parsedPreview.records.length} records, {parsedPreview.headers.length} columns:
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
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Real-Time P2P WebRTC Collaboration</h3>
                <span style={{ fontSize: '11px', color: '#888' }}>
                  Peer-to-peer live co-editing across different machines and networks
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
                    ? `Connected to '${collabSession.getSessionId()}' ${collabSession.isPasswordProtected() ? '(Protected)' : '(Public)'} · WebRTC P2P`
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
                {copiedLink
                  ? (collabPassword.trim() ? 'Copied Secure Link!' : 'Copied Link!')
                  : (collabPassword.trim() ? 'Copy Secure Share Link' : 'Copy Share Link')}
              </button>
              <button className="action-btn" onClick={() => setShowCollabModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {!onOpenImposition && showImpositionModal && (
        <BookletImpositionModal
          state={state}
          onClose={() => setShowImpositionModal(false)}
        />
      )}

      {!onOpenCoverSpine && showCoverSpineModal && (
        <CoverSpineModal
          state={state}
          onClose={() => setShowCoverSpineModal(false)}
        />
      )}
    </header>
  );
}
