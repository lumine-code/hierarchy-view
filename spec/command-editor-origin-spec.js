const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

describe("Hierarchy commands in their dispatch editor", () => {
  let main, first, active, detached, scratch, edge, sessions;

  beforeEach(async () => {
    for (const name of ["openExternal", "openPath", "showItemInFolder", "openApplication"])
      spyOn(lumine.shell, name).and.resolveTo();
    spyOn(lumine.application, "openWindow").and.resolveTo();
    scratch = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "hierarchy-origin-")));
    for (const name of ["first.txt", "active.txt", "detached.txt"])
      fs.writeFileSync(path.join(scratch, name), "symbol\n");
    jasmine.attachToDOM(lumine.workspace.getElement());
    main = (await lumine.packages.activatePackage("hierarchy-view")).mainModule;
    first = await lumine.workspace.open(path.join(scratch, "first.txt"));
    active = await lumine.workspace.open(path.join(scratch, "active.txt"));
    sessions = jasmine.createSpy("session lookup for editor").and.resolveTo([]);
    edge = main.consumeIde({ activeSessionsForEditor: sessions });
  });

  afterEach(async () => {
    edge.dispose();
    await lumine.packages.deactivatePackage("hierarchy-view");
    detached?.destroy();
    for (const editor of lumine.workspace.getTextEditors()) editor.destroy();
    await lumine.fileWatchClient.settlePendingTeardown();
    const current = fs.realpathSync.native(scratch);
    const relative = path.relative(fs.realpathSync.native(os.tmpdir()), current);
    if (current !== scratch || !relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Refusing cleanup outside the owned hierarchy fixture");
    fs.rmSync(current, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  async function dispatchAt(editor, commands) {
    const run = spyOn(main, "showHierarchy").and.callThrough();
    for (const command of commands) {
      sessions.calls.reset();
      lumine.commands.dispatch(editor.getElement(), `hierarchy-view:${command}`);
      expect(run).toHaveBeenCalledTimes(1);
      await run.calls.mostRecent().returnValue;
      expect(sessions).toHaveBeenCalledOnceWith(editor);
      run.calls.reset();
    }
  }

  it("uses the originating background editor for all four hierarchy commands", async () => {
    expect(lumine.workspace.getActiveTextEditor()).toBe(active);
    await dispatchAt(first, ["incoming-calls", "outgoing-calls", "supertypes", "subtypes"]);
    expect(lumine.workspace.getActiveTextEditor()).toBe(active);
  });

  it("continues to use the active editor when the command originates there", async () => {
    await dispatchAt(active, ["incoming-calls"]);
  });

  it("retains the active-editor fallback for a direct request without an event", async () => {
    await main.showHierarchy("call", "up");
    expect(sessions).toHaveBeenCalledOnceWith(active);
  });
  it("does not borrow an editor from an unrelated focused surface", async () => {
    const button = document.createElement("button");
    lumine.workspace.getElement().appendChild(button);
    try {
      button.focus();
      await lumine.commands.dispatch(button, "hierarchy-view:incoming-calls");
      expect(sessions).not.toHaveBeenCalled();
      expect(lumine.commands.canDispatch(button, "hierarchy-view:incoming-calls")).toBe(false);
    } finally {
      button.remove();
    }
  });

  it("uses a real attached editor that is not a pane item", async () => {
    detached = lumine.workspace.buildTextEditor();
    detached.setText("symbol\n");
    detached.getBuffer().setPath(path.join(scratch, "detached.txt"));
    jasmine.attachToDOM(detached.getElement());
    expect(lumine.workspace.paneForItem(detached)).toBeUndefined();
    await dispatchAt(detached, ["incoming-calls"]);
    expect(lumine.workspace.getActiveTextEditor()).toBe(active);
  });
});
