import { useState, useEffect } from 'preact/hooks';
import { stateManager } from '../state';
import { ProjectState } from '../types';

export function useProjectState(): ProjectState {
  const [state, setState] = useState<ProjectState>(stateManager.getState());

  useEffect(() => {
    return stateManager.subscribe((newState: ProjectState) => {
      setState({ ...newState });
    });
  }, []);

  return state;
}
