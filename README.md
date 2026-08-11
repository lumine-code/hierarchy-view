# hierarchy-view

Explore the callers, callees, supertypes and subtypes of a symbol.

Both hierarchies share one dock item, powered by the bundled language-server hub: prepare one from the symbol under the cursor, then walk it as a lazily expanded tree and jump to any entry.

## Features

- **Call hierarchy**: lists the callers or the callees of the symbol under the cursor.
- **Type hierarchy**: lists the supertypes or the subtypes of the symbol under the cursor.
- **Lazy tree**: expanding an entry queries the language server for the next level and caches it.
- **Direction switch**: a header button re-queries the same symbol in the other direction.
- **Navigation**: click an entry, or confirm it with the keyboard, to open it in a pending pane.
- **One server per tree**: the server that prepared the root answers every request in it, so an entry is never resolved against a server that did not produce it.
- **Capability aware**: commands no-op with a notification when no language server on the file serves that hierarchy.

## Installation

To install `hierarchy-view` search for _hierarchy-view_ in the Install pane of the Lumine settings or run `lumine --install lumine-code/hierarchy-view`.

## Commands

Commands available in `lumine-workspace`:

- `hierarchy-view:toggle`: show or hide the hierarchy dock item,
- `hierarchy-view:toggle-focus`: focus the hierarchy, or return focus to the editor.

Commands available in `lumine-text-editor`:

- `hierarchy-view:incoming-calls`: show the callers of the symbol under the cursor,
- `hierarchy-view:outgoing-calls`: show the calls made from the symbol under the cursor,
- `hierarchy-view:supertypes`: show the base types of the symbol under the cursor,
- `hierarchy-view:subtypes`: show the types derived from the symbol under the cursor.

## Usage

The header button switches direction within the hierarchy on screen; the commands choose which hierarchy that is. Running a type command over a displayed call tree replaces it and retitles the tab, so only one of the two is ever open.

Type hierarchy is served by fewer language servers than call hierarchy is — clangd, jdtls and Metals implement it, while pyright, typescript-language-server, texlab and tinymist offer only call hierarchy.

## Customization

The hierarchy appearance can be tweaked from your `styles.css`:

```css
.hierarchy-view {
  font-size: 12px;
  .hierarchy-view-detail {
    color: var(--text-color-highlight);
  }
}
```

## Services

- **ide-client** (`^1.0.0`): consumed to route the `textDocument/prepareCallHierarchy`, `callHierarchy/incomingCalls`, `callHierarchy/outgoingCalls`, `textDocument/prepareTypeHierarchy`, `typeHierarchy/supertypes` and `typeHierarchy/subtypes` requests through the language-server session that serves the file.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
