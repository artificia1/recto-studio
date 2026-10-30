# State module boundaries

- `stateManager.ts` coordinates document commands, notifications, and public APIs.
- `defaults.ts` owns paragraph/object styles, master spreads, conditions, and the
  initial document. It imports document types/constants only.
- `history.ts` owns bounded undo/redo storage, branching, cloning, and clearing.
  It has no dependency on the UI, storage, canvas, or state manager.
- `autosave.ts` coordinates scheduled writes and recovery.
- `persistence.ts` owns IndexedDB and native file serialization.
- `projectValidation.ts` validates and migrates imported document data.
- `scriptRunner.ts` interprets restricted automation scripts and produces queued
  updates; the state manager validates and commits those updates.

Defaults remain re-exported through stateManager.ts and the existing state.ts bridge
for compatibility. History uses the same JSON cloning and 30-state limit as before.
The state manager owns mutation/notification timing, including Undo/Redo notifications.

Canvas keyboard dispatch lives in `../engine/interaction/keyboard.ts`. It receives
a narrow command interface and callbacks for renderer-specific space-pan/pen state.
The canvas owns event registration/cleanup, cursor changes, and redraws. The keyboard
module imports the state manager only as a TypeScript type, avoiding a runtime cycle.

Future extractions should preserve these APIs and move one cohesive responsibility
at a time, with state/history tests and production browser checks. Checkpoint storage,
preflight, pointer gestures, rendering, and large inspector components still merit
separate refactors; this extraction does not claim to eliminate all monoliths.
