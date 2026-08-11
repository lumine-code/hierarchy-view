const { CompositeDisposable, Emitter } = require("lumine");
const { fileURLToPath } = require("url");
const path = require("path");

const HIERARCHY_URI = "lumine://hierarchy-view";

// LSP SymbolKind numbers to names, per the protocol specification.
const SYMBOL_KINDS = {
  1: "file",
  2: "module",
  3: "namespace",
  4: "package",
  5: "class",
  6: "method",
  7: "property",
  8: "field",
  9: "constructor",
  10: "enum",
  11: "interface",
  12: "function",
  13: "variable",
  14: "constant",
  15: "string",
  16: "number",
  17: "boolean",
  18: "array",
  19: "object",
  20: "key",
  21: "null",
  22: "enum-member",
  23: "struct",
  24: "event",
  25: "operator",
  26: "type-parameter",
};

// The same Octicon vocabulary outline-view uses for its symbol kinds.
const KIND_ICONS = {
  file: "icon-file-text",
  module: "icon-database",
  namespace: "icon-tag",
  package: "icon-package",
  class: "icon-package",
  method: "icon-gear",
  property: "icon-primitive-dot",
  field: "icon-primitive-dot",
  constructor: "icon-tools",
  interface: "icon-key",
  function: "icon-gear",
  variable: "icon-code",
  constant: "icon-primitive-square",
};

function iconForKind(kind) {
  return KIND_ICONS[SYMBOL_KINDS[kind]] ?? "icon-dash";
}

// The dock item. Renders one prepared CallHierarchyItem as the root of a
// lazily expanded tree of incoming or outgoing calls. Children are fetched on
// first expansion and cached per node; switching direction re-queries.
class HierarchyView {
  constructor() {
    this.emitter = new Emitter();
    this.disposables = new CompositeDisposable();
    this.direction = "incoming";
    this.session = null;
    this.root = null;
    this.nodes = new Map();
    this.nodeId = 1;
    this.selectedId = null;

    this.element = document.createElement("div");
    this.element.className = "hierarchy-view tool-panel";
    this.element.tabIndex = -1;

    this.header = document.createElement("div");
    this.header.className = "hierarchy-view-header";
    this.directionLabel = document.createElement("span");
    this.directionLabel.className = "hierarchy-view-direction icon icon-arrow-left";
    this.switchButton = document.createElement("button");
    this.switchButton.className = "hierarchy-view-switch btn btn-xs icon icon-git-compare";
    this.switchButton.addEventListener("click", () => this.switchDirection());
    this.header.appendChild(this.directionLabel);
    this.header.appendChild(this.switchButton);

    this.list = document.createElement("div");
    this.list.className = "hierarchy-view-list";

    this.element.appendChild(this.header);
    this.element.appendChild(this.list);

    this.element.addEventListener("click", (event) => this.handleClick(event));
    this.element.addEventListener("focus", () => {
      if (!this.selectedId && this.root) this.select(this.root.id);
    });

    this.disposables.add(
      lumine.commands.add(this.element, {
        "core:move-up": (event) => {
          event.stopImmediatePropagation();
          this.moveDelta(-1);
        },
        "core:move-down": (event) => {
          event.stopImmediatePropagation();
          this.moveDelta(1);
        },
        "core:move-left": (event) => {
          event.stopImmediatePropagation();
          this.collapseSelected();
        },
        "core:move-right": (event) => {
          event.stopImmediatePropagation();
          this.expandSelected();
        },
        "core:confirm": (event) => {
          event.stopImmediatePropagation();
          this.openSelected();
        },
      }),
    );

    this.render();
  }

  destroy() {
    this.disposables.dispose();
    this.emitter.emit("did-destroy");
    this.emitter.dispose();
    this.element.remove();
  }

  onDidDestroy(callback) {
    return this.emitter.on("did-destroy", callback);
  }

  getTitle() {
    return "Call Hierarchy";
  }

  getURI() {
    return HIERARCHY_URI;
  }

  getIconName() {
    return "link";
  }

  getDefaultLocation() {
    return lumine.config.get("hierarchy-view.dockSide") === "left" ? "left" : "right";
  }

  getAllowedLocations() {
    // The workspace picks the first location indicated in this array.
    return this.getDefaultLocation() === "left" ? ["left", "right"] : ["right", "left"];
  }

  isPermanentDockItem() {
    return false;
  }

  getPreferredWidth() {
    this.list.style.width = "min-content";
    const result = this.list.offsetWidth;
    this.list.style.width = "";
    return result;
  }

  toggle() {
    return lumine.workspace.toggle(this);
  }

