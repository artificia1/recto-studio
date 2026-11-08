import type { BezierNode } from '../types';

/** Handles are offsets from their anchors, including the closing curve. */
export function bezierNodesToSvgPath(nodes: BezierNode[], closed: boolean): string {
  if (!nodes.length) return '';
  let path = `M ${nodes[0].x} ${nodes[0].y}`;
  const curve = (previous: BezierNode, current: BezierNode) => {
    const firstX = previous.x + (previous.handleOut?.x || 0);
    const firstY = previous.y + (previous.handleOut?.y || 0);
    const secondX = current.x + (current.handleIn?.x || 0);
    const secondY = current.y + (current.handleIn?.y || 0);
    return ` C ${firstX.toFixed(2)} ${firstY.toFixed(2)}, ${secondX.toFixed(2)} ${secondY.toFixed(2)}, ${current.x.toFixed(2)} ${current.y.toFixed(2)}`;
  };
  for (let index = 1; index < nodes.length; index++) path += curve(nodes[index - 1], nodes[index]);
  if (closed && nodes.length > 2) path += curve(nodes[nodes.length - 1], nodes[0]) + ' Z';
  return path;
}
