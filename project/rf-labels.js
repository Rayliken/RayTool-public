/* Measured labels: local placement first, collision-free overflow and persistent manual positions. */
(function (host) {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  function bounds(root, node) {
    const b = node.getBBox(),
      mat = node.getCTM(),
      inv = root.getCTM()?.inverse();
    if (!mat || !inv) return [b.x, b.y, b.x + b.width, b.y + b.height];
    const t = inv.multiply(mat),
      ps = [
        [b.x, b.y],
        [b.x + b.width, b.y],
        [b.x, b.y + b.height],
        [b.x + b.width, b.y + b.height],
      ].map((p) => new DOMPoint(...p).matrixTransform(t));
    return [
      Math.min(...ps.map((p) => p.x)),
      Math.min(...ps.map((p) => p.y)),
      Math.max(...ps.map((p) => p.x)),
      Math.max(...ps.map((p) => p.y)),
    ];
  }
  function resolve(source, model, kind = "layout") {
    if (typeof document === "undefined")
      return {
        svg: source,
        placements: {},
        report: { status: "requires_browser_measurement" },
      };
    const scope = kind === "layout" ? "layout" : "topology",
      doc = new DOMParser().parseFromString(source, "image/svg+xml"),
      root = document.importNode(doc.documentElement, true),
      holder = document.createElement("div");
    holder.style.cssText =
      "position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none";
    holder.append(root);
    document.body.append(holder);
    const vb = root.viewBox.baseVal,
      grid = new Map(),
      CELL = 96;
    let seq = 0;
    function insert(b, type) {
      const r = { b, type, id: seq++ };
      for (let x = Math.floor(b[0] / CELL); x <= Math.floor(b[2] / CELL); x++)
        for (
          let y = Math.floor(b[1] / CELL);
          y <= Math.floor(b[3] / CELL);
          y++
        ) {
          const k = x + "," + y;
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push(r);
        }
    }
    function query(b) {
      const out = [],
        seen = new Set();
      for (let x = Math.floor(b[0] / CELL); x <= Math.floor(b[2] / CELL); x++)
        for (let y = Math.floor(b[1] / CELL); y <= Math.floor(b[3] / CELL); y++)
          for (const r of grid.get(x + "," + y) || [])
            if (!seen.has(r.id)) {
              seen.add(r.id);
              out.push(r);
            }
      return out;
    }
    const overlap = (a, b) => {
      const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]),
        h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
      return w > 0.05 && h > 0.05 ? w * h : 0;
    };
    // fixed markers of movable cards (TestPoint pin, measured-point diamond, stair dot) are obstacles too
    for (const sh of root.querySelectorAll("[data-label-obstacle]")) {
      const b = bounds(root, sh);
      insert([b[0] - 1, b[1] - 1, b[2] + 1, b[3] + 1], "symbol");
    }
    for (const g of root.querySelectorAll("[data-node-id]"))
      for (const sh of g.querySelectorAll("path,rect,circle,polygon")) {
        if (sh.hasAttribute("data-survey-leader")) continue;
        const b = bounds(root, sh);
        insert([b[0] - 2, b[1] - 2, b[2] + 2, b[3] + 2], "symbol");
      }
    for (const p of root.querySelectorAll("[data-edge-id] > path"))
      try {
        const L = p.getTotalLength();
        let a = p.getPointAtLength(0);
        for (let d = 20; d < L + 20; d += 20) {
          const b = p.getPointAtLength(Math.min(d, L));
          insert(
            [
              Math.min(a.x, b.x) - 1,
              Math.min(a.y, b.y) - 1,
              Math.max(a.x, b.x) + 1,
              Math.max(a.y, b.y) + 1,
            ],
            "wire",
          );
          a = b;
        }
      } catch (e) {}
    const texts = [
        ...root.querySelectorAll(
          "text[data-e],text[data-n],[data-rf-label]",
        ),
      ].filter((t) => t.textContent.trim() && !t.hasAttribute("data-port")),
      moving = new Set(texts),
      manual = model.meta?.label_positions?.[scope] || {};
    // cards (<g data-rf-label>) move as a whole: their own texts are not obstacles
    for (const t of root.querySelectorAll("text"))
      if (!moving.has(t) && !moving.has(t.closest("g[data-rf-label]"))) insert(bounds(root, t), "fixed");
    const counters = {},
      items = texts
        .map((el, i) => {
          const b = bounds(root, el),
            g = el.closest("[data-node-id],[data-edge-id]"),
            nid = el.getAttribute("data-n") || g?.getAttribute("data-node-id"),
            eid = el.getAttribute("data-e") || g?.getAttribute("data-edge-id"),
            n = model.nodes?.[nid],
            base = nid ? "node:" + nid : "edge:" + eid,
            counter = counters[base] || 0;
          counters[base] = counter + 1;
          const key = el.getAttribute("data-label-key") || base + ":" + counter,
            xy = (el.getAttribute("data-anchor") || "").split(",").map(Number);
          let anchor =
            xy.length === 2 && xy.every(Number.isFinite)
              ? xy
              : nid && g
                ? (() => {
                    const bs = [...g.querySelectorAll("path,rect,circle")]
                      .filter((s) => !s.closest("[data-label-leader]"))
                      .map((s) => bounds(root, s));
                    return bs.length
                      ? [
                          (Math.min(...bs.map((b) => b[0])) +
                            Math.max(...bs.map((b) => b[2]))) /
                            2,
                          (Math.min(...bs.map((b) => b[1])) +
                            Math.max(...bs.map((b) => b[3]))) /
                            2,
                        ]
                      : [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
                  })()
                : [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
          return {
            el,
            b,
            nid,
            eid,
            key,
            anchor,
            manual: manual[key],
            // cards keep their drawing position unless they collide (data-keep-place)
            keep: el.hasAttribute("data-keep-place"),
            priority: manual[key]
              ? -1
              : el.hasAttribute("data-label-priority")
                ? Number(el.getAttribute("data-label-priority"))
                : n?.kind === "device"
                ? 0
                : n?.kind === "antenna"
                  ? 1
                  : 2,
          };
        })
        .sort(
          (a, b) =>
            a.priority - b.priority ||
            (b.b[2] - b.b[0]) * (b.b[3] - b.b[1]) -
              (a.b[2] - a.b[0]) * (a.b[3] - a.b[1]) ||
            a.key.localeCompare(b.key, undefined, { numeric: true }),
        );
    const placements = {},
      conflicts = [];
    let maxLeader = 0,
      overflow = 0;
    for (const o of items) {
      const b = o.b,
        pad = 2,
        w = b[2] - b[0],
        h = b[3] - b[1],
        a = o.anchor,
        limit =
          scope === "layout" ? model.meta?.layout_max_leader_px || 180 : 100;
      let best = null;
      function consider(left, top, pinned = false) {
        if(!pinned&&o.el.hasAttribute("data-device-db")&&top<o.b[1]-.01)return;
        const bb = [left - pad, top - pad, left + w + pad, top + h + pad],
          outside =
            Math.max(0, vb.x - bb[0]) +
            Math.max(0, vb.y - bb[1]) +
            Math.max(0, bb[2] - vb.x - vb.width) +
            Math.max(0, bb[3] - vb.y - vb.height);
        if (outside > 0.05 && !pinned) return;
        let hard = 0,
          wire = 0;
        for (const q of query(bb)) {
          const ar = overlap(bb, q.b);
          if (q.type === "wire") wire += ar;
          else hard += ar;
        }
        const nx = Math.max(bb[0], Math.min(bb[2], a[0])),
          ny = Math.max(bb[1], Math.min(bb[3], a[1])),
          leader = Math.hypot(nx - a[0], ny - a[1]),
          home = Math.hypot(left - b[0], top - b[1]),
          score = o.keep
            ? hard * 1e7 + wire * 3 + home * 6 + leader * 0.5     // white cards: stay home, do not cover cables
            : hard * 1e7 +
              wire * (o.el.hasAttribute("data-destination-label") ? 100000 : 0.2) +
              leader * 8 +
              Math.max(0, leader - limit) * 100 +
              home * 0.08;
        if (!best || score < best.score)
          best = { left, top, bb, hard, wire, leader, nx, ny, score };
      }
      // search around the anchor, or for a card around its own drawing position
      const c = o.keep ? [b[0] + w / 2, b[1] + h / 2] : a;
      if (o.manual) consider(a[0] + o.manual.left, a[1] + o.manual.top, true);
      else {
        consider(b[0], b[1]);
        for (const r of o.keep ? [3, 8, 15, 25, 40, 60, 85, 115, 150, 200, 260] : [6, 12, 22, 36, 55, 80, 110, 150, 200, 260])
          for (let i = 0; i < 24; i++) {
            const ang = (i * Math.PI) / 12;
            consider(
              c[0] + Math.cos(ang) * (o.keep ? r : w / 2 + r) - w / 2,
              c[1] + Math.sin(ang) * (o.keep ? r : h / 2 + r) - h / 2,
            );
          }
        // Flush positions against neighbouring labels often fit better than a radial grid.
        if (!best || best.hard || best.leader > limit) {
          for (const q of query([
            a[0] - w - limit,
            a[1] - h - limit,
            a[0] + w + limit,
            a[1] + h + limit,
          ]))
            if (q.type === "label")
              for (const xx of [q.b[0] - w - 5, q.b[2] + 5, a[0] - w / 2])
                for (const yy of [q.b[1] - h - 5, q.b[3] + 5, a[1] - h / 2])
                  consider(xx, yy);
        }
        if (!best || best.hard) {
          overflow++;
          for (const r of [
            320, 420, 560, 740, 960, 1280, 1700, 2200, 3000, 4200,
          ]) {
            for (let i = 0; i < 48; i++) {
              const ang = (i * Math.PI) / 24;
              consider(
                c[0] + Math.cos(ang) * (w / 2 + r) - w / 2,
                c[1] + Math.sin(ang) * (h / 2 + r) - h / 2,
              );
            }
            if (best && !best.hard) break;
          }
        }
      }
      if (!best)
        best = {
          left: b[0],
          top: b[1],
          bb: b,
          hard: 1,
          wire: 0,
          leader: 0,
          nx: a[0],
          ny: a[1],
        };
      const dx = best.left - b[0],
        dy = best.top - b[1];
      o.el.setAttribute(
        "transform",
        `translate(${dx.toFixed(3)} ${dy.toFixed(3)})`,
      );
      o.el.setAttribute("data-label-key", o.key);
      o.el.setAttribute("data-anchor", a.join(","));
      o.el.setAttribute("data-label-scope", scope);
      o.el.setAttribute(
        "data-label-conflict",
        best.hard > 0.05 ? "true" : "false",
      );
      o.el.classList.add("rf-label");
      const lc = o.el.getAttribute("data-leader-color");
      if (best.leader > (lc ? 2 : 8)) {
        // same look as the TestPoint cards: the label's own colour, width in proportion to the text, and (for plain
        // labels, whose target has no marker of its own) a small dot where the leader points
        const txt = o.el.matches("text") ? o.el : o.el.querySelector("text"),
          fsz = Number(txt?.getAttribute("font-size")) || 10,
          color = lc || txt?.getAttribute("fill") || "#555",
          w = o.el.getAttribute("data-leader-width") || String(+(fsz * 0.06).toFixed(3));
        const g = document.createElementNS(NS, "g");
        g.setAttribute("data-label-leader", o.key);
        g.setAttribute("pointer-events", "none");
        g.setAttribute("opacity", "0.85");
        const p = document.createElementNS(NS, "path");
        p.setAttribute("d", `M${a[0]},${a[1]}L${best.nx},${best.ny}`);
        p.setAttribute("stroke", color);
        p.setAttribute("stroke-width", w);
        p.setAttribute("stroke-linecap", "round");
        p.setAttribute("fill", "none");
        g.append(p);
        if (!lc) {
          const d = document.createElementNS(NS, "circle");
          d.setAttribute("cx", a[0]); d.setAttribute("cy", a[1]); d.setAttribute("r", String(+(w * 1.8).toFixed(3)));
          d.setAttribute("fill", color);
          g.append(d);
        }
        o.el.parentNode.insertBefore(g, o.el);
      }
      insert(best.bb, "label");
      placements[o.key] = {
        bbox: best.bb,
        anchor: a,
        left: best.left - a[0],
        top: best.top - a[1],
        leader_distance: best.leader,
      };
      maxLeader = Math.max(maxLeader, best.leader);
      if (best.hard > 0.05)
        conflicts.push({
          key: o.key,
          item: o.nid || o.eid,
          overlap_area: best.hard,
          manual: !!o.manual,
        });
    }
    const result = {
      svg: new XMLSerializer().serializeToString(root),
      placements,
      report: {
        labels: items.length,
        conflicts: conflicts.length,
        unresolved: conflicts,
        overflow_labels: overflow,
        max_leader: maxLeader,
        measurement: "SVG getBBox",
      },
    };
    holder.remove();
    return result;
  }
  host.RFLabels = { resolve, bounds };
  if (typeof module !== "undefined") module.exports = host.RFLabels;
})(typeof globalThis === "undefined" ? this : globalThis);
