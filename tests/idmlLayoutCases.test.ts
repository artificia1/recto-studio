import { describe, expect, it } from 'vitest';
import { parseIdmlPackage } from '../src/idmlImport';
import type { TextElement } from '../src/types';
import { LAYOUT_CASES, inDesignLayoutCases } from './fixtures/inDesignLayoutCases';

describe('InDesign layout case fixture', () => {
  it('imports as one page and one text frame per case', async () => {
    const project = await parseIdmlPackage(inDesignLayoutCases(), 'layout-cases.idml');
    const frames = project.spreads.flatMap(spread => spread.elements).filter((element): element is TextElement => element.type === 'text');
    for (const layoutCase of Object.values(LAYOUT_CASES)) {
      expect(frames.map(frame => frame.id), layoutCase.title).toContain(layoutCase.frameId);
    }
    const byId = (id: string) => frames.find(frame => frame.id === id)!;
    expect(byId('idml-tabs').text).toBe('Редакторская группа:\tИмя Фамилия\n\tИмя Фамилия\n\tИмя Фамилия');
    expect(byId('idml-contents').text).toContain('Название рассказа\t5');
    // Caps are a style property: the story keeps the text as typed.
    expect(byId('idml-caps').text).toBe('Название рассказа\nНазвание книги');
    expect(byId('idml-first-line')).toMatchObject({ x: 20, y: 27, width: 120, height: 166, paddingMm: 0 });
  });

  // What InDesign does with each case; see LAYOUT_CASES for the numbers, measured from its PDF where noted.
  for (const layoutCase of Object.values(LAYOUT_CASES)) it.todo(`lays out ${layoutCase.title}`);
});
