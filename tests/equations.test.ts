import { describe, expect, it } from 'vitest';
import { EQUATION_TEMPLATES, renderEquation } from '../src/engine/equations';
import type { EquationSource } from '../src/types';

const source: EquationSource = { latex: 'E = mc^2', fontSizePt: 18, color: '#123456', displayMode: true };

describe('portable equations', () => {
  it.each(EQUATION_TEMPLATES)('typesets $name as self-contained vector paths', ({ latex }) => {
    const result = renderEquation({ ...source, latex });
    expect(result.widthMm).toBeGreaterThan(0);
    expect(result.heightMm).toBeGreaterThan(0);
    expect(result.svg).toContain('<path');
    expect(result.svg).toContain('#123456');
    expect(result.svg).not.toMatch(/<script|<foreignObject|<image|href=|currentColor/);
    expect(atob(result.dataUrl.split(',')[1])).toContain('<svg');
  });
  it('scales physical dimensions with type size', () => {
    const small = renderEquation(source);
    const large = renderEquation({ ...source, fontSizePt: 36 });
    expect(large.widthMm).toBeCloseTo(small.widthMm * 2);
    expect(large.heightMm).toBeCloseTo(small.heightMm * 2);
  });
  it.each(['$E = mc^2$', '$$E = mc^2$$', String.raw`\[E = mc^2\]`, String.raw`\(E = mc^2\)`])('accepts pasted delimiters %s', latex => {
    expect(renderEquation({ ...source, latex }).svg).toBe(renderEquation(source).svg);
  });
  it.each([String.raw`\frac{a}`, String.raw`\unknown{a}`, String.raw`\href{https://example.com}{x}`,
    String.raw`\require{html}`, String.raw`\includegraphics{file}`, String.raw`\htmlClass{bad}{x}`])('rejects invalid or unsupported commands %s', latex => {
    expect(() => renderEquation({ ...source, latex })).toThrow();
  });
  it('bounds input and rejects invalid geometry and colour', () => {
    for (const patch of [{ latex: '' }, { latex: 'x'.repeat(6001) }, { fontSizePt: NaN }, { fontSizePt: 0 }, { fontSizePt: 145 }, { color: 'red" onload="bad' }]) {
      expect(() => renderEquation({ ...source, ...patch })).toThrow();
    }
  });
  it('keeps errors isolated from the next equation', () => {
    expect(() => renderEquation({ ...source, latex: String.raw`\frac{` })).toThrow();
    expect(renderEquation(source).svg).toContain('<path');
  });
});
