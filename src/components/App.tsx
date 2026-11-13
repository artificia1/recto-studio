import { useState, useEffect, useRef } from 'preact/hooks';
import { lazy, Suspense } from 'preact/compat';
import type { IngestedStory } from '../contentImport';
import type { TextElement, ImageElement } from '../types';
import { storyText } from '../engine/storyContent';
import { useProjectState } from '../hooks/useProjectState';
import { TopBar } from './TopBar';
import { ControlBar } from './ControlBar';
import { Toolbar } from './Toolbar';
import { InspectorPanel } from './Inspector/InspectorPanel';
import { StatusBar } from './StatusBar';
import { BookletImpositionModal, CoverSpineModal } from './LazyPrintDialogs';
import { SpreadCanvas } from '../canvas';
import { stateManager } from '../state';
import { fontManager } from '../fontManager';
import { getAppearance, subscribeAppearance } from '../appearance';
const ManuscriptImportModal = lazy(() => import('./ManuscriptImportModal').then(module => ({ default: module.ManuscriptImportModal })));
const EquationModal = lazy(() => import('./EquationModal').then(module => ({ default: module.EquationModal })));
const InddImportModal = lazy(() => import('./InddImportModal').then(module => ({ default: module.InddImportModal })));
const StoryEditorModal = lazy(() => import('./StoryEditorModal').then(module => ({ default: module.StoryEditorModal })));
const BarcodeModal = lazy(() => import('./BarcodeModal').then(module => ({ default: module.BarcodeModal })));
const QrCodeModal = lazy(() => import('./QrCodeModal').then(module => ({ default: module.QrCodeModal })));
const ShortcutsModal = lazy(() => import('./ShortcutsModal').then(module => ({ default: module.ShortcutsModal })));
const ScriptsModal = lazy(() => import('./ScriptsModal').then(module => ({ default: module.ScriptsModal })));
const FindChangeModal = lazy(() => import('./FindChangeModal').then(module => ({ default: module.FindChangeModal })));
const QuickApply = lazy(() => import('./QuickApply').then(module => ({ default: module.QuickApply })));
const SpatialWorkspace = lazy(() => import('./SpatialWorkspace'));

