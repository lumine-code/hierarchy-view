const { CompositeDisposable, Disposable } = require("lumine");
const { pathToFileURL } = require("url");
const HierarchyView = require("./hierarchy-view");
const { HIERARCHIES } = require("./hierarchies");

class HierarchyViewPackage {
  constructor() {
    this.service = null;
    this.view = null;
    this.subscriptions = null;
  }

  activate() {
    this.subscriptions = new CompositeDisposable();
    this.subscriptions.add(
      lumine.commands.add("lumine-text-editor:not([mini])", {
        "hierarchy-view:incoming-calls": {
          description: "List what calls the symbol under the cursor.",
          didDispatch: () => this.showHierarchy("call", "up"),
        },
        "hierarchy-view:outgoing-calls": {
          description: "List what the symbol under the cursor calls.",
          didDispatch: () => this.showHierarchy("call", "down"),
        },
        "hierarchy-view:supertypes": {
          description: "List the types the one under the cursor inherits from.",
          didDispatch: () => this.showHierarchy("type", "up"),
        },
        "hierarchy-view:subtypes": {
          description: "List the types that inherit from the one under the cursor.",
          didDispatch: () => this.showHierarchy("type", "down"),
        },
      }),
      lumine.commands.add("lumine-workspace", {
        "hierarchy-view:toggle": () => this.getView().toggle(),
        "hierarchy-view:toggle-focus": () => this.getView().toggleFocus(),
      }),
    );
  }

  deactivate() {
    this.subscriptions?.dispose();
    this.subscriptions = null;
    const view = this.view;
    if (view) {
      const pane = lumine.workspace.paneForItem(view);
      if (pane) {
        pane.destroyItem(view);
      } else {
        view.destroy();
      }
    }
    this.service = null;
  }

  consumeIdeClient(service) {
    this.service = service;
    return new Disposable(() => {
      if (this.service === service) this.service = null;
    });
  }

  getView() {
    if (this.view === null) {
      this.view = new HierarchyView();
      this.view.onDidDestroy(() => {
        this.view = null;
      });
    }
    return this.view;
  }

  // Prepare `kind` for the symbol under the cursor and show its first item as
  // the tree root in the dock, queried in `direction`.
  //
  // The session that prepares the root serves the whole tree. Two servers on
  // one file is normal — a type checker beside a linter — so the one to ask is
  // the one that says it can answer, not whichever adapter registered first.
  // And a prepared item carries an opaque `data` that means something only to
  // the server that minted it, so every expansion has to go back to that same
  // session rather than being re-routed per request.
  async showHierarchy(kind, direction) {
    const { prepare, feature, title, noun } = HIERARCHIES[kind];
    const editor = lumine.workspace.getActiveTextEditor();
    if (!editor) return;
    if (!this.service) {
      lumine.notifications.addInfo(
        `The ${noun} is unavailable: no language-server hub is connected.`,
      );
      return;
    }
    const filePath = editor.getPath();
    // Read the cursor before the first await: resolving sessions waits for
    // each to finish starting, and the caret can move while a cold server
    // comes up.
    const position = editor.getCursorBufferPosition();

    const sessions = await this.service.activeSessionsForEditor(editor);
    if (editor.isDestroyed()) return;
    if (sessions.length === 0) {
      lumine.notifications.addInfo("No language server is active for this file.");
      return;
    }
    // supports() consults the dynamic registrations before the static
    // capability and honours the adapter's feature switch. Reading
    // `capabilities.<x>HierarchyProvider` directly finds nothing for a server
    // that registered the capability after the handshake.
    const session = sessions.find((candidate) => candidate.supports(prepare, editor, feature));
    if (!session) {
      const name = sessions.length === 1 ? sessions[0].adapter?.displayName : null;
      lumine.notifications.addInfo(
        name
          ? `The ${name} does not support ${noun}.`
          : `No language server for this file supports ${noun}.`,
      );
      return;
    }

    let items;
    try {
      items = await session.request(prepare, {
        textDocument: { uri: pathToFileURL(filePath).href },
        position: { line: position.row, character: position.column },
      });
    } catch (error) {
      lumine.notifications.addWarning(`${title} request failed`, {
        detail: error?.message ?? String(error),
        dismissable: true,
      });
      return;
    }
    if (!items || items.length === 0) {
      lumine.notifications.addInfo("No symbol at cursor");
      return;
    }
    await this.getView().showItem(session, items[0], kind, direction);
  }
}

module.exports = new HierarchyViewPackage();