  isFocused() {
    const active = document.activeElement;
    return this.element === active || this.element.contains(active);
  }

  // Reveal and focus the panel, or hand focus back to the editor when it
  // already has it. This is what the keystroke binds rather than `toggle`:
  // pressing it a second time should return you to your work, not hide a panel
  // you are looking at.
  async toggleFocus() {
    if (this.isFocused()) {
      lumine.workspace.getCenter().getActivePane().activate();
      return;
    }
    await this.show();
    this.element.focus();
  }

  async show() {
    await lumine.workspace.open(this, {
      searchAllPanes: true,
      activatePane: false,
      activateItem: true,
    });
    const container = lumine.workspace.paneContainerForURI(this.getURI());
    if (!container || container === lumine.workspace.getCenter()) return;
    container.show();
    container.getActivePane().activateItemForURI(this.getURI());
    container.activate();
  }

  // Show `item` (a prepared CallHierarchyItem) as the tree root, querying in
  // `direction` ("incoming" or "outgoing"). `session` is the server that
  // prepared the item, and serves every request in the tree: an item's `data`
  // is opaque and means nothing to any other server.
  async showItem(session, item, direction) {
    this.session = session;
    this.direction = direction;
    this.nodes.clear();
    this.nodeId = 1;
    this.root = this.createNode(item, null, null);
    this.selectedId = this.root.id;
    this.render();
    await this.show();
  }

  switchDirection() {
    this.setDirection(this.direction === "incoming" ? "outgoing" : "incoming");
  }

  // Re-query the current root in the other direction. Cached children are
  // direction-specific, so the tree is rebuilt from the root item.
  setDirection(direction) {
    this.direction = direction;
    if (this.root) {
      const item = this.root.item;
      this.nodes.clear();
      this.nodeId = 1;
      this.root = this.createNode(item, null, null);
      this.selectedId = this.root.id;
    }
    this.render();
  }

  createNode(item, fromRanges, parent) {
    const node = {
      id: String(this.nodeId++),
      item,
      fromRanges,
      parent,
      children: null,
      expanded: false,
      leaf: false,
      pending: false,
    };
    this.nodes.set(node.id, node);
    return node;
  }

  selectedNode() {
    return this.selectedId ? (this.nodes.get(this.selectedId) ?? null) : null;
  }

  // Fetch the next level of calls for `node`. Returns child nodes, or null
  // when the request failed (so a retry stays possible).
  async fetchChildren(node) {
    if (!this.session) return null;
    const method =
      this.direction === "incoming" ? "callHierarchy/incomingCalls" : "callHierarchy/outgoingCalls";
    let calls;
    try {
      calls = await this.session.request(method, { item: node.item });
    } catch (error) {
      lumine.notifications.addWarning("Call hierarchy request failed", {
        detail: error?.message ?? String(error),
        dismissable: true,
      });
      return null;
    }
    return (calls ?? []).map((call) =>
      this.createNode(call.from ?? call.to, call.fromRanges, node),
    );
  }

  async expand(node) {
    if (node.leaf || node.expanded || node.pending) return;
    if (node.children === null) {
      node.pending = true;
      try {
        const children = await this.fetchChildren(node);
        if (children === null) return;
        node.children = children;
      } finally {
        node.pending = false;
      }
      if (node.children.length === 0) {
        node.leaf = true;
        this.render();
        return;
      }
    }
    node.expanded = true;
    this.render();
  }

  collapse(node) {
    if (!node.expanded) return;
    node.expanded = false;
    // Descendants of a collapsed node leave the DOM, so keep the selection on
    // something visible: the collapsed node itself.
    this.selectedId = node.id;
    this.render();
  }

  toggleNode(node) {
    if (node.expanded) {
      this.collapse(node);
    } else {
      this.expand(node);
    }
  }

  expandSelected() {
    const node = this.selectedNode();
    if (!node) return;
    if (!node.expanded) {
      this.expand(node);
    } else if (node.children?.length) {
      this.select(node.children[0].id);
    }
  }

  collapseSelected() {
    const node = this.selectedNode();
    if (!node) return;
    if (node.expanded) {
      this.collapse(node);
    } else if (node.parent) {
      this.select(node.parent.id);
    }
  }

  openSelected() {
    const node = this.selectedNode();
    if (node) this.openNode(node);
  }

  openNode(node) {
    const item = node.item;
    const filePath = item.uri?.startsWith("file:") ? fileURLToPath(item.uri) : null;
    if (!filePath) return;
    const start = item.selectionRange?.start ?? item.range?.start ?? { line: 0, character: 0 };
    lumine.workspace.open(filePath, {
      initialLine: start.line,
      initialColumn: start.character,
      pending: true,
    });
  }

