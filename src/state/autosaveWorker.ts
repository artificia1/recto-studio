/// <reference lib="webworker" />

import type { ProjectState } from '../types';
import type { AutosaveJob } from './autosaveWorkerClient';
import { saveRecoveryCheckpoint } from './desktopRecovery';
import { RectoDB } from './persistence';

self.onmessage = async (event: MessageEvent<AutosaveJob>) => {
  try {
    const { json, updatedAt, checkpoint } = event.data;
    const state = JSON.parse(json) as ProjectState;
    if (checkpoint) {
      await saveRecoveryCheckpoint(checkpoint.id, state, updatedAt, checkpoint.fileName, checkpoint.recoverable);
    } else {
      await RectoDB.saveProject(state, updatedAt);
    }
    self.postMessage(true);
  } catch {
    self.postMessage(false);
  }
};
