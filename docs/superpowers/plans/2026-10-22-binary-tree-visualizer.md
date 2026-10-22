# Binary Tree Visualizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fully automatic SVG visualizer for level-order binary-tree arrays and link it from the portfolio's Dev Utils section.

**Architecture:** A browser script exposes pure parsing and layout functions through a small UMD-style module so Node's built-in test runner can test the behavior without a DOM. The same module initializes the page in browsers, rendering connectors and nodes into responsive SVG and synchronizing input through the URL hash.

**Tech Stack:** HTML5, shared CSS, dependency-free JavaScript, SVG, Node.js built-in `node:test`.

---

## File structure

- Create `dev-utils/binary-tree-visualizer.js`: parsing, tree layout, browser rendering, URL state, and live event wiring.
- Create `dev-utils/binary-tree-visualizer.html`: accessible visualizer UI.
- Create `dev-utils/binary-tree-visualizer.test.js`: pure behavior tests using `node:test`.
- Modify `dev-utils/dev-utils.css`: narrowly scoped tree drawing and empty-state rules.
- Modify `index.html`: add the utility card.

### Task 1: Parse and normalize level-order trees

**Files:**
- Create: `dev-utils/binary-tree-visualizer.test.js`
- Create: `dev-utils/binary-tree-visualizer.js`

- [ ] **Step 1: Write failing parser tests**

Test the supplied array, trimming trailing `null`, accepting strings and finite numbers, rejecting malformed/non-array input, rejecting unsupported labels, enforcing a 255-node limit, rejecting a missing root with descendants, and rejecting leftover entries no node can claim.

- [ ] **Step 2: Verify the tests fail**

Run: `node --test dev-utils/binary-tree-visualizer.test.js`
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement `parseTree(text)`**

Parse JSON, validate the array and labels, trim trailing nulls, build the tree with LeetCode's queue semantics (each non-null node consumes the next two entries), reject leftover entries, and return `{ values, nodes, edges, depth }` with node records containing `index`, `value`, and `depth`.

- [ ] **Step 4: Verify parser tests pass**

Run: `node --test dev-utils/binary-tree-visualizer.test.js`
Expected: all parser tests PASS.

### Task 2: Compute a readable automatic layout

**Files:**
- Modify: `dev-utils/binary-tree-visualizer.test.js`
- Modify: `dev-utils/binary-tree-visualizer.js`

- [ ] **Step 1: Write failing layout tests**

Assert that `layoutTree(tree)` places parents above children, left children left of parents, right children right of parents, preserves sparse-tree ordering, and returns positive bounds for a single node.

- [ ] **Step 2: Verify only layout tests fail**

Run: `node --test dev-utils/binary-tree-visualizer.test.js`
Expected: parser tests PASS and layout tests FAIL because `layoutTree` is absent.

- [ ] **Step 3: Implement `layoutTree(tree)`**

Use in-order structural positioning: recursively place each reachable node, advance a horizontal cursor after the left subtree, and then place the right subtree. Use fixed minimum gaps, depth-based vertical spacing, label-aware radii, and calculated padded bounds. This retains gaps implied by sparse structure without exponential slot widths.

- [ ] **Step 4: Verify all pure tests pass**

Run: `node --test dev-utils/binary-tree-visualizer.test.js`
Expected: all tests PASS.

### Task 3: Build the automatic SVG page

**Files:**
- Create: `dev-utils/binary-tree-visualizer.html`
- Modify: `dev-utils/binary-tree-visualizer.js`
- Modify: `dev-utils/dev-utils.css`

- [ ] **Step 1: Add the accessible page shell**

Create the shared navigation, heading, labeled textarea, Sample and Copy link buttons, alert/status regions, and an SVG with the accessible label `Binary tree drawing`.

- [ ] **Step 2: Add browser initialization and SVG rendering**

On DOM ready, render edges before nodes, escape labels by assigning `textContent`, set the `viewBox` from layout bounds, debounce input by 180 ms, display actionable errors, clear stale drawings, and show an empty-tree message.

- [ ] **Step 3: Add full-auto fitting and URL restoration**

Load `tree` from the URL hash or use the supplied example, update the hash after valid renders, use `preserveAspectRatio="xMidYMid meet"`, and observe the container with `ResizeObserver` so its responsive height is recalculated from the tree aspect ratio.

- [ ] **Step 4: Add scoped styles**

Style `#binary-tree`, `.tree-edge`, `.tree-node`, `.tree-node-label`, `.tree-meta`, and `.tree-empty` to match existing Dev Utils panels, including a minimum readable SVG height and mobile sizing.

### Task 4: Integrate and verify

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add the homepage card**

Add a third Dev Utils card titled `Binary Tree Visualizer`, describe level-order arrays and null placeholders, and link it to `./dev-utils/binary-tree-visualizer.html`.

- [ ] **Step 2: Run automated checks**

Run: `node --test dev-utils/binary-tree-visualizer.test.js`
Expected: all tests PASS.

Run: `git diff --check`
Expected: no output and exit code 0.

- [ ] **Step 3: Run a local smoke test**

Serve the repository with `python3 -m http.server 8000`, load the utility and homepage, and verify the example tree, `[1,2,3,null,5]`, invalid input, live rendering, responsive fit, copied/restored links, and homepage navigation.

- [ ] **Step 4: Commit the implementation**

Stage only the planned files and commit with `Add binary tree visualizer`.
