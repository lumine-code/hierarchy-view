describe("hierarchy service availability", () => {
  // Analysis fixtures use a real grammar; None deliberately disables this package.
  beforeEach(async () => {
    await lumine.packages.activatePackage("language-text");
  });

  it("does not initialize a view or request sessions while the service changes", async () => {
    const main = (await lumine.packages.activatePackage("hierarchy-view")).mainModule;
    const editor = await lumine.workspace.open();
    const service = { activeSessionsForEditor: jasmine.createSpy("sessions") };
    const changed = spyOn(lumine.commands, "invalidateAvailability").and.callThrough();
    const available = () =>
      lumine.commands.canDispatch(editor.getElement(), "hierarchy-view:incoming-calls");
    try {
      expect(available()).toBe(false);
      const edge = main.consumeIde(service);
      expect(available()).toBe(true);
      expect(main.view).toBe(null);
      expect(service.activeSessionsForEditor).not.toHaveBeenCalled();
      edge.dispose();
      expect(available()).toBe(false);
      expect(changed).toHaveBeenCalled();
    } finally {
      editor.destroy();
      await lumine.packages.deactivatePackage("hierarchy-view");
    }
  });
});
