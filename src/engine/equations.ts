import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import 'mathjax-full/js/input/tex/ams/AmsConfiguration.js';
import type { EquationSource } from '../types';
import { uint8ArrayToBase64 } from '../zip';

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

export const EQUATION_TEMPLATES = [
  { name: 'Quadratic formula', latex: String.raw`x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}` },
  { name: 'Integral', latex: String.raw`\int_a^b f(x)\,dx = F(b) - F(a)` },
  { name: 'Summation', latex: String.raw`\sum_{k=1}^{n} k = \frac{n(n+1)}{2}` },
  { name: 'Matrix', latex: String.raw`A = \begin{pmatrix} a & b \\ c & d \end{pmatrix}` },
  { name: 'Aligned equations', latex: String.raw`\begin{aligned} y &= mx + c \\ E &= mc^2 \end{aligned}` },
  { name: 'Piecewise function', latex: String.raw`f(x) = \begin{cases} x^2 & x \ge 0 \\ -x & x < 0 \end{cases}` },
] as const;

export interface RenderedEquation { svg: string; dataUrl: string; widthMm: number; heightMm: number }

/** Only bundled math packages: no HTML, URLs, file access, or runtime package loading. */
export function renderEquation(source: EquationSource): RenderedEquation {
  let latex = source.latex.trim();
  if (!latex || latex.length > 6000) throw new Error('Enter an equation of 1–6,000 characters.');
  if (!Number.isFinite(source.fontSizePt) || source.fontSizePt < 6 || source.fontSizePt > 144) {
    throw new Error('Choose a type size between 6 and 144 pt.');
  }
  if (!/^#[\da-f]{6}$/i.test(source.color)) throw new Error('Choose a valid equation colour.');
  // Accept familiar pasted math delimiters without treating document LaTeX as executable input.
  for (const [start, end] of [['$$', '$$'], ['\\[', '\\]'], ['\\(', '\\)'], ['$', '$']]) {
    if (latex.startsWith(start) && latex.endsWith(end) && latex.length > start.length + end.length) {
      latex = latex.slice(start.length, -end.length).trim();
      break;
    }
  }
  const tex = new TeX({
    packages: ['base', 'ams'], maxBuffer: 10000, maxMacros: 1000,
    formatError: (_jax: unknown, error: Error) => { throw new Error(error.message); },
  });
  const document = mathjax.document('', { InputJax: tex, OutputJax: new SVG({ fontCache: 'none' }) });
  const node = document.convert(latex, { display: source.displayMode });
  const svg = adaptor.tags(node, 'svg')[0];
  if (!svg) throw new Error('Could not typeset this equation.');
  const viewBox = (adaptor.getAttribute(svg, 'viewBox') || '').split(/\s+/).map(Number);
  if (viewBox.length !== 4 || !viewBox.every(Number.isFinite) || viewBox[2] <= 0 || viewBox[3] <= 0) {
    throw new Error('This equation has no visible mathematical content.');
  }
  const unitMm = source.fontSizePt * 25.4 / 72 / 1000;
  const widthMm = viewBox[2] * unitMm, heightMm = viewBox[3] * unitMm;
  if (widthMm > 2000 || heightMm > 2000) throw new Error('This equation is too large. Reduce its size or split it into smaller equations.');
  adaptor.setAttribute(svg, 'width', `${widthMm * 96 / 25.4}px`);
  adaptor.setAttribute(svg, 'height', `${heightMm * 96 / 25.4}px`);
  adaptor.removeAttribute(svg, 'style');
  const markup = adaptor.outerHTML(svg).replace(/currentColor/g, source.color);
  return { svg: markup, dataUrl: `data:image/svg+xml;base64,${uint8ArrayToBase64(new TextEncoder().encode(markup))}`, widthMm, heightMm };
}
