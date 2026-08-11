const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));

// Guards for the hierarchy-view package conventions: the lumine-code metadata,
// the command prefix and config namespace, the CSS-custom-property stylesheet,
// and the absence of legacy editor branding.
describe("hierarchy-view package assets", () => {
  it("ships a keymap on the reveal tier, and no menus", () => {
    // A bare alt-<letter> at workspace scope reveals a surface, one letter per
    // surface. `keymaps` has to be in `files` or the binding never ships.
    const keymap = JSON.parse(read("keymaps/hierarchy-view.json").replace(/^\s*\/\/.*$/gm, ""));
    expect(keymap["lumine-workspace"]["alt-k"]).toBe("hierarchy-view:toggle-focus");
    expect(JSON.parse(read("package.json")).files).toContain("keymaps");
    expect(exists("menus")).toBe(false);
  });

  it("ships a CSS stylesheet built on custom properties, not Less", () => {
    expect(exists("styles/hierarchy-view.css")).toBe(true);
    expect(exists("styles/hierarchy-view.less")).toBe(false);
    const css = read("styles/hierarchy-view.css");
    expect(css).toContain(".hierarchy-view");
    expect(css).toContain("var(--");
    expect(css).not.toContain('@import "ui-variables"');
    expect(css).not.toMatch(/\bfade\(|\bcontrast\(|\blighten\(|\bdarken\(|@[a-z-]+:/);
  });

  it("is named `hierarchy-view` with lumine-code metadata and no runtime dependencies", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.name).toBe("hierarchy-view");
    expect(pkg.author).toBe("lumine-code");
    expect(pkg.repository).toBe("https://github.com/lumine-code/hierarchy-view");
    expect(pkg.bugs.url).toBe("https://github.com/lumine-code/hierarchy-view/issues");
    expect(pkg.main).toBe("./lib/main");
    expect(pkg.license).toBe("MIT");
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.devDependencies.eslint).toBeDefined();
    expect(pkg.devDependencies.prettier).toBeDefined();
  });

  it("consumes the ide-client service and provides none", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.consumedServices["ide-client"].versions["^1.0.0"]).toBe("consumeIdeClient");
    expect(pkg.providedServices).toBeUndefined();
  });

  it("defines the config schema under the hierarchy-view namespace without order keys", () => {
    const pkg = JSON.parse(read("package.json"));
    const schema = pkg.configSchema;
    expect(Object.keys(schema)).toEqual(["dockSide"]);
    for (const entry of Object.values(schema)) {
      expect(entry.order).toBeUndefined();
      expect(entry.title).toBeDefined();
      expect(entry.description).toBeDefined();
      expect(entry.type).toBeDefined();
      // `default` must be the last key of every entry.
      const keys = Object.keys(entry);
      expect(keys[keys.length - 1]).toBe("default");
    }
  });

  it("keeps the README description in sync with package.json", () => {
    const pkg = JSON.parse(read("package.json"));
    const lines = read("README.md").split(/\r?\n/);
    expect(lines[0]).toBe("# hierarchy-view");
    const sentence = lines.find((line, index) => index > 0 && line.trim().length > 0);
    expect(sentence).toBe(pkg.description);
  });

  it("uses the hierarchy-view: command prefix in lib", () => {
    const main = read("lib/main.js");
    for (const command of [
      "incoming-calls",
      "outgoing-calls",
      "supertypes",
      "subtypes",
      "toggle",
      "toggle-focus",
    ])
      expect(main).toContain(`"hierarchy-view:${command}"`);
  });

  it("keeps the keywords specific and free of the package's own name", () => {
    // The Install tab already scores a name match higher than any keyword, so
    // a keyword that is part of the name is a wasted slot. Nothing else checks
    // this, and a rename is exactly when it goes stale.
    const { keywords } = JSON.parse(read("package.json"));
    expect(keywords.length).toBeGreaterThan(2);
    expect(keywords.length).toBeLessThan(9);
    for (const keyword of keywords) {
      expect(keyword).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect("hierarchy-view").not.toContain(keyword);
    }
  });

  it("ships a background tip for each hierarchy, right after engines", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.backgroundTips.length).toBe(2);
    const keys = Object.keys(pkg);
    expect(keys[keys.indexOf("engines") + 1]).toBe("backgroundTips");
    // Neither command is bound, so the else branch is what actually renders;
    // a tip whose only form is a keystroke would show nothing.
    for (const tip of pkg.backgroundTips) expect(tip).toContain("{% else %}");
  });

  it("has no legacy editor branding in lib, README, or package.json", () => {
    // Technical identifiers such as the `lumine` global, `lumine-text-editor`
    // selectors, and `lumine://` URIs are allowed; editor branding is not.
    const branding = /\bAtom\b|\bPulsar\b/;
    for (const file of fs.readdirSync(path.join(root, "lib"))) {
      if (!file.endsWith(".js")) continue;
      const src = read(path.join("lib", file));
      expect(src.toLowerCase()).not.toContain("pulsar");
      expect(src).not.toContain("atom-ide");
      expect(src).not.toMatch(branding);
    }
    expect(read("README.md")).not.toMatch(branding);
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.description).not.toMatch(branding);
  });
});
