import type { ImageElement, ProjectState } from '../types';

interface RelinkPlacement {
  id: string;
  pageNumber: number | undefined;
  source: string;
  locked: boolean;
}

export interface ImageRelinkMatch<T> {
  file: T;
  targetIds: string[];
  pages: number[];
  locked: number;
  problem?: string;
}

function fileKey(name: string): string {
  return (name.split(/[\\/]/).at(-1) ?? '').normalize('NFC').toLowerCase();
}

function sourceName(image: ImageElement): string {
  if (image.name) return image.name;
  if (!image.src || /^(data|blob):/i.test(image.src)) return '';
  const filename = image.src.split(/[?#]/, 1)[0].split(/[\\/]/).at(-1) ?? '';
  try { return decodeURIComponent(filename); } catch { return filename; }
}

/** Match real source filenames and keep conflicting names out of the apply list. */
export function planImageRelinks<T extends { name: string }>(
  state: ProjectState,
  files: readonly T[],
): ImageRelinkMatch<T>[] {
  const placements = new Map<string, RelinkPlacement[]>();
  const lockedLayers = new Set(state.layers.filter(layer => layer.locked).map(layer => layer.id));
  for (const spread of state.spreads) {
    const pageNumbers = new Map(spread.pages.map(page => [page.id, page.pageNumber]));
    for (const image of spread.elements) {
      if (image.type !== 'image' || image.equation) continue;
      const key = fileKey(sourceName(image));
      if (!key) continue;
      const placement = {
        id: image.id, pageNumber: pageNumbers.get(image.pageId), source: image.src || image.assetId || '',
        locked: image.locked || lockedLayers.has(image.layerId ?? 'layer-1'),
      };
      const existing = placements.get(key);
      if (existing) existing.push(placement);
      else placements.set(key, [placement]);
    }
  }

  const selectedNames = new Map<string, number>();
  for (const file of files) {
    const key = fileKey(file.name);
    selectedNames.set(key, (selectedNames.get(key) ?? 0) + 1);
  }
  return files.map(file => {
    const key = fileKey(file.name);
    const found = placements.get(key) ?? [];
    const editable = found.filter(placement => !placement.locked);
    const sources = new Set(found.map(placement => placement.source).filter(Boolean));
    const problem = (selectedNames.get(key) ?? 0) > 1 ? 'More than one selected file has this name.'
      : !found.length ? 'No placed image has this filename.'
      : sources.size > 1 ? 'This filename refers to different placed sources. Relink them individually.'
      : !editable.length ? 'All matching frames are locked.'
      : undefined;
    return {
      file,
      targetIds: problem ? [] : editable.map(placement => placement.id),
      pages: [...new Set(editable.flatMap(placement => placement.pageNumber === undefined ? [] : [placement.pageNumber]))],
      locked: found.length - editable.length,
      problem,
    };
  });
}
