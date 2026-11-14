/**
 * Recto Studio — High-Precision Desktop Publishing Engine
 * Copyright (c) 2022-2026 Abhinav. All rights reserved.
 * Licensed under the MIT License.
 */

import { useState, useEffect, useRef } from 'preact/hooks';
import { stateManager } from '../state';
import { PAGE_PRESETS, PagePreset, ProjectState, VersionSnapshot, PeerPresence } from '../types';
import { collabSession } from '../collab';
import { isDesktop } from '../desktop';
import type { IngestedStory } from '../contentImport';
import type { TextElement } from '../types';
import { BookletImpositionModal, CoverSpineModal } from './LazyPrintDialogs';
import type { ExportAction } from './ExportMenu';

import { lazy, Suspense } from 'preact/compat';
const AppUpdater = lazy(() => import('./AppUpdater').then(module => ({ default: module.AppUpdater })));
const ScribusImportDialog = lazy(() => import('./ScribusImportDialog'));
const NewProjectMenu = lazy(() => import('./NewProjectMenu'));
const ExportMenu = lazy(() => import('./ExportMenu'));
const FileMenu = lazy(() => import('./FileMenu'));
const CollaborationDialog = lazy(() => import('./CollaborationDialog'));
const DataMergeDialog = lazy(() => import('./DataMergeDialog'));
const VersionHistoryDialog = lazy(() => import('./VersionHistoryDialog'));
const RecoveryDialog = lazy(() => import('./RecoveryDialog'));
const AppearancePage = lazy(() => import('./AppearancePage'));
const TopAlignmentControls = lazy(() => import('./TopAlignmentControls'));
const WebInstallDialog = lazy(() => import('./WebInstallDialog'));

function saveProject(saveAs = false) {
  void import('../desktopProjects').then(({ saveCurrentProject }) => saveCurrentProject(saveAs))
    .catch(error => alert(`Could not save this project. ${error instanceof Error ? error.message : String(error)}`));
}

function ActionIcon({ name }: { name: string }) {
  return <svg className="top-action-icon" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
    <use href={`./toolbar-icons.svg#${name}`} />
  </svg>;
}

interface TopBarProps {
  state: ProjectState;
  onImportManuscript: (story: IngestedStory, fileName: string, frame: TextElement) => void;
  onOpenFindChange?: () => void;
  onOpenQuickApply?: () => void;
  onOpenImposition?: () => void;
  onOpenCoverSpine?: () => void;
  onOpenShortcuts?: () => void;
  onOpenStoryEditor?: () => void;
  onOpenBarcode?: () => void;
  onOpenQr?: () => void;
  onOpenEquation?: () => void;
  onOpenIndd?: (file: File) => void;
  onOpenScripts?: () => void;
  onOpenDocumentSetup?: () => void;
}

