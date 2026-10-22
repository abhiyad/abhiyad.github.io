(function () {
  const SAMPLE_EDGES = "[[3,1],[3,2],[1,4],[2,0]]";
  const SAMPLE_N = "5";

  // One colour per connected component, cycled.
  const PALETTE = [
    "#4e79a7",
    "#f28e2b",
    "#59a14f",
    "#e15759",
    "#b07aa1",
    "#76b7b2",
    "#9c755f",
    "#d4a72c",
  ];

  const NS = "http://www.w3.org/2000/svg";
  const SPACING = { treeX: 64, treeY: 90, layerX: 84, layerY: 100, force: 100 };
  const PAD = 48;
  const MIN_SCALE = 0.45;
  const MAX_NODES = 1000;
  // Above this, picking the tree centre (all-pairs BFS) gets slow; fall back to the lowest id.
  const MAX_CENTER_SEARCH = 300;
  // Below this container width, force layouts are laid out tall instead of wide.
  const PORTRAIT_WIDTH = 600;

  const LAYOUT_NAMES = {
    tree: "tree",
    layered: "layered DAG",
    force: "force-directed",
    circle: "circle",
  };

  const $ = (id) => document.getElementById(id);
  const nInput = $("n");
  const edgesInput = $("edges");
  const errorEl = $("error");
  const baseSel = $("base");
  const directedChk = $("directed");
  const layoutSel = $("layout");
  const rootInput = $("root");
  const svg = $("graph");
  const wrap = $("chart-wrap");
  const statsEl = $("stats");
  const statusEl = $("status");
  const adjOut = $("adj-out");
  const extraLabel = $("extra-label");
  const extraOut = $("extra-out");

  // Positions survive re-renders (resize, weight edits, dragging) until the structure changes.
  let cache = { key: null, pos: null, roots: [] };
  let view = null;

  // ---------- parsing ----------

  function parseEdges(text) {
    const t = text.trim();
    if (!t) return [];

    let data;
    try {
      data = JSON.parse(t);
    } catch (_) {
      // Loose formats: "(0,1) (1,2)", "[0,1] [1,2]" or one edge per line.
      const groups = /[[(]/.test(t) ? t.match(/[[(][^[\]()]*[\])]/g) || [] : t.split(/[\n;]+/);
      data = groups.map((g) => (g.match(/-?\d+(?:\.\d+)?/g) || []).map(Number)).filter((g) => g.length);
    }

    if (!Array.isArray(data)) throw new Error("Expected an array like [[0,1],[1,2]].");
    if (data.length && data.every((x) => typeof x === "number")) data = [data];

    return data.map((e, i) => {
      if (!Array.isArray(e) || (e.length !== 2 && e.length !== 3) || !e.every(Number.isFinite)) {
        throw new Error(`Edge #${i} should be [u, v] or [u, v, weight]: ${JSON.stringify(e)}`);
      }
      if (!Number.isInteger(e[0]) || !Number.isInteger(e[1])) {
        throw new Error(`Edge #${i} has non-integer nodes: ${JSON.stringify(e)}`);
      }
      return { u: e[0], v: e[1], w: e.length === 3 ? e[2] : null, idx: i };
    });
  }

  function buildGraph(raw) {
    const base = +baseSel.value;
    const directed = directedChk.checked;

    let n;
    const nText = nInput.value.trim();
    if (nText) {
      n = Number(nText);
      if (!Number.isInteger(n) || n < 0) throw new Error("Number of nodes must be a non-negative integer.");
    } else {
      n = raw.reduce((m, e) => Math.max(m, e.u, e.v), base - 1) - base + 1;
    }
    if (n > MAX_NODES) throw new Error(`That's ${n} nodes; this tool draws at most ${MAX_NODES}.`);

    const edges = raw.map((e) => {
      for (const id of [e.u, e.v]) {
        if (id < base || id >= base + n) {
          const hint = base === 0 && id === n ? " Try 1-indexed." : "";
          throw new Error(`Edge #${e.idx} uses node ${id}, but nodes are ${base}..${base + n - 1}.${hint}`);
        }
      }
      return { ...e, u: e.u - base, v: e.v - base };
    });

    const out = Array.from({ length: n }, () => []);
    const inn = Array.from({ length: n }, () => []);
    const und = Array.from({ length: n }, () => []);
    for (const e of edges) {
      out[e.u].push(e.v);
      inn[e.v].push(e.u);
      und[e.u].push(e.v);
      if (e.u !== e.v) und[e.v].push(e.u);
    }
    [out, inn, und].forEach((lists) => lists.forEach((l) => l.sort((a, b) => a - b)));

    const comp = new Array(n).fill(-1);
    const components = [];
    for (let s = 0; s < n; s++) {
      if (comp[s] >= 0) continue;
      const members = [s];
      comp[s] = components.length;
      for (let i = 0; i < members.length; i++) {
        for (const v of und[members[i]]) {
          if (comp[v] < 0) {
            comp[v] = components.length;
            members.push(v);
          }
        }
      }
      components.push(members.sort((a, b) => a - b));
    }

    const selfLoops = edges.filter((e) => e.u === e.v).length;
    const seen = new Set();
    const undSeen = new Set();
    let dupes = 0;
    let undDupes = 0;
    for (const e of edges) {
      const key = `${e.u},${e.v}`;
      const undKey = `${Math.min(e.u, e.v)},${Math.max(e.u, e.v)}`;
      if (seen.has(directed ? key : undKey)) dupes++;
      seen.add(directed ? key : undKey);
      if (undSeen.has(undKey)) undDupes++;
      undSeen.add(undKey);
    }
    const isForest = selfLoops === 0 && undDupes === 0 && edges.length === n - components.length;

    let topo = null;
    if (directed) {
      const indeg = inn.map((l) => l.length);
      const order = [];
      for (let v = 0; v < n; v++) if (!indeg[v]) order.push(v);
      for (let i = 0; i < order.length; i++) {
        for (const v of out[order[i]]) if (--indeg[v] === 0) order.push(v);
      }
      if (order.length === n) topo = order;
    }

    return { n, base, directed, edges, out, inn, und, comp, components, selfLoops, dupes, isForest, topo };
  }

  // ---------- layouts ----------

  function chooseLayout(g) {
    const mode = layoutSel.value;
    if (mode === "auto") return g.isForest ? "tree" : g.topo ? "layered" : "force";
    if (mode === "layered" && !g.topo) return "force";
    return mode;
  }

  function computeLayout(g, layout, portrait) {
    if (layout === "tree") {
      const roots = treeRoots(g);
      return { pos: treeLayout(g, roots), roots };
    }
    if (layout === "layered") return { pos: layeredLayout(g), roots: [] };
    if (layout === "circle") return { pos: circleLayout(g), roots: [] };
    return { pos: forceLayout(g, portrait), roots: [] };
  }

  function bfsDepths(g, s) {
    const depth = new Map([[s, 0]]);
    const queue = [s];
    for (let i = 0; i < queue.length; i++) {
      for (const v of g.und[queue[i]]) {
        if (!depth.has(v)) {
          depth.set(v, depth.get(queue[i]) + 1);
          queue.push(v);
        }
      }
    }
    return depth;
  }

  // The node with the smallest eccentricity gives the shortest, most balanced tree.
  function center(g, members) {
    if (members.length > MAX_CENTER_SEARCH) return members[0];
    let best = members[0];
    let bestEcc = Infinity;
    for (const v of members) {
      const ecc = Math.max(...bfsDepths(g, v).values());
      if (ecc < bestEcc) {
        best = v;
        bestEcc = ecc;
      }
    }
    return best;
  }

  function treeRoots(g) {
    const text = rootInput.value.trim();
    const requested = text === "" ? null : Number(text) - g.base;
    return g.components.map((members) => {
      if (members.includes(requested)) return requested;
      if (g.directed) {
        const source = members.find((v) => g.inn[v].length === 0);
        if (source !== undefined) return source;
      }
      return center(g, members);
    });
  }

  // BFS spanning tree per component; leaves get consecutive slots, parents sit over their children.
  function treeLayout(g, roots) {
    const children = Array.from({ length: g.n }, () => []);
    const depth = new Array(g.n).fill(-1);
    const x = new Array(g.n);
    let cursor = 0;

    const place = (u) => {
      const kids = children[u];
      if (!kids.length) {
        x[u] = cursor++;
        return;
      }
      kids.forEach(place);
      x[u] = (x[kids[0]] + x[kids[kids.length - 1]]) / 2;
    };

    for (const r of roots) {
      depth[r] = 0;
      const queue = [r];
      for (let i = 0; i < queue.length; i++) {
        const u = queue[i];
        for (const v of new Set(g.und[u])) {
          if (depth[v] < 0) {
            depth[v] = depth[u] + 1;
            children[u].push(v);
            queue.push(v);
          }
        }
      }
      place(r);
      cursor += 0.5; // breathing room between components
    }

    return x.map((xi, u) => ({ x: xi * SPACING.treeX, y: depth[u] * SPACING.treeY }));
  }

  // Longest-path layering, then a few barycenter sweeps to untangle crossings.
  function layeredLayout(g) {
    const layer = new Array(g.n).fill(0);
    for (const u of g.topo) for (const v of g.out[u]) layer[v] = Math.max(layer[v], layer[u] + 1);

    const layers = [];
    for (let u = 0; u < g.n; u++) (layers[layer[u]] = layers[layer[u]] || []).push(u);

    const x = new Array(g.n);
    const spread = (L) => L.forEach((u, i) => (x[u] = i - (L.length - 1) / 2));
    layers.forEach(spread);

    const sweep = (L, nbrs) => {
      const bary = new Map(
        L.map((u) => {
          const xs = nbrs[u].map((v) => x[v]);
          return [u, xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : x[u]];
        })
      );
      L.sort((p, q) => bary.get(p) - bary.get(q) || p - q);
      spread(L);
    };
    for (let it = 0; it < 4; it++) {
      for (let l = 1; l < layers.length; l++) sweep(layers[l], g.inn);
      for (let l = layers.length - 2; l >= 0; l--) sweep(layers[l], g.out);
    }

    return x.map((xi, u) => ({ x: xi * SPACING.layerX, y: layer[u] * SPACING.layerY }));
  }

  function circleLayout(g) {
    const r = Math.max(110, (g.n * 64) / (2 * Math.PI));
    return Array.from({ length: g.n }, (_, i) => {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / g.n;
      return { x: r * Math.cos(a), y: r * Math.sin(a) };
    });
  }

  // Seeded so the same input always produces the same picture.
  function rng(seed) {
    return () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
  }

  // Fruchterman-Reingold with gravity, then rotated so the long axis fits the screen.
  function forceLayout(g, portrait) {
    const n = g.n;
    const k = SPACING.force;
    const rand = rng(n * 7919 + g.edges.length);
    const r0 = (k * Math.sqrt(n)) / 2;
    const pos = Array.from({ length: n }, (_, i) => {
      const a = (2 * Math.PI * i) / Math.max(1, n);
      return { x: r0 * Math.cos(a) + rand() * 10, y: r0 * Math.sin(a) + rand() * 10 };
    });

    const links = [];
    const linked = new Set();
    for (const e of g.edges) {
      const key = `${Math.min(e.u, e.v)},${Math.max(e.u, e.v)}`;
      if (e.u !== e.v && !linked.has(key)) {
        linked.add(key);
        links.push([e.u, e.v]);
      }
    }

    const iters = n > 300 ? Math.max(60, Math.floor(3e7 / (n * n))) : 400;
    const t0 = k * 2;
    const dx = new Float64Array(n);
    const dy = new Float64Array(n);
    for (let it = 0; it < iters; it++) {
      dx.fill(0);
      dy.fill(0);
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          let ex = pos[i].x - pos[j].x;
          let ey = pos[i].y - pos[j].y;
          let d = Math.hypot(ex, ey);
          if (d < 0.01) {
            ex = rand() - 0.5;
            ey = rand() - 0.5;
            d = 0.01;
          }
          const f = (k * k) / d / d;
          dx[i] += ex * f;
          dy[i] += ey * f;
          dx[j] -= ex * f;
          dy[j] -= ey * f;
        }
      }
      for (const [u, v] of links) {
        const ex = pos[u].x - pos[v].x;
        const ey = pos[u].y - pos[v].y;
        const d = Math.hypot(ex, ey) || 0.01;
        const f = d / k;
        dx[u] -= ex * f;
        dy[u] -= ey * f;
        dx[v] += ex * f;
        dy[v] += ey * f;
      }
      const t = t0 * (1 - it / iters) + 1;
      for (let i = 0; i < n; i++) {
        dx[i] -= pos[i].x * 0.04;
        dy[i] -= pos[i].y * 0.04;
        const len = Math.hypot(dx[i], dy[i]) || 1;
        const step = Math.min(len, t);
        pos[i].x += (dx[i] / len) * step;
        pos[i].y += (dy[i] / len) * step;
      }
    }

    return alignPrincipalAxis(pos, portrait);
  }

  function alignPrincipalAxis(pos, portrait) {
    if (pos.length < 2) return pos;
    const mx = pos.reduce((s, p) => s + p.x, 0) / pos.length;
    const my = pos.reduce((s, p) => s + p.y, 0) / pos.length;
    let cxx = 0;
    let cyy = 0;
    let cxy = 0;
    for (const p of pos) {
      cxx += (p.x - mx) ** 2;
      cyy += (p.y - my) ** 2;
      cxy += (p.x - mx) * (p.y - my);
    }
    const a = -0.5 * Math.atan2(2 * cxy, cxx - cyy) + (portrait ? Math.PI / 2 : 0);
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    return pos.map((p) => ({
      x: (p.x - mx) * cos - (p.y - my) * sin,
      y: (p.x - mx) * sin + (p.y - my) * cos,
    }));
  }

  // ---------- drawing ----------

  function el(tag, attrs, parent, text) {
    const node = document.createElementNS(NS, tag);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    if (text !== undefined) node.textContent = text;
    if (parent) parent.appendChild(node);
    return node;
  }

  // Parallel / antiparallel edges bow apart; repeated self-loops grow.
  function assignCurves(edges) {
    const groups = new Map();
    const loops = new Map();
    for (const e of edges) {
      if (e.u === e.v) {
        e.loop = loops.get(e.u) || 0;
        loops.set(e.u, e.loop + 1);
        continue;
      }
      const key = `${Math.min(e.u, e.v)},${Math.max(e.u, e.v)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }
    for (const list of groups.values()) {
      list.forEach((e, i) => {
        e.curve = (i - (list.length - 1) / 2) * 40 * (e.u < e.v ? 1 : -1);
      });
    }
  }

  // Self-loops point away from the node's neighbours, so they don't sit on top of other edges.
  function loopAngle(u, pos, g) {
    let vx = 0;
    let vy = 0;
    for (const v of g.und[u]) {
      if (v === u) continue;
      const l = Math.hypot(pos[v].x - pos[u].x, pos[v].y - pos[u].y) || 1;
      vx -= (pos[v].x - pos[u].x) / l;
      vy -= (pos[v].y - pos[u].y) / l;
    }
    return Math.hypot(vx, vy) < 0.1 ? -Math.PI / 2 : Math.atan2(vy, vx);
  }

  function edgeGeom(e, pos, R, g) {
    const p = pos[e.u];
    if (e.u === e.v) {
      const h = 44 * (1 + e.loop * 0.5);
      const a = loopAngle(e.u, pos, g);
      const at = (r, da) => ({ x: p.x + r * Math.cos(a + da), y: p.y + r * Math.sin(a + da) });
      const [s, c1, c2, t] = [at(R, -0.4), at(R + h, -0.5), at(R + h, 0.5), at(R, 0.4)];
      const label = at(R + h * 0.75 + 8, 0);
      return { d: `M${s.x},${s.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${t.x},${t.y}`, label };
    }
    const q = pos[e.v];
    const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    const nx = -(q.y - p.y) / len;
    const ny = (q.x - p.x) / len;
    const c = { x: (p.x + q.x) / 2 + nx * e.curve, y: (p.y + q.y) / 2 + ny * e.curve };
    const toward = (from, to) => {
      const l = Math.hypot(to.x - from.x, to.y - from.y) || 1;
      return { x: from.x + ((to.x - from.x) / l) * R, y: from.y + ((to.y - from.y) / l) * R };
    };
    const s = toward(p, c);
    const t = toward(q, c);
    return {
      d: e.curve ? `M${s.x},${s.y} Q${c.x},${c.y} ${t.x},${t.y}` : `M${s.x},${s.y} L${t.x},${t.y}`,
      label: { x: 0.25 * s.x + 0.5 * c.x + 0.25 * t.x, y: 0.25 * s.y + 0.5 * c.y + 0.25 * t.y },
    };
  }

  function draw(g, pos, roots) {
    svg.innerHTML = "";
    svg.classList.toggle("directed", g.directed);
    if (!g.n) {
      svg.setAttribute("width", 0);
      svg.setAttribute("height", 0);
      view = null;
      return;
    }

    const R = Math.max(18, 8 + String(g.base + g.n - 1).length * 4.5);
    const defs = el("defs", {}, svg);
    for (const [id, color] of [["arrow", "#aaaaaa"], ["arrow-hl", "#353535"]]) {
      const m = el(
        "marker",
        { id, viewBox: "0 0 10 10", refX: 10, refY: 5, markerWidth: 10, markerHeight: 10, markerUnits: "userSpaceOnUse", orient: "auto-start-reverse" },
        defs
      );
      el("path", { d: "M0,0 L10,5 L0,10 z", fill: color }, m);
    }

    assignCurves(g.edges);
    const edgeLayer = el("g", {}, svg);
    const edgeEls = g.edges.map((e) => {
      const node = el("g", { class: "edge" }, edgeLayer);
      const path = el("path", {}, node);
      const text = e.w === null ? null : el("text", {}, node, String(e.w));
      return { e, node, path, text };
    });

    const roleRoots = new Set(roots);
    const nodeLayer = el("g", {}, svg);
    const nodeEls = pos.map((_, i) => {
      const node = el("g", { class: "node" + (roleRoots.has(i) ? " root" : ""), "data-node": i }, nodeLayer);
      el("circle", { r: R, fill: PALETTE[g.comp[i] % PALETTE.length] }, node);
      el("text", {}, node, String(i + g.base));
      return node;
    });

    view = { g, pos, R, edgeEls, nodeEls };
    updatePositions();
    fit();
  }

  function updatePositions() {
    const { g, pos, R, edgeEls, nodeEls } = view;
    nodeEls.forEach((node, i) => node.setAttribute("transform", `translate(${pos[i].x},${pos[i].y})`));
    for (const { e, path, text } of edgeEls) {
      const geom = edgeGeom(e, pos, R, g);
      path.setAttribute("d", geom.d);
      if (text) {
        text.setAttribute("x", geom.label.x);
        text.setAttribute("y", geom.label.y);
      }
    }
  }

  // Never scale up; scale down to the container width, but not so far that labels become unreadable.
  function fit() {
    const { pos, R } = view;
    const pad = R + PAD + (view.g.selfLoops ? 40 : 0);
    let minX = Math.min(...pos.map((p) => p.x)) - pad;
    let maxX = Math.max(...pos.map((p) => p.x)) + pad;
    let minY = Math.min(...pos.map((p) => p.y)) - pad;
    let maxY = Math.max(...pos.map((p) => p.y)) + pad;

    const W = Math.max(wrap.clientWidth, 280);
    let bw = maxX - minX;
    let bh = maxY - minY;
    const scale = Math.max(MIN_SCALE, Math.min(1, W / bw));
    if (bw * scale < W) {
      minX -= (W / scale - bw) / 2;
      bw = W / scale;
    }
    const minH = 220 / scale;
    if (bh < minH) {
      minY -= (minH - bh) / 2;
      bh = minH;
    }
    svg.setAttribute("viewBox", `${minX} ${minY} ${bw} ${bh}`);
    svg.setAttribute("width", bw * scale);
    svg.setAttribute("height", bh * scale);
  }

  // ---------- interaction ----------

  function highlight(i) {
    const { g, edgeEls, nodeEls } = view;
    const near = new Set([i, ...g.und[i]]);
    svg.classList.add("hovering");
    nodeEls.forEach((node, j) => node.classList.toggle("dim", !near.has(j)));
    for (const { e, node } of edgeEls) {
      const hit = e.u === i || e.v === i;
      node.classList.toggle("hl", hit);
      node.classList.toggle("dim", !hit);
    }

    const ids = (list) => `[${list.map((v) => v + g.base).join(",")}]`;
    const id = i + g.base;
    statusEl.textContent = g.directed
      ? `node ${id} · out ${ids(g.out[i])} · in ${ids(g.inn[i])}`
      : `node ${id} · degree ${g.und[i].length} · neighbours ${ids(g.und[i])}`;
  }

  function clearHighlight() {
    if (!view) return;
    svg.classList.remove("hovering");
    view.nodeEls.forEach((n) => n.classList.remove("dim"));
    view.edgeEls.forEach(({ node }) => node.classList.remove("hl", "dim"));
    statusEl.textContent = view.note;
  }

  let drag = null;

  function toSvgPoint(ev) {
    const pt = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(svg.getScreenCTM().inverse());
    return { x: pt.x, y: pt.y };
  }

  svg.addEventListener("pointerdown", (ev) => {
    const node = ev.target.closest("[data-node]");
    if (!node || !view) return;
    ev.preventDefault();
    node.setPointerCapture(ev.pointerId);
    const i = +node.dataset.node;
    const p = toSvgPoint(ev);
    drag = { i, node, dx: view.pos[i].x - p.x, dy: view.pos[i].y - p.y, sx: ev.clientX, sy: ev.clientY, moved: false };
  });

  svg.addEventListener("pointermove", (ev) => {
    if (drag) {
      if (Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) > 3) drag.moved = true;
      if (!drag.moved) return;
      const p = toSvgPoint(ev);
      view.pos[drag.i] = { x: p.x + drag.dx, y: p.y + drag.dy };
      updatePositions();
      return;
    }
    const node = ev.target.closest && ev.target.closest("[data-node]");
    if (node && view) highlight(+node.dataset.node);
    else clearHighlight();
  });

  svg.addEventListener("pointerup", () => {
    if (!drag) return;
    const { i, moved } = drag;
    drag = null;
    // A click (no drag) on a node re-roots the tree there.
    if (!moved && view.layout === "tree") {
      rootInput.value = i + view.g.base;
      render();
    }
  });

  svg.addEventListener("pointerleave", () => {
    if (!drag) clearHighlight();
  });

  // ---------- stats & outputs ----------

  function renderStats(g) {
    const degree = (i) => (g.directed ? g.out[i].length + g.inn[i].length : g.und[i].length);
    let maxDeg = -1;
    let maxNode = 0;
    for (let i = 0; i < g.n; i++) {
      if (degree(i) > maxDeg) {
        maxDeg = degree(i);
        maxNode = i;
      }
    }

    let type;
    if (g.directed) type = g.topo ? (g.isForest && g.components.length === 1 ? "Tree (DAG)" : "DAG") : "Has a cycle";
    else type = g.isForest ? (g.components.length === 1 ? "Tree" : "Forest") : "Has a cycle";

    const edgeNotes = [];
    if (g.selfLoops) edgeNotes.push(`${g.selfLoops} self-loop${g.selfLoops > 1 ? "s" : ""}`);
    if (g.dupes) edgeNotes.push(`${g.dupes} duplicate${g.dupes > 1 ? "s" : ""}`);

    const stats = [
      ["Nodes", g.n, ""],
      ["Edges", g.edges.length, edgeNotes.join(", ")],
      ["Components", g.components.length, ""],
      ["Type", type, ""],
      ["Max degree", g.n ? maxDeg : "-", g.n ? `node ${maxNode + g.base}` : ""],
    ];
    statsEl.innerHTML = "";
    for (const [label, value, note] of stats) {
      const div = document.createElement("div");
      div.className = "stat";
      div.innerHTML = `<div class="stat-label"></div><div class="stat-value"></div><div class="stat-note"></div>`;
      div.children[0].textContent = label;
      div.children[1].textContent = value;
      div.children[2].textContent = note;
      statsEl.appendChild(div);
    }
  }

  function renderOutputs(g) {
    const lists = g.directed ? g.out : g.und;
    adjOut.textContent = lists.map((l, i) => `${i + g.base}: [${l.map((v) => v + g.base).join(",")}]`).join("\n") || "(empty)";

    const toIds = (list) => list.map((v) => v + g.base);
    if (g.directed) {
      extraLabel.textContent = "Topological order";
      extraOut.textContent = g.topo ? JSON.stringify(toIds(g.topo)) : "None: the graph has a cycle.";
    } else {
      extraLabel.textContent = "Connected components";
      extraOut.textContent = JSON.stringify(g.components.map(toIds));
    }
  }

  function layoutNote(g, layout, roots) {
    let note = `Layout: ${LAYOUT_NAMES[layout]}`;
    if (layoutSel.value === "layered" && layout !== "layered") note += " (graph has a cycle, so it can't be layered)";
    if (layout === "tree") {
      note += `, rooted at ${roots.map((r) => r + g.base).join(", ")}. Click a node to re-root`;
    }
    return note + ". Drag nodes to rearrange.";
  }

  // ---------- main ----------

  function render() {
    let g;
    try {
      g = buildGraph(parseEdges(edgesInput.value));
      errorEl.textContent = "";
    } catch (e) {
      errorEl.textContent = e.message;
      return;
    }
    writeHash();

    const layout = chooseLayout(g);
    const portrait = layout === "force" && wrap.clientWidth < PORTRAIT_WIDTH;
    const key = JSON.stringify([g.n, g.base, g.directed, g.edges.map((e) => [e.u, e.v]), layout, rootInput.value.trim(), portrait]);
    if (cache.key !== key) cache = { key, ...computeLayout(g, layout, portrait) };

    draw(g, cache.pos, cache.roots);
    if (view) {
      view.layout = layout;
      view.note = layoutNote(g, layout, cache.roots);
      statusEl.textContent = view.note;
    } else {
      statusEl.textContent = "";
    }
    renderStats(g);
    renderOutputs(g);
  }

  // ---------- url state ----------

  function writeHash() {
    const params = new URLSearchParams();
    params.set("e", edgesInput.value.trim());
    if (nInput.value.trim()) params.set("n", nInput.value.trim());
    if (baseSel.value !== "0") params.set("base", baseSel.value);
    if (directedChk.checked) params.set("dir", "1");
    if (layoutSel.value !== "auto") params.set("layout", layoutSel.value);
    if (rootInput.value.trim()) params.set("root", rootInput.value.trim());
    history.replaceState(null, "", "#" + params.toString());
  }

  function readHash() {
    const params = new URLSearchParams(location.hash.slice(1));
    if (!params.has("e")) {
      edgesInput.value = SAMPLE_EDGES;
      nInput.value = SAMPLE_N;
      return;
    }
    edgesInput.value = params.get("e");
    nInput.value = params.get("n") || "";
    if (params.get("base") === "1") baseSel.value = "1";
    directedChk.checked = params.get("dir") === "1";
    const layout = params.get("layout");
    if (layout && [...layoutSel.options].some((o) => o.value === layout)) layoutSel.value = layout;
    rootInput.value = params.get("root") || "";
  }

  function flash(button, text) {
    const original = button.textContent;
    button.textContent = text;
    setTimeout(() => (button.textContent = original), 1200);
  }

  function copy(text, button) {
    navigator.clipboard.writeText(text).then(
      () => flash(button, "Copied"),
      () => flash(button, "Failed")
    );
  }

  // ---------- wiring ----------

  let debounce;
  const later = (ms) => {
    clearTimeout(debounce);
    debounce = setTimeout(render, ms);
  };
  edgesInput.addEventListener("input", () => later(200));
  nInput.addEventListener("input", () => later(200));
  rootInput.addEventListener("input", () => later(200));
  [baseSel, directedChk, layoutSel].forEach((c) => c.addEventListener("change", render));
  window.addEventListener("resize", () => later(100));
  $("sample").addEventListener("click", () => {
    edgesInput.value = SAMPLE_EDGES;
    nInput.value = SAMPLE_N;
    rootInput.value = "";
    render();
  });
  $("relayout").addEventListener("click", () => {
    cache.key = null;
    render();
  });
  $("copy-link").addEventListener("click", (e) => copy(location.href, e.currentTarget));
  $("copy-adj").addEventListener("click", (e) => copy(adjOut.textContent, e.currentTarget));

  readHash();
  render();
})();
