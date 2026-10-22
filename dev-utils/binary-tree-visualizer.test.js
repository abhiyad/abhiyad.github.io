const test = require("node:test");
const assert = require("node:assert/strict");
const { parseTree, layoutTree } = require("./binary-tree-visualizer.js");

const byValue = (tree) => tree.nodes.map((n) => n.value);
const child = (tree, id, side) => {
  const n = tree.nodes[id];
  return n[side] === null ? null : tree.nodes[n[side]];
};

// ---------- parseTree ----------

test("builds the LeetCode example with queue semantics", () => {
  const t = parseTree("[5,6,6,null,null,8,6,10,null,5]");
  assert.deepEqual(byValue(t), [5, 6, 6, 8, 6, 10, 5]);
  const root = t.nodes[0];
  assert.equal(child(t, 0, "left").value, 6);
  assert.equal(child(t, root.left, "left"), null);
  assert.equal(child(t, root.left, "right"), null);
  const r = root.right;
  assert.equal(child(t, r, "left").value, 8);
  assert.equal(child(t, r, "right").value, 6);
  const eight = t.nodes[r].left;
  assert.equal(child(t, eight, "left").value, 10);
  assert.equal(child(t, eight, "right"), null);
  assert.equal(child(t, t.nodes[r].right, "left").value, 5);
  assert.equal(t.height, 4);
});

test("sparse tree [1,2,3,null,5]", () => {
  const t = parseTree("[1,2,3,null,5]");
  assert.equal(child(t, 1, "left"), null);
  assert.equal(child(t, 1, "right").value, 5);
});

test("trims trailing nulls and accepts strings, negatives and decimals", () => {
  const t = parseTree('["root",-1.5,null,null,null]');
  assert.deepEqual(byValue(t), ["root", -1.5]);
});

test("empty input and [] give an empty tree", () => {
  assert.equal(parseTree("").nodes.length, 0);
  assert.equal(parseTree("[]").nodes.length, 0);
  assert.equal(parseTree("[null]").nodes.length, 0);
});

test("single node", () => {
  const t = parseTree("[42]");
  assert.deepEqual(byValue(t), [42]);
  assert.equal(t.height, 1);
});

test("rejects malformed and non-array input", () => {
  assert.throws(() => parseTree("[1,2"), /JSON/);
  assert.throws(() => parseTree("{}"), /array/);
});

test("rejects unsupported labels", () => {
  assert.throws(() => parseTree("[1,[2]]"), /#1/);
  assert.throws(() => parseTree("[1,true]"), /#1/);
});

test("rejects a null root with descendants", () => {
  assert.throws(() => parseTree("[null,1]"), /root/i);
});

test("rejects leftover entries no node can claim", () => {
  // 1 has children null,null; 2 has nowhere to go.
  assert.throws(() => parseTree("[1,null,null,2]"), /#3/);
});

test("enforces the node limit", () => {
  const big = JSON.stringify(Array.from({ length: 1001 }, (_, i) => i));
  assert.throws(() => parseTree(big), /1000/);
});

// ---------- layoutTree ----------

test("parents sit above children, left/right on the correct side", () => {
  const t = parseTree("[5,6,6,null,null,8,6,10,null,5]");
  const pos = layoutTree(t).pos;
  t.nodes.forEach((n, id) => {
    if (n.left !== null) {
      assert.ok(pos[n.left].y > pos[id].y);
      assert.ok(pos[n.left].x < pos[id].x);
    }
    if (n.right !== null) {
      assert.ok(pos[n.right].y > pos[id].y);
      assert.ok(pos[n.right].x > pos[id].x);
    }
  });
});

test("every node in a left subtree is left of every node in the right subtree", () => {
  const t = parseTree("[1,2,3,null,5,6]");
  const pos = layoutTree(t).pos;
  // 2's subtree = {2,5}; 3's subtree = {3,6}
  const x = (v) => pos[t.nodes.findIndex((n) => n.value === v)].x;
  assert.ok(Math.max(x(2), x(5)) < Math.min(x(3), x(6)));
});

test("single node has positive bounds", () => {
  const l = layoutTree(parseTree("[1]"));
  assert.ok(l.width > 0 && l.height > 0);
});
