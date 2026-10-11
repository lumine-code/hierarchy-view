const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

beforeEach(() => {
  for (const method of ["openExternal", "openPath", "showItemInFolder", "openApplication"])
    if (!jasmine.isSpy(lumine.shell[method])) spyOn(lumine.shell, method).and.resolveTo();
  if (!jasmine.isSpy(lumine.application.openWindow))
    spyOn(lumine.application, "openWindow").and.resolveTo();
});

describe("Hierarchy View independent service edges", () => {
  let main, editor, scratch, temporary, leases;
  beforeEach(async () => {
    jasmine.useRealClock();
    if (lumine.packages.isPackageLoaded("hierarchy-view"))
      await lumine.packages.unloadPackage("hierarchy-view");
    temporary = fs.realpathSync.native(os.tmpdir());
    scratch = fs.realpathSync.native(fs.mkdtempSync(path.join(temporary, "hierarchy-edges-")));
    const file = path.join(scratch, "symbol.txt");
    fs.writeFileSync(file, "symbol\n");
    jasmine.attachToDOM(lumine.workspace.getElement());
    editor = await lumine.workspace.open(file);
    main = (await lumine.packages.activatePackage("hierarchy-view")).mainModule;
    leases = [];
  });
  afterEach(async () => {
    for (const lease of leases) lease.dispose();
    if (lumine.packages.isPackageLoaded("hierarchy-view"))
      await lumine.packages.unloadPackage("hierarchy-view");
    editor?.destroy();
    await lumine.fileWatchClient.settlePendingTeardown();
    if (
      path.dirname(fs.realpathSync.native(scratch)) !== temporary ||
      !path.basename(scratch).startsWith("hierarchy-edges-")
    )
      throw new Error("Hierarchy fixture cleanup escaped its private temporary root");
    fs.rmSync(scratch, { recursive: true, force: true });
  });
  function provide(name) {
    const item = {
      name,
      kind: 12,
      uri: pathToFileURL(editor.getPath()).href,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } },
      selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } },
    };
    const session = {
      supports: () => true,
      request: jasmine.createSpy(name + " prepare").and.resolveTo([item]),
    };
    const service = {
      activeSessionsForEditor: jasmine.createSpy(name + " sessions").and.resolveTo([session]),
    };
    const lease = lumine.packages.serviceHub.provide("ide", "1.0.0", service);
    leases.push(lease);
    return { service, session, lease };
  }
  async function show(name) {
    await lumine.commands.dispatch(editor.getElement(), "hierarchy-view:incoming-calls");
    expect(main.view?.element.querySelector(".hierarchy-view-name")?.textContent).toBe(name);
  }
  it("restores the earlier live hub when the latest provider withdraws", async () => {
    const older = provide("older");
    const newer = provide("newer");
    newer.lease.dispose();
    await show("older");
    expect(older.service.activeSessionsForEditor).toHaveBeenCalledOnceWith(editor);
    expect(newer.session.request).not.toHaveBeenCalled();
  });
  it("retains the latest hub when an earlier provider withdraws", async () => {
    const older = provide("older");
    const newer = provide("newer");
    older.lease.dispose();
    await show("newer");
    expect(newer.service.activeSessionsForEditor).toHaveBeenCalledOnceWith(editor);
    expect(older.session.request).not.toHaveBeenCalled();
  });
  it("uses the latest hub for an ordinary hierarchy command", async () => {
    const older = provide("older");
    const newer = provide("newer");
    await show("newer");
    expect(newer.service.activeSessionsForEditor).toHaveBeenCalledOnceWith(editor);
    expect(older.session.request).not.toHaveBeenCalled();
  });
});
