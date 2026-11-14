/// <reference lib="webworker" />
import { composeStoryInBackground, type StoryCompositionRequest } from './storyComposition';

self.onmessage = async (event: MessageEvent<StoryCompositionRequest>) => {
  try {
    self.postMessage(await composeStoryInBackground(event.data));
  } catch {
    self.postMessage(null);
  }
};
