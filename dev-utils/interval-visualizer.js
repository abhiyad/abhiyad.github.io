(function () {
  const SAMPLE =
    "[[1,1],[26,29],[18,24],[3,3],[13,13],[27,27],[15,15],[20,21],[4,4],[5,16],[21,27],[29,29],[6,6],[7,7]]";

  // One colour per merged group, cycled.
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
  const ROW_H = 24;
  const BAR_H = 16;
  const DEPTH_H = 56;
  const MARGIN = { top: 26, right: 24, bottom: 26, left: 64 };
  // Integer data spanning more than this is drawn as segments, not unit cells.
  const MAX_CELLS = 2000;

  const $ = (id) => document.getElementById(id);
  const input = $("input");
  const errorEl = $("error");
  const orderSel = $("order");
  const packChk = $("pack");
  const svg = $("chart");
  const wrap = $("chart-wrap");
  const tooltip = $("tooltip");
  const statsEl = $("stats");
  const mergedOut = $("merged-out");

  let state = null;

  // ---------- parsing ----------

  function parse(text) {
    const trimmed = text.trim();
    if (!trimmed) return [];

    let data;
    try {
      data = JSON.parse(trimmed);
    } catch (_) {
      // Fall back to pulling numbers out pairwise, e.g. "1 3\n2 6" or "(1,3),(2,6)".
      const nums = trimmed.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/gi) || [];
      if (nums.length % 2) {
        throw new Error("Odd number of values: every interval needs a start and an end.");
      }
      data = [];
      for (let i = 0; i < nums.length; i += 2) data.push([+nums[i], +nums[i + 1]]);
    }

    if (!Array.isArray(data)) throw new Error("Expected an array like [[1,3],[2,6]].");
    if (data.length === 2 && data.every((n) => typeof n === "number")) data = [data];

    return data.map((pair, i) => {
      if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(Number.isFinite)) {
        throw new Error(`Item #${i} is not a [start, end] pair: ${JSON.stringify(pair)}`);
      }
      const [a, b] = pair;
      return { idx: i, start: Math.min(a, b), end: Math.max(a, b), reversed: a > b };
    });
  }

  // ---------- algorithms ----------

  function byStart(p, q) {
    return p.start - q.start || p.end - q.end;
  }

  // Closed intervals: [1,3] and [3,5] overlap, [1,2] and [3,4] do not.
  function merge(intervals) {
    const groups = [];
    for (const iv of [...intervals].sort(byStart)) {
      const last = groups[groups.length - 1];
      if (last && iv.start <= last.end) {
        last.end = Math.max(last.end, iv.end);
        last.members.push(iv);
      } else {
        groups.push({ start: iv.start, end: iv.end, members: [iv] });
      }
    }
    groups.forEach((g, gi) => g.members.forEach((m) => (m.group = gi)));
    return groups;
  }

  function covering(intervals, x) {
    return intervals.filter((iv) => iv.start <= x && x <= iv.end);
  }

  // Greedy lane assignment: first lane whose last interval ended strictly before this start.
  function packLanes(intervals) {
    const laneEnds = [];
    const lanes = [];
    for (const iv of [...intervals].sort(byStart)) {
      let lane = laneEnds.findIndex((end) => end < iv.start);
      if (lane === -1) {
        lane = laneEnds.length;
        lanes.push([]);
      }
      laneEnds[lane] = iv.end;
      lanes[lane].push(iv);
    }
    return lanes;
  }

  // Overlap depth as a list of { from, to, depth } cells to draw.
  function depthProfile(intervals, allInt, lo, hi) {
    const cells = [];
    if (allInt && hi - lo <= MAX_CELLS) {
      const diff = new Array(hi - lo + 2).fill(0);
      for (const iv of intervals) {
        diff[iv.start - lo] += 1;
        diff[iv.end - lo + 1] -= 1;
      }
      let run = 0;
      for (let x = lo; x <= hi; x++) {
        run += diff[x - lo];
        cells.push({ from: x - 0.5, to: x + 0.5, depth: run, at: x });
      }
      return cells;
    }
    const points = [...new Set(intervals.flatMap((iv) => [iv.start, iv.end]))].sort((a, b) => a - b);
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      cells.push({ from: p, to: p, depth: covering(intervals, p).length, at: p });
      if (i + 1 < points.length) {
        const mid = (p + points[i + 1]) / 2;
        cells.push({ from: p, to: points[i + 1], depth: covering(intervals, mid).length, at: mid });
      }
    }
    return cells;
  }

  // ---------- formatting ----------

  function fmt(v) {
    return Number.isInteger(v) ? String(v) : String(+v.toFixed(3));
  }

  function ivText(iv) {
    return `[${fmt(iv.start)},${fmt(iv.end)}]`;
  }

  function niceStep(span, targetTicks) {
    const raw = span / Math.max(1, targetTicks);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag;
    return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
  }

  function el(tag, attrs, parent, text) {
    const node = document.createElementNS(NS, tag);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    if (text !== undefined) node.textContent = text;
    if (parent) parent.appendChild(node);
    return node;
  }

  // ---------- rendering ----------

  function render() {
    let intervals;
    try {
      intervals = parse(input.value);
      errorEl.textContent = "";
    } catch (e) {
      errorEl.textContent = e.message;
      return;
    }
    writeHash();
    orderSel.disabled = packChk.checked;

    svg.innerHTML = "";
    tooltip.hidden = true;
    if (!intervals.length) {
      state = null;
      statsEl.innerHTML = "";
      mergedOut.textContent = "[]";
      svg.setAttribute("height", 0);
      return;
    }

    const groups = merge(intervals);
    const allInt = intervals.every((iv) => Number.isInteger(iv.start) && Number.isInteger(iv.end));
    const lo = Math.min(...intervals.map((iv) => iv.start));
    const hi = Math.max(...intervals.map((iv) => iv.end));
    const pad = Math.max((hi - lo) * 0.03, allInt ? 1 : 0.5);
    const d0 = lo - pad;
    const d1 = hi + pad;

    const rows = buildRows(intervals);
    const profile = depthProfile(intervals, allInt, lo, hi);
    const maxDepth = Math.max(...profile.map((c) => c.depth));

    const width = Math.max(wrap.clientWidth, 280);
    const plotW = width - MARGIN.left - MARGIN.right;
    const x = (v) => MARGIN.left + ((v - d0) / (d1 - d0)) * plotW;
    const invX = (px) => d0 + ((px - MARGIN.left) / plotW) * (d1 - d0);

    const rowsTop = MARGIN.top + 8;
    const rowsBottom = rowsTop + rows.length * ROW_H;
    const mergedTop = rowsBottom + 18;
    const depthTop = mergedTop + ROW_H + 22;
    const depthBottom = depthTop + DEPTH_H;
    const height = depthBottom + MARGIN.bottom;

    svg.setAttribute("width", width);
    svg.setAttribute("height", height);
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

    // Grid + axis labels top and bottom.
    let step = niceStep(d1 - d0, Math.floor(plotW / 55));
    if (allInt) step = Math.max(1, Math.round(step));
    const gridG = el("g", {}, svg);
    for (let t = Math.ceil(d0 / step) * step; t <= d1; t += step) {
      const tx = x(t);
      el("line", { class: "grid", x1: tx, x2: tx, y1: MARGIN.top, y2: depthBottom }, gridG);
      const anchor = tx > width - 14 ? "end" : "middle";
      el("text", { class: "axis-label", x: tx, y: MARGIN.top - 8, "text-anchor": anchor }, gridG, fmt(t));
      el("text", { class: "axis-label", x: tx, y: depthBottom + 16, "text-anchor": anchor }, gridG, fmt(t));
    }

    // Interval rows.
    const ivG = el("g", {}, svg);
    rows.forEach((row, ri) => {
      const cy = rowsTop + ri * ROW_H + ROW_H / 2;
      const label = packChk.checked ? `lane ${ri}` : `#${row[0].idx}`;
      el("text", { class: "row-label", x: MARGIN.left - 10, y: cy + 4, "text-anchor": "end" }, ivG, label);
      let drawnRight = -Infinity;
      row.forEach((iv, i) => {
        const bounds = neighbourBounds(row, i, x, width, drawnRight);
        drawnRight = drawBar(ivG, iv, cy, x, PALETTE[iv.group % PALETTE.length], bounds, "iv", { "data-idx": iv.idx });
      });
    });

    // Merged row.
    el("line", { class: "separator", x1: 0, x2: width, y1: mergedTop - 9, y2: mergedTop - 9 }, svg);
    const mergedG = el("g", {}, svg);
    const mcy = mergedTop + ROW_H / 2;
    el("text", { class: "section-label", x: MARGIN.left - 10, y: mcy + 4, "text-anchor": "end" }, mergedG, "merged");
    let drawnRight = -Infinity;
    groups.forEach((g, gi) => {
      const bounds = neighbourBounds(groups, gi, x, width, drawnRight);
      drawnRight = drawBar(mergedG, g, mcy, x, PALETTE[gi % PALETTE.length], bounds, "iv merged", { "data-group": gi });
    });

    // Depth profile.
    el("line", { class: "separator", x1: 0, x2: width, y1: depthTop - 12, y2: depthTop - 12 }, svg);
    const depthG = el("g", {}, svg);
    el("text", { class: "section-label", x: MARGIN.left - 10, y: depthTop + 12, "text-anchor": "end" }, depthG, "depth");
    el("text", { class: "row-label", x: MARGIN.left - 10, y: depthTop + 26, "text-anchor": "end" }, depthG, `max ${maxDepth}`);
    for (const c of profile) {
      if (!c.depth) continue;
      const h = (c.depth / maxDepth) * DEPTH_H;
      const x0 = x(c.from);
      const w = Math.max(2, x(c.to) - x0 - (c.from === c.to ? 0 : 1));
      el(
        "rect",
        {
          class: "depth-cell" + (c.depth === maxDepth ? " max" : ""),
          x: c.from === c.to ? x0 - 1 : x0 + 0.5,
          y: depthBottom - h,
          width: w,
          height: h,
        },
        depthG
      );
    }

    state = { intervals, groups, allInt, invX, x, lo, hi, d0, d1, rowsTop, depthBottom };
    renderStats(intervals, groups, profile, maxDepth, allInt);
    mergedOut.textContent = JSON.stringify(groups.map((g) => [g.start, g.end]));
  }

  function buildRows(intervals) {
    if (packChk.checked) return packLanes(intervals);
    const ordered = [...intervals];
    const order = orderSel.value;
    if (order === "start") ordered.sort(byStart);
    else if (order === "end") ordered.sort((p, q) => p.end - q.end || p.start - q.start);
    else if (order === "length") ordered.sort((p, q) => q.end - q.start - (p.end - p.start) || byStart(p, q));
    return ordered.map((iv) => [iv]);
  }

  // Free horizontal space around item i of a start-sorted row, for placing its label.
  // drawnRight is the right edge of whatever the previous item drew (shape or label).
  function neighbourBounds(row, i, x, width, drawnRight) {
    const prev = row[i - 1];
    const next = row[i + 1];
    return {
      min: Math.max(drawnRight + 4, prev ? x(prev.end) + (prev.start === prev.end ? 6 : 0) + 4 : MARGIN.left - 4),
      max: next ? x(next.start) - (next.start === next.end ? 6 : 0) - 4 : width,
    };
  }

  // Returns the right edge of what was drawn, so the next item's label can avoid it.
  function drawBar(parent, iv, cy, x, color, bounds, cls, data) {
    const g = el("g", Object.assign({ class: cls }, data), parent);
    const x0 = x(iv.start);
    const x1 = x(iv.end);
    const text = ivText(iv);
    const textW = text.length * 6.7 + 10;
    let right;

    if (iv.start === iv.end) {
      el("circle", { cx: x0, cy, r: 6, fill: color }, g);
      right = x0 + 6;
    } else {
      el("rect", { x: x0, y: cy - BAR_H / 2, width: Math.max(3, x1 - x0), height: BAR_H, rx: 4, fill: color }, g);
      if (iv.reversed) {
        el("rect", { x: x0, y: cy - BAR_H / 2, width: x1 - x0, height: BAR_H, rx: 4, fill: "none", stroke: "#c0392b", "stroke-width": 2 }, g);
      }
      right = x1;
      if (x1 - x0 >= textW) {
        el("text", { class: "bar-text-in", x: (x0 + x1) / 2, y: cy + 4, "text-anchor": "middle" }, g, text);
        return right;
      }
    }
    // Label beside the bar: right if there's room, else left, else leave it to the tooltip.
    const left = iv.start === iv.end ? x0 - 6 : x0;
    if (right + textW <= bounds.max) {
      el("text", { class: "bar-text-out", x: right + 6, y: cy + 4 }, g, text);
      return right + textW;
    }
    if (left - textW >= bounds.min) {
      el("text", { class: "bar-text-out", x: left - 6, y: cy + 4, "text-anchor": "end" }, g, text);
    }
    return right;
  }

  function renderStats(intervals, groups, profile, maxDepth, allInt) {
    const peak = profile.find((c) => c.depth === maxDepth);
    const covered = groups.reduce((s, g) => s + (g.end - g.start + (allInt ? 1 : 0)), 0);
    const reversed = intervals.filter((iv) => iv.reversed).length;
    const stats = [
      ["Intervals", intervals.length, reversed ? `${reversed} reversed (start > end)` : ""],
      ["Range", `[${fmt(state.lo)}, ${fmt(state.hi)}]`, ""],
      ["Merged groups", groups.length, ""],
      ["Max overlap", maxDepth, peak ? `first at x = ${fmt(peak.at)}` : ""],
      [allInt ? "Covered points" : "Covered length", fmt(covered), ""],
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

  // ---------- hover ----------

  function onMove(e) {
    if (!state) return;
    const rect = svg.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    let v = state.invX(px);
    if (v < state.d0 || v > state.d1) return onLeave();
    if (state.allInt) v = Math.round(v);

    const hits = covering(state.intervals, v);
    const hitIdx = new Set(hits.map((iv) => iv.idx));
    const hitGroups = new Set(hits.map((iv) => iv.group));

    // Hovering a specific bar focuses just that interval.
    const barNode = e.target.closest && e.target.closest("[data-idx]");
    const focused = barNode ? state.intervals[+barNode.dataset.idx] : null;

    svg.classList.add("hovering");
    svg.querySelectorAll(".iv").forEach((node) => {
      let lit;
      if (focused) {
        lit = node.dataset.idx !== undefined ? +node.dataset.idx === focused.idx : +node.dataset.group === focused.group;
      } else {
        lit = node.dataset.idx !== undefined ? hitIdx.has(+node.dataset.idx) : hitGroups.has(+node.dataset.group);
      }
      node.classList.toggle("dim", !lit);
    });

    let guide = svg.querySelector(".guide");
    if (!guide) guide = el("line", { class: "guide" }, svg);
    const gx = state.x(v);
    guide.setAttribute("x1", gx);
    guide.setAttribute("x2", gx);
    guide.setAttribute("y1", state.rowsTop - 8);
    guide.setAttribute("y2", state.depthBottom);

    let html;
    if (focused) {
      html =
        `<strong>#${focused.idx} ${ivText(focused)}</strong>` +
        `<div class="muted">length ${fmt(focused.end - focused.start)} · group ${focused.group}</div>`;
    } else {
      const list = hits
        .slice(0, 8)
        .map((iv) => `#${iv.idx} ${ivText(iv)}`)
        .join("<br>");
      const more = hits.length > 8 ? `<br><span class="muted">+${hits.length - 8} more</span>` : "";
      html =
        `<strong>x = ${fmt(v)}</strong> · depth ${hits.length}` +
        (hits.length ? `<div>${list}${more}</div>` : `<div class="muted">not covered</div>`);
    }
    tooltip.innerHTML = html;
    tooltip.hidden = false;

    const wrapRect = wrap.getBoundingClientRect();
    let tx = e.clientX - wrapRect.left + wrap.scrollLeft + 14;
    const ty = py + 14;
    if (tx + tooltip.offsetWidth > wrap.scrollLeft + wrap.clientWidth) tx -= tooltip.offsetWidth + 28;
    tooltip.style.left = `${tx}px`;
    tooltip.style.top = `${ty}px`;
  }

  function onLeave() {
    svg.classList.remove("hovering");
    svg.querySelectorAll(".iv.dim").forEach((n) => n.classList.remove("dim"));
    const guide = svg.querySelector(".guide");
    if (guide) guide.remove();
    tooltip.hidden = true;
  }

  // ---------- url state ----------

  function writeHash() {
    const params = new URLSearchParams();
    params.set("i", input.value.trim());
    if (orderSel.value !== "input") params.set("order", orderSel.value);
    if (packChk.checked) params.set("pack", "1");
    history.replaceState(null, "", "#" + params.toString());
  }

  function readHash() {
    const params = new URLSearchParams(location.hash.slice(1));
    input.value = params.get("i") || SAMPLE;
    const order = params.get("order");
    if (order && [...orderSel.options].some((o) => o.value === order)) orderSel.value = order;
    packChk.checked = params.get("pack") === "1";
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
  input.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(render, 150);
  });
  orderSel.addEventListener("change", render);
  packChk.addEventListener("change", render);
  svg.addEventListener("mousemove", onMove);
  svg.addEventListener("mouseleave", onLeave);
  window.addEventListener("resize", () => {
    clearTimeout(debounce);
    debounce = setTimeout(render, 100);
  });
  $("sample").addEventListener("click", () => {
    input.value = SAMPLE;
    render();
  });
  $("copy-link").addEventListener("click", (e) => copy(location.href, e.currentTarget));
  $("copy-merged").addEventListener("click", (e) => copy(mergedOut.textContent, e.currentTarget));

  readHash();
  render();
})();