  handleClick(event) {
    const li = event.target?.closest("li.hierarchy-view-entry");
    if (!li || !this.element.contains(li)) return;
    const node = this.nodes.get(li.dataset.id);
    if (!node) return;
    this.select(node.id);
    // The disclosure caret is generated content on the row's left edge; a
    // click left of the name span lands in that zone and toggles expansion.
    const name = li.firstElementChild?.querySelector(".hierarchy-view-name");
    if (!node.leaf && name && event.clientX < name.getBoundingClientRect().left) {
      this.toggleNode(node);
      return;
    }
    this.openNode(node);
  }

  moveDelta(delta) {
    const entries = Array.from(this.list.querySelectorAll("li.hierarchy-view-entry"));
    if (entries.length === 0) return;
    const selected = this.list.querySelector("li.hierarchy-view-entry.selected");
    let index = entries.indexOf(selected) + delta;
    if (index < 0) index = 0;
    if (index >= entries.length) index = entries.length - 1;
    this.select(entries[index].dataset.id);
  }

  select(id) {
    this.list.querySelector("li.selected")?.classList.remove("selected");
    this.selectedId = id;
    const li = this.list.querySelector(`li[data-id="${id}"]`);
    if (li) {
      li.classList.add("selected");
      li.scrollIntoView?.({ block: "nearest" });
    }
  }

  rowTitle(item) {
    const kind = SYMBOL_KINDS[item.kind] ?? "unknown";
    const filePath = item.uri?.startsWith("file:") ? fileURLToPath(item.uri) : null;
    const line = (item.selectionRange?.start?.line ?? item.range?.start?.line ?? 0) + 1;
    const location = filePath ? ` — ${path.basename(filePath)}:${line}` : "";
    return `${item.name} (${kind})${location}`;
  }

  renderRow(node) {
    const row = document.createElement("div");
    row.className = node.leaf ? "hierarchy-view-item" : "hierarchy-view-item list-item";
    row.title = this.rowTitle(node.item);

    const name = document.createElement("span");
    name.className = `hierarchy-view-name icon ${iconForKind(node.item.kind)}`;
    name.textContent = node.item.name;
    row.appendChild(name);

    if (node.fromRanges?.length > 1) {
      const badge = document.createElement("span");
      badge.className = "hierarchy-view-count badge badge-flexible";
      badge.textContent = String(node.fromRanges.length);
      row.appendChild(badge);
    }

    const filePath = node.item.uri?.startsWith("file:") ? fileURLToPath(node.item.uri) : null;
    const detailText = node.item.detail || (filePath ? path.basename(filePath) : "");
    if (detailText) {
      const detail = document.createElement("span");
      detail.className = "hierarchy-view-detail";
      detail.textContent = detailText;
      row.appendChild(detail);
    }
    return row;
  }

  renderNode(node) {
    const li = document.createElement("li");
    li.dataset.id = node.id;
    if (node.leaf) {
      li.className = "hierarchy-view-entry list-item";
      li.appendChild(this.renderRow(node));
    } else {
      li.className = `hierarchy-view-entry list-nested-item${node.expanded ? "" : " collapsed"}`;
      li.appendChild(this.renderRow(node));
      if (node.expanded && node.children?.length) {
        const ul = document.createElement("ul");
        ul.className = "hierarchy-view-tree list-tree";
        for (const child of node.children) ul.appendChild(this.renderNode(child));
        li.appendChild(ul);
      }
    }
    return li;
  }

  render() {
    const incoming = this.direction === "incoming";
    this.directionLabel.className = `hierarchy-view-direction icon ${incoming ? "icon-arrow-left" : "icon-arrow-right"}`;
    this.directionLabel.textContent = incoming ? "Incoming calls" : "Outgoing calls";
    this.switchButton.title = incoming ? "Show outgoing calls" : "Show incoming calls";

    this.list.textContent = "";
    if (!this.root) {
      const message = document.createElement("ul");
      message.className = "background-message";
      const line = document.createElement("li");
      line.textContent = "No Calls";
      message.appendChild(line);
      this.list.appendChild(message);
      return;
    }
    const tree = document.createElement("ul");
    tree.className =
      "hierarchy-view-tree hierarchy-view-tree-root list-tree has-collapsable-children";
    tree.appendChild(this.renderNode(this.root));
    this.list.appendChild(tree);

    if (this.selectedId && !this.nodes.has(this.selectedId)) this.selectedId = this.root.id;
    if (this.selectedId) {
      this.list.querySelector(`li[data-id="${this.selectedId}"]`)?.classList.add("selected");
    }
  }
}

module.exports = HierarchyView;
