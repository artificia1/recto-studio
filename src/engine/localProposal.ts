import type { ProjectState } from '../types';
import { INITIAL_STATE } from '../state/defaults';
import { parseProject } from '../state/projectValidation';

export function readLocalProposal(input: string, sourceRevision: string): ProjectState {
  const value = JSON.parse(input);
  if (value?.format !== 'recto-proposal' || value.version !== 1 || !value.draft) {
    throw new Error('The file is not a supported Recto proposal.');
  }
  if (value.sourceRevision !== sourceRevision) throw new Error('This proposal came from a different snapshot. Share a fresh copy.');
  return parseProject(JSON.stringify(value.draft), INITIAL_STATE);
}

export function describeLocalProposal(source: ProjectState, draft: ProjectState) {
  const pages = (state: ProjectState) => state.spreads.reduce((count, spread) => count + spread.pages.length, 0);
  const frames = (state: ProjectState) => new Map(state.spreads.flatMap(spread => spread.elements.map(frame => [frame.id, frame] as const)));
  const before = frames(source), after = frames(draft);
  const added = [...after.keys()].filter(id => !before.has(id)).length;
  const removed = [...before.keys()].filter(id => !after.has(id)).length;
  const edited = [...before].filter(([id, frame]) => after.has(id) && JSON.stringify(frame) !== JSON.stringify(after.get(id))).length;
  return { beforePages: pages(source), afterPages: pages(draft), added, removed, edited,
    beforeTitle: source.settings.title, afterTitle: draft.settings.title };
}
