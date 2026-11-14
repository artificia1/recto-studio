import type { ProjectState } from '../../types';

type MousePosition = Pick<MouseEvent, 'clientX' | 'clientY'>;
type Viewport = Pick<ProjectState, 'zoom' | 'panX' | 'panY'>;
export type CanvasMouseDown = MousePosition & Pick<MouseEvent, 'button' | 'shiftKey' | 'metaKey' | 'ctrlKey'>;
export type CanvasMouseMove = MousePosition & Pick<MouseEvent, 'altKey' | 'buttons'>;
export type CanvasMouseUp = MousePosition & Pick<MouseEvent, 'shiftKey'>;

interface CanvasInputHandlers {
  mouseDown(event: CanvasMouseDown): void;
  mouseMove(event: CanvasMouseMove): void;
  mouseUp(event: CanvasMouseUp): void;
  doubleClick(event: MouseEvent): void;
  wheel(event: WheelEvent): void;
  pointerDown(event: PointerEvent): void;
  pointerMove(event: PointerEvent): void;
  pointerUp(event: PointerEvent): void;
  pointerCancel(event: PointerEvent): void;
  drop(event: DragEvent): void;
  keyDown(event: KeyboardEvent): void;
  keyUp(event: KeyboardEvent): void;
  penIsDown(): boolean;
  touchPointer(): void;
  startPinch(): void;
  stopPinch(): void;
  getViewport(): Viewport;
  setViewport(zoom: number, panX: number, panY: number): void;
}

function touchCenter(a: Touch, b: Touch) {
  return { clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2,
    distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) };
}

export function bindCanvasInput(canvas: HTMLCanvasElement, handlers: CanvasInputHandlers): () => void {
  const lifetime = new AbortController();
  const options = { signal: lifetime.signal };
  const active = { ...options, passive: false };
  canvas.style.touchAction = 'none';
  canvas.addEventListener('mousedown', handlers.mouseDown, options);
  window.addEventListener('mousemove', handlers.mouseMove, options);
  window.addEventListener('mouseup', handlers.mouseUp, options);
  canvas.addEventListener('dblclick', handlers.doubleClick, options);
  canvas.addEventListener('wheel', handlers.wheel, active);
  canvas.addEventListener('pointerdown', handlers.pointerDown, options);
  window.addEventListener('pointermove', handlers.pointerMove, options);
  window.addEventListener('pointerup', handlers.pointerUp, options);
  window.addEventListener('pointercancel', handlers.pointerCancel, options);
  canvas.addEventListener('dragover', event => event.preventDefault(), options);
  canvas.addEventListener('drop', handlers.drop, options);
  window.addEventListener('keydown', handlers.keyDown, options);
  window.addEventListener('keyup', handlers.keyUp, options);

  let gesture = false;
  let pinch: (Viewport & ReturnType<typeof touchCenter>) | undefined;
  let lastTouch: MousePosition = { clientX: 0, clientY: 0 };
  function blockTouch(event: TouchEvent) {
    if (event.cancelable) event.preventDefault();
  }
  canvas.addEventListener('touchstart', event => {
    if (handlers.penIsDown()) { blockTouch(event); return; }
    const [first, second] = Array.from(event.touches);
    if (!first) return;
    gesture = true;
    handlers.touchPointer();
    if (event.touches.length === 1) {
      blockTouch(event);
      lastTouch = first;
      handlers.mouseDown({ clientX: first.clientX, clientY: first.clientY, button: 0,
        shiftKey: false, metaKey: false, ctrlKey: false });
    } else if (event.touches.length === 2) {
      blockTouch(event);
      handlers.startPinch();
      pinch = { ...handlers.getViewport(), ...touchCenter(first, second) };
      lastTouch = pinch;
    }
  }, active);
  window.addEventListener('touchmove', event => {
    if (!gesture) return;
    if (handlers.penIsDown()) { blockTouch(event); return; }
    handlers.touchPointer();
    if (event.touches.length === 1) {
      if (pinch) handlers.stopPinch();
      pinch = undefined;
      lastTouch = event.touches[0];
      handlers.mouseMove({ clientX: lastTouch.clientX, clientY: lastTouch.clientY, altKey: false, buttons: 1 });
    } else if (event.touches.length === 2 && pinch) {
      blockTouch(event);
      const center = touchCenter(event.touches[0], event.touches[1]);
      lastTouch = center;
      if (pinch.distance <= 5) return;
      const zoom = Math.max(0.2, Math.min(3, pinch.zoom * center.distance / pinch.distance));
      const rect = canvas.getBoundingClientRect();
      const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      const ratio = zoom / pinch.zoom;
      handlers.setViewport(zoom, center.clientX - x - (pinch.clientX - x - pinch.panX) * ratio,
        center.clientY - y - (pinch.clientY - y - pinch.panY) * ratio);
    }
  }, active);
  function endTouch(event: TouchEvent) {
    if (!gesture) return;
    gesture = event.type !== 'touchcancel' && event.touches.length > 0;
    if (handlers.penIsDown()) return;
    if (event.touches.length <= 1 || !gesture) {
      handlers.stopPinch();
      pinch = undefined;
    }
    const point = event.changedTouches[0] || event.touches[0] || lastTouch;
    handlers.mouseUp({ clientX: point.clientX, clientY: point.clientY, shiftKey: false });
  }
  window.addEventListener('touchend', endTouch, options);
  window.addEventListener('touchcancel', endTouch, options);
  return () => lifetime.abort();
}