export function TopBar({
  state,
  onImportManuscript,
  onOpenFindChange,
  onOpenQuickApply,
  onOpenImposition,
  onOpenCoverSpine,
  onOpenShortcuts,
  onOpenStoryEditor,
  onOpenBarcode,
  onOpenQr,
  onOpenEquation,
  onOpenIndd,
  onOpenScripts,
  onOpenDocumentSetup,
}: TopBarProps) {
  const [showImpositionModal, setShowImpositionModal] = useState(false);
  const [showCoverSpineModal, setShowCoverSpineModal] = useState(false);

  const handleOpenImposition = onOpenImposition || (() => setShowImpositionModal(true));
  const handleOpenCoverSpine = onOpenCoverSpine || (() => setShowCoverSpineModal(true));

  const [title, setTitle] = useState(state.settings.title);
  const [showDataMergeModal, setShowDataMergeModal] = useState(false);
  const [showScribusImport, setShowScribusImport] = useState(false);
  const [showVersionModal, setShowVersionModal] = useState(false);
  const [showCollabModal, setShowCollabModal] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [snapshots, setSnapshots] = useState<VersionSnapshot[]>(stateManager.getSnapshots());
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);
  const [diffResult, setDiffResult] = useState<ReturnType<typeof stateManager.diffSnapshot> | null>(null);

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
  const [showRecovery, setShowRecovery] = useState(false);
  const [showAppearance, setShowAppearance] = useState(false);
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const open = () => setShowAppearance(true);
    window.addEventListener('recto:appearance', open);
    return () => window.removeEventListener('recto:appearance', open);
  }, []);

  useEffect(() => {
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      if (event.repeat || event.isComposing) return;
      if (event.target instanceof HTMLElement && event.target.matches('input, textarea, [contenteditable]')) event.target.blur();
      saveProject(event.shiftKey);
    };
    window.addEventListener('keydown', handleSaveShortcut);
    return () => window.removeEventListener('keydown', handleSaveShortcut);
  }, []);

  const fullscreenDocument: Document & {
    webkitFullscreenElement?: Element;
    webkitExitFullscreen?(): void;
  } = document;

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement || fullscreenDocument.webkitFullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    document.addEventListener('webkitfullscreenchange', handleFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFsChange);
      document.removeEventListener('webkitfullscreenchange', handleFsChange);
    };
  }, []);

  const handleToggleFullscreen = () => {
    try {
      if (!document.fullscreenElement && !fullscreenDocument.webkitFullscreenElement) {
        const root: HTMLElement & { webkitRequestFullscreen?(): void } = document.documentElement;
        if (root.requestFullscreen) {
          root.requestFullscreen().catch(() => {});
        } else if (root.webkitRequestFullscreen) {
          root.webkitRequestFullscreen();
        }
      } else {
        if (document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        } else if (fullscreenDocument.webkitExitFullscreen) {
          fullscreenDocument.webkitExitFullscreen();
        }
      }
    } catch {
      // Ignore fullscreen failure on restricted environments
    }
  };
  const newMenuRef = useRef<HTMLDivElement>(null);
  const fileMenuRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const idmlInputRef = useRef<HTMLInputElement>(null);
  const inddInputRef = useRef<HTMLInputElement>(null);
  const placeInputRef = useRef<HTMLInputElement>(null);

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
          void collabSession.connect(roomParam, undefined, pwdParam || undefined).catch(error => alert(`Could not start collaboration: ${error instanceof Error ? error.message : String(error)}`));
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
    } else if (val !== 'custom') {
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

  const installFile = async (file: File) => {
    const name = file.name.toLowerCase();
    if (name.endsWith('.indd')) onOpenIndd?.(file);
    else if (name.endsWith('.idml')) await stateManager.loadFromIdml(file);
    else await stateManager.importProjectFile(file);
  };

  const handleOpenClick = () => {
    if (!isDesktop()) { fileInputRef.current?.click(); return; }
    void import('../desktopProjects').then(({ openCurrentDesktopProject }) => openCurrentDesktopProject(installFile))
      .catch(error => alert(`Could not open this project. ${error instanceof Error ? error.message : String(error)}`));
  };

  const handleIdmlClick = () => {
    idmlInputRef.current?.click();
  };

  const handleInddClick = () => {
    inddInputRef.current?.click();
  };

  const handleFileChange = async (e: Event | any) => {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (file) {
      try {
        await installFile(file);
      } catch (err) {
        console.error('Failed to load project file:', err);
        alert(`Could not open this project. ${err instanceof Error ? err.message : 'Please check the file.'}`);
      } finally {
        target.value = '';
      }
    }
  };

  const handleIdmlFileChange = async (e: Event | any) => {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (file) {
      try {
        if (file.name.toLowerCase().endsWith('.indd')) {
          onOpenIndd?.(file);
        } else {
          await stateManager.loadFromIdml(file);
        }
      } catch (err) {
        console.error('Failed to import InDesign document:', err);
        alert('Failed to import InDesign document: ' + (err instanceof Error ? err.message : String(err)));
      } finally {
        target.value = '';
      }
    }
  };

  const handleInddFileChange = async (e: Event | any) => {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (file) {
      try {
        onOpenIndd?.(file);
      } catch (err) {
        console.error('Failed to import InDesign .indd document:', err);
        alert('Failed to import InDesign document: ' + (err instanceof Error ? err.message : String(err)));
      } finally {
        target.value = '';
      }
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

  const handlePlaceFileChange = async (e: Event | any) => {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    const textEl = selectedElements.find((el) => el.type === 'text');
    if (file && textEl) {
      try {
        const buffer = await file.arrayBuffer();
        const { ingestManuscript } = await import('../contentImport');
        const ingested = await ingestManuscript(file.name, buffer);
        if (stateManager.getElementById(textEl.id) !== textEl) throw new Error('The text frame changed. Select it and place the manuscript again.');
        if (!ingested.formattedText.trim()) throw new Error('This manuscript has no readable text.');
        onImportManuscript(ingested, file.name, textEl as TextElement);
      } catch (err) {
        console.error('Failed to place text content:', err);
        alert(`Could not import manuscript. ${err instanceof Error ? err.message : 'Please try another file.'}`);
      } finally {
        target.value = '';
      }
    }
  };

  const runExport = async (action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (error) {
      alert(`Export failed. ${error instanceof Error ? error.message : 'Please try again.'}`);
    }
  };

  const handlePublicationExport = (action: ExportAction) => {
    if (action === 'booklet') return handleOpenImposition();
    if (action === 'cover') return handleOpenCoverSpine();
    void runExport(async () => {
      const { downloadPublication } = await import('../export/publicationDownloads');
      if (action === 'image' && stateManager.getState().activeSpreadIndex !== state.activeSpreadIndex) {
        throw new Error('The active spread changed. Export the image again.');
      }
      await downloadPublication(state, action);
    });
  };

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

  const handleToggleCollab = async () => {
    if (isConnected) {
      collabSession.disconnect();
      setIsConnected(false);
      setCollabPeers([]);
    } else {
      try { await collabSession.connect(
        collabRoom.trim() || 'recto-live',
        collabUserName.trim(),
        collabPassword.trim()
      ); } catch (error) { alert(`Could not start collaboration: ${error instanceof Error ? error.message : String(error)}`); return; }
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
          <img className="brand-icon" src="./logo.svg" width="16" height="16" alt="" />
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
          value={!['0.5', '0.75', '1', '1.25', '1.5', '2'].includes((Math.round(state.zoom * 100) / 100).toString()) ? 'custom' : (Math.round(state.zoom * 100) / 100).toString()}
          onChange={handleZoomChange}
          title="Canvas Zoom"
        >
          {!['0.5', '0.75', '1', '1.25', '1.5', '2'].includes((Math.round(state.zoom * 100) / 100).toString()) && (
            <option value="custom">{Math.round(state.zoom * 100)}%</option>
          )}
          <option value="fit">Fit Spread</option>
          <option value="0.5">50%</option>
          <option value="0.75">75%</option>
          <option value="1">100%</option>
          <option value="1.25">125%</option>
          <option value="1.5">150%</option>
          <option value="2">200%</option>
        </select>

        {hasSelection && <Suspense fallback={null}>
          <TopAlignmentControls count={selectedElements.length} selectedIds={selectedIds} allLocked={allLocked} />
        </Suspense>}
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
              New
            </button>
            <button
              className={`action-btn dropdown-arrow-btn ${showNewMenu ? 'active' : ''}`}
              onClick={() => {
                setShowNewMenu((prev) => !prev);
                setShowFileMenu(false);
                setShowExportMenu(false);
              }}
              title="Choose Blank Book Preset: A4, 6x9 Novel, US Letter, Square..."
            >
              ▾
            </button>
          </div>
          {showNewMenu && <Suspense fallback={null}><NewProjectMenu onCreate={handleCreateBlank} /></Suspense>}
        </div>

        {/* Quick Save Project */}
        <button
          className="action-btn"
          onClick={() => saveProject()}
          title="Save .recto project to disk (Ctrl+S)"
        >
          Save
        </button>

        {/* Unified File & Content Menu */}
        <div className="top-dropdown" ref={fileMenuRef}>
          <button
            className={`action-btn ${showFileMenu ? 'active' : ''}`}
            onClick={() => {
              setShowFileMenu((prev) => !prev);
              setShowNewMenu(false);
              setShowExportMenu(false);
            }}
            title="File Management, Project IO, and Document Imports"
          >
            File ▾
          </button>
          {showFileMenu && <Suspense fallback={null}>
            <FileMenu state={state} selectedTextId={selectedElements.length === 1 && selectedElements[0].type === 'text' ? selectedElements[0].id : undefined}
              onClose={() => setShowFileMenu(false)} onSave={saveProject} onRecovery={() => setShowRecovery(true)}
              handleCreateBlank={handleCreateBlank} handleOpenClick={handleOpenClick} handleIdmlClick={handleIdmlClick}
              handleInddClick={handleInddClick} handlePlaceClick={handlePlaceClick} onMerge={() => setShowDataMergeModal(true)}
              onScribus={() => setShowScribusImport(true)} onOpenDocumentSetup={onOpenDocumentSetup} onOpenQr={onOpenQr}
              onOpenEquation={onOpenEquation} onOpenBarcode={onOpenBarcode} onOpenStoryEditor={onOpenStoryEditor}
              onOpenScripts={onOpenScripts} onOpenShortcuts={onOpenShortcuts} handleOpenCoverSpine={handleOpenCoverSpine}
              onInstallGuide={() => {
                fileMenuRef.current?.querySelector('button')?.focus();
                setShowInstallGuide(true);
              }}
              handleOpenImposition={handleOpenImposition} />
          </Suspense>}
        </div>

        {showRecovery && <Suspense fallback={null}>
          <RecoveryDialog onClose={() => setShowRecovery(false)} onRecover={project =>
            stateManager.importProjectFile(new File([JSON.stringify(project)], 'recovered.recto'))} />
        </Suspense>}

        <input
          type="file"
          ref={fileInputRef}
          accept=".recto,.papercut,.json,.idml,.indd,.rectoarchive"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
        <input
          type="file"
          ref={idmlInputRef}
          accept=".idml,.indd,application/vnd.adobe.indesign-idml-package"
          style={{ display: 'none' }}
          onChange={handleIdmlFileChange}
        />
        <input
          type="file"
          ref={inddInputRef}
          accept=".indd,application/x-indesign"
          style={{ display: 'none' }}
          onChange={handleInddFileChange}
        />
        <input
          type="file"
          ref={placeInputRef}
          accept=".md,.markdown,.txt,.docx"
          style={{ display: 'none' }}
          onChange={handlePlaceFileChange}
        />

        {onOpenQuickApply && (
          <button
            className="action-btn top-btn-quick-apply"
            onClick={onOpenQuickApply}
            title="Quick Apply Styles & Commands (Ctrl+/ or Ctrl+Enter)"
            aria-label="Quick Apply"
          >
            <ActionIcon name="commands" />
            <span className="top-action-label">Quick Apply</span>
          </button>
        )}

        {onOpenFindChange && (
          <button
            className="action-btn top-btn-find"
            onClick={onOpenFindChange}
            title="Find / Change (GREP) (Ctrl+F)"
            aria-label="Find"
          >
            <ActionIcon name="find" />
            <span className="top-action-label">Find</span>
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
              onClick={() => handlePublicationExport('proof')}
              title="Export Clean Digital PDF (Exact Trim Dimensions)"
            >
              Export PDF
            </button>
            <button
              className={`action-btn-primary dropdown-arrow-btn ${showExportMenu ? 'active' : ''}`}
              onClick={() => {
                setShowExportMenu((prev) => !prev);
                setShowFileMenu(false);
                setShowNewMenu(false);
              }}
              title="Export Clean PDF, Print PDF, EPUB 3, Web Flipbook, or Package"
            >
              ▾
            </button>
          </div>
          {showExportMenu && <Suspense fallback={null}><ExportMenu onClose={() => setShowExportMenu(false)}
            onExport={handlePublicationExport}/></Suspense>}
        </div>

        {/* Immersive Fullscreen Mode (Removes Mobile/Tablet Browser Navigation Chrome) */}
        <button
          className={`action-btn top-btn-fullscreen ${isFullscreen ? 'active' : ''}`}
          onClick={handleToggleFullscreen}
          title={isFullscreen ? 'Exit Immersive Fullscreen' : 'Enter Immersive Fullscreen (Hide Browser Top & Bottom Bars)'}
          aria-label={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          aria-pressed={isFullscreen}
        >
          <ActionIcon name={isFullscreen ? 'exit-fullscreen' : 'fullscreen'} />
          <span className="top-action-label">{isFullscreen ? 'Exit' : 'Fullscreen'}</span>
        </button>
        <button type="button" className="action-btn top-btn-appearance" aria-label="Appearance"
          title="Workspace appearance" aria-haspopup="dialog" onClick={() => setShowAppearance(true)}>
          <ActionIcon name="appearance" /><span className="top-action-label">Appearance</span>
        </button>
        {isDesktop() && !/Macintosh/.test(navigator.userAgent) && <Suspense fallback={null}><AppUpdater /></Suspense>}
      </div>

      {showAppearance && <Suspense fallback={null}><AppearancePage onClose={() => setShowAppearance(false)} /></Suspense>}
      {showInstallGuide && <Suspense fallback={null}><WebInstallDialog onClose={() => setShowInstallGuide(false)} /></Suspense>}
      {showScribusImport && <Suspense fallback={null}><ScribusImportDialog onClose={() => setShowScribusImport(false)} /></Suspense>}
      {showDataMergeModal && <Suspense fallback={null}><DataMergeDialog
        csvText={csvText} setCsvText={setCsvText} onClose={() => setShowDataMergeModal(false)} /></Suspense>}

      {showVersionModal && <Suspense fallback={null}><VersionHistoryDialog snapshots={snapshots}
        selectedSnapshotId={selectedSnapshotId} diffResult={diffResult} commitMessage={commitMessage}
        setCommitMessage={setCommitMessage} onClose={() => setShowVersionModal(false)} handleCreateSnapshot={handleCreateSnapshot}
        handleSelectSnapshot={handleSelectSnapshot} handleDeleteSnapshot={handleDeleteSnapshot} handleRollback={handleRollback} /></Suspense>}

      {showCollabModal && <Suspense fallback={null}><CollaborationDialog {...{
        collabRoom, setCollabRoom, collabPassword, setCollabPassword, showPassword, setShowPassword,
        collabUserName, setCollabUserName, collabPeers, isConnected, copiedLink, currentSpreadNum,
        handleToggleCollab, handleCopyShareLink,
      }} onClose={() => setShowCollabModal(false)} /></Suspense>}

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
