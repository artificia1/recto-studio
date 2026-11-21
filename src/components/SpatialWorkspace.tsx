import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { memo } from 'preact/compat';
import type { CanvasElement, ProjectState } from '../types';
import { stateManager } from '../state';
import { spreadGrid, visibleSpreadCells, workspaceDrop } from '../engine/spatialWorkspace';
import { instantiateMasterItem, resolveMaster } from '../engine/masterInheritance';
import { publicationText } from '../engine/publicationReferences';
import { masterTargetPage } from '../engine/pageLabels';
import { canvasRunFont, layoutStory } from '../engine/storyLayout';
import { fontManager } from '../fontManager';
import { layoutKernels } from '../engine/layoutRuntime';
import { plainStory } from '../engine/storyContent';
import { bezierNodesToSvgPath } from '../engine/vectorPath';
import { useModalFocus } from '../hooks/useModalFocus';
import { calculateImageFitting } from '../canvas';

interface PreviewProps {
  element: CanvasElement;
  state: ProjectState;
  revision: number;
  fontGeneration: number;
  kernels: typeof layoutKernels;
  scale: number;
}

const WorkspacePreview = memo(function WorkspacePreview({ element, state, scale, revision, fontGeneration, kernels }: PreviewProps) {
  const bitmap = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    if (element.type !== 'text' || !bitmap.current) return;
    const layout = layoutStory(element.textContent || plainStory(element.text, element.paragraphStyleId),
      element, state.paragraphStyles, state.characterStyles || []);
    const pixelsPerMm = Math.min(Math.max(0.6, Math.min(2, scale)), 1024 / Math.max(element.width, element.height));
    bitmap.current.width = Math.max(1, Math.ceil(element.width * pixelsPerMm));
    bitmap.current.height = Math.max(1, Math.ceil(element.height * pixelsPerMm));
    const context = bitmap.current.getContext('2d')!;
    for (const line of layout.lines) for (const segment of line.segments) {
      context.font = canvasRunFont(segment.style, pixelsPerMm);
      context.fillStyle = segment.style.color;
      context.letterSpacing = `${segment.style.letterSpacingPt * 25.4 / 72 * pixelsPerMm}px`;
      const x = segment.x * pixelsPerMm;
      const y = (line.y + segment.style.fontSizePt * 25.4 / 72) * pixelsPerMm;
      context.fillText(segment.text, x, y);
      if (segment.style.underline) context.fillRect(x, y + 1, segment.width * pixelsPerMm, 0.6);
    }
  }, [element, state, scale, revision, fontGeneration, kernels]);
  if (element.type === 'text') {
    return <foreignObject width={element.width} height={element.height}>
      <canvas ref={bitmap} aria-label="Text frame preview" style={{ width: '100%', height: '100%', display: 'block' }}/>
    </foreignObject>;
  }
  if (element.type === 'image') {
    const fit = calculateImageFitting(0, 0, element.width, element.height, element.originalWidth || element.width,
      element.originalHeight || element.height, element.fitMode, element.focalPoint);
    return <svg width={element.width} height={element.height} overflow="hidden"><image href={element.proxySrc || element.src}
      x={fit.drawX} y={fit.drawY} width={fit.drawW} height={fit.drawH} preserveAspectRatio="none"/></svg>;
  }
  if (element.type === 'shape') return element.shapeKind === 'line'
    ? <line x1={0} y1={0} x2={element.width} y2={element.height} stroke={element.strokeColor} stroke-width={element.strokeWidthMm}/>
    : element.shapeKind === 'ellipse'
      ? <ellipse cx={element.width / 2} cy={element.height / 2} rx={element.width / 2} ry={element.height / 2} fill={element.fillColor} stroke={element.strokeColor} stroke-width={element.strokeWidthMm}/>
      : <rect width={element.width} height={element.height} fill={element.fillColor} stroke={element.strokeColor} stroke-width={element.strokeWidthMm}/>;
  if (element.type === 'path') return <path d={bezierNodesToSvgPath(element.nodes, element.closed)} fill={element.fillColor}
    stroke={element.strokeColor} stroke-width={element.strokeWidthMm}/>;
  return <><rect width={element.width} height={element.height} fill="#eee" stroke="#777" stroke-width={0.3}/>
    <text x={2} y={5} font-size={3}>Table {element.rows} × {element.cols}</text></>;
}, (before, after) => before.element === after.element && before.revision === after.revision &&
  before.fontGeneration === after.fontGeneration && before.kernels === after.kernels && before.scale === after.scale);

