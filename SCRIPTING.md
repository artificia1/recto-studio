# Publishing scripts

The Custom tab accepts a restricted JavaScript subset. It parses script text and
interprets supported statements; it never calls eval or Function on script text.
Built-in scripts keep their existing implementations.

Supported: const/let variables, plain objects and arrays, if/else, for…of loops,
local counters, primitive arithmetic/comparison, and selected string methods
(trim, toUpperCase, toLowerCase, includes).

Available API:

- `stateManager.getState()` returns a detached document snapshot.
- `stateManager.updateElement(id, updates)` queues an element update on any spread.
- `alert(message)` and `console.log(message)` collect text in the panel.

```js
const document = stateManager.getState();
for (const spread of document.spreads) {
  for (const element of spread.elements) {
    if (element.type === 'text') {
      stateManager.updateElement(element.id, { text: element.text.toUpperCase() });
    }
  }
}
```

Queued updates are validated together before committing. Errors leave the document
unchanged; one Undo reverses a successful run. Locked elements cannot be changed.
Identity, type, page ownership, and editing threaded story text are unavailable.
Scripts cannot directly mutate the snapshot or access files, browser globals,
network, imports, native code, application internals, or arbitrary functions.
Regular expressions, new, function declarations, while loops, and general-purpose
JavaScript libraries are unsupported. Existing unrestricted custom scripts may
need adaptation to this API. Script size, operation count, update count, output,
and generated string size have explicit limits.

This limits the capabilities of user-authored scripts; it does not sandbox the
entire editor, trusted built-ins, dependencies, or arbitrary code already running
in the application's page. Collaboration does not stream these bulk transactions.
