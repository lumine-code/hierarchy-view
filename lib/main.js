const { CompositeDisposable, Disposable } = require("lumine");
const { pathToFileURL } = require("url");
const HierarchyView = require("./hierarchy-view");

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
        "hierarchy-view:incoming-calls": () => this.showCalls("incoming"),
        "hierarchy-view:outgoing-calls": () => this.showCalls("outgoing"),
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

  // Prepare a call hierarchy for the symbol under the cursor and show its
  // first item as the tree root in the dock.
  //
  // The session that prepares the root serves the whole tree. Two servers on
  // one file is normal — a type checker beside a linter — so the one to ask is
  // the one that says it can answer, not whichever adapter registered first.
  // And a prepared item carries an opaque `data` that means something only to
  // the server that minted it, so every expansion has to go back to that same
  // session rather than being re-routed per request.
  async showCalls(direction) {
    const editor = lumine.workspace.getActiveTextEditor();
    if (!editor) return;
    if (!this.service) {
      lumine.notifications.addInfo(
        "Call hierarchy is unavailable: no language-server hub is connected.",
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
    // `capabilities.callHierarchyProvider` directly finds nothing for a server
    // that registered the capability after the handshake.
    const session = sessions.find((candidate) =>
      candidate.supports("textDocument/prepareCallHierarchy", editor, "callHierarchy"),
    );
    if (!session) {
      const name = sessions.length === 1 ? sessions[0].adapter?.displayName : null;
      lumine.notifications.addInfo(
        name
          ? `The ${name} does not support call hierarchy.`
          : "No language server for this file supports call hierarchy.",
      );
      return;
    }

    let items;
    try {
      items = await session.request("textDocument/prepareCallHierarchy", {
        textDocument: { uri: pathToFileURL(filePath).href },
        position: { line: position.row, character: position.column },
      });
    } catch (error) {
      lumine.notifications.addWarning("Call hierarchy request failed", {
        detail: error?.message ?? String(error),
        dismissable: true,
      });
      return;
    }
    if (!items || items.length === 0) {
      lumine.notifications.addInfo("No symbol at cursor");
      return;
    }
    await this.getView().showItem(session, items[0], direction);
  }
}

module.exports = new HierarchyViewPackage();
