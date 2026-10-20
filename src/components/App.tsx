import { useState, useEffect, useRef } from 'preact/hooks';
import { useProjectState } from '../hooks/useProjectState';
import { TopBar } from './TopBar';
import { ControlBar } from './ControlBar';
import { Toolbar } from './Toolbar';
import { InspectorPanel } from './Inspector/InspectorPanel';
import { StatusBar } from './StatusBar';
import { FindChangeModal } from './FindChangeModal';
import { QuickApply } from './QuickApply';
import { BookletImpositionModal } from './BookletImpositionModal';
import { CoverSpineModal } from './CoverSpineModal';
import { SpreadCanvas } from '../canvas';
import { stateManager } from '../state';
import { ingestManuscript } from '../contentImport';

export function App() {
  const state = useProjectState();
  const [showFindChange, setShowFindChange] = useState(false);
  const [showQuickApply, setShowQuickApply] = useState(false);
  const [showImposition, setShowImposition] = useState(false);
  const [showCoverSpine, setShowCoverSpine] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rulerTopRef = useRef<HTMLCanvasElement>(null);
  const rulerLeftRef = useRef<HTMLCanvasElement>(null);
  const spreadCanvasRef = useRef<SpreadCanvas | null>(null);

  useEffect(() => {
    const handleGlobalShortcuts = (e: KeyboardEvent) => {
      const isMod = e.ctrlKey || e.metaKey;
      if (isMod && e.shiftKey && (e.key === 'i' || e.key === 'I')) {
        e.preventDefault();
        setShowImposition((prev) => !prev);
      } else if (isMod && e.shiftKey && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        setShowCoverSpine((prev) => !prev);
      } else if (isMod && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        setShowFindChange((prev) => !prev);
      } else if (isMod && (e.key === '/' || e.key === 'Enter')) {
        e.preventDefault();
        setShowQuickApply((prev) => !prev);
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
  }, []);

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const name = file.name.toLowerCase();

    if (name.endsWith('.idml')) {
      const buffer = await file.arrayBuffer();
      await stateManager.loadFromIdml(buffer);
      return;
    }

    if (name.endsWith('.recto') || name.endsWith('.papercut') || name.endsWith('.json')) {
      const text = await file.text();
      stateManager.loadFromJson(text);
      return;
    }

    if (name.endsWith('.md') || name.endsWith('.markdown') || name.endsWith('.txt') || name.endsWith('.docx')) {
      const buffer = await file.arrayBuffer();
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

        <InspectorPanel state={state} />
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
    </div>
  );
}
