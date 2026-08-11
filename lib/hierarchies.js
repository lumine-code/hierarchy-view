// Everything that differs between the two hierarchies, and between the two
// directions within each. The tree, the dock item and the keystroke are shared,
// so this table is the whole of what makes one a call hierarchy and the other a
// type hierarchy.
//
// Directions are `up` and `down` rather than the protocol's own words: incoming
// calls and supertypes both sit above the root, outgoing calls and subtypes
// below. One vocabulary reads correctly for both, and it is what the arrows in
// the header mean.
//
// `key` is how a child arrives. Call hierarchy wraps each one in
// {from, fromRanges} or {to, fromRanges}; type hierarchy answers with a bare
// TypeHierarchyItem array. A null `key` is what makes the count badge vanish
// for types without a branch anywhere: no wrapper means no `fromRanges`.
exports.HIERARCHIES = {
  call: {
    prepare: "textDocument/prepareCallHierarchy",
    feature: "callHierarchy",
    title: "Call Hierarchy",
    iconName: "link",
    noun: "call hierarchy",
    empty: "No Calls",
    up: {
      method: "callHierarchy/incomingCalls",
      key: "from",
      label: "Incoming calls",
      icon: "icon-arrow-left",
      switchTitle: "Show outgoing calls",
    },
    down: {
      method: "callHierarchy/outgoingCalls",
      key: "to",
      label: "Outgoing calls",
      icon: "icon-arrow-right",
      switchTitle: "Show incoming calls",
    },
  },
  type: {
    prepare: "textDocument/prepareTypeHierarchy",
    feature: "typeHierarchy",
    title: "Type Hierarchy",
    iconName: "organization",
    noun: "type hierarchy",
    empty: "No Types",
    up: {
      method: "typeHierarchy/supertypes",
      key: null,
      label: "Supertypes",
      icon: "icon-arrow-up",
      switchTitle: "Show subtypes",
    },
    down: {
      method: "typeHierarchy/subtypes",
      key: null,
      label: "Subtypes",
      icon: "icon-arrow-down",
      switchTitle: "Show supertypes",
    },
  },
};

exports.OTHER_DIRECTION = { up: "down", down: "up" };
