const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

function waitFor(condition, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const poll = () => {
      let value;
      try {
        value = condition();
      } catch (error) {
        reject(error);
        return;
      }
      if (value) {
        resolve(value);
      } else if (Date.now() - start > timeout) {
        reject(new Error("Timed out waiting for condition"));
      } else {
        setTimeout(poll, 20);
      }
    };
    poll();
  });
}

function makeItem(name, uri, line, character) {
  return {
    name,
    kind: 12,
    uri,
    range: { start: { line, character: 0 }, end: { line: line + 2, character: 0 } },
    selectionRange: {
      start: { line, character },
      end: { line, character: character + name.length },
    },
  };
}

// A session stub whose `supports()` behaves the way the hub's does: the
// prepare method is gated on the provider field, the follow-up requests are
// not gated at all — they are what a server registers dynamically under.
function makeSession(id, capabilities, respond) {
  return {
    state: "running",
    capabilities,
    adapter: { id, displayName: id },
    supports(method) {
      if (method === "textDocument/prepareCallHierarchy")
        return !!this.capabilities.callHierarchyProvider;
      return true;
    },
    request: jasmine.createSpy(`${id} request`).and.callFake(respond),
  };
}

describe("hierarchy-view", () => {
  let mainModule, editor, tempDir, originPath, targetPath;
  let service, session, sessions, respond, serviceDisposable;

  function names(view) {
    return Array.from(view.element.querySelectorAll(".hierarchy-view-name")).map(
      (el) => el.textContent,
    );
  }

  function requestCalls(method, target = session) {
    return target.request.calls.all().filter((call) => call.args[0] === method);
  }

  async function showIncoming() {
    lumine.commands.dispatch(lumine.views.getView(editor), "hierarchy-view:incoming-calls");
    const view = await waitFor(() => mainModule.view);
    await waitFor(() => view.element.querySelector("li.hierarchy-view-entry"));
    return view;
  }

  async function expandRoot(view) {
    lumine.commands.dispatch(view.element, "core:move-right");
    await waitFor(() => view.element.querySelectorAll("li.hierarchy-view-entry").length === 3);
  }

  beforeEach(async () => {
    jasmine.useRealClock();
    jasmine.attachToDOM(lumine.views.getView(lumine.workspace));

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hierarchy-view-"));
    originPath = path.join(tempDir, "origin.js");
    targetPath = path.join(tempDir, "target.js");
    fs.writeFileSync(originPath, "function alpha() {}\n");
    fs.writeFileSync(targetPath, "function beta() { alpha(); }\nfunction gamma() { alpha(); }\n");

    const pack = await lumine.packages.activatePackage("hierarchy-view");
    mainModule = pack.mainModule;
    editor = await lumine.workspace.open(originPath);

    // A stub of the `ide-client` service: one prepared item at the
    // cursor, two incoming callers in another file, and no outgoing calls.
    const rootItem = makeItem("alpha", pathToFileURL(originPath).href, 0, 9);
    respond = async (method) => {
      if (method === "textDocument/prepareCallHierarchy") return [rootItem];
      if (method === "callHierarchy/incomingCalls") {
        const uri = pathToFileURL(targetPath).href;
        return [
          {
            from: makeItem("beta", uri, 0, 9),
            fromRanges: [{ start: { line: 0, character: 18 }, end: { line: 0, character: 23 } }],
          },
          {
            from: makeItem("gamma", uri, 1, 9),
            fromRanges: [{ start: { line: 1, character: 19 }, end: { line: 1, character: 24 } }],
          },
        ];
      }
      if (method === "callHierarchy/outgoingCalls") return [];
      return null;
    };
    session = makeSession("Stub Server", { callHierarchyProvider: true }, respond);
    sessions = [session];
    service = { activeSessionsForEditor: async () => sessions };
    serviceDisposable = mainModule.consumeIdeClient(service);
  });

  afterEach(async () => {
    serviceDisposable?.dispose();
    await lumine.packages.deactivatePackage("hierarchy-view");
    // Retries because Windows keeps a directory non-empty until the last handle on a child
    // closes, and `force` swallows only ENOENT.
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it("shows the prepared symbol as the tree root in a dock item", async () => {
    editor.setCursorBufferPosition([0, 12]);
    const view = await showIncoming();

    expect(names(view)).toEqual(["alpha"]);
    expect(view.element.querySelector(".hierarchy-view-direction").textContent).toBe(
      "Incoming calls",
    );
    // The function kind renders with the same Octicon vocabulary as the outline.
    expect(view.element.querySelector(".hierarchy-view-name").classList.contains("icon-gear")).toBe(
      true,
    );
    // The dock item is open in the right dock by default.
    expect(lumine.workspace.getRightDock().getPaneItems()).toContain(view);

    expect(session.request).toHaveBeenCalledWith("textDocument/prepareCallHierarchy", {
      textDocument: { uri: pathToFileURL(originPath).href },
      position: { line: 0, character: 12 },
    });
  });

  it("lazily expands a node into its callers and caches the result", async () => {
    const view = await showIncoming();
    expect(requestCalls("callHierarchy/incomingCalls").length).toBe(0);

    await expandRoot(view);
    expect(names(view)).toEqual(["alpha", "beta", "gamma"]);
    const incoming = requestCalls("callHierarchy/incomingCalls");
    expect(incoming.length).toBe(1);
    expect(incoming[0].args[1].item.name).toBe("alpha");

    // Collapse and re-expand: the children come from the per-node cache.
    lumine.commands.dispatch(view.element, "core:move-left");
    expect(view.element.querySelectorAll("li.hierarchy-view-entry").length).toBe(1);
    await expandRoot(view);
    expect(names(view)).toEqual(["alpha", "beta", "gamma"]);
    expect(requestCalls("callHierarchy/incomingCalls").length).toBe(1);
  });

  it("opens the call site when a child entry is confirmed", async () => {
    const view = await showIncoming();
    await expandRoot(view);

    lumine.commands.dispatch(view.element, "core:move-down");
    expect(view.element.querySelector("li.selected .hierarchy-view-name").textContent).toBe("beta");

    spyOn(lumine.workspace, "open");
    lumine.commands.dispatch(view.element, "core:confirm");
    expect(lumine.workspace.open).toHaveBeenCalledWith(targetPath, {
      initialLine: 0,
      initialColumn: 9,
      pending: true,
    });
  });

  it("switches direction and re-queries the same root", async () => {
    const view = await showIncoming();
    await expandRoot(view);

    view.element.querySelector(".hierarchy-view-switch").dispatchEvent(new MouseEvent("click"));
    expect(view.element.querySelector(".hierarchy-view-direction").textContent).toBe(
      "Outgoing calls",
    );
    expect(names(view)).toEqual(["alpha"]);

    // The stub reports no outgoing calls, so expanding turns the root into a leaf.
    lumine.commands.dispatch(view.element, "core:move-right");
    await waitFor(() => view.element.querySelector("li.hierarchy-view-entry.list-item"));
    expect(requestCalls("callHierarchy/outgoingCalls").length).toBe(1);
    expect(names(view)).toEqual(["alpha"]);
  });

  it("no-ops with an info notification when the session lacks hierarchy-view support", async () => {
    session.capabilities = {};
    lumine.notifications.clear();
    lumine.commands.dispatch(lumine.views.getView(editor), "hierarchy-view:incoming-calls");

    const notification = await waitFor(() => lumine.notifications.getNotifications()[0]);
    expect(notification.getType()).toBe("info");
    expect(notification.getMessage()).toContain("does not support call hierarchy");
    expect(mainModule.view).toBeNull();
    expect(session.request).not.toHaveBeenCalled();
  });

  it("asks the server that supports it, not the one that registered first", async () => {
    // Two servers on one file is the normal case — a type checker beside a
    // linter. Taking sessions[0] reported the linter's "no call hierarchy" as
    // the file's answer while the checker sat right there.
    const linter = makeSession("Linter", {}, respond);
    sessions = [linter, session];

    const view = await showIncoming();
    expect(names(view)).toEqual(["alpha"]);
    expect(linter.request).not.toHaveBeenCalled();
    expect(requestCalls("textDocument/prepareCallHierarchy").length).toBe(1);
  });

  it("honours a capability the server registered dynamically", async () => {
    // A dynamic registration leaves `capabilities` empty, so the old direct
    // read of capabilities.callHierarchyProvider refused a server that in fact
    // serves it. supports() is the only check that sees both.
    session.capabilities = {};
    session.supports = () => true;

    const view = await showIncoming();
    expect(names(view)).toEqual(["alpha"]);
  });

  it("keeps the whole tree on the session that prepared the root", async () => {
    // An item's `data` is opaque and means nothing to another server, so a
    // second capable session must never be handed an expansion.
    const other = makeSession("Other", { callHierarchyProvider: true }, respond);
    sessions = [session, other];

    const view = await showIncoming();
    await expandRoot(view);
    expect(names(view)).toEqual(["alpha", "beta", "gamma"]);
    expect(other.request).not.toHaveBeenCalled();
  });

  it("stays generic when several servers are attached and none can serve it", async () => {
    sessions = [makeSession("Linter", {}, respond), makeSession("Other", {}, respond)];
    lumine.notifications.clear();
    lumine.commands.dispatch(lumine.views.getView(editor), "hierarchy-view:incoming-calls");

    const notification = await waitFor(() => lumine.notifications.getNotifications()[0]);
    expect(notification.getMessage()).toBe(
      "No language server for this file supports call hierarchy.",
    );
    expect(mainModule.view).toBeNull();
  });

  it("notifies when no language server is attached at all", async () => {
    sessions = [];
    lumine.notifications.clear();
    lumine.commands.dispatch(lumine.views.getView(editor), "hierarchy-view:incoming-calls");

    const notification = await waitFor(() => lumine.notifications.getNotifications()[0]);
    expect(notification.getMessage()).toBe("No language server is active for this file.");
    expect(mainModule.view).toBeNull();
  });

  it("notifies when the server finds no symbol at the cursor", async () => {
    session.request.and.resolveTo(null);
    lumine.notifications.clear();
    lumine.commands.dispatch(lumine.views.getView(editor), "hierarchy-view:incoming-calls");

    const notification = await waitFor(() => lumine.notifications.getNotifications()[0]);
    expect(notification.getType()).toBe("info");
    expect(notification.getMessage()).toBe("No symbol at cursor");
    expect(mainModule.view).toBeNull();
  });
});
