(function (host) {
  "use strict";
  const Plan =
    host.RFPlan ||
    (typeof require === "function" ? require("./rf-plan.js") : null);
  const C = host.RFCore,
    esc = (s) =>
      String(s ?? "").replace(
        /[&<>"']/g,
        (ch) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&apos;",
          })[ch],
      );
  function lengthLabel(m, e) {
    const l = C.lengthInfo(m, e);
    if (l.value == null) return "LENGTH MISSING";
    const tags = {
      cad: "CAD",
      stair_reserve: "stair reserve",
      manual: "manual",
      geometry: "drawn estimate",
      survey: "survey",
      pdf: "PDF",
      allocation: "allocated estimate",
    };
    return (
      l.value.toFixed(2) +
      " m [" +
      (tags[l.method] || l.source) +
      "]" +
      (l.cad_m != null && Math.abs(l.delta_m) > 0.01
        ? " / CAD " + l.cad_m.toFixed(2) + " m"
        : "")
    );
  }
  function rawTopology(m) {
    if (m.meta?.diagram_style === "original_compact") {
      const O =
        host.RFOriginal ||
        (typeof require === "function" ? require("./rf-original.js") : null);
      return O.render(m);
    }
    const L =
      host.RFLine ||
      (typeof require === "function" ? require("./rf-line.js") : null);
    return L.render(m);
  }
  function compactNames(m, obj) {
    const all = C.labels(m, obj);
    if (m.meta?.layout_label_style !== "compact") return all;
    const groups = new Map();
    for (const id of all) {
      const match = id.match(/^(PRJ-RS-)([A-Z0-9>]+)-([HL])-(.*)$/);
      if (!match) {
        groups.set(id, []);
        continue;
      }
      const base = (match[2] === m.meta.floor ? "" : match[2] + "-") + match[4];
      if (!groups.has(base)) groups.set(base, []);
      groups.get(base).push(match[3]);
    }
    return [...groups].map(([id, bands]) => id);
  }
  function layout(m) {
    const FONT = m.meta?.layout_font_px || 11,
      K = m.meta?.layout_symbol_scale || FONT / 8,
      compact = m.meta?.layout_label_style === "compact",
      ns = Object.values(m.nodes || {}),
      es = Object.values(m.edges || {}),
      pts = ns.map((n) => [n.x, n.y]);
    for (const e of es) pts.push(...(e.pts || []));
    if (!pts.length)
      return {
        svg: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"/>',
        width: 800,
        height: 600,
      };
    const minx = Math.min(...pts.map((p) => p[0])) - 350,
      miny = Math.min(...pts.map((p) => p[1])) - 230,
      maxx = Math.max(...pts.map((p) => p[0])) + 350,
      maxy = Math.max(...pts.map((p) => p[1])) + 250,
      W = maxx - minx,
      H = maxy - miny,
      p = [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${minx} ${miny} ${W} ${H}" font-family="Arial,sans-serif"><rect x="${minx}" y="${miny}" width="${W}" height="${H}" fill="white"/><text x="${minx + 20}" y="${miny + 36}" font-size="30">${esc(m.meta?.floor || "")} / RF LAYOUT · R05.1 REPAIR</text><text x="${minx + 20}" y="${miny + 65}" font-size="15">Full H/L names · Original antenna / passive symbols · R: reserved / ~: drawn estimate / ?: unresolved</text><text x="${minx + 20}" y="${miny + 90}" font-size="14">CAD survey positions retained · Offset symbols use survey leaders · Passive mapping and dashed route associations remain under review</text>`,
      ];
    const short = (s) =>
      String(s || "").replace(
        new RegExp("^PRJ-RS-" + (m.meta?.floor || "") + "-[HL]-"),
        "",
      );
    const num = (v) =>
      v == null ? "?" : Number.isInteger(v) ? String(v) : v.toFixed(1);
    function deviceName(n) {
      return (
        (n.dev === "PASSIVE_UNKNOWN"
          ? "?"
          : /^DC/.test(n.dev)
            ? n.dev.slice(2) + "dB"
            : n.dev === "SPL2"
              ? "2-way"
              : n.dev === "SPL3"
                ? "3-way"
                : n.dev) +
        " · " +
        short(n.label || n.id)
      );
    }
    function txt(x, y, lines, id, co = "#153b71") {
      return `<text data-rf-label="true" ${id} data-anchor="${x},${y}" x="${x + 12}" y="${y - 18}" fill="${co}" font-size="${FONT}" paint-order="stroke" stroke="white" stroke-width="${FONT * 0.13}" stroke-linejoin="round">${lines.map((v, i) => `<tspan x="${x + 12}" dy="${i ? FONT * 1.22 : 0}">${esc(v)}</tspan>`).join("")}</text>`;
    }
    function compactLength(e) {
      const L = C.lengthInfo(m, e);
      return (
        (L.is_estimate ? "~" : "") +
        num(L.value) +
        "m" +
        (L.is_reserve ? " R" : L.method === "manual" ? " M" : "")
      );
    }
    for (const e of es) {
      const ps = Plan.points(m, e, K);
      if (ps.length < 2) continue;
      let longest = { len: -1, a: ps[0], b: ps[1] };
      for (let i = 1; i < ps.length; i++) {
        const len = Math.hypot(
          ps[i][0] - ps[i - 1][0],
          ps[i][1] - ps[i - 1][1],
        );
        if (len > longest.len) longest = { len, a: ps[i - 1], b: ps[i] };
      }
      const x = (longest.a[0] + longest.b[0]) / 2,
        y = (longest.a[1] + longest.b[1]) / 2,
        co = C.CABLE[e.cable]?.color || "#b22";
      let annotations = "";
      if (!e.direct_symbol_link) {
        if (compact && e.layout_section_labels?.length) {
          for (const section of e.layout_section_labels)
            annotations += txt(
              section.anchor[0],
              section.anchor[1],
              [
                short(section.ids?.[0] || e.id) +
                  " · " +
                  num(section.cad_m) +
                  "m CAD",
              ],
              `data-e="${esc(e.id)}"`,
              co,
            );
          if (e.cable === "LCK")
            annotations += txt(
              x,
              y,
              ["SELECTED " + compactLength(e) + " · " + e.id],
              `data-e="${esc(e.id)}"`,
              co,
            );
        } else {
          let names = compactNames(m, e).map((id) =>
            id.startsWith("CAD-")
              ? (e.cable === "LCK"
                  ? "LCX "
                  : e.cable === "UNRESOLVED"
                    ? "TYPE? "
                    : "") + e.id
              : id.startsWith("GAP")
                ? "JOIN? " + e.id
                : id,
          );
          let lines = compact
            ? [names.join(" / ") + " · " + compactLength(e)]
            : [...names, lengthLabel(m, e)];
          annotations = txt(x, y, lines, `data-e="${esc(e.id)}"`, co);
        }
      }
      p.push(
        `<g data-edge-id="${esc(e.id)}"><title>${esc((e.label || e.id) + " | " + lengthLabel(m, e))}</title><path d="M${ps.map((v) => v.join(" ")).join(" L")}" fill="none" stroke="${co}" stroke-width="1.6"${e.review_only ? ' stroke-dasharray="7 4"' : ""}/>${annotations}</g>`,
      );
    }
    for (const a of m.cad_auxiliary_geometry || []) {
      if (a.pts?.length > 1)
        p.push(
          `<g data-auxiliary-handle="${esc(a.handle)}"><title>${esc(a.state + " | " + a.handle)}</title><path d="M${a.pts.map((q) => q.join(" ")).join(" L")}" stroke="#9a9a9a" stroke-width=".7" fill="none"/></g>`,
        );
    }
    for (const original of ns) {
      const xy = Plan.position(m, original, K),
        n = { ...original, x: xy[0], y: xy[1] },
        co =
          n.kind === "antenna"
            ? n.dev === "Panel"
              ? "#2563ab"
              : "#b82b2b"
            : "#735115";
      let ls = [];
      if (n.kind === "antenna") {
        ls = [(n.dev || "Type pending") + " Antenna:", ...compactNames(m, n)];
        if (n.symbol_status === "ANNOTATION_ONLY_UNPLACED")
          ls.push("CAD position pending");
      } else if (n.kind === "device")
        ls = [Plan.name(n), ...compactNames(m, n)];
      else if (n.kind === "source") ls = [n.label || n.id];
      const glyph = Plan.glyph(m, original, K),
        ring =
          n.kind === "antenna" && n.change
            ? `<circle cx="${n.x}" cy="${n.y}" r="${8 * K}" fill="none" stroke="${n.change.includes("ADDED") ? "#ed792d" : n.change.includes("TYPE") ? "#c79513" : "#239e72"}" stroke-width="${K}"/>`
            : "";
      p.push(
        glyph.replace(
          /<\/g>$/,
          ring +
            (ls.length ? txt(n.x, n.y, ls, `data-n="${esc(n.id)}"`, co) : "") +
            "</g>",
        ),
      );
    }
    p.push("</svg>");
    const result = host.RFLabels?.resolve(p.join(""), m, "layout") || {
      svg: p.join(""),
    };
    return { ...result, width: W, height: H };
  }
  function topology(m) {
    const r = rawTopology(m),
      placed = host.RFLabels?.resolve(
        r.svg,
        m,
        m.meta?.diagram_style || "rf_line",
      );
    return placed ? { ...r, ...placed } : r;
  }
  host.RFRender = { topology, layout, lengthLabel };
  if (typeof module !== "undefined") module.exports = host.RFRender;
})(typeof globalThis === "undefined" ? this : globalThis);
