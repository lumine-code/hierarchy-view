// Authentic package usage. Run with lumine/script/demo.js; fixtures stay in demo/.
module.exports = {
  version: 1,
  dependencies: [
    "language-typescript",
    "marker",
    "linter",
    "diagnostics",
    "documentation-view",
    "hover",
    "ide",
    "ide-typescript",
  ],
  viewport: { width: 1150, height: 600 },
  async before(context) {
    const { lumine, state } = context;
    for (const p of lumine.packages.getActivePackages())
      if (
        p.name.startsWith("ide-") &&
        p.name !== "ide-typescript" &&
        state.serverInstall?.[p.name]?.status !== "installing"
      )
        await lumine.packages.deactivatePackage(p.name);
  },
  async prepare(context) {
    const { lumine, state, fixture, open } = context;
    state.editor = await open("ide-features/signal.ts");
    await lumine.project.setPaths([fixture("ide-features")]);
    lumine.grammars.assignLanguageMode(state.editor.getBuffer(), "source.ts");
    await state.editor.getBuffer().getLanguageMode().ready;
    await state.editor.getBuffer().getLanguageMode().atGrammarSettlement?.();
  },
  scenes: [
    {
      id: "scene-1",
      file: "demo.png",
      caption: "Explore the incoming calls of a TypeScript function.",
      timeout: 60000,
      async run(context) {
        const { lumine, state, waitFor } = context;
        {
          for (let n = 0; n < 60; n++) {
            if (
              [
                ...lumine.packages.getActivePackage("ide").mainModule.manager.sessions.values(),
              ].some((s) => s.adapter.id === "ide-typescript" && s.state === "running") &&
              lumine.packages
                .getActivePackage("linter")
                .mainModule.provideMcpTools()[0]
                .execute({ filePath: state.editor.getPath() })
                .messages.filter((m) => m.linterName === "TypeScript Language Server").length
            )
              break;
            await new Promise((r) => setTimeout(r, 500));
          }
          if (
            ![...lumine.packages.getActivePackage("ide").mainModule.manager.sessions.values()].some(
              (s) => s.adapter.id === "ide-typescript" && s.state === "running",
            )
          )
            throw new Error("The actual language server did not start");
          const messages = lumine.packages
            .getActivePackage("linter")
            .mainModule.provideMcpTools()[0]
            .execute({ filePath: state.editor.getPath() })
            .messages.filter((m) => m.linterName === "TypeScript Language Server");
          if (!messages.length) throw new Error("No diagnostic from the expected server");
          const message = messages.find((m) => m.severity === "error") || messages[0];
          state.evidence = {
            adapter: "ide-typescript",
            provider: message.linterName,
            diagnostic: message.excerpt,
          };
          state.editor.setCursorBufferPosition(message.range.start);
          state.editor.scrollToCursorPosition();
          lumine.views.getView(state.editor).focus();
        }
        {
          lumine.commands.dispatch(lumine.views.getView(state.editor), "hover:dismiss");
          state.editor.setCursorBufferPosition([1, 20]);
          lumine.commands.dispatch(
            lumine.views.getView(state.editor),
            "hierarchy-view:incoming-calls",
          );
          await waitFor(
            () => document.querySelector(".hierarchy-view")?.innerText.includes("average"),
            "incoming root",
          );
          document.querySelector(".hierarchy-view .list-item").click();
          await waitFor(
            () => document.querySelector(".hierarchy-view")?.innerText.includes("summarizeSignal"),
            "real incoming caller",
          );
        }
      },
      ready() {
        return Boolean(
          document.querySelector(".hierarchy-view")?.innerText.includes("summarizeSignal"),
        );
      },
    },
    {
      id: "scene-2",
      file: "demo-2.png",
      caption: "Explore the outgoing calls of a TypeScript function.",
      timeout: 60000,
      async run({ lumine, state, waitFor }) {
        const row = state.editor
          .getText()
          .split("\n")
          .findIndex((line) => line.startsWith("export function summarizeSignal"));
        state.editor.setCursorBufferPosition([row, 25]);
        state.editor.scrollToCursorPosition();
        lumine.views.getView(state.editor).focus();
        lumine.commands.dispatch(
          lumine.views.getView(state.editor),
          "hierarchy-view:outgoing-calls",
        );
        await waitFor(
          () =>
            document.querySelector(".hierarchy-view")?.innerText.includes("Outgoing calls") &&
            document.querySelector(".hierarchy-view")?.innerText.includes("summarizeSignal"),
          "outgoing root",
        );
        document.querySelector(".hierarchy-view .list-item").click();
        await waitFor(
          () =>
            document.querySelector(".hierarchy-view")?.innerText.includes("average") &&
            document.querySelector(".hierarchy-view")?.innerText.includes("peakAmplitude"),
          "real outgoing targets",
        );
      },
      ready() {
        return Boolean(
          document.querySelector(".hierarchy-view")?.innerText.includes("average") &&
          document.querySelector(".hierarchy-view")?.innerText.includes("peakAmplitude"),
        );
      },
    },
  ],
  async cleanup() {},
};
