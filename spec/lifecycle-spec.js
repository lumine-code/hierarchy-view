const path = require("node:path");
const os = require("node:os");
const { pathToFileURL } = require("node:url");

describe("Hierarchy View request ownership", () => {
  let main, editor, service, session, edge, root;

  const deferred = () => {
    let resolve, reject;
    const promise = new Promise((done, fail) => {
      resolve = done;
      reject = fail;
    });
    return { promise, resolve, reject };
  };

  beforeEach(async () => {
    jasmine.attachToDOM(lumine.views.getView(lumine.workspace));
    main = (await lumine.packages.activatePackage("hierarchy-view")).mainModule;
    editor = await lumine.workspace.open(
      path.join(os.tmpdir(), `hierarchy-owned-${process.pid}.js`),
    );
    editor.setText("symbol()\n");
    editor.setCursorBufferPosition([0, 2]);
    root = {
      name: "root",
      kind: 12,
      uri: pathToFileURL(editor.getPath()).href,
      range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } },
      selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
    };
    session = { supports: () => true, request: jasmine.createSpy("request").and.resolveTo([root]) };
    service = { activeSessionsForEditor: jasmine.createSpy("sessions").and.resolveTo([session]) };
    edge = main.consumeIde(service);
  });

  afterEach(async () => {
    edge.dispose();
    if (lumine.packages.isPackageActive("hierarchy-view"))
      await lumine.packages.deactivatePackage("hierarchy-view");
    // A broken baseline can create a view after its package has retired.
    if (main.view) {
      const pane = lumine.workspace.paneForItem(main.view);
      if (pane) await pane.destroyItem(main.view, true);
      else main.view.destroy();
    }
  });

  async function showRoot() {
    const view = main.getView();
    await view.showItem(session, root, "call", "up");
    return view;
  }

  const children = (name = "late child") => [{ from: { ...root, name }, fromRanges: [] }];

  it("does not render or recreate icon subscriptions after a pending expansion is closed", async () => {
    const view = await showRoot();
    const response = deferred();
    session.request.and.returnValue(response.promise);
    const pending = view.expand(view.root);
    await lumine.workspace.paneForItem(view).destroyItem(view, true);
    const render = spyOn(view, "render").and.callThrough();
    response.resolve(children());
    await pending;

    expect(render).not.toHaveBeenCalled();
    expect(view.iconDisposables.disposed).toBe(true);
    view.iconDisposables.dispose();
  });

  it("does not add old children to a replacement root and session", async () => {
    const view = await showRoot();
    const response = deferred();
    session.request.and.returnValue(response.promise);
    const pending = view.expand(view.root);
    const newer = { request: jasmine.createSpy("new request").and.resolveTo([]) };
    await view.showItem(newer, { ...root, name: "new root" }, "type", "down");
    const nodes = [...view.nodes.values()];
    const render = spyOn(view, "render").and.callThrough();
    response.resolve(children());
    await pending;

    expect([...view.nodes.values()]).toEqual(nodes);
    expect(view.root.item.name).toBe("new root");
    expect(render).not.toHaveBeenCalled();
    expect(newer.request).not.toHaveBeenCalled();
  });

  it("ignores children from the previous direction while allowing the new direction to expand", async () => {
    const view = await showRoot();
    const response = deferred();
    session.request.and.callFake((method) =>
      method === "callHierarchy/incomingCalls" ? response.promise : Promise.resolve([]),
    );
    const pending = view.expand(view.root);
    view.setDirection("down");
    await view.expand(view.root);
    response.resolve(children());
    await pending;

    expect(view.nodes.size).toBe(1);
    expect(view.root.leaf).toBe(true);
    expect(view.root.children).toEqual([]);
    expect(session.request.calls.allArgs().map((args) => args[0])).toEqual([
      "callHierarchy/incomingCalls",
      "callHierarchy/outgoingCalls",
    ]);
  });

  it("suppresses a failed expansion belonging to a closed view", async () => {
    const view = await showRoot();
    const response = deferred();
    session.request.and.returnValue(response.promise);
    const pending = view.expand(view.root);
    await lumine.workspace.paneForItem(view).destroyItem(view, true);
    const warning = spyOn(lumine.notifications, "addWarning");
    response.reject(new Error("retired server response"));
    await pending;

    expect(warning).not.toHaveBeenCalled();
  });

  it("preserves a current expansion error and leaves the node retryable", async () => {
    const view = await showRoot();
    session.request.and.rejectWith(new Error("current server response"));
    const warning = spyOn(lumine.notifications, "addWarning");
    await view.expand(view.root);

    expect(warning).toHaveBeenCalledTimes(1);
    expect(view.root.pending).toBe(false);
    expect(view.root.children).toBeNull();
  });

  it("does not reveal a replacement view when an older open completes after close", async () => {
    const view = main.getView();
    const completion = deferred();
    const open = lumine.workspace.open.bind(lumine.workspace);
    let opened;
    const pendingOpen = spyOn(lumine.workspace, "open").and.callFake(async (...args) => {
      opened = await open(...args);
      await completion.promise;
      return opened;
    });
    const pending = view.show();
    await conditionPromise(() => opened === view);
    await lumine.workspace.paneForItem(view).destroyItem(view, true);
    pendingOpen.and.callFake(open);
    const replacement = main.getView();
    await replacement.showItem(session, root, "call", "up");
    const dock = lumine.workspace.paneContainerForURI(replacement.getURI());
    dock.hide();
    completion.resolve();
    await pending;

    expect(dock.isVisible()).toBe(false);
    expect(lumine.workspace.paneForItem(replacement)).toBeDefined();
  });

  it("ignores an open failure that belongs to a destroyed view", async () => {
    const view = main.getView();
    const completion = deferred();
    spyOn(lumine.workspace, "open").and.returnValue(completion.promise);
    const result = view.show().then(
      () => null,
      (error) => error,
    );
    view.destroy();
    completion.reject(new Error("retired open"));

    expect(await result).toBeNull();
  });

  it("preserves a current open failure", async () => {
    const view = main.getView();
    const error = new Error("current open failed");
    spyOn(lumine.workspace, "open").and.rejectWith(error);

    await expectAsync(view.show()).toBeRejectedWith(error);
  });

  it("retires expansion before an asynchronous pane close completes during deactivation", async () => {
    const view = await showRoot();
    const response = deferred();
    const closing = deferred();
    session.request.and.returnValue(response.promise);
    const pending = view.expand(view.root);
    const icons = view.iconDisposables;
    let closeStarted = false;
    const listener = lumine.workspace.paneForItem(view).onWillDestroyItem(() => {
      closeStarted = true;
      return closing.promise;
    });
    const deactivation = lumine.packages.deactivatePackage("hierarchy-view");
    try {
      await conditionPromise(() => closeStarted);
      response.resolve(children());
      await pending;
      expect(view.iconDisposables).toBe(icons);
    } finally {
      closing.resolve();
      await deactivation;
      listener.dispose();
    }
    expect(lumine.workspace.paneForItem(view)).toBeUndefined();
    view.iconDisposables.dispose();
  });

  it("does not prepare or open a hierarchy after session discovery outlives deactivation", async () => {
    const sessions = deferred();
    service.activeSessionsForEditor.and.returnValue(sessions.promise);
    const pending = main.showHierarchy("call", "up");
    await lumine.packages.deactivatePackage("hierarchy-view");
    sessions.resolve([session]);
    await pending;

    expect(session.request).not.toHaveBeenCalled();
    expect(main.view).toBeNull();
  });

  it("does not open a prepared hierarchy after its package deactivates", async () => {
    const response = deferred();
    session.request.and.returnValue(response.promise);
    const pending = main.showHierarchy("call", "up");
    await flushMicrotasks();
    await lumine.packages.deactivatePackage("hierarchy-view");
    response.resolve([root]);
    await pending;

    expect(main.view).toBeNull();
  });

  it("keeps the newest prepared hierarchy when an older request resolves last", async () => {
    const response = deferred();
    session.request.and.returnValues(
      response.promise,
      Promise.resolve([{ ...root, name: "newest" }]),
    );
    const pending = main.showHierarchy("call", "up");
    await flushMicrotasks();
    await main.showHierarchy("call", "up");
    response.resolve([{ ...root, name: "older" }]);
    await pending;

    expect(main.view.root.item.name).toBe("newest");
  });

  it("suppresses an obsolete prepare error but preserves current warnings", async () => {
    const response = deferred();
    session.request.and.returnValue(response.promise);
    const pending = main.showHierarchy("call", "up");
    await flushMicrotasks();
    await lumine.packages.deactivatePackage("hierarchy-view");
    const warning = spyOn(lumine.notifications, "addWarning");
    response.reject(new Error("retired prepare"));
    await pending;

    expect(warning).not.toHaveBeenCalled();
  });

  it("keeps the original editor and cursor query through a tab and caret change", async () => {
    const sessions = deferred();
    service.activeSessionsForEditor.and.returnValue(sessions.promise);
    const pending = main.showHierarchy("call", "up");
    const uri = root.uri;
    editor.setCursorBufferPosition([0, 5]);
    await lumine.workspace.open();
    sessions.resolve([session]);
    await pending;

    expect(session.request).toHaveBeenCalledWith("textDocument/prepareCallHierarchy", {
      textDocument: { uri },
      position: { line: 0, character: 2 },
    });
    expect(main.view.root.item.name).toBe("root");
  });
});
