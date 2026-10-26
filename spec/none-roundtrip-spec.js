const path = require("node:path");
const os = require("node:os");
const { pathToFileURL } = require("node:url");

describe("Hierarchy requests across a None round trip", () => {
  let main, editor, grammar, edge, root, session, service;
  const held = () => {
    let resolve;
    return { promise: new Promise((done) => (resolve = done)), resolve: (value) => resolve(value) };
  };
  const flush = async () => {
    for (let index = 0; index < 12; index++) await Promise.resolve();
  };
  beforeEach(async () => {
    jasmine.useRealClock();
    const text = await lumine.packages.activatePackage("language-text");
    await text.resourceLoadPromise;
    if (lumine.packages.isPackageLoaded("hierarchy-view"))
      await lumine.packages.unloadPackage("hierarchy-view");
    jasmine.attachToDOM(lumine.workspace.getElement());
    editor = await lumine.workspace.open(path.join(os.tmpdir(), "hierarchy-none-roundtrip.txt"));
    editor.setText("symbol\n");
    grammar = editor.getGrammar();
    main = (await lumine.packages.activatePackage("hierarchy-view")).mainModule;
    root = {
      name: "fresh",
      kind: 12,
      uri: pathToFileURL(editor.getPath()).href,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } },
      selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } },
    };
    session = { supports: () => true, request: jasmine.createSpy("prepare").and.resolveTo([root]) };
    service = { activeSessionsForEditor: jasmine.createSpy("sessions").and.resolveTo([session]) };
    edge = main.consumeIde(service);
  });
  afterEach(async () => {
    edge.dispose();
    await lumine.packages.unloadPackage("hierarchy-view");
    editor.destroy();
  });
  function roundtrip(target = editor) {
    lumine.grammars.assignGrammar(target, lumine.grammars.nullGrammar);
    lumine.grammars.assignGrammar(target, grammar);
    expect(target.getGrammar()).toBe(grammar);
  }
  for (const embedded of [false, true]) {
    it(`retires pending session discovery for ${embedded ? "an embedded" : "a file"} editor before a fresh command`, async () => {
      const discovery = held();
      service.activeSessionsForEditor.and.returnValues(
        discovery.promise,
        Promise.resolve([session]),
      );
      let target = editor;
      if (embedded) {
        target = lumine.workspace.buildTextEditor();
        target.setText("symbol\n");
        target.getBuffer().setPath(path.join(os.tmpdir(), "hierarchy-embedded-roundtrip.txt"));
        lumine.grammars.assignGrammar(target, grammar);
        jasmine.attachToDOM(target.element);
      }
      let settled = false;
      const event = { target: target.element };
      const obsolete = main.showHierarchy("call", "up", event).then(() => {
        settled = true;
      });
      try {
        roundtrip(target);
        await flush();
        expect(settled).toBe(true);
        await main.showHierarchy("call", "up", event);
        expect(main.view.root.item.name).toBe("fresh");
        discovery.resolve([session]);
        await obsolete;
        expect(session.request).toHaveBeenCalledTimes(1);
        expect(target.getText()).toBe("symbol\n");
      } finally {
        discovery.resolve([session]);
        await obsolete;
        if (embedded) target.destroy();
      }
    });
  }
  it("drops an old prepare result while a new command completes before it", async () => {
    const response = held();
    session.request.and.returnValues(response.promise, Promise.resolve([root]));
    let settled = false;
    const obsolete = main.showHierarchy("call", "up").then(() => {
      settled = true;
    });
    await flush();
    expect(session.request).toHaveBeenCalledTimes(1);
    roundtrip();
    await flush();
    expect(settled).toBe(true);
    await main.showHierarchy("call", "up");
    response.resolve([{ ...root, name: "obsolete" }]);
    await obsolete;
    expect(main.view.root.item.name).toBe("fresh");
  });
  it("does not leave a stale tree when opening outlives the source mode", async () => {
    const opening = held();
    const open = lumine.workspace.open.bind(lumine.workspace);
    let opened;
    spyOn(lumine.workspace, "open").and.callFake(async (...args) => {
      opened = await open(...args);
      await opening.promise;
      return opened;
    });
    const obsolete = main.showHierarchy("call", "up");
    await conditionPromise(() => Boolean(opened));
    const view = main.view;
    roundtrip();
    opening.resolve();
    await obsolete;
    await flush();
    expect(view.root).toBeNull();
    expect(lumine.workspace.paneForItem(view)).toBeUndefined();
  });
});
