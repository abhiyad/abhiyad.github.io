# Binary Tree Visualizer Design

## Goal

Add a dependency-free developer utility that turns a LeetCode-style level-order array into a clear, responsive binary-tree diagram. The utility is visualization-only: it does not compute traversals or validate binary-search-tree ordering.

## Input and semantics

- Accept a JSON array such as `[5,6,6,null,null,8,6,10,null,5]`.
- Interpret entries exactly as LeetCode serializes trees: a breadth-first queue where each non-null node consumes the next two entries as its left and right children. `null` children consume a slot but have no children of their own, so they take no further positions (this is *not* heap `2i + 1` indexing).
- Treat `null` as an absent child, as in `[1,2,3,null,5]`.
- Accept finite numbers and strings as node labels. Reject malformed JSON, non-array input, unsupported values, and arrays whose root is `null` while later nodes are present, and entries left over after every node has received its children.
- Ignore trailing `null` entries because they do not affect the rendered tree.
- Apply a conservative node limit and show a useful error instead of attempting an impractically large drawing.

## User experience

Create `dev-utils/binary-tree-visualizer.html`, styled with the existing shared `dev-utils.css`. The page contains:

- a short explanation and example;
- one array input area;
- Sample and Copy link controls;
- a status/error message;
- a responsive SVG drawing area.

The experience is “full auto”:

- parse and redraw shortly after every input change;
- calculate the layout without configuration;
- automatically fit and center the tree after valid input and container resizing;
- restore input from the URL when a shared link is opened;
- show the sample tree on first load when no URL state exists.

Manual layout, root selection, and traversal controls are intentionally excluded.

## Rendering architecture

Use a small, dependency-free JavaScript module in `dev-utils/binary-tree-visualizer.js` with three separable responsibilities:

1. `parseTree` validates and normalizes the array.
2. `layoutTree` assigns each node its own in-order column and a row per depth, so left/right ordering is always preserved and sparse trees stay compact.
3. `renderTree` creates connectors first and labeled circular nodes second, then sets an SVG `viewBox` that fits the content.

The renderer rebuilds the SVG for each accepted input. A debounced input listener prevents redundant work while typing. A `ResizeObserver` reapplies fitting when the drawing container changes size.

## Visual behavior and accessibility

- Match the portfolio’s existing monochrome rounded-panel style.
- Use crisp SVG connectors and high-contrast circular nodes.
- Scale long labels or expand their node radius within a sensible bound.
- Keep labels readable on narrow screens and permit horizontal overflow only when fitting would make them illegible.
- Give the SVG an accessible name and expose validation failures through an alert region.
- Use native buttons and a labeled text area for keyboard accessibility.

## Site integration

Add a Binary Tree Visualizer card to the Dev Utils section in `index.html`, following the existing Interval and Graph Visualizer card pattern. Reuse shared CSS and add only narrowly scoped tree styles where necessary.

## Error handling

Invalid input keeps the page stable, clears the stale diagram, and shows a concise actionable message. Empty input renders an empty state. Leftover entries that no node can claim are rejected because they cannot belong to the represented tree.

## Verification

Verify:

- the supplied complete-tree example;
- sparse trees containing `null` placeholders;
- empty and single-node arrays;
- malformed JSON and structurally unreachable nodes;
- long string and negative/decimal number labels;
- live redraw, resize fitting, copied URL restoration, and the homepage link;
- no regressions in the existing developer utilities or portfolio navigation.
