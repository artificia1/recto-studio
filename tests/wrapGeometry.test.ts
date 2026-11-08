import { describe, expect, it } from 'vitest';
import { availableTextInterval, prepareWrapObstacles } from '../src/engine/wrapGeometry';
import { assetStore } from '../src/engine/assetStore';
import { layoutStory } from '../src/engine/storyLayout';
import { plainStory } from '../src/engine/storyContent';
import type { CanvasElement, ImageElement, TextElement, VectorPathElement } from '../src/types';

const frame: TextElement = { id: 'text', type: 'text', pageId: 'p', x: 0, y: 0, width: 100, height: 100, rotation: 0,
  opacity: 1, locked: false, zIndex: 1, text: '', fontFamily: 'serif', fontSizePt: 10, lineHeight: 1.3, letterSpacingPt: 0,
  color: '#000', alignment: 'left', columns: 1, columnGutterMm: 4, backgroundColor: 'transparent', borderColor: 'transparent', borderWidthMm: 0, paddingMm: 0 };
const shape = (changes: Partial<CanvasElement> = {}): CanvasElement => ({ ...frame, id: 'shape', type: 'shape', shapeKind: 'rectangle', x: 40,
  width: 20, height: 80, fillColor: '#222', strokeColor: '#222', strokeWidthMm: 0, strokeDash: 'solid', textWrap: { mode: 'contour', standoffMm: 0 }, ...changes } as CanvasElement);
const space = (objects: CanvasElement[], top: number, height = 4, text = frame) => availableTextInterval(prepareWrapObstacles(objects, text), text.x, text.width, top, height);

describe('shared runaround geometry', () => {
  it('unions simultaneous obstacles independently of their layer order', () => {
    const a = shape({ x: 20 }), b = shape({ id: 'b', x: 60 });
    expect(space([a, b], 20)).toEqual({ left: 0, width: 20 });
    expect(space([b, a], 20)).toEqual(space([a, b], 20));
  });
  it('uses the complete band of an arbitrary curved path rather than its frame bounds', () => {
    const path = { ...shape(), type: 'path', x: 30, width: 60, height: 80, closed: true,
      nodes: [{ x: 0, y: 80, handleOut: { x: 60, y: -80 } }, { x: 0, y: 0, handleIn: { x: 60, y: 80 } }] } as VectorPathElement;
    const text = { ...frame, width: 120 };
    const curved = space([path], 38, 4, text), bounding = space([{ ...path, textWrap: { mode: 'boundingBox', standoffMm: 0 } }], 38, 4, text);
    expect(curved.width).toBeGreaterThan(bounding.width + 10);
    expect(curved.left).toBeGreaterThan(70); expect(curved.left).toBeLessThan(80);
  });
  it('accounts for object rotation and rotated text-frame coordinates', () => {
    const object = shape({ y: 40, rotation: 90 });
    const text = { ...frame, width: 120 };
    expect(space([object], 40, 4, text).width).toBe(120);
    expect(space([object], 75, 4, text).width).toBeCloseTo(30);
    const rotatedText = { ...frame, rotation: 90 };
    expect(space([shape({ height: 100 })], 5, 4, rotatedText).width).toBeCloseTo(100);
    expect(space([shape({ height: 100 })], 45, 4, rotatedText).width).toBeCloseTo(0);
  });
  it('maps source alpha through cropping, focal points and proportional fitting', () => {
    const image = { ...shape(), type: 'image', x: 0, width: 100, height: 100, src: '', fitMode: 'fill', originalWidth: 200, originalHeight: 100,
      alphaContour: Array.from({ length: 4 }, () => ({ minX: 0, maxX: 0.25 })) } as ImageElement;
    expect(space([image], 20).width).toBe(100);
    expect(space([{ ...image, focalPoint: { x: 0, y: 0.5 } }], 20)).toEqual({ left: 50, width: 50 });
    const fitted = { ...image, fitMode: 'fit' as const, alphaContour: [{ minX: 0, maxX: 1 }] };
    expect(space([fitted], 5).width).toBe(100);
    expect(space([fitted], 40).width).toBe(0);
  });
  it('traces every row and the full rightmost pixel, including short images', () => {
    const pixels = new Uint8Array(4 * 5 * 4); pixels[(4 * 4 + 3) * 4 + 3] = 255;
    const outline = assetStore.computeAlphaContour(pixels, 4, 5, 2);
    expect(outline[0]).toEqual({ minX: 1, maxX: 0 });
    expect(outline[1]).toEqual({ minX: 0.75, maxX: 1 });
    expect(assetStore.computeAlphaContour(new Uint8Array([1, 2, 3, 255]), 1, 1, 32)).toEqual([{ minX: 0, maxX: 1 }]);
  });
  it('keeps composed text outside a triangle without modifying the manuscript', () => {
    const triangle = { ...shape(), type: 'path', width: 40, height: 80, closed: true,
      nodes: [{ x: 0, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 80 }] } as VectorPathElement;
    const content = plainStory('alpha beta gamma delta '.repeat(30)), before = JSON.stringify(content);
    const layout = layoutStory(content, frame, [], [], value => value.length, 0, { obstacles: [triangle] });
    expect(layout.lines.length).toBeGreaterThan(4);
    for (const line of layout.lines) if (line.y < 80) {
      const rightmost = 40 + Math.min(40, line.y + line.height, 80 - line.y) * 1;
      const start = line.segments[0]?.x || 0, end = Math.max(...line.segments.map(segment => segment.x + segment.width));
      expect(end <= 40.01 || start >= rightmost - 0.1).toBe(true);
    }
    expect(JSON.stringify(content)).toBe(before);
  });
});
