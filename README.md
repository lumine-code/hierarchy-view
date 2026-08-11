# hierarchy-view

Explore incoming and outgoing calls for a symbol.

The call hierarchy lives in a dock item, powered by the bundled language-server hub: prepare it from the symbol under the cursor, then walk callers or callees as a lazily expanded tree and jump to any call site.

## Features

- **Incoming calls**: lists the callers of the symbol under the cursor.
- **Outgoing calls**: lists the calls made from the symbol under the cursor.
- **Lazy tree**: expanding an entry queries the language server for the next level and caches it.
- **Direction switch**: a header button re-queries the same symbol in the other direction.
- **Navigation**: click an entry, or confirm it with the keyboard, to open the call site in a pending pane.
- **Capability aware**: commands no-op with a notification when the language server lacks hierarchy-view support.

## Installation

To install `hierarchy-view` search for _hierarchy-view_ in the Install pane of the Lumine settings or run `lumine --install lumine-code/hierarchy-view`.

## Commands

Commands available in `lumine-workspace`:

- `hierarchy-view:toggle`: show or hide the call hierarchy dock item,
- `hierarchy-view:toggle-focus`: focus the call hierarchy, or return focus to the editor.

Commands available in `lumine-text-editor`:

- `hierarchy-view:incoming-calls`: show the callers of the symbol under the cursor,
- `hierarchy-view:outgoing-calls`: show the calls made from the symbol under the cursor.

## Customization

The call hierarchy appearance can be tweaked from your `styles.css`:

```css
.hierarchy-view {
  font-size: 12px;
  .hierarchy-view-detail {
    color: var(--text-color-highlight);
  }
}
```

## Services

- **ide-client** (`^1.0.0`): consumed to route the `textDocument/prepareCallHierarchy`, `callHierarchy/incomingCalls`, and `callHierarchy/outgoingCalls` requests through the origin editor's language-server session.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
