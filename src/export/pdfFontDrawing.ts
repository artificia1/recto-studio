import type { Font, GlyphRun } from 'fontkit';
import type { jsPDF } from 'jspdf';

type FontDrawing = (font: Font, run: GlyphRun, text: string, x: number, y: number, size: number, invisible?: boolean) => boolean;
const writers = new WeakMap<jsPDF, FontDrawing>();

export const bindFontDrawing = (doc: jsPDF, write: FontDrawing) => writers.set(doc, write);
export const drawEmbeddedText = (doc: jsPDF, ...args: Parameters<FontDrawing>) => writers.get(doc)?.(...args) ?? false;