export default function SpatialWorkspace({ state, onClose }: { state: ProjectState; onClose: () => void }) {
  const [zoom, setZoom] = useState(0.15), [columns, setColumns] = useState(4), [message, setMessage] = useState('');
  const [viewport, setViewport] = useState({ x: 0, y: 0, width: 1500, height: 1000 });
  const [drag, setDrag] = useState<{ id: string; ids: string[]; x: number; y: number; dx: number; dy: number; grabX: number; grabY: number } | null>(null);
  const root = useRef<HTMLDivElement>(null), scroll = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  useModalFocus(true, root);
  const scale = zoom * 96 / 25.4;
  const revision = stateManager.getDocumentRevision();
  const grid = useMemo(() => spreadGrid(state, columns), [revision, columns]);
  const overscan = 200;
  const visibleCells = visibleSpreadCells(grid, {
    x: (viewport.x - overscan) / scale,
    y: (viewport.y - overscan) / scale,
    width: (viewport.width + 2 * overscan) / scale,
    height: (viewport.height + 2 * overscan) / scale,
  });
  const updateViewport = () => { const box = scroll.current; if (box) setViewport({ x: box.scrollLeft, y: box.scrollTop, width: box.clientWidth, height: box.clientHeight }); };
  useEffect(() => { const observer = new ResizeObserver(updateViewport); if (scroll.current) observer.observe(scroll.current); updateViewport(); return () => observer.disconnect(); }, []);
  const point = (event: PointerEvent) => {
    const matrix = svg.current?.getScreenCTM();
    return matrix ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()) : new DOMPoint();
  };
  useEffect(() => {
    if (!drag) return;
    let frame: number;
    const tick = () => {
      const host = scroll.current, cursor = pointer.current;
      if (host && cursor) {
        const box = host.getBoundingClientRect();
        const speed = (value: number, low: number, high: number) => value < low + 48 ? -Math.min(18, (low + 48 - value) / 3) : value > high - 48 ? Math.min(18, (value - high + 48) / 3) : 0;
        const previousX = host.scrollLeft, previousY = host.scrollTop;
        host.scrollBy(speed(cursor.x, box.left, box.right), speed(cursor.y, box.top, box.bottom));
        if (host.scrollLeft !== previousX || host.scrollTop !== previousY) {
          const matrix = svg.current?.getScreenCTM();
          if (matrix) { const p = new DOMPoint(cursor.x, cursor.y).matrixTransform(matrix.inverse()); setDrag(current => current ? { ...current, dx: p.x - current.x, dy: p.y - current.y } : null); }
          updateViewport();
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [drag?.id]);
  return <div className="spatial-workspace" role="dialog" aria-modal="true" aria-label="Multi-spread workspace" ref={root} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') onClose(); }}>
    <div className="spatial-controls"><strong>Multi-spread workspace</strong>
      <label>Zoom<select aria-label="Workspace zoom" value={zoom} onChange={event => setZoom(Number(event.currentTarget.value))}>{[0.05,0.1,0.15,0.25,0.5,1].map(value => <option value={value}>{Math.round(value * 100)}%</option>)}</select></label>
      <label>Columns<select aria-label="Workspace columns" value={columns} onChange={event => setColumns(Number(event.currentTarget.value))}>{[1,2,3,4,6,8].map(value => <option value={value}>{value}</option>)}</select></label>
      <button type="button" className="sm-btn" onClick={onClose}>Return to spread editor</button>
    </div>
    <p>Drag artwork across pages or onto the pasteboard. Pasteboard items are saved but excluded from publication output. Double-click a page to edit it. Layout previews simplify tables, clipping and colour. Use the spread editor and exported proof for final inspection.</p>
    {message && <p role="status">{message}</p>}
    <div className="spatial-scroll" ref={scroll} onScroll={updateViewport}>
      <svg ref={svg} width={grid.width * scale} height={grid.height * scale} viewBox={`0 0 ${grid.width} ${grid.height}`} onPointerMove={event => { pointer.current = { x: event.clientX, y: event.clientY }; if (drag) { const p = point(event); setDrag({ ...drag, dx: p.x - drag.x, dy: p.y - drag.y }); } }}
        onPointerCancel={() => setDrag(null)} onPointerUp={event => {
          if (!drag) return;
          const p = point(event), drop = workspaceDrop(stateManager.getState(), columns, p.x, p.y);
          if (Math.hypot(drag.dx, drag.dy) * scale > 3) {
            try { if (!drop) throw new Error('Drop onto a page or its adjacent pasteboard.'); stateManager.moveArtwork(drag.ids, drop.pageId, drop.x - drag.grabX, drop.y - drag.grabY, drop.pasteboard); setMessage(drop.pasteboard ? 'Artwork stored on pasteboard.' : 'Artwork moved to target page.'); }
            catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
          }
          setDrag(null);
        }}>
        {visibleCells.map(cell => {
          const master = resolveMaster(state.masterSpreads, cell.spread.masterSpreadId);
          const inherited = (master?.elements || []).filter(element => !cell.spread.detachedMasterElementIds?.includes(element.id) && !cell.spread.elements.some(local => local.masterSourceId === element.id)).flatMap(element => { const page = masterTargetPage(master!.pages, cell.spread.pages, element.pageId); return page ? [instantiateMasterItem(element, page.id, text => publicationText(state, text, page.pageNumber))] : []; });
          const order = (a: CanvasElement, b: CanvasElement) => (state.layers.find(layer => layer.id === a.layerId)?.order || 0) - (state.layers.find(layer => layer.id === b.layerId)?.order || 0) || a.zIndex - b.zIndex;
          const objects = [...inherited.sort(order), ...[...cell.spread.elements].sort(order)].filter(element => state.layers.find(layer => layer.id === element.layerId)?.visible !== false);
          return <g key={cell.spread.id} transform={`translate(${cell.x} ${cell.y})`}>
            <rect x={-30} y={-30} width={cell.width + 60} height={cell.height + 60} fill="var(--bg-hover)" stroke={state.activeSpreadIndex === cell.index ? 'var(--accent-cyan)' : 'var(--border-light)'} stroke-width={1}/>
            <text x={0} y={-12} fill="currentColor" font-size={6}>Spread {cell.index + 1}</text>
            {cell.spread.pages.map((page, index) => <rect key={page.id} data-workspace-page={page.id} x={index * state.settings.widthMm} width={state.settings.widthMm} height={state.settings.heightMm} fill="white" stroke="#999" stroke-width={0.5} onDblClick={() => { stateManager.setActiveSpread(cell.index); stateManager.setPan(0, 0); onClose(); }}/>) }
            {objects.map(element => {
              const pageIndex = Math.max(0, cell.spread.pages.findIndex(page => page.id === element.pageId));
              const dx = drag?.ids.includes(element.id) ? drag.dx : 0, dy = drag?.ids.includes(element.id) ? drag.dy : 0;
              return <g key={element.id} data-workspace-object={element.id} transform={`translate(${pageIndex * state.settings.widthMm + element.x + dx} ${element.y + dy}) rotate(${element.rotation} ${element.width / 2} ${element.height / 2})`} opacity={element.opacity} style={{ cursor: 'move', mixBlendMode: element.blendMode || 'normal' }} onPointerDown={event => {
                if (!cell.spread.elements.some(item => item.id === element.id)) return;
                event.preventDefault(); pointer.current = { x: event.clientX, y: event.clientY }; const p = point(event); svg.current?.setPointerCapture(event.pointerId);
                stateManager.setActiveSpread(cell.index); stateManager.selectElement(element.id);
                const ids = [element.id, ...stateManager.getState().selectedElementIds.filter(id => id !== element.id)];
                setDrag({ id: element.id, ids, x: p.x, y: p.y, dx: 0, dy: 0, grabX: p.x - cell.x - pageIndex * state.settings.widthMm - element.x, grabY: p.y - cell.y - element.y });
              }}>
                <rect width={element.width} height={element.height} fill="transparent" stroke={state.selectedElementIds.includes(element.id) ? 'var(--accent-cyan)' : 'none'} stroke-width={0.5}/>
                <g pointer-events="none"><WorkspacePreview element={element} state={state} revision={revision}
                  fontGeneration={fontManager.generation} kernels={layoutKernels} scale={scale}/></g>
              </g>;
            })}
          </g>;
        })}
      </svg>
    </div>
  </div>;
}
