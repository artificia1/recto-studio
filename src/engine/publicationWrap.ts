import type { CanvasElement, ProjectState, Spread, TextElement, StoryContent } from '../types';
import { resolveMaster } from './masterInheritance';
import { masterTargetPage } from './pageLabels';
import { segmentTextWithGrep } from './legacyTypography';

export function publicationWrapObjects(state: ProjectState, spread: Spread): CanvasElement[] {
  const master = resolveMaster(state.masterSpreads, spread.masterSpreadId);
  const inherited = (master?.elements || []).flatMap(element => {
    const page = masterTargetPage(master!.pages, spread.pages, element.pageId);
    return page && !spread.detachedMasterElementIds?.includes(element.id) && !spread.elements.some(local => local.masterSourceId === element.id && local.pageId === page.id)
      ? [{ ...element, pageId: page.id }] : [];
  });
  return [...inherited, ...spread.elements].filter(element => element.textWrap?.mode && element.textWrap.mode !== 'none' &&
    !element.pasteboard && state.layers.find(layer => layer.id === element.layerId)?.visible !== false);
}

export function wrappedPlainContent(frame: TextElement, source: string): StoryContent {
  return { version: 1, paragraphs: source.split('\n').map(text => ({ styleId: frame.paragraphStyleId,
    runs: segmentTextWithGrep(text, frame.grepStyles, frame.color) })) };
}
