import type { IndexEntry, Page, StoryParagraph, StoryRun } from '../types';
import { pageLabel } from './pageLabels';

interface Node { name: string; children: Map<string, Node>; pages: Map<number, { label: string; elementId?: string }>; see: Set<string>; seeAlso: Set<string> }
export function hierarchicalIndex(entries: IndexEntry[], pages: Page[]): StoryParagraph[] {
  const roots = new Map<string, Node>();
  for (const entry of entries) {
    let children = roots, node: Node | undefined;
    for (const name of [entry.topic, ...(entry.subtopics || (entry.subtopic ? [entry.subtopic] : []))].slice(0, 4)) {
      node = children.get(name);
      if (!node) { node = { name, children: new Map(), pages: new Map(), see: new Set(), seeAlso: new Set() }; children.set(name, node); }
      children = node.children;
    }
    if (!node) continue;
    if (entry.see) node.see.add(entry.see);
    for (const target of entry.seeAlso || []) node.seeAlso.add(target);
    const page = pages.find(page => page.pageNumber === entry.pageNumber);
    if (page && !entry.see) node.pages.set(page.pageNumber, { label: pageLabel(pages, page.id).label, elementId: entry.elementId });
  }
  const paragraphs: StoryParagraph[] = [];
  const visit = (node: Node, depth: number) => {
    const runs: StoryRun[] = [{ text: '    '.repeat(depth) + node.name + (node.pages.size ? '  ' : '') }];
    const labels = [...node.pages].sort(([a], [b]) => a - b);
    const reference = (value: { label: string; elementId?: string }): StoryRun => ({ text: value.label, ...(value.elementId ? { reference: { targetElementId: value.elementId, format: 'page' as const } } : {}) });
    for (let index = 0; index < labels.length; index++) {
      if (index) runs.push({ text: ', ' });
      let last = index;
      while (last + 1 < labels.length && labels[last + 1][0] === labels[last][0] + 1 && /^\d+$/.test(labels[last][1].label) && /^\d+$/.test(labels[last + 1][1].label) && Number(labels[last + 1][1].label) === Number(labels[last][1].label) + 1) last++;
      runs.push(reference(labels[index][1]));
      if (last >= index + 2) { runs.push({ text: '–' }, reference(labels[last][1])); index = last; }
    }
    for (const [prefix, targets] of [['See', node.see], ['See also', node.seeAlso]] as const) if (targets.size) runs.push({ text: `${node.pages.size ? '. ' : '  '}${prefix} ${[...targets].sort().join('; ')}`, italic: true });
    paragraphs.push({ runs });
    for (const child of [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name))) visit(child, depth + 1);
  };
  let initial = '';
  for (const node of [...roots.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    const letter = Array.from(node.name)[0]?.toUpperCase() || '#';
    if (letter !== initial) { initial = letter; paragraphs.push({ runs: [{ text: `[ ${letter} ]`, bold: true }] }); }
    visit(node, 0);
  }
  return paragraphs;
}
