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

describe("call-hierarchy", () => {
  let mainModule, editor, tempDir, originPath, targetPath, service, session, serviceDisposable;

  function names(view) {
    return Array.from(view.element.querySelectorAll(".call-hierarchy-name")).map(
      (el) => el.textContent,
    );
  }

  function requestCalls(method) {
    return service.request.calls.all().filter((call) => call.args[1] === method);
  }

  async function showIncoming() {
    lumine.commands.dispatch(lumine.views.getView(editor), "call-hierarchy:incoming-calls");
    const view = await waitFor(() => mainModule.view);
    await waitFor(() => view.element.querySelector("li.call-hierarchy-entry"));
    return view;
  }

  async function expandRoot(view) {
    lumine.commands.dispatch(view.element, "core:move-right");
    await waitFor(() => view.element.querySelectorAll("li.call-hierarchy-entry").length === 3);
  }

  beforeEach(async () => {
    jasmine.useRealClock();
    jasmine.attachToDOM(lumine.views.getView(lumine.workspace));

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "call-hierarchy-"));
    originPath = path.join(tempDir, "origin.js");
    targetPath = path.join(tempDir, "target.js");
    fs.writeFileSync(originPath, "function alpha() {}\n");
    fs.writeFileSync(targetPath, "function beta() { alpha(); }\nfunction gamma() { alpha(); }\n");

    const pack = await lumine.packages.activatePackage("call-hierarchy");
    mainModule = pack.mainModule;
    editor = await lumine.workspace.open(originPath);

    // A stub of the `ide-client` service: one prepared item at the
    // cursor, two incoming callers in another file, and no outgoing calls.
    session = {
      state: "running",
      capabilities: { callHierarchyProvider: true },
      adapter: { id: "stub", displayName: "Stub Server" },
      supports: () => true,
    };
    const rootItem = makeItem("alpha", pathToFileURL(originPath).href, 0, 9);
    service = {
      sessionForEditor: () => session,
      request: jasmine.createSpy("request").and.callFake(async (_editor, method) => {
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
      }),
    };
    serviceDisposable = mainModule.consumeIdeClient(service);
  });

  afterEach(async () => {
    serviceDisposable?.dispose();
    await lumine.packages.deactivatePackage("call-hierarchy");
    // Retries because Windows keeps a directory non-empty until the last handle on a child
    // closes, and `force` swallows only ENOENT.
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it("shows the prepared symbol as the tree root in a dock item", async () => {
    editor.setCursorBufferPosition([0, 12]);
    const view = await showIncoming();

    expect(names(view)).toEqual(["alpha"]);
    expect(view.element.querySelector(".call-hierarchy-direction").textContent).toBe(
      "Incoming calls",
    );
    // The function kind renders with the same Octicon vocabulary as the outline.
    expect(view.element.querySelector(".call-hierarchy-name").classList.contains("icon-gear")).toBe(
      true,
    );
    // The dock item is open in the right dock by default.
    expect(lumine.workspace.getRightDock().getPaneItems()).toContain(view);

    expect(service.request).toHaveBeenCalledWith(editor, "textDocument/prepareCallHierarchy", {
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
    expect(incoming[0].args[0]).toBe(editor);
    expect(incoming[0].args[2].item.name).toBe("alpha");

    // Collapse and re-expand: the children come from the per-node cache.
    lumine.commands.dispatch(view.element, "core:move-left");
    expect(view.element.querySelectorAll("li.call-hierarchy-entry").length).toBe(1);
    await expandRoot(view);
    expect(names(view)).toEqual(["alpha", "beta", "gamma"]);
    expect(requestCalls("callHierarchy/incomingCalls").length).toBe(1);
  });

  it("opens the call site when a child entry is confirmed", async () => {
    const view = await showIncoming();
    await expandRoot(view);

    lumine.commands.dispatch(view.element, "core:move-down");
    expect(view.element.querySelector("li.selected .call-hierarchy-name").textContent).toBe("beta");

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

    view.element.querySelector(".call-hierarchy-switch").dispatchEvent(new MouseEvent("click"));
    expect(view.element.querySelector(".call-hierarchy-direction").textContent).toBe(
      "Outgoing calls",
    );
    expect(names(view)).toEqual(["alpha"]);

    // The stub reports no outgoing calls, so expanding turns the root into a leaf.
    lumine.commands.dispatch(view.element, "core:move-right");
    await waitFor(() => view.element.querySelector("li.call-hierarchy-entry.list-item"));
    expect(requestCalls("callHierarchy/outgoingCalls").length).toBe(1);
    expect(names(view)).toEqual(["alpha"]);
  });

  it("no-ops with an info notification when the session lacks call-hierarchy support", async () => {
    session.capabilities = {};
    lumine.notifications.clear();
    lumine.commands.dispatch(lumine.views.getView(editor), "call-hierarchy:incoming-calls");

    const notification = await waitFor(() => lumine.notifications.getNotifications()[0]);
    expect(notification.getType()).toBe("info");
    expect(notification.getMessage()).toContain("does not support call hierarchy");
    expect(mainModule.view).toBeNull();
    expect(service.request).not.toHaveBeenCalled();
  });

  it("notifies when the server finds no symbol at the cursor", async () => {
    service.request.and.resolveTo(null);
    lumine.notifications.clear();
    lumine.commands.dispatch(lumine.views.getView(editor), "call-hierarchy:incoming-calls");

    const notification = await waitFor(() => lumine.notifications.getNotifications()[0]);
    expect(notification.getType()).toBe("info");
    expect(notification.getMessage()).toBe("No symbol at cursor");
    expect(mainModule.view).toBeNull();
  });
});
