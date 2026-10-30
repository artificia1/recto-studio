import { useState, useEffect, useRef } from 'preact/hooks';
import { useProjectState } from '../hooks/useProjectState';
import { TopBar } from './TopBar';
import { ControlBar } from './ControlBar';
import { Toolbar } from './Toolbar';
import { InspectorPanel } from './Inspector/InspectorPanel';
import { StatusBar } from './StatusBar';
import { FindChangeModal } from './FindChangeModal';
import { QuickApply } from './QuickApply';
import { BookletImpositionModal, CoverSpineModal } from './LazyPrintDialogs';
import { ShortcutsModal } from './ShortcutsModal';
import { StoryEditorModal } from './StoryEditorModal';
import { BarcodeModal } from './BarcodeModal';
import { QrCodeModal } from './QrCodeModal';
import { ScriptsModal } from './ScriptsModal';
import { SpreadCanvas } from '../canvas';
import { stateManager } from '../state';
import { fontManager } from '../fontManager';

export function App() {
  const state = useProjectState();
  const [showFindChange, setShowFindChange] = useState(false);
  const [showQuickApply, setShowQuickApply] = useState(false);
  const [showImposition, setShowImposition] = useState(false);
  const [showCoverSpine, setShowCoverSpine] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showStoryEditor, setShowStoryEditor] = useState(false);
  const [showBarcodeModal, setShowBarcodeModal] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [showScriptsModal, setShowScriptsModal] = useState(false);
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<'properties' | 'styles' | 'pages' | 'layers' | 'links' | 'templates' | 'setup'>('properties');
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rulerTopRef = useRef<HTMLCanvasElement>(null);
  const rulerLeftRef = useRef<HTMLCanvasElement>(null);
  const spreadCanvasRef = useRef<SpreadCanvas | null>(null);

  useEffect(() => {
    const unsubscribe = fontManager.subscribe(() => spreadCanvasRef.current?.render());
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

      if (isMod && e.shiftKey && (e.key === 'i' || e.key === 'I')) {
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
      console.log('SpreadCanvas 2D render engine connected to Preact TSX shell.');
    }

    return () => {
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

    if (name.endsWith('.idml') || name.endsWith('.indd')) {
      const buffer = await file.arrayBuffer();
      if (name.endsWith('.indd')) {
        await stateManager.loadFromIndd(buffer, file.name);
      } else {
        await stateManager.loadFromIdml(buffer, file.name);
      }
      return;
    }

    if (name.endsWith('.recto') || name.endsWith('.papercut') || name.endsWith('.json')) {
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

      const activeSpread = stateManager.getActiveSpread();
      const selectedElId = state.selectedElementId;
      const selectedEl = activeSpread.elements.find((el) => el.id === selectedElId);

      if (selectedEl && selectedEl.type === 'text') {
        stateManager.placeTextContent(selectedEl.id, ingested);
      } else {
        const textEl = activeSpread.elements.find((el) => el.type === 'text');
        if (textEl) {
          stateManager.placeTextContent(textEl.id, ingested);
        } else {
          const page = activeSpread.pages[0];
          const margin = state.settings.margins;
          stateManager.addElement({
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
          });
        }
      }
      return;
    }

    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (re) => {
        if (typeof re.target?.result === 'string') {
          const resultStr = re.target.result;
          const format = file.type.split('/')[1]?.toUpperCase() || 'JPG';

          const imgLoader = new Image();
          imgLoader.onload = () => {
            stateManager.registerImageDimensions(
              resultStr,
              imgLoader.naturalWidth,
              imgLoader.naturalHeight,
              file.size,
              format,
              file.name
            );
          };
          imgLoader.src = resultStr;

          const activeSpread = stateManager.getActiveSpread();
          const selectedEl = activeSpread.elements.find((el) => el.id === state.selectedElementId);
          if (selectedEl && selectedEl.type === 'image') {
            stateManager.relinkAsset(selectedEl.id, resultStr, {
              name: file.name,
              fileSize: file.size,
              format,
            });
          } else {
            const page = activeSpread.pages[0];
            stateManager.addElement({
              id: `img-dropped-${Date.now()}`,
              type: 'image',
              pageId: page.id,
              x: 30,
              y: 30,
              width: 80,
              height: 80,
              rotation: 0,
              opacity: 1,
              zIndex: 10,
              locked: false,
              src: resultStr,
              fitMode: 'fill',
              borderColor: '#000',
              borderWidthMm: 0,
              name: file.name,
              fileSize: file.size,
              format,
            });
          }
        }
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div id="app" onDragOver={handleDragOver} onDrop={handleDrop}>
      <TopBar
        state={state}
        onOpenFindChange={() => setShowFindChange(true)}
        onOpenQuickApply={() => setShowQuickApply(true)}
        onOpenImposition={() => setShowImposition(true)}
        onOpenCoverSpine={() => setShowCoverSpine(true)}
        onOpenShortcuts={() => setShowShortcuts(true)}
        onOpenStoryEditor={() => setShowStoryEditor(true)}
        onOpenBarcode={() => setShowBarcodeModal(true)}
        onOpenQr={() => setShowQrModal(true)}
        onOpenScripts={() => setShowScriptsModal(true)}
        onOpenDocumentSetup={() => setInspectorTab('setup')}
      />
      <ControlBar state={state} />

      <div className="workspace">
        <Toolbar state={state} />

        <main className="canvas-viewport" id="canvas-container" ref={containerRef}>
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

      <FindChangeModal
        isOpen={showFindChange}
        onClose={() => setShowFindChange(false)}
      />

      <QuickApply
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
      />

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

      <ShortcutsModal
        isOpen={showShortcuts}
        onClose={() => setShowShortcuts(false)}
      />

      <StoryEditorModal
        isOpen={showStoryEditor}
        onClose={() => setShowStoryEditor(false)}
        state={state}
      />

      <BarcodeModal
        isOpen={showBarcodeModal}
        onClose={() => setShowBarcodeModal(false)}
      />

      <QrCodeModal
        isOpen={showQrModal}
        onClose={() => setShowQrModal(false)}
      />

      <ScriptsModal
        isOpen={showScriptsModal}
        onClose={() => setShowScriptsModal(false)}
      />
    </div>
  );
}
