# call-hierarchy

Explore incoming and outgoing calls for a symbol.

The call hierarchy lives in a dock item, powered by the bundled language-server hub: prepare it from the symbol under the cursor, then walk callers or callees as a lazily expanded tree and jump to any call site.

## Features

- **Incoming calls**: lists the callers of the symbol under the cursor.
- **Outgoing calls**: lists the calls made from the symbol under the cursor.
- **Lazy tree**: expanding an entry queries the language server for the next level and caches it.
- **Direction switch**: a header button re-queries the same symbol in the other direction.
- **Navigation**: click an entry, or confirm it with the keyboard, to open the call site in a pending pane.
- **Capability aware**: commands no-op with a notification when the language server lacks call-hierarchy support.

## Installation

To install `call-hierarchy` search for _call-hierarchy_ in the Install pane of the Lumine settings or run `lumine --install lumine-code/call-hierarchy`.

## Commands

Commands available in `lumine-workspace`:

- `call-hierarchy:toggle`: show or hide the call hierarchy dock item,
- `call-hierarchy:toggle-focus`: focus the call hierarchy, or return focus to the editor.

Commands available in `lumine-text-editor`:

- `call-hierarchy:incoming-calls`: show the callers of the symbol under the cursor,
- `call-hierarchy:outgoing-calls`: show the calls made from the symbol under the cursor.

## Customization

The call hierarchy appearance can be tweaked from your `styles.css`:

```css
.call-hierarchy {
  font-size: 12px;
  .call-hierarchy-detail {
    color: var(--text-color-highlight);
  }
}
```

## Services

- **ide-client** (`^1.0.0`): consumed to route the `textDocument/prepareCallHierarchy`, `callHierarchy/incomingCalls`, and `callHierarchy/outgoingCalls` requests through the origin editor's language-server session.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
