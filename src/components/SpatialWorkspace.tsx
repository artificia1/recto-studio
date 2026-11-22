import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { memo } from 'preact/compat';
import type { CanvasElement, ProjectState } from '../types';
import { stateManager } from '../state';
import { spreadGrid, visibleSpreadCells, workspaceDrop } from '../engine/spatialWorkspace';
import { instantiateMasterItem, resolveMaster } from '../engine/masterInheritance';
import { masterTargetPage } from '../engine/pageLabels';
import { bezierNodesToSvgPath } from '../engine/vectorPath';
import { useModalFocus } from '../hooks/useModalFocus';
import { calculateImageFitting } from '../engine/imageFitting';

const WorkspacePreview = memo(function WorkspacePreview({ element, compact }: { element: CanvasElement; compact: boolean }) {
  if (element.type === 'text') {
    if (!element.text) return null;
    const padding = Math.max(0, element.paddingMm ?? 2);
    const width = element.width - 2 * padding;
    const height = element.height - 2 * padding;
    if (width <= 0 || height <= 0) return null;
    const leading = Math.max(2, element.fontSizePt * 25.4 / 72 * element.lineHeight);
    const charactersPerLine = Math.max(1, width / Math.max(1, element.fontSizePt * 0.17));
    const lines = Math.min(compact ? 6 : 24, Math.floor(height / leading), Math.ceil(element.text.length / charactersPerLine));
    const step = compact ? Math.min(height / Math.max(1, lines), leading * 3) : leading;
    const path = Array.from({ length: lines }, (_, index) => {
      const remaining = element.text.length - index * charactersPerLine;
      const length = Math.min(1, remaining / charactersPerLine) * width * (index % 5 === 4 ? 0.72 : 0.95);
      return `M${padding} ${padding + (index + 0.7) * step}h${length}`;
    }).join(' ');
    return <path data-text-preview="" d={path} fill="none" stroke={element.color} opacity={0.5}
      stroke-width={Math.max(0.45, leading * 0.24)}/>;
  }
  if (element.type === 'image') {
    if (compact && !element.proxySrc &&
      (element.src.length > 256 * 1024 || (element.originalWidth ?? 0) * (element.originalHeight ?? 0) > 2_000_000)) {
      return <rect width={element.width} height={element.height} fill="#d4dce3" stroke="#7c8995" stroke-width={0.5}/>;
    }
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
});


type SpreadCell = ReturnType<typeof spreadGrid>['cells'][number];

interface WorkspaceObject {
  element: CanvasElement;
  x: number;
  y: number;
}

interface WorkspaceDrag {
  id: string;
  ids: Set<string>;
  cellIndex: number;
  objects: WorkspaceObject[];
}

interface DragGesture {
  preview: WorkspaceDrag;
  pointerId: number;
  clientX: number;
  clientY: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  grabX: number;
  grabY: number;
  scrollX: number;
  scrollY: number;
  bounds: DOMRect;
  revision: number;
}

const noSelection: readonly string[] = [];

function objectTransform({ element, x, y }: WorkspaceObject) {
  return 'translate(' + x + ' ' + y + ') rotate(' + element.rotation + ' ' + element.width / 2 + ' ' + element.height / 2 + ')';
}

function drawOrder(layers: ProjectState['layers'], a: CanvasElement, b: CanvasElement) {
  return (layers.find(layer => layer.id === a.layerId)?.order || 0) -
    (layers.find(layer => layer.id === b.layerId)?.order || 0) || a.zIndex - b.zIndex;
}

const WorkspaceCell = memo(function WorkspaceCell({ cell, width, height, compact, layers, masters, revision,
  active, selected, hidden, onStart, onOpen }: {
  cell: SpreadCell;
  width: number;
  height: number;
  compact: boolean;
  layers: ProjectState['layers'];
  masters: ProjectState['masterSpreads'];
  revision: number;
  active: boolean;
  selected: readonly string[];
  hidden?: Set<string>;
  onStart: (event: PointerEvent, cell: SpreadCell, object: WorkspaceObject) => void;
  onOpen: (index: number) => void;
}) {
  const objects = useMemo(() => {
    const master = resolveMaster(masters, cell.spread.masterSpreadId);
    const inherited = (master?.elements || []).flatMap(element => {
      if (cell.spread.detachedMasterElementIds?.includes(element.id) ||
        cell.spread.elements.some(local => local.masterSourceId === element.id)) return [];
      const page = masterTargetPage(master!.pages, cell.spread.pages, element.pageId);
      return page ? [instantiateMasterItem(element, page.id, text => text)] : [];
    });
    const order = (a: CanvasElement, b: CanvasElement) => drawOrder(layers, a, b);
    return [...inherited.sort(order).map(element => ({ element, local: false })),
      ...[...cell.spread.elements].sort(order).map(element => ({ element, local: true }))]
      .filter(({ element }) => layers.find(layer => layer.id === element.layerId)?.visible !== false)
      .map(({ element, local }) => ({
        element, local,
        x: Math.max(0, cell.spread.pages.findIndex(page => page.id === element.pageId)) * width + element.x,
        y: element.y,
      }));
  }, [cell, width, layers, masters, revision]);

  return <g transform={'translate(' + cell.x + ' ' + cell.y + ')'}>
    <rect x={-30} y={-30} width={cell.width + 60} height={cell.height + 60} fill="var(--bg-hover)"
      stroke={active ? 'var(--accent-cyan)' : 'var(--border-light)'} stroke-width={1}/>
    <text x={0} y={-12} fill="currentColor" font-size={6}>Spread {cell.index + 1}</text>
    {cell.spread.pages.map((page, index) => <rect key={page.id} data-workspace-page={page.id}
      x={index * width} width={width} height={height} fill="white" stroke="#999" stroke-width={0.5}
      onDblClick={() => onOpen(cell.index)}/>)}
    {objects.map(object => {
      const { element, local } = object;
      return <g key={element.id} data-workspace-object={element.id} transform={objectTransform(object)}
        visibility={hidden?.has(element.id) ? 'hidden' : undefined} opacity={element.opacity}
        style={{ cursor: local ? 'move' : 'default', mixBlendMode: element.blendMode || 'normal' }}
        onPointerDown={local ? event => onStart(event, cell, object) : undefined}>
        <rect width={element.width} height={element.height} fill="transparent"
          stroke={selected.includes(element.id) ? 'var(--accent-cyan)' : 'none'} stroke-width={0.5}/>
        <g pointer-events="none"><WorkspacePreview element={element} compact={compact}/></g>
      </g>;
    })}
  </g>;
});

function edgeSpeed(value: number, low: number, high: number) {
  if (value < low + 48) return -Math.min(18, (low + 48 - value) / 3);
  if (value > high - 48) return Math.min(18, (value - high + 48) / 3);
  return 0;
}

export default function SpatialWorkspace({ state, onClose }: { state: ProjectState; onClose: () => void }) {
  const [zoom, setZoom] = useState(0.15), [columns, setColumns] = useState(4), [message, setMessage] = useState('');
  const [viewport, setViewport] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [preview, setPreview] = useState<WorkspaceDrag | null>(null);
  const root = useRef<HTMLDivElement>(null), scroll = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null);
  const overlay = useRef<SVGGElement>(null);
  const drag = useRef<DragGesture | null>(null);
  const dragFrame = useRef(0), scrollFrame = useRef(0);
  useModalFocus(true, root);

  const scale = zoom * 96 / 25.4;
  const compact = zoom <= 0.1;
  const revision = stateManager.getDocumentRevision();
  const grid = useMemo(() => spreadGrid(state, columns), [revision, columns]);
  const overscan = compact ? 64 : 120;
  const cells = useMemo(() => visibleSpreadCells(grid, {
    x: (viewport.x - overscan) / scale,
    y: (viewport.y - overscan) / scale,
    width: (viewport.width + 2 * overscan) / scale,
    height: (viewport.height + 2 * overscan) / scale,
  }), [grid, viewport, scale, overscan]);

  const updateViewport = useCallback(() => {
    const box = scroll.current;
    if (!box) return;
    const { clientWidth: width, clientHeight: height } = box;
    // The overscan covers the viewport between buckets without another grid render.
    const bucket = 48;
    const x = Math.floor(box.scrollLeft / bucket) * bucket;
    const y = Math.floor(box.scrollTop / bucket) * bucket;
    setViewport(previous => previous.x === x && previous.y === y && previous.width === width && previous.height === height
      ? previous : { x, y, width, height });
  }, []);

  const offset = (current: DragGesture, host: HTMLDivElement) => ({
    x: (current.clientX - current.startX + host.scrollLeft - current.scrollX) / scale,
    y: (current.clientY - current.startY + host.scrollTop - current.scrollY) / scale,
  });

  const scheduleDrag = () => {
    if (dragFrame.current || !drag.current) return;
    dragFrame.current = requestAnimationFrame(() => {
      dragFrame.current = 0;
      const current = drag.current, host = scroll.current;
      if (!current || !host) return;
      const { bounds, clientX, clientY } = current;
      const sx = edgeSpeed(clientX, bounds.left, bounds.right), sy = edgeSpeed(clientY, bounds.top, bounds.bottom);
      const previousX = host.scrollLeft, previousY = host.scrollTop;
      if (sx || sy) host.scrollBy(sx, sy);
      const { x, y } = offset(current, host);
      overlay.current?.setAttribute('transform', 'translate(' + x + ' ' + y + ')');
      if (host.scrollLeft !== previousX || host.scrollTop !== previousY) scheduleDrag();
    });
  };

  const onScroll = () => {
    if (!scrollFrame.current) scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = 0;
      updateViewport();
    });
    scheduleDrag();
  };

  const clearDrag = useCallback(() => {
    const current = drag.current;
    drag.current = null;
    cancelAnimationFrame(dragFrame.current);
    dragFrame.current = 0;
    overlay.current?.removeAttribute('transform');
    if (current && svg.current?.hasPointerCapture(current.pointerId)) svg.current.releasePointerCapture(current.pointerId);
    setPreview(null);
  }, []);

  useEffect(() => {
    const observer = new ResizeObserver(updateViewport);
    if (scroll.current) observer.observe(scroll.current);
    updateViewport();
    window.addEventListener('blur', clearDrag);
    return () => {
      observer.disconnect();
      window.removeEventListener('blur', clearDrag);
      cancelAnimationFrame(dragFrame.current);
      cancelAnimationFrame(scrollFrame.current);
    };
  }, [updateViewport, clearDrag]);

  const startDrag = useCallback((event: PointerEvent, cell: SpreadCell, object: WorkspaceObject) => {
    const host = scroll.current, surface = svg.current;
    if (event.button !== 0 || drag.current || !host || !surface) return;
    const matrix = surface.getScreenCTM();
    if (!matrix) return;
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const { element, x, y } = object;
    const currentState = stateManager.getState();
    const layers = currentState.layers;
    const members = element.groupId ? cell.spread.elements.filter(item => item.groupId === element.groupId) : [element];
    const ids = new Set(members.map(item => item.id));
    const objects = members.filter(item => layers.find(layer => layer.id === item.layerId)?.visible !== false)
      .sort((a, b) => drawOrder(layers, a, b))
      .map(item => ({
        element: item,
        x: cell.x + Math.max(0, cell.spread.pages.findIndex(page => page.id === item.pageId)) * currentState.settings.widthMm + item.x,
        y: cell.y + item.y,
      }));
    const next = { id: element.id, ids, cellIndex: cell.index, objects };
    event.preventDefault();
    surface.setPointerCapture(event.pointerId);
    drag.current = {
      preview: next, pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY,
      startX: event.clientX, startY: event.clientY, x: p.x, y: p.y,
      grabX: p.x - cell.x - x, grabY: p.y - cell.y - y,
      scrollX: host.scrollLeft, scrollY: host.scrollTop, bounds: host.getBoundingClientRect(),
      revision: stateManager.getDocumentRevision(),
    };
    setPreview(next);
  }, []);

  const movePointer = (event: PointerEvent) => {
    const current = drag.current;
    if (current?.pointerId !== event.pointerId) return;
    current.clientX = event.clientX;
    current.clientY = event.clientY;
    scheduleDrag();
  };

  const endDrag = (event: PointerEvent) => {
    const current = drag.current, host = scroll.current;
    if (!current || current.pointerId !== event.pointerId || !host) return;
    current.clientX = event.clientX;
    current.clientY = event.clientY;
    const delta = offset(current, host);
    const { preview: item } = current;
    clearDrag();
    if (current.revision !== stateManager.getDocumentRevision()) {
      setMessage('The document changed during the drag. Try again with the updated spread.');
      return;
    }
    if (Math.hypot(delta.x, delta.y) * scale <= 3) {
      if (item.cellIndex !== stateManager.getState().activeSpreadIndex) stateManager.setActiveSpread(item.cellIndex);
      stateManager.selectElement(item.id);
      return;
    }
    const drop = workspaceDrop(stateManager.getState(), columns, current.x + delta.x, current.y + delta.y);
    try {
      if (!drop) throw new Error('Drop onto a page or its adjacent pasteboard.');
      stateManager.moveArtwork([item.id], drop.pageId, drop.x - current.grabX, drop.y - current.grabY, drop.pasteboard);
      setMessage(drop.pasteboard ? 'Artwork stored on pasteboard.' : 'Artwork moved to target page.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const cancelPointer = (event: PointerEvent) => {
    if (drag.current?.pointerId === event.pointerId) clearDrag();
  };
  const close = useCallback(() => { clearDrag(); onClose(); }, [clearDrag, onClose]);
  const openSpread = useCallback((index: number) => {
    stateManager.setActiveSpread(index);
    stateManager.setPan(0, 0);
    close();
  }, [close]);
  const selectedIndex = preview?.cellIndex ?? state.activeSpreadIndex;
  const selected = useMemo(() => preview ? [...preview.ids] : state.selectedElementIds, [preview, state.selectedElementIds]);

  return <div className="spatial-workspace" role="dialog" aria-modal="true" aria-label="Multi-spread workspace" ref={root}
    onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') drag.current ? clearDrag() : close(); }}>
    <div className="spatial-controls"><strong>Multi-spread workspace</strong>
      <label>Zoom<select aria-label="Workspace zoom" value={zoom} onChange={event => { clearDrag(); setZoom(Number(event.currentTarget.value)); }}>
        {[0.05, 0.1, 0.15, 0.25, 0.5, 1].map(value => <option key={value} value={value}>{Math.round(value * 100)}%</option>)}
      </select></label>
      <label>Columns<select aria-label="Workspace columns" value={columns} onChange={event => { clearDrag(); setColumns(Number(event.currentTarget.value)); }}>
        {[1, 2, 3, 4, 6, 8].map(value => <option key={value} value={value}>{value}</option>)}
      </select></label>
      <button type="button" className="sm-btn" onClick={close}>Return to spread editor</button>
    </div>
    <p>Drag artwork across pages or onto the pasteboard. Pasteboard items are saved but excluded from publication output. Double-click a page to edit it. Text appears as line previews.</p>
    <p role="status" hidden={!message}>{message}</p>
    <div className="spatial-scroll" ref={scroll} onScroll={onScroll}>
      <svg ref={svg} width={grid.width * scale} height={grid.height * scale} viewBox={'0 0 ' + grid.width + ' ' + grid.height}
        onPointerMove={movePointer} onPointerUp={endDrag} onPointerCancel={cancelPointer} onLostPointerCapture={cancelPointer}>
        {cells.map(cell => <WorkspaceCell key={cell.spread.id} cell={cell} width={state.settings.widthMm}
          height={state.settings.heightMm} compact={compact} layers={state.layers} masters={state.masterSpreads}
          revision={revision} active={cell.index === selectedIndex} selected={cell.index === selectedIndex ? selected : noSelection}
          hidden={cell.index === preview?.cellIndex ? preview.ids : undefined} onStart={startDrag} onOpen={openSpread}/>)}
        <g ref={overlay} data-workspace-drag-layer="" pointer-events="none" aria-hidden="true">
          {preview?.objects.map(object => <g key={object.element.id} data-workspace-drag-object={object.element.id}
            transform={objectTransform(object)}>
            <WorkspacePreview element={object.element} compact={compact}/>
            <rect width={object.element.width} height={object.element.height} fill="none" stroke="var(--accent-cyan)"
              vector-effect="non-scaling-stroke" stroke-width={1}/>
          </g>)}
        </g>
      </svg>
    </div>
  </div>;
}
