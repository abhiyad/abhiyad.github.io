(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BinaryTree = api;
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => api.init());
    else api.init();
  }
})(typeof self !== "undefined" ? self : this, function () {
  const SAMPLE = "[5,6,6,null,null,8,6,10,null,5]";
  const MAX_NODES = 1000;

  const NS = "http://www.w3.org/2000/svg";
  const LEVEL_H = 72;
  const GAP = 14;
  const PAD = 12;
  const MIN_R = 17;
  const MAX_R = 42;
  // Below this zoom labels get too small to read, so scroll horizontally instead.
  const MIN_SCALE = 0.55;

  // ---------- parsing ----------

  // LeetCode serialisation: a BFS queue where every non-null node consumes the
  // next two entries as its left and right child. Nulls never get children.
  function parseTree(text) {
    const trimmed = text.trim();
    const empty = { nodes: [], height: 0, leaves: 0 };
    if (!trimmed) return empty;

    let data;
    try {
      data = JSON.parse(trimmed);
    } catch (_) {
      throw new Error("Invalid JSON. Expected something like [1,2,3,null,5].");
    }
    if (!Array.isArray(data)) throw new Error("Expected an array like [1,2,3,null,5].");

    data.forEach((v, i) => {
      const ok = v === null || typeof v === "string" || (typeof v === "number" && Number.isFinite(v));
      if (!ok) throw new Error(`Item #${i} must be a number, string or null: ${JSON.stringify(v)}`);
    });

    let end = data.length;
    while (end > 0 && data[end - 1] === null) end--;
    const values = data.slice(0, end);
    if (!values.length) return empty;
    if (values[0] === null) throw new Error("The root is null, so no other node can be attached.");

    const count = values.filter((v) => v !== null).length;
    if (count > MAX_NODES) {
      throw new Error(`That's ${count} nodes; the limit is ${MAX_NODES} to keep the drawing usable.`);
    }

    const nodes = [{ value: values[0], index: 0, depth: 0, left: null, right: null }];
    const queue = [0];
    let i = 1;
    for (let head = 0; head < queue.length && i < values.length; head++) {
      const parent = nodes[queue[head]];
      for (const side of ["left", "right"]) {
        if (i >= values.length) break;
        const v = values[i];
        if (v !== null) {
          nodes.push({ value: v, index: i, depth: parent.depth + 1, left: null, right: null });
          parent[side] = nodes.length - 1;
          queue.push(nodes.length - 1);
        }
        i++;
      }
    }
    if (i < values.length) {
      throw new Error(`Item #${i} (${JSON.stringify(values[i])}) has no parent: every node before it is already full or null.`);
    }

    return {
      nodes,
      height: Math.max(...nodes.map((n) => n.depth)) + 1,
      leaves: nodes.filter((n) => n.left === null && n.right === null).length,
    };
  }

  // ---------- layout ----------

  function radiusFor(label) {
    return Math.min(MAX_R, Math.max(MIN_R, 7 + label.length * 4));
  }

  // Each node gets its own in-order column, so left/right order is always
  // preserved and gaps left by nulls cost nothing.
  function layoutTree(tree) {
    const n = tree.nodes.length;
    if (!n) return { pos: [], r: MIN_R, width: 0, height: 0 };

    const r = Math.max(...tree.nodes.map((node) => radiusFor(String(node.value))));
    const col = 2 * r + GAP;
    const pos = new Array(n);
    let cursor = 0;

    // Iterative in-order walk; deep skewed trees would overflow recursion.
    const stack = [];
    let cur = 0;
    while (cur !== null || stack.length) {
      while (cur !== null) {
        stack.push(cur);
        cur = tree.nodes[cur].left;
      }
      cur = stack.pop();
      pos[cur] = { x: PAD + r + cursor * col, y: PAD + r + tree.nodes[cur].depth * LEVEL_H };
      cursor++;
      cur = tree.nodes[cur].right;
    }

    return {
      pos,
      r,
      width: 2 * PAD + 2 * r + (n - 1) * col,
      height: 2 * PAD + 2 * r + (tree.height - 1) * LEVEL_H,
    };
  }

  // ---------- browser ----------

  function init() {
    const $ = (id) => document.getElementById(id);
    const input = $("input");
    const errorEl = $("error");
    const statsEl = $("stats");
    const svg = $("tree");
    const wrap = $("tree-wrap");
    const emptyEl = $("tree-empty");
    let current = null;

    function el(tag, attrs, parent) {
      const node = document.createElementNS(NS, tag);
      for (const k in attrs) node.setAttribute(k, attrs[k]);
      if (parent) parent.appendChild(node);
      return node;
    }

    function fit() {
      if (!current || !current.width) return;
      const avail = wrap.clientWidth;
      const scale = Math.min(1.25, Math.max(MIN_SCALE, avail / current.width));
      svg.setAttribute("width", Math.round(current.width * scale));
      svg.setAttribute("height", Math.round(current.height * scale));
    }

    function draw(tree, layout) {
      svg.replaceChildren();
      svg.setAttribute("viewBox", `0 0 ${layout.width} ${layout.height}`);
      svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

      const edges = el("g", { class: "tree-edges" }, svg);
      tree.nodes.forEach((node, id) => {
        for (const c of [node.left, node.right]) {
          if (c === null) continue;
          const a = layout.pos[id];
          const b = layout.pos[c];
          el("line", { class: "tree-edge", x1: a.x, y1: a.y, x2: b.x, y2: b.y }, edges);
        }
      });

      const nodes = el("g", {}, svg);
      tree.nodes.forEach((node, id) => {
        const label = String(node.value);
        const p = layout.pos[id];
        const g = el("g", { class: id === 0 ? "tree-node root" : "tree-node" }, nodes);
        el("title", {}, g).textContent = `${label} · depth ${node.depth} · array index ${node.index}`;
        el("circle", { cx: p.x, cy: p.y, r: layout.r }, g);
        const text = el("text", { x: p.x, y: p.y, class: "tree-node-label" }, g);
        text.textContent = label.length > 10 ? label.slice(0, 9) + "…" : label;
      });
    }

    function stat(label, value) {
      return `<div class="stat"><div class="stat-label">${label}</div><div class="stat-value">${value}</div></div>`;
    }

    function render() {
      let tree;
      try {
        tree = parseTree(input.value);
      } catch (e) {
        errorEl.textContent = e.message;
        svg.replaceChildren();
        svg.removeAttribute("width");
        svg.removeAttribute("height");
        statsEl.innerHTML = "";
        emptyEl.hidden = true;
        current = null;
        return;
      }
      errorEl.textContent = "";
      writeHash();

      emptyEl.hidden = tree.nodes.length > 0;
      current = layoutTree(tree);
      statsEl.innerHTML = tree.nodes.length
        ? stat("Nodes", tree.nodes.length) + stat("Height", tree.height) + stat("Leaves", tree.leaves)
        : "";
      if (!tree.nodes.length) {
        svg.replaceChildren();
        svg.removeAttribute("width");
        svg.removeAttribute("height");
        return;
      }
      draw(tree, current);
      fit();
      // When the tree is wider than the panel, start scrolled to the root.
      const scale = svg.getAttribute("width") / current.width;
      wrap.scrollLeft = current.pos[0].x * scale - wrap.clientWidth / 2;
    }

    // ---------- url state ----------

    function writeHash() {
      const params = new URLSearchParams();
      params.set("tree", input.value.trim());
      history.replaceState(null, "", "#" + params.toString());
    }

    function readHash() {
      const params = new URLSearchParams(location.hash.slice(1));
      input.value = params.get("tree") ?? SAMPLE;
    }

    function flash(button, text) {
      const original = button.textContent;
      button.textContent = text;
      setTimeout(() => (button.textContent = original), 1200);
    }

    // ---------- wiring ----------

    let debounce;
    input.addEventListener("input", () => {
      clearTimeout(debounce);
      debounce = setTimeout(render, 180);
    });
    $("sample").addEventListener("click", () => {
      input.value = SAMPLE;
      render();
    });
    $("copy-link").addEventListener("click", (e) => {
      const button = e.currentTarget;
      navigator.clipboard.writeText(location.href).then(
        () => flash(button, "Copied"),
        () => flash(button, "Failed")
      );
    });
    new ResizeObserver(fit).observe(wrap);

    readHash();
    render();
  }

  return { parseTree, layoutTree, init, SAMPLE };
});
