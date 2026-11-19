/* Adapted from the user's original RF Riser Builder: original THRU-first layout,
   compact spacing, symbols, legend and label placement. See Source_Comparison.md. */
(function (host) {
  "use strict";
  const C =
    host.RFCore ||
    (typeof require === "function" ? require("./rf-core.js") : null);
  const CABLE = {
    LCK: { n: "Leaky", c: "#00A85A" },
    COX12: { n: '1/2" coax', c: "#6C7BD8" },
    COX114: { n: '1-1/4" coax', c: "#EF5350" },
  };
  const DEVS = [
      ["SPL2", "2-way splitter"],
      ["SPL3", "3-way splitter"],
      ["POI", "POI"],
      ...[5, 6, 7, 10, 15, 20, 30, 40].map((n) => [
        "DC" + n,
        n + " dB coupler",
      ]),
    ],
    CAPTION = {
      LCK: "Leaky Cable:",
      COX12: '1/2" Cable:',
      COX114: '1-1/4" Cable:',
    };
  const isCoupler = (d) => /^DC/.test(d || ""),
    esc = (x) =>
      String(x ?? "").replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&apos;",
          })[c],
      );
  function legend(x = 24, y = 24, options = {}) {
    const LEGW = 210,
      CABLE = options.reference_colors
        ? {
            LCK: { c: "#17a33c" },
            COX12: { c: "#244af4" },
            COX114: { c: "#ed252c" },
          }
        : {
            LCK: { c: "#00A85A" },
            COX12: { c: "#6C7BD8" },
            COX114: { c: "#EF5350" },
          };
    let s = "";
    // legend, top-left
    (() => {
      const lx = x,
        ly = y,
        lh = 17,
        rows = [
          [
            "cab",
            "LCK",
            options.reference_colors ? "Reference green wire" : "Leaky cable",
          ],
          [
            "cab",
            "COX12",
            options.reference_colors
              ? "Reference blue wire"
              : '1/2" coaxial cable',
          ],
          [
            "cab",
            "COX114",
            options.reference_colors
              ? "Reference red wire"
              : '1-1/4" coaxial cable',
          ],
          ["ant", "Dome", "Dome antenna"],
          ["ant", "Panel", "Panel antenna"],
          ["dev", "SPL2", "Splitter"],
          ["dev", "DC10", "Directional coupler"],
          ["dev", "POI", "POI"],
          ["src", "", "Source / feed interface"],
        ];
      s +=
        `<rect x="${lx}" y="${ly}" width="${LEGW - 30}" height="${rows.length * lh + 30}" ` +
        `fill="#fff" stroke="#111" stroke-width="1"/>` +
        `<text x="${lx + 10}" y="${ly + 16}" font-size="10" font-weight="700">LEGEND</text>`;
      rows.forEach(([kind, id, txt], i) => {
        const cy = ly + 28 + i * lh + 6,
          ix = lx + 12;
        if (kind === "cab")
          s += `<path d="M${ix},${cy}H${ix + 22}" stroke="${CABLE[id].c}" stroke-width="2"/>`;
        else if (kind === "ant") {
          const c = id === "Panel" ? "#1D4ED8" : "#DC2626",
            cx = ix + 11;
          s +=
            `<path d="M${cx},${cy + 5}L${cx},${cy - 2}M${cx},${cy - 2}L${cx - 5},${cy - 7}` +
            `M${cx},${cy - 2}L${cx + 5},${cy - 7}M${cx},${cy - 2}L${cx},${cy - 6}" ` +
            `fill="none" stroke="${c}" stroke-width="1.2" stroke-linejoin="round"/>`;
        } else if (kind === "dev") {
          const w = 24,
            h = 11,
            cx = ix + 11;
          s +=
            `<rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" fill="none" stroke="#111"/>` +
            `<path d="${
              id === "POI"
                ? `M${cx - 5},${cy}H${cx + 5}M${cx},${cy - 3}V${cy + 3}`
                : id === "SPL2"
                  ? `M${cx - w / 2},${cy}L${cx - 3},${cy}M${cx + w / 2},${cy - h / 2}L${cx - 3},${cy}L${cx + w / 2},${cy + h / 2}`
                  : `M${cx - 4},${cy + h / 2}L${cx - 4},${cy}L${cx + 5},${cy}`
            }" fill="none" stroke="#111" stroke-width="1"/>`;
        } else
          s += `<rect x="${ix + 5}" y="${cy - 5}" width="11" height="11" rx="2" fill="#F0B429" stroke="#8A6410"/>`;
        s += `<text x="${ix + 32}" y="${cy + 3.5}" font-size="9">${esc(txt)}</text>`;
      });
    })();
    return { svg: s, width: 180, height: 183 };
  }
  function render(M) {
    M = C.lineModel(M);
    const original = M,
      a = C.analyze(M);
    M = { ...M, nodes: a.nodes };
    const P = {},
      panels = [],
      RX = 290,
      RY = 46,
      PAD = 64,
      BW = 40,
      BH = 17,
      LEGW = 210,
      LEGH = 183;
    let cy = 130,
      maxd = 0;
    const roleOf = (id, e) => M.nodes[id]?.ports?.[e.id] || "UNASSIGNED";
    const kidsOrdered = (id) => {
      const o = (a.kids[id] || []).map((child) => ({
        child,
        edge: a.pe[child],
      }));
      if (isCoupler(a.nodes[id].dev))
        o.sort(
          (x, y) =>
            (roleOf(id, x.edge) === "THRU" ? 0 : 1) -
            (roleOf(id, y.edge) === "THRU" ? 0 : 1),
        );
      return o;
    };
    for (const root of a.roots) {
      const leaves = [],
        rows = {};
      (function dfs(u) {
        const ks = kidsOrdered(u);
        if (!ks.length) {
          leaves.push(u);
          return;
        }
        ks.forEach((v) => dfs(v.child));
      })(root);
      const place = (id) => {
        if (rows[id] !== undefined) return rows[id];
        const ks = kidsOrdered(id).map((x) => place(x.child));
        return (rows[id] = isCoupler(a.nodes[id].dev)
          ? ks[0]
          : ks.reduce((x, y) => x + y, 0) / (ks.length || 1));
      };
      leaves.forEach((id, i) => (rows[id] = i));
      place(root);
      const ids = a.order.filter((k) => a.owner[k] === root),
        top = cy - 60;
      for (const id of ids) {
        P[id] = { x: PAD + LEGW + a.depth[id] * RX, y: cy + rows[id] * RY };
        maxd = Math.max(maxd, a.depth[id]);
      }
      cy += Math.max(1, leaves.length) * RY + 100;
      panels.push({
        root,
        ids,
        top,
        bottom: cy - 50,
        comp: a.nodeComponent[root],
      });
    }
    const W = Math.max(1100, PAD * 2 + RX * (maxd + 1) + 230),
      H = Math.max(cy + 60, LEGH + PAD * 2);
    let s = `<svg xmlns="http://www.w3.org/2000/svg" id="rfTopologySVG" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="ui-sans-serif,Segoe UI,Roboto"><rect width="${W}" height="${H}" fill="white"/><text x="24" y="22" font-size="13">${esc(M.meta?.floor || "RF")} / Original-tool compact arrangement</text><text x="230" y="44" font-size="10" fill="#a45b24">${esc((M.meta?.review_status || "Review model").slice(0, 140))}</text>`;
    // legend, top-left
    (() => {
      const lx = 24,
        ly = 54,
        lh = 17,
        rows = [
          ["cab", "LCK", "Leaky cable"],
          ["cab", "COX12", '1/2" coaxial cable'],
          ["cab", "COX114", '1-1/4" coaxial cable'],
          ["ant", "Dome", "Dome antenna"],
          ["ant", "Panel", "Panel antenna"],
          ["dev", "SPL2", "Splitter"],
          ["dev", "DC10", "Directional coupler"],
          ["dev", "POI", "POI"],
          ["src", "", "ORU / FEED / REF"],
        ];
      s +=
        `<rect x="${lx}" y="${ly}" width="${LEGW - 30}" height="${rows.length * lh + 30}" ` +
        `fill="#fff" stroke="#111" stroke-width="1"/>` +
        `<text x="${lx + 10}" y="${ly + 16}" font-size="10" font-weight="700">LEGEND</text>`;
      rows.forEach(([kind, id, txt], i) => {
        const cy = ly + 28 + i * lh + 6,
          ix = lx + 12;
        if (kind === "cab")
          s += `<path d="M${ix},${cy}H${ix + 22}" stroke="${CABLE[id].c}" stroke-width="2"/>`;
        else if (kind === "ant") {
          const c = id === "Panel" ? "#1D4ED8" : "#DC2626",
            cx = ix + 11;
          s +=
            `<path d="M${cx},${cy + 5}L${cx},${cy - 2}M${cx},${cy - 2}L${cx - 5},${cy - 7}` +
            `M${cx},${cy - 2}L${cx + 5},${cy - 7}M${cx},${cy - 2}L${cx},${cy - 6}" ` +
            `fill="none" stroke="${c}" stroke-width="1.2" stroke-linejoin="round"/>`;
        } else if (kind === "dev") {
          const w = 24,
            h = 11,
            cx = ix + 11;
          s +=
            `<rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" fill="none" stroke="#111"/>` +
            `<path d="${
              id === "POI"
                ? `M${cx - 5},${cy}H${cx + 5}M${cx},${cy - 3}V${cy + 3}`
                : id === "SPL2"
                  ? `M${cx - w / 2},${cy}L${cx - 3},${cy}M${cx + w / 2},${cy - h / 2}L${cx - 3},${cy}L${cx + w / 2},${cy + h / 2}`
                  : `M${cx - 4},${cy + h / 2}L${cx - 4},${cy}L${cx + 5},${cy}`
            }" fill="none" stroke="#111" stroke-width="1"/>`;
        } else
          s += `<rect x="${ix + 5}" y="${cy - 5}" width="11" height="11" rx="2" fill="#F0B429" stroke="#8A6410"/>`;
        s += `<text x="${ix + 32}" y="${cy + 3.5}" font-size="9">${esc(txt)}</text>`;
      });
    })();

    for (const panel of panels) {
      const comp = panel.comp;
      const rootLabel =
        a.nodes[panel.root].kind === "source"
          ? a.nodes[panel.root].label || panel.root
          : "UNFED / source required";
      s += `<text x="250" y="${panel.top + 20}" font-size="11" fill="${comp.sources.length === 1 ? "#333" : "#a45b24"}">${esc(rootLabel)}${comp.sources.length > 1 ? " / JOINED SOURCES - HOLD" : ""}</text>`;
      const t = {
        src: a.nodes[panel.root],
        order: panel.ids,
        par: a.par,
        pe: a.pe,
        kids: a.kids,
      };
      const X = (id) => P[id].x,
        Y = (id) => P[id].y,
        edgeLenM = (e) => C.lengthInfo(M, e).value,
        termName = (t, id) => a.nodes[id].label || t.pe[id]?.label || id;
      // ---- cables, routed from the parent's actual output port ----
      for (const id of t.order) {
        const pid = t.par[id];
        if (pid === undefined) continue;
        const e = t.pe[id],
          L = edgeLenM(e),
          role = roleOf(pid, e);
        s += `<g data-edge-id="${esc(e.id)}" data-from="${esc(pid)}" data-to="${esc(id)}" data-from-port="${esc(role)}">`;
        const pn = M.nodes[pid];
        let sx = X(pid),
          sy = Y(pid);
        if (pn.kind === "device" || pn.kind === "source") {
          if (isCoupler(pn.dev) && role === "COUPLED") {
            sx = X(pid);
            sy = Y(pid) + BH / 2;
          } else {
            sx = X(pid) + BW / 2;
            sy = Y(pid);
            if (/^SPL/.test(pn.dev || "")) {
              const outs = (t.kids[pid] || []).map((k) => t.pe[k].id),
                i = outs.indexOf(e.id);
              sy =
                Y(pid) +
                (outs.length > 1 ? -BH / 2 + (BH * i) / (outs.length - 1) : 0);
            }
          }
        }
        const ex = X(id) - (M.nodes[id].kind === "device" ? BW / 2 : 0),
          ey = Y(id);
        const mx = Math.max(sx + 26, (sx + ex) / 2);
        const d = sy === ey ? `M${sx},${sy}H${ex}` : `M${sx},${sy}V${ey}H${ex}`;
        s += `<path d="${d}" fill="none" stroke="${CABLE[e.cable]?.c || "#a33b22"}" stroke-width="1.7" ${e.route_status === "proposed_gap" || e.cable === "UNRESOLVED" ? 'stroke-dasharray="7 4"' : ""}/>`;
        const lx = sy === ey ? (sx + ex) / 2 : (sx + ex) / 2,
          ly = ey - 5;
        const info = C.lengthInfo(M, e);
        const cap =
          (CAPTION[e.cable] || "Cable:") +
          " " +
          (info.value == null ? "LENGTH ?" : info.value.toFixed(2) + " m") +
          (info.is_reserve
            ? " [reserve]"
            : info.method === "cad"
              ? " [CAD]"
              : info.is_estimate
                ? " [estimate]"
                : "") +
          (info.delta_m != null && Math.abs(info.delta_m) > 0.01
            ? " / CAD " + info.cad_m.toFixed(2) + " m"
            : "");
        const nm = C.labels(M, e);
        const rows = [cap].concat(
          e.cad_sections?.length > 1
            ? e.cad_sections.map(
                (v) =>
                  (v.ids?.[0] || e.id).replace("-H-", "-[H/L]-") +
                  " · " +
                  v.cad_m +
                  " m [CAD]",
              )
            : nm.length
              ? nm
              : ["(unnamed)"],
        );
        if (e.line_destination && M.meta?.tool_settings?.line_labels?.ports !== false)
          rows.push(...String(e.line_destination).split("\n").filter(Boolean));
        s +=
          `<text x="${lx}" y="${ly - rows.length * 9.6}" font-size="8.2" text-anchor="middle" ` +
          `data-e="${e.id}" style="cursor:pointer">` +
          rows
            .map(
              (r, i) =>
                `<tspan x="${lx}" dy="${i ? 9.6 : 0}" fill="${i ? "#111" : "#777"}">${esc(r)}</tspan>`,
            )
            .join("") +
          `</text>`;
        if (isCoupler(pn.dev))
          s +=
            `<text x="${sx + (role === "COUPLED" ? 6 : 8)}" y="${sy + (role === "COUPLED" ? 11 : -4)}" font-size="7.5" ` +
            `fill="${role === "COUPLED" ? "#0E8A94" : "#888"}">${role === "COUPLED" ? "coupled" : role === "THRU" ? "thru" : "port ?"}</text>`;
        s += `</g>`;
      }
      // ---- component symbols, line-diagram style ----
      for (const id of t.order) {
        const n = M.nodes[id],
          x = X(id),
          y = Y(id);
        s += `<g data-node-id="${esc(id)}" data-symbol="${esc(n.kind === "device" ? (isCoupler(n.dev) ? "coupler" : /^SPL/.test(n.dev || "") ? "splitter" : "equipment") : n.kind)}">`;
        if (n.kind === "source") {
          s +=
            `<rect x="${x - BW / 2}" y="${y - BH / 2}" width="${BW}" height="${BH}" rx="3" fill="#F0B429" stroke="#8A6410"/>` +
            `<text x="${x}" y="${y + 4}" font-size="10" text-anchor="middle" font-weight="700">${C.sourceType(n)}</text>`;
        } else if (n.kind === "device" && isCoupler(n.dev)) {
          const w = BW,
            h = BH;
          s +=
            `<rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" fill="#fff" stroke="#111" stroke-width="1.2"/>` +
            `<path d="M${x - w * 0.18},${y + h / 2}L${x - w * 0.18},${y}L${x + w * 0.2},${y}" fill="none" stroke="#111" stroke-width="1.1" stroke-linejoin="round"/>` +
            `<text x="${x}" y="${y - h / 2 - 4}" font-size="8.5" text-anchor="middle" fill="#111" ` +
            `data-n="${id}" style="cursor:pointer">${esc((DEVS.find((d) => d[0] === n.dev) || ["", n.dev])[1])}</text>`;
        } else if (n.kind === "device") {
          const w = BW,
            h = BH;
          s +=
            `<rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" fill="#fff" stroke="#111" stroke-width="1.2"/>` +
            (n.dev === "POI"
              ? `<path d="M${x - w * 0.2},${y}H${x + w * 0.2}M${x},${y - h * 0.3}V${y + h * 0.3}" stroke="#111" stroke-width="1"/>`
              : `<path d="M${x - w / 2},${y}L${x - w * 0.12},${y}M${x + w / 2},${y - h / 2}L${x - w * 0.12},${y}L${x + w / 2},${y + h / 2}${n.dev === "SPL3" ? `M${x - w * 0.12},${y}H${x + w / 2}` : ""}" fill="none" stroke="#111" stroke-width="1.1" stroke-linejoin="round"/>`) +
            `<text x="${x}" y="${y - 11}" font-size="8" text-anchor="middle" fill="#555" ` +
            `data-n="${id}" style="cursor:pointer">${esc((DEVS.find((d) => d[0] === n.dev) || ["", n.dev])[1])}</text>`;
        } else if (n.kind === "antenna") {
          const ac = n.dev === "Panel" ? "#1D4ED8" : "#DC2626";
          s +=
            `<path d="M${x},${y}L${x},${y - 13}M${x},${y - 13}L${x - 7},${y - 21}M${x},${y - 13}L${x + 7},${y - 21}` +
            `M${x},${y - 13}L${x},${y - 19.5}" fill="none" stroke="${ac}" stroke-width="1.3" stroke-linejoin="round"/>` +
            `<text x="${x + 11}" y="${y - 3}" font-size="8.2" fill="#111" data-n="${id}" style="cursor:pointer">` +
            [`${n.dev || "Dome"} Antenna:`]
              .concat(C.labels(M, n).length ? C.labels(M, n) : ["(unnamed)"])
              .map(
                (r, i) =>
                  `<tspan x="${x + 11}" dy="${i ? 9.6 : 0}" text-anchor="start" fill="${i ? ac : "#777"}">${esc(r)}</tspan>`,
              )
              .join("") +
            `</text>`;
        } else if (!t.kids[id]) {
          const tn = C.labels(
            M,
            t.pe[id]?.cable === "LCK"
              ? t.pe[id]
              : n.label
                ? n
                : { label: termName(t, id) },
          );
          s +=
            `<circle cx="${x}" cy="${y}" r="3.2" fill="#00A85A"/>` +
            `<text x="${x + 8}" y="${y + (tn.length > 1 ? -1 : 3.5)}" font-size="8.2" fill="#111" ` +
            `data-e="${t.pe[id] ? t.pe[id].id : ""}" style="cursor:pointer">` +
            (tn.length ? tn : ["(unnamed)"])
              .map(
                (r, i) =>
                  `<tspan x="${x + 8}" dy="${i ? 9.6 : 0}" text-anchor="start">${esc(r)}</tspan>`,
              )
              .join("") +
            `</text>`;
        } else s += `<circle cx="${x}" cy="${y}" r="2.5" fill="#999"/>`;
        if (n.kind === "device" && n.label && !n.generated_label)
          s += `<text x="${x + 30}" y="${y + 31}" font-size="7.5" fill="#555" data-n="${esc(id)}" style="cursor:pointer">${esc(n.label)}</text>`;
        s += `</g>`;
      }
    }
    // Original renderer showed only the first source's tree. Retain all remaining actual links.
    for (const e of a.extraEdges) {
      const p = P[e.a],
        q = P[e.b],
        x = Math.max(p.x, q.x) + 35;
      s += `<g data-edge-id="${esc(e.id)}"><path d="M${p.x},${p.y}H${x}V${q.y}H${q.x}" stroke="#b43826" stroke-dasharray="6 4" fill="none"/><text x="${x + 6}" y="${(p.y + q.y) / 2}" font-size="8" fill="#b43826">${esc(e.label || e.id)} / NON-TREE CHECK</text></g>`;
    }
    s += "</svg>";
    return {
      svg: s,
      width: W,
      height: H,
      nodeCount: Object.keys(a.nodes).length,
      edgeCount: a.edges.length,
      sourceCount: Object.values(M.nodes).filter((n) => n.kind === "source")
        .length,
      components: a.components.length,
      issues: C.issues(original),
      positions: P,
      placementMode: "original-tool compact",
    };
  }
  const api = { render, legend };
  host.RFOriginal = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof globalThis === "undefined" ? this : globalThis);
