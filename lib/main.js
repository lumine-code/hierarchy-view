const { CompositeDisposable, Disposable } = require("lumine");
const { pathToFileURL } = require("url");
const CallHierarchyView = require("./call-hierarchy-view");

class CallHierarchyPackage {
  constructor() {
    this.service = null;
    this.view = null;
    this.subscriptions = null;
  }

  activate() {
    this.subscriptions = new CompositeDisposable();
    this.subscriptions.add(
      lumine.commands.add("lumine-text-editor:not([mini])", {
        "call-hierarchy:incoming-calls": () => this.showCalls("incoming"),
        "call-hierarchy:outgoing-calls": () => this.showCalls("outgoing"),
      }),
      lumine.commands.add("lumine-workspace", {
        "call-hierarchy:toggle": () => this.getView().toggle(),
        "call-hierarchy:toggle-focus": () => this.getView().toggleFocus(),
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
      this.view = new CallHierarchyView(() => this.service);
      this.view.onDidDestroy(() => {
        this.view = null;
      });
    }
    return this.view;
  }

  // Prepare a call hierarchy for the symbol under the cursor and show its
  // first item as the tree root in the dock. All requests route through the
  // origin editor: the language-server session is per project root, so the
  // editor pins the right session for the whole tree.
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
    const session = filePath ? this.service.sessionForEditor(editor) : null;
    if (!session) {
      lumine.notifications.addInfo("No language server is active for this file.");
      return;
    }
    if (!session.capabilities?.callHierarchyProvider) {
      const name = session.adapter?.displayName ?? "language server";
      lumine.notifications.addInfo(`The ${name} does not support call hierarchy.`);
      return;
    }
    const position = editor.getCursorBufferPosition();
    let items;
    try {
      items = await this.service.request(editor, "textDocument/prepareCallHierarchy", {
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
    await this.getView().showItem(editor, items[0], direction);
  }
}

module.exports = new CallHierarchyPackage();