export function App() {
  const [showWorkspace, setShowWorkspace] = useState(false);
  const state = useProjectState();
  const [pendingManuscript, setPendingManuscript] = useState<{ story: IngestedStory; fileName: string; frame: TextElement; revision: number; createFrame?: boolean } | null>(null);
  const [showFindChange, setShowFindChange] = useState(false);
  const findChangeMounted = useRef(false);
  if (showFindChange) findChangeMounted.current = true;
  const [showQuickApply, setShowQuickApply] = useState(false);
  const quickApplyMounted = useRef(false);
  if (showQuickApply) quickApplyMounted.current = true;
  const [showImposition, setShowImposition] = useState(false);
  const [showCoverSpine, setShowCoverSpine] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showStoryEditor, setShowStoryEditor] = useState(false);
  const storyEditorMounted = useRef(false);
  if (showStoryEditor) storyEditorMounted.current = true;
  useEffect(() => {
    const open = () => setShowStoryEditor(true);
    window.addEventListener('recto:open-story-editor', open);
    return () => window.removeEventListener('recto:open-story-editor', open);
  }, []);
  const [showBarcodeModal, setShowBarcodeModal] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const barcodeMounted = useRef(false), qrMounted = useRef(false);
  if (showBarcodeModal) barcodeMounted.current = true;
  if (showQrModal) qrMounted.current = true;
  const [equationEditor, setEquationEditor] = useState<{ element?: ImageElement } | null>(null);
  const [pendingIndd, setPendingIndd] = useState<File | null>(null);
  useEffect(() => {
    const edit = () => {
      const selected = stateManager.getElementById(stateManager.getState().selectedElementId || '');
      if (selected?.type === 'image' && selected.equation) setEquationEditor({ element: selected });
    };
    window.addEventListener('recto:edit-equation', edit);
    return () => window.removeEventListener('recto:edit-equation', edit);
  }, []);
  const [showScriptsModal, setShowScriptsModal] = useState(false);
  const shortcutsMounted = useRef(false), scriptsMounted = useRef(false);
  if (showShortcuts) shortcutsMounted.current = true;
  if (showScriptsModal) scriptsMounted.current = true;
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<'properties' | 'styles' | 'pages' | 'layers' | 'links' | 'templates' | 'setup'>('properties');
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rulerTopRef = useRef<HTMLCanvasElement>(null);
  const rulerLeftRef = useRef<HTMLCanvasElement>(null);
  const spreadCanvasRef = useRef<SpreadCanvas | null>(null);

  useEffect(() => {
    const unsubscribe = fontManager.subscribe(() => {
      stateManager.refreshPublicationReferences(false);
      spreadCanvasRef.current?.render();
    });
    const families = new Set(state.paragraphStyles.map(style => style.fontFamily));
    for (const spread of state.spreads) {
      for (const element of spread.elements) {
        if (element.type === 'text') families.add(element.fontFamily);
      }
    }
    families.forEach(family => {
      if (fontManager.isGoogleFont(family)) void fontManager.loadGoogleFont(family);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const handleGlobalShortcuts = (e: KeyboardEvent) => {
      const isMod = e.ctrlKey || e.metaKey;
      const target = e.target as HTMLElement;
      const isEditing = Boolean(target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable));

      if (isMod && !isEditing && !e.altKey && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        try { if (e.shiftKey) stateManager.ungroupSelection(); else stateManager.groupSelection(); }
        catch (error) { window.alert(error instanceof Error ? error.message : String(error)); }
      } else if (isMod && e.shiftKey && (e.key === 'i' || e.key === 'I')) {
        e.preventDefault();
        setShowImposition((prev) => !prev);
      } else if (isMod && e.shiftKey && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        setShowCoverSpine((prev) => !prev);
      } else if (isMod && e.altKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        setInspectorTab('setup');
      } else if (isMod && !e.altKey && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setInspectorTab('setup');
      } else if (isMod && e.altKey && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault();
        stateManager.toggleEditorialLock();
      } else if (isMod && !e.shiftKey && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault();
        stateManager.toggleLock();
      } else if (isMod && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        setShowFindChange((prev) => !prev);
      } else if (isMod && (e.key === '/' || e.key === 'Enter')) {
        e.preventDefault();
        setShowQuickApply((prev) => !prev);
      } else if (isMod && e.altKey && !e.shiftKey && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        setShowStoryEditor((prev) => !prev);
      } else if (isMod && e.altKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        stateManager.fitFrameToContent();
      } else if (isMod && e.altKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        stateManager.toggleReadingOrder();
      } else if (isMod && e.altKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        stateManager.toggleSlugBanner();
      } else if (!isEditing && !isMod && !e.altKey && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        stateManager.setTool('measure');
      } else if (isMod && (e.key === ';' || e.key === ':')) {
        e.preventDefault();
        stateManager.toggleGuides();
      } else if (isMod && e.altKey && (e.key === "'" || e.key === '"')) {
        e.preventDefault();
        stateManager.toggleBaselineGrid();
      } else if (!isEditing && !isMod && !e.altKey && !e.shiftKey && (e.key === 'w' || e.key === 'W')) {
        e.preventDefault();
        stateManager.togglePreviewMode();
      } else if (e.key === '?' || (e.shiftKey && e.key === '/') || e.key === 'F1') {
        if (isEditing) return;
        e.preventDefault();
        setShowShortcuts((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleGlobalShortcuts);
    return () => window.removeEventListener('keydown', handleGlobalShortcuts);
  }, []);

  useEffect(() => {
    if (
      containerRef.current &&
      canvasRef.current &&
      rulerTopRef.current &&
      rulerLeftRef.current &&
      !spreadCanvasRef.current
    ) {
      spreadCanvasRef.current = new SpreadCanvas(
        containerRef.current,
        canvasRef.current,
        rulerTopRef.current,
        rulerLeftRef.current
      );

      (window as any).recto = {
        stateManager,
        spreadCanvas: spreadCanvasRef.current,
      };
      (window as any).papercut = (window as any).recto;

      spreadCanvasRef.current.render();
    }

    let previousAppearance = getAppearance();
    const unsubscribe = subscribeAppearance(appearance => {
      const canvas = spreadCanvasRef.current;
      if (!canvas) return;
      canvas.refreshRulerPalette();
      if (appearance.compact !== previousAppearance.compact) {
        canvas.resizeCanvas();
        canvas.scheduleRender();
      } else if (appearance.pasteboard !== previousAppearance.pasteboard) {
        canvas.scheduleRender();
      } else {
        canvas.drawRulers();
      }
      previousAppearance = appearance;
    });
    return () => {
      unsubscribe();
      if (spreadCanvasRef.current) {
        spreadCanvasRef.current.destroy();
        spreadCanvasRef.current = null;
      }
    };
  }, []);

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (e: DragEvent) => {
    try {
      await handleDroppedFile(e);
    } catch (error) {
      alert(`Could not import this file. ${error instanceof Error ? error.message : 'Please try again.'}`);
    }
  };

  const handleDroppedFile = async (e: DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const name = file.name.toLowerCase();
    const spread = stateManager.getActiveSpread();
    const revision = stateManager.getDocumentRevision();
    const checkTarget = () => {
      if (stateManager.getDocumentRevision() !== revision || stateManager.getActiveSpread() !== spread) {
        throw new Error('The document or spread changed. Drop the file again on its intended page.');
      }
    };

    if (name.endsWith('.idml') || name.endsWith('.indd')) {
      if (name.endsWith('.indd')) {
        setPendingIndd(file);
      } else {
        await stateManager.loadFromIdml(file);
      }
      return;
    }

    if (/\.(recto|rectoarchive|papercut|json)$/.test(name)) {
      try {
        await stateManager.importProjectFile(file);
      } catch (error) {
        alert(`Could not open this project. ${error instanceof Error ? error.message : 'Please check the file.'}`);
      }
      return;
    }

    if (name.endsWith('.md') || name.endsWith('.markdown') || name.endsWith('.txt') || name.endsWith('.docx')) {
      const buffer = await file.arrayBuffer();
      const { ingestManuscript } = await import('../contentImport');
      const ingested = await ingestManuscript(file.name, buffer);
      checkTarget();
      if (!ingested.formattedText.trim()) throw new Error('This manuscript has no readable text.');

      const activeSpread = stateManager.getActiveSpread();
      const selectedElId = state.selectedElementId;
      const selectedEl = activeSpread.elements.find((el) => el.id === selectedElId);

      if (selectedEl && selectedEl.type === 'text') {
        setPendingManuscript({ story: ingested, fileName: file.name, frame: selectedEl, revision });
      } else {
        const textEl = activeSpread.elements.find((el) => el.type === 'text');
        if (textEl) {
          setPendingManuscript({ story: ingested, fileName: file.name, frame: textEl, revision });
        } else {
          const page = activeSpread.pages[0];
          const margin = state.settings.margins;
          setPendingManuscript({ story: ingested, fileName: file.name, revision, createFrame: true, frame: {
            id: `text-placed-${Date.now()}`,
            type: 'text',
            pageId: page.id,
            x: margin.insideMm,
            y: margin.topMm,
            width: state.settings.widthMm - margin.insideMm - margin.outsideMm,
            height: state.settings.heightMm - margin.topMm - margin.bottomMm,
            rotation: 0,
            opacity: 1,
            zIndex: 10,
            locked: false,
            text: ingested.formattedText,
            fontFamily: 'Merriweather, Georgia, serif',
            fontSizePt: 10,
            lineHeight: 1.4,
            letterSpacingPt: 0,
            color: '#1a1a1a',
            alignment: 'justify',
            columns: state.settings.columnCount || 2,
            columnGutterMm: state.settings.columnGutterMm || 5,
            backgroundColor: 'transparent',
            borderColor: 'transparent',
            borderWidthMm: 0,
            paddingMm: 2,
            paragraphStyleId: ingested.detectedStyleId,
          } });
        }
      }
      return;
    }

    if (file.type.startsWith('image/')) {
      const selected = spread.elements.find(el => el.id === state.selectedElementId);
      if (selected?.type === 'image') {
        if (!await stateManager.registerImageAsset(selected.id, file)) throw new Error('The image frame changed or is locked.');
        return;
      }
      const { readPlacedImage } = await import('../engine/placedImage');
      const image = await readPlacedImage(file);
      checkTarget();
      stateManager.addElement({
        ...image,
        id: crypto.randomUUID(),
        type: 'image',
        pageId: spread.pages[0].id,
        x: 30,
        y: 30,
        width: 80,
        height: 80,
        rotation: 0,
        opacity: 1,
        zIndex: 10,
        locked: false,
        fitMode: 'fill',
        borderColor: '#000',
        borderWidthMm: 0,
      });
    }
  };

  return (
    <div id="app" onDragOver={handleDragOver} onDrop={handleDrop}>
      {pendingManuscript && <Suspense fallback={null}><ManuscriptImportModal manuscript={pendingManuscript.story}
        fileName={pendingManuscript.fileName} frame={pendingManuscript.frame} state={state}
        onClose={() => setPendingManuscript(null)}
        onUpdate={pendingManuscript.createFrame ? undefined : (content, notes) => {
          stateManager.applyManuscriptUpdate(pendingManuscript.frame.id, pendingManuscript.revision, content, notes);
          setPendingManuscript(null);
        }} onPlace={content => {
          if (stateManager.getDocumentRevision() !== pendingManuscript.revision) {
            throw new Error('The document changed. Close this preview and place the manuscript again.');
          }
          stateManager.placeManuscript(pendingManuscript.createFrame ? pendingManuscript.frame : pendingManuscript.frame.id, content, pendingManuscript.story.notes);
          setPendingManuscript(null);
        }} /></Suspense>}
      <TopBar
        onImportManuscript={(story, fileName, frame) => setPendingManuscript({ story, fileName, frame, revision: stateManager.getDocumentRevision() })}
        state={state}
        onOpenFindChange={() => setShowFindChange(true)}
        onOpenQuickApply={() => setShowQuickApply(true)}
        onOpenImposition={() => setShowImposition(true)}
        onOpenCoverSpine={() => setShowCoverSpine(true)}
        onOpenShortcuts={() => setShowShortcuts(true)}
        onOpenStoryEditor={() => setShowStoryEditor(true)}
        onOpenBarcode={() => setShowBarcodeModal(true)}
        onOpenQr={() => setShowQrModal(true)}
        onOpenEquation={() => setEquationEditor({})}
        onOpenIndd={setPendingIndd}
        onOpenScripts={() => setShowScriptsModal(true)}
        onOpenDocumentSetup={() => setInspectorTab('setup')}
      />
      <ControlBar state={state} />

      <div className="workspace">
        <Toolbar state={state} />

        <main className="canvas-viewport" id="canvas-container" ref={containerRef}>
          <button type="button" className="workspace-map-toggle" aria-haspopup="dialog" onClick={() => setShowWorkspace(true)}>
            All spreads
          </button>
          <div className="ruler-corner"></div>
          <div className="ruler-top-container">
            <canvas id="ruler-top" ref={rulerTopRef}></canvas>
          </div>
          <div className="ruler-left-container">
            <canvas id="ruler-left" ref={rulerLeftRef}></canvas>
          </div>
          <div className="main-canvas-container">
            <canvas id="spread-canvas" ref={canvasRef}></canvas>
          </div>
        </main>

        {/* Floating Mobile / Tablet UI Controls */}
        <button
          className="mobile-inspector-toggle-btn"
          onClick={() => setMobileInspectorOpen(!mobileInspectorOpen)}
          title="Toggle Inspector"
          aria-label="Toggle Inspector"
        >
          Inspector
        </button>

        <div className="mobile-canvas-zoom-pill">
          <button
            className="mobile-zoom-btn"
            onClick={() => stateManager.setZoom(Math.max(0.2, Math.round((state.zoom - 0.15) * 100) / 100))}
            title="Zoom Out"
            aria-label="Zoom Out"
          >
            −
          </button>
          <button
            className="mobile-zoom-btn mobile-zoom-fit-btn"
            onClick={() => stateManager.setZoomAndPan(0.85, 0, 0)}
            title="Fit Spread to Screen"
            aria-label="Fit Spread"
          >
            Fit
          </button>
          <span className="mobile-zoom-label">{Math.round(state.zoom * 100)}%</span>
          <button
            className="mobile-zoom-btn"
            onClick={() => stateManager.setZoom(Math.min(3.0, Math.round((state.zoom + 0.15) * 100) / 100))}
            title="Zoom In"
            aria-label="Zoom In"
          >
            +
          </button>
        </div>

        {/* Floating Touch Action Pill: only auto on touch devices, or when manually enabled in settings */}
        {((typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0) || state.showQuickActionsToolbar) && state.selectedElementId) && (
          <div className={`mobile-touch-actions-pill ${state.showQuickActionsToolbar ? 'force-visible' : ''}`}>
            <button
              className="mobile-action-btn"
              onClick={() => {
                if (state.selectedElementId) {
                  stateManager.duplicateElement(state.selectedElementId);
                }
              }}
              title="Duplicate Element"
            >
              Copy
            </button>
            <button
              className="mobile-action-btn"
              onClick={() => {
                if (state.selectedElementId) {
                  stateManager.changeElementOrder(state.selectedElementId, 'front');
                }
              }}
              title="Bring to Front"
            >
              Front
            </button>
            <button
              className="mobile-action-btn"
              onClick={() => {
                if (state.selectedElementId) {
                  stateManager.changeElementOrder(state.selectedElementId, 'back');
                }
              }}
              title="Send to Back"
            >
              Back
            </button>
            <button
              className="mobile-action-btn"
              onClick={() => {
                if (state.selectedElementId) {
                  stateManager.toggleLock([state.selectedElementId]);
                }
              }}
              title="Toggle Lock"
            >
              Lock
            </button>
            <button
              className="mobile-action-btn mobile-action-btn-danger"
              onClick={() => {
                stateManager.deleteSelectedElements();
              }}
              title="Delete Element"
            >
              Delete
            </button>
          </div>
        )}

        {mobileInspectorOpen && (
          <div
            className="mobile-drawer-backdrop"
            onClick={() => setMobileInspectorOpen(false)}
          />
        )}

        <InspectorPanel
          state={state}
          activeTab={inspectorTab}
          onTabChange={setInspectorTab}
          isOpen={mobileInspectorOpen}
          onClose={() => setMobileInspectorOpen(false)}
        />
      </div>

      <StatusBar state={state} />
      {showWorkspace && <Suspense fallback={<div role="status">Loading multi-spread workspace…</div>}><SpatialWorkspace state={state} onClose={() => { const id = stateManager.getState().selectedElementId; if (id) stateManager.zoomToElement(id); setShowWorkspace(false); }}/></Suspense>}

      {findChangeMounted.current && <Suspense fallback={null}><FindChangeModal
        isOpen={showFindChange}
        onClose={() => setShowFindChange(false)}
      /></Suspense>}

      {quickApplyMounted.current && <Suspense fallback={null}><QuickApply
        isOpen={showQuickApply}
        onClose={() => setShowQuickApply(false)}
        state={state}
        onOpenFindChange={() => {
          setShowQuickApply(false);
          setShowFindChange(true);
        }}
        onOpenImposition={() => {
          setShowQuickApply(false);
          setShowImposition(true);
        }}
        onOpenCoverSpine={() => {
          setShowQuickApply(false);
          setShowCoverSpine(true);
        }}
      /></Suspense>}

      {showImposition && (
        <BookletImpositionModal
          state={state}
          onClose={() => setShowImposition(false)}
        />
      )}

      {showCoverSpine && (
        <CoverSpineModal
          state={state}
          onClose={() => setShowCoverSpine(false)}
        />
      )}

      {shortcutsMounted.current && <Suspense fallback={<div role="status">Loading shortcuts…</div>}><ShortcutsModal
        isOpen={showShortcuts}
        onClose={() => setShowShortcuts(false)}
      /></Suspense>}

      {storyEditorMounted.current && <Suspense fallback={<div role="status">Loading Story Editor…</div>}><StoryEditorModal
        isOpen={showStoryEditor}
        onClose={() => setShowStoryEditor(false)}
        state={state}
      /></Suspense>}

      {barcodeMounted.current && <Suspense fallback={<div role="status">Loading barcode editor…</div>}><BarcodeModal
        isOpen={showBarcodeModal}
        onClose={() => setShowBarcodeModal(false)}
      /></Suspense>}

      {equationEditor && <Suspense fallback={<div className="modal-overlay" role="status">Loading equation editor…</div>}>
        <EquationModal element={equationEditor.element} onClose={() => setEquationEditor(null)} />
      </Suspense>}
      {pendingIndd && <Suspense fallback={<div role="status">Loading import options…</div>}>
        <InddImportModal file={pendingIndd} onClose={() => setPendingIndd(null)} />
      </Suspense>}
      {qrMounted.current && <Suspense fallback={<div role="status">Loading QR editor…</div>}><QrCodeModal
        isOpen={showQrModal}
        onClose={() => setShowQrModal(false)}
      /></Suspense>}

      {scriptsMounted.current && <Suspense fallback={<div role="status">Loading scripts…</div>}><ScriptsModal
        isOpen={showScriptsModal}
        onClose={() => setShowScriptsModal(false)}
      /></Suspense>}
    </div>
  );
}
