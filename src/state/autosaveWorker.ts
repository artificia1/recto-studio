/// <reference lib="webworker" />

import type { ProjectState } from '../types';
import { RectoDB } from './persistence';

self.onmessage = async (event: MessageEvent<{ json: string; updatedAt: number }>) => {
  try {
    const { json, updatedAt } = event.data;
    await RectoDB.saveProject(JSON.parse(json) as ProjectState, updatedAt);
    self.postMessage(true);
  } catch {
    self.postMessage(false);
  }
};
