const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));

// Guards for the call-hierarchy package conventions: the lumine-code metadata,
// the command prefix and config namespace, the CSS-custom-property stylesheet,
// and the absence of legacy editor branding.
describe("call-hierarchy package assets", () => {
  it("ships a keymap on the reveal tier, and no menus", () => {
    // A bare alt-<letter> at workspace scope reveals a surface, one letter per
    // surface. `keymaps` has to be in `files` or the binding never ships.
    const keymap = JSON.parse(read("keymaps/call-hierarchy.json").replace(/^\s*\/\/.*$/gm, ""));
    expect(keymap["lumine-workspace"]["alt-k"]).toBe("call-hierarchy:toggle-focus");
    expect(JSON.parse(read("package.json")).files).toContain("keymaps");
    expect(exists("menus")).toBe(false);
  });

  it("ships a CSS stylesheet built on custom properties, not Less", () => {
    expect(exists("styles/call-hierarchy.css")).toBe(true);
    expect(exists("styles/call-hierarchy.less")).toBe(false);
    const css = read("styles/call-hierarchy.css");
    expect(css).toContain(".call-hierarchy");
    expect(css).toContain("var(--");
    expect(css).not.toContain('@import "ui-variables"');
    expect(css).not.toMatch(/\bfade\(|\bcontrast\(|\blighten\(|\bdarken\(|@[a-z-]+:/);
  });

  it("is named `call-hierarchy` with lumine-code metadata and no runtime dependencies", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.name).toBe("call-hierarchy");
    expect(pkg.author).toBe("lumine-code");
    expect(pkg.repository).toBe("https://github.com/lumine-code/call-hierarchy");
    expect(pkg.bugs.url).toBe("https://github.com/lumine-code/call-hierarchy/issues");
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

  it("defines the config schema under the call-hierarchy namespace without order keys", () => {
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
    expect(lines[0]).toBe("# call-hierarchy");
    const sentence = lines.find((line, index) => index > 0 && line.trim().length > 0);
    expect(sentence).toBe(pkg.description);
  });

  it("uses the call-hierarchy: command prefix in lib", () => {
    const main = read("lib/main.js");
    expect(main).toContain('"call-hierarchy:incoming-calls"');
    expect(main).toContain('"call-hierarchy:outgoing-calls"');
    expect(main).toContain('"call-hierarchy:toggle"');
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
