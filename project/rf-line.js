/* Conventional RF single-line diagrams. Rendering never rewires the project. */
(function (host) {
  "use strict";
  const C =
    host.RFCore ||
    (typeof require === "function" ? require("./rf-core.js") : null);
  const esc = (v) =>
    String(v ?? "").replace(
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
  function signature(m) {
    return JSON.stringify([
      Object.values(m.nodes)
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((n) => [
          n.id,
          n.kind,
          n.dev || "",
          Object.entries(n.ports || {}).sort((a, b) =>
            a[0].localeCompare(b[0]),
          ),
        ]),
      Object.values(m.edges)
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((e) => [e.id, e.a, e.b]),
    ]);
  }
  function text(x, y, lines, opts = {}) {
    if (!lines.length) return "";
    const size = opts.size || 11,
      anchor = opts.anchor || "middle";
    return `<text x="${x}" y="${y}" font-size="${size}" fill="${opts.color || "#153b71"}" text-anchor="${anchor}" ${opts.attrs || ""}>${lines.map((s, i) => `<tspan x="${x}" dy="${i ? size * 1.25 : 0}">${esc(s)}</tspan>`).join("")}</text>`;
  }
  function path(points, attrs = "") {
    return `<path d="M ${points.map((p) => p.join(" ")).join(" L ")}" fill="none" ${attrs}/>`;
  }
  function labels(m, n) {
    return C.labels(m, n).filter(Boolean);
  }
  function shortName(n) {
    const s = n.label || n.id;
    return s.replace(/^PRJ-RS-[A-Z0-9>]+-[HL]-/, "");
  }
  function lengthText(m, e) {
    const l = C.lengthInfo(m, e);
    return l.value == null ? "LENGTH ?" : l.value.toFixed(0) + " m";
  }
  function autoPlacement(m, a) {
    const P = {},
      frames = [],
      font = m.meta?.tool_settings?.label_size || 9,
      maxName = Math.max(
        24,
        ...[...Object.values(m.nodes), ...Object.values(m.edges)].map(
          (n) => (n.label || "").length,
        ),
      ),
      RX = Math.max(280, maxName * 6 + 80),
      RY = 95,
      groups = [];
    for (const root of a.roots) {
      const ids = a.order.filter((k) => a.owner[k] === root),
        rows = {},
        leaves = [],
        ordered = (id) => {
          const ks = [...(a.kids[id] || [])];
          if (/^DC/.test(a.nodes[id].dev || ""))
            ks.sort(
              (x, y) =>
                (a.nodes[id].ports?.[a.pe[x]?.id] === "THRU" ? 0 : 1) -
                (a.nodes[id].ports?.[a.pe[y]?.id] === "THRU" ? 0 : 1),
            );
          return ks;
        };
      (function walk(id) {
        const ks = ordered(id);
        if (!ks.length) leaves.push(id);
        else ks.forEach(walk);
      })(root);
      leaves.forEach((id, i) => (rows[id] = i));
      function row(id) {
        if (rows[id] !== undefined) return rows[id];
        const ks = ordered(id),
          v = ks.map(row),
          n = a.nodes[id];
        if (/^DC/.test(n.dev || "")) {
          const t = ks.findIndex((k) => n.ports?.[a.pe[k]?.id] === "THRU");
          return (rows[id] = t >= 0 ? v[t] : Math.min(...v) - 1);
        }
        return (rows[id] = v.reduce((s, y) => s + y, 0) / (v.length || 1));
      }
      row(root);
      const low = Math.min(...ids.map((k) => rows[k])),
        high = Math.max(...ids.map((k) => rows[k])),
        w = 230 + Math.max(...ids.map((k) => a.depth[k])) * RX + RX,
        h = (high - low) * RY + 190;
      groups.push({ root, ids, rows, low, w, h, comp: a.nodeComponent[root] });
    }
    const groupWidths = groups.map(g => g.w).sort((a,b) => b-a),
      W = m.meta?.line_panel_columns === 2 && groupWidths.length > 1 ? groupWidths[0] + groupWidths[1] + 140 : Math.max(1200, ...groups.map((g) => g.w + 90)),
      placed = [];
    groups.sort(
      (x, y) =>
        (x.comp.sources.length ? 0 : 1) - (y.comp.sources.length ? 0 : 1) ||
        y.w * y.h - x.w * x.h,
    );
    for (const g of groups) {
      let best = null;
      const xs = [45, ...placed.map((r) => r.x + r.w + 24)];
      for (const x of xs) {
        if (x + g.w > W - 44) continue;
        let y = 190,
          moved = true;
        while (moved) {
          moved = false;
          for (const r of placed)
            if (
              x < r.x + r.w + 20 &&
              x + g.w + 20 > r.x &&
              y < r.y + r.h + 24 &&
              y + g.h + 24 > r.y
            ) {
              y = r.y + r.h + 24;
              moved = true;
            }
        }
        const cost = y + g.h;
        if (!best || cost < best.cost || (cost === best.cost && x < best.x))
          best = { x, y, cost };
      }
      if (!best)
        best = {
          x: 45,
          y: Math.max(190, ...placed.map((r) => r.y + r.h + 24)),
        };
      placed.push({ x: best.x, y: best.y, w: g.w, h: g.h });
      for (const id of g.ids)
        P[id] = {
          x: best.x + 180 + a.depth[id] * RX,
          y: best.y + 100 + (g.rows[id] - g.low) * RY,
        };
      frames.push({
        comp: g.comp,
        root: g.root,
        ids: g.ids,
        left: best.x,
        right: best.x + g.w,
        top: best.y,
        bottom: best.y + g.h,
      });
    }
    return {
      positions: P,
      frames,
      width: W,
      height: Math.max(700, ...placed.map((r) => r.y + r.h)) + 55,
      mode: "compact RF schematic",
    };
  }

  function render(m) {
    m = C.lineModel(m);
    // stair pass-through drawings (feed port + cable + end, stair_pass: true) belong to the Layout only: not RF networks
    if (Object.values(m.nodes).some((n) => n.stair_pass))
      m = { ...m, nodes: Object.fromEntries(Object.entries(m.nodes).filter(([, n]) => !n.stair_pass)), edges: Object.fromEntries(Object.entries(m.edges).filter(([, e]) => !e.stair_pass)) };
    const rxWarnings=host.RFDesign?host.RFDesign.warnings(m):{};
    if (m.meta?.line_hide_unused_junctions) {
      const wired = new Set(Object.values(m.edges).flatMap(e => [e.a,e.b]));
      m = {...m, nodes:Object.fromEntries(Object.entries(m.nodes).filter(([id,n]) =>
        n.kind !== "junction" || wired.has(id) || String(n.label || "").trim()
      ))};
    }
    const a = C.analyze(m),
      issues = C.issues(m),
      explicit =
        m.meta?.diagram_layout?.signature === signature(m) &&
        Object.values(m.nodes).every((n) => n.diagram_placement),
      scale = explicit ? 2.7 : 1;
    let s;
    if (explicit) {
      const P = {};
      for (const n of Object.values(m.nodes))
        P[n.id] = { x: n.x * scale + 180, y: n.y * scale + 200 };
      const frames = a.components
        .filter((c) => c.sources.length)
        .map((comp) => ({
          comp,
          top: Math.min(...comp.nodes.map((k) => P[k].y)) - 160,
          bottom: Math.max(...comp.nodes.map((k) => P[k].y)) + 120,
        }));
      s = {
        positions: P,
        frames,
        width: Math.max(1400, ...Object.values(P).map((p) => p.x + 340)),
        height: Math.max(850, ...Object.values(P).map((p) => p.y + 180)),
        mode: "reference line-diagram placement",
      };
    } else s = autoPlacement(m, a);
    const P = s.positions,
      W = s.width,
      diagramH = s.height,
      H = s.height + 215,
      portAnchors = {},
      geometry = {},
      body = [],
      edgeRecords = [];
    function point(p) {
      return [p[0] * scale + 180, p[1] * scale + 200];
    }
    function local(n, eid) {
      const p = P[n.id];
      if (explicit) {
        const pp = n.diagram_placement.ports?.[eid];
        if (pp) return point(pp);
      }
      const role = n.ports?.[eid],
        incoming = a.pe[n.id]?.id === eid;
      if (n.kind === "source") return [p.x + 28, p.y];
      if (n.kind === "antenna") return [p.x, p.y];
      if (n.kind === "device") {
        if (role === "IN" || (!role && incoming)) return [p.x - 25, p.y];
        if (/^DC/.test(n.dev || "") && role === "COUPLED") {
          const peer = a.adj[n.id].find((v) => v.edge.id === eid)?.node;
          return [p.x, p.y + (P[peer]?.y > p.y ? 17 : -17)];
        }
        if (/^DC/.test(n.dev || "") && role === "THRU") return [p.x + 25, p.y];
        const outs = a.adj[n.id]
            .filter(
              (v) =>
                n.ports?.[v.edge.id] !== "IN" &&
                !(a.pe[n.id]?.id === v.edge.id && !n.ports?.[v.edge.id]),
            )
            .sort(
              (x, y) =>
                P[x.node].y - P[y.node].y || x.edge.id.localeCompare(y.edge.id),
            ),
          index = outs.findIndex((v) => v.edge.id === eid),
          dy =
            outs.length > 1
              ? ((index - (outs.length - 1) / 2) * 24) / (outs.length - 1)
              : 0;
        return [p.x + 25, p.y + dy];
      }
      return [p.x, p.y];
    }
    for (const n of Object.values(a.nodes)) {
      portAnchors[n.id] = {};
      for (const e of a.adj[n.id])
        portAnchors[n.id][e.edge.id] = local(n, e.edge.id);
    }
    // Each actual model edge is drawn separately, with the actual component port at both ends.
    for (const e of a.edges) {
      let from = e.a,
        to = e.b,
        isTree = a.par[e.b] === e.a && a.pe[e.b]?.id === e.id;
      if (!isTree && a.par[e.a] === e.b && a.pe[e.a]?.id === e.id) {
        from = e.b;
        to = e.a;
        isTree = true;
      }
      const v = portAnchors[from][e.id],
        w = portAnchors[to][e.id],
        up = a.nodes[from],
        role = up.ports?.[e.id];
      let pts;
      if (explicit && e.diagram_placement?.pts?.length)
        pts = (
          from === e.a
            ? e.diagram_placement.pts
            : e.diagram_placement.pts.slice().reverse()
        ).map(point);
      else if (!isTree) {
        const lane = Math.max(v[0], w[0]) + 80 + (edgeRecords.length % 6) * 14;
        pts = [v, [lane, v[1]], [lane, w[1]], w];
      } else if (Math.abs(v[1] - w[1]) < 0.1) pts = [v, w];
      else if (role === "COUPLED") pts = [v, [v[0], w[1]], w];
      else if (up.kind === "device" && /^SPL/.test(up.dev || "")) {
        // splitter outputs going the same way (two up, or two down) turn at their own x, so their vertical runs do not
        // lie on top of each other: going up, the lower port turns further right; going down, the upper port does
        const dir = (o) => Math.sign((portAnchors[o.node]?.[o.edge.id]?.[1] ?? 0) - portAnchors[from][o.edge.id][1]),
          mine = Math.sign(w[1] - v[1]),
          same = a.adj[from]
            .filter((o) => o.edge.id !== a.pe[from]?.id && up.ports?.[o.edge.id] !== "IN" && dir(o) === mine)
            .sort((p, q) => (portAnchors[from][p.edge.id][1] - portAnchors[from][q.edge.id][1]) * (mine < 0 ? 1 : -1)),
          rank = Math.max(0, same.findIndex((o) => o.edge.id === e.id)),
          x = v[0] + 32 + rank * 14;
        pts = [v, [x, v[1]], [x, w[1]], w];
      } else pts = [v, [w[0], v[1]], w];
      // Attach endpoints to symbols, including direct symbol-to-symbol links.
      if (pts.length < 2) pts = [v, w];
      pts[0] = v;
      pts[pts.length - 1] = w;
      let review =
          !isTree ||
          e.review_only ||
          e.identity_status === "candidate" ||
          (e.route_status === "legacy_only" && !e.cad_confirmed),
        col =
          e.cable === "UNRESOLVED"
            ? "#8a6e55"
            : e.cable === "LCK"
              ? "#16854a"
              : e.cable === "COX114"
                ? "#d22e34"
                : "#205eb0";
      if (!isTree) col = "#bd3a26";
      const segments = pts
          .slice(1)
          .map((p, i) => ({
            a: pts[i],
            b: p,
            len: Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]),
          })),
        long = segments.sort((a, b) => b.len - a.len)[0] || {
          a: v,
          b: w,
          len: 0,
        },
        mid = [(long.a[0] + long.b[0]) / 2, (long.a[1] + long.b[1]) / 2],
        vertical = Math.abs(long.a[0] - long.b[0]) < 2;
      let tx = mid[0] + (vertical ? 10 : 0),
        ty = mid[1] - (vertical ? 7 : 20),
        anchor = vertical ? "start" : "middle";
      // user 2026-11-18: the line diagram names leaky cables only; coax shows its length (meta.line_labels.coax_names
      // brings the names back)
      const named = e.cable === "LCK" || m.meta?.line_labels?.coax_names === true;
      const L = C.lengthInfo(m, e),
        names = e.label && named ? labels(m, e) : [];
      // Short symbol links retain an accessible label without covering the symbols.
      const compact = (explicit && long.len < 75) || !named;
      let ll = compact
        ? L.value == null
          ? ["? m"]
          : [L.value.toFixed(0) + " m"]
        : [...names, lengthText(m, e)];
      if (e.cad_sections?.length > 1 && !compact)
        ll = e.cad_sections
          .map(
            (v) =>
              (v.ids?.[0] || e.id).replace("-H-", "-[H/L]-") +
              " · " +
              v.cad_m +
              " m",
          )
          .concat([
            (C.lengthInfo(m, e).is_reserve ? "SELECTED " : "TOTAL ") +
              lengthText(m, e),
          ]);
      if (!names.length && !compact && !e.cad_sections?.length)
        ll.unshift(e.id);
      if (!isTree) ll.push("NON-TREE / CHECK");
      let label =
        e.diagram_placement?.length_xy && explicit
          ? point(e.diagram_placement.length_xy)
          : null;
      if (label) {
        tx = label[0];
        ty = label[1];
        anchor = "start";
        ll = [...names, lengthText(m, e)];
      }
      // A zero-length symbol link represents the terminal jumper counted in the antenna field.
      // Label that jumper once, without exposing an internal TAP ID as a cable number.
      if (e.direct_symbol_link && L.value === 0) {
        const ant = [a.nodes[e.a], a.nodes[e.b]].find(n => n?.kind === "antenna");
        if (ant) {
          const jumper = C.parseLength(ant.jumper ?? 2);
          ll = [...names, jumper == null ? "Jumper pending" : `${jumper} m jumper`];
        }
      }
      if (e.diagram_only) ll = e.handoff_reference ? [...(named ? [e.label] : []), "Port boundary"] : ["Reference feed plane"];
      if (e.route_status === "INHERITED_STAIR_REFERENCE") ll = [...names, `${e.reference_reserve_m ?? 100} m`];
      // Stair cables: stair no. / From-To / stair Excel whole-run length (stair_annotation from the stair register).
      // user 2026-11-18: no "Stair Excel F2 = 56 m" line on drawings (the cell stays in the data)
      const stairLines = e.stair_annotation?.lines?.length ? e.stair_annotation.lines.filter((l) => !/^Stair Excel\b/i.test(l)) : (e.stair?.from || e.stair?.to ? [`From ${e.stair.from || "?"} to ${e.stair.to || "?"}`] : []);
      ll.push(...stairLines);
      const visibility = m.meta?.tool_settings?.line_labels || {};
      const showNames = visibility["name" + e.cable] !== false;
      const showLengths = visibility["length" + e.cable] !== false;
      ll = ll.flatMap(line => {
        const value = String(line);
        if (/^From\s/.test(value) || stairLines.includes(value)) return visibility.stairs === false ? [] : [value];
        const section = value.match(/^(.*?)\s*·\s*(\d+(?:\.\d+)?)\s*m$/);
        if (section && showNames && showLengths) return [value];
        if (section) return [showNames ? section[1] : "", showLengths ? section[2] + " m" : ""].filter(Boolean);
        const isLength = /^(?:\d+(?:\.\d+)?\s*m\b|\?\s*m|LENGTH\b|Jumper\b|SELECTED\b|TOTAL\b)/i.test(value);
        return (isLength ? showLengths : showNames) ? [value] : [];
      });
      if (e.line_destination && visibility.ports !== false) {
        ll.push(...String(e.line_destination).split("\n").filter(Boolean));
        if (!vertical) ty -= Math.max(0, ll.length - 1) * (explicit ? 8.5 : 10) * 1.25;
      }
      const refColors = explicit ? e.diagram_placement?.colors : [];
      if (refColors?.length) col = refColors[0];
      const attrs = `stroke="${col}" stroke-width="1.6" stroke-linejoin="round" ${!e.review_verified && (!isTree || e.route_status === "proposed_gap" || e.cable === "UNRESOLVED") ? 'stroke-dasharray="7 4"' : ""}`;
      body.push(
        `<g data-edge-id="${esc(e.id)}" data-from="${esc(from)}" data-to="${esc(to)}" data-from-port="${esc(up.ports?.[e.id] || "")}" data-to-port="${esc(a.nodes[to].ports?.[e.id] || "")}"><title>${esc((e.label || e.id) + " | " + lengthText(m, e) + (review ? " | REVIEW" : ""))}</title>${
          refColors?.length === pts.length - 1
            ? pts
                .slice(1)
                .map((v, i) =>
                  path(
                    [pts[i], v],
                    `stroke="${refColors[i]}" stroke-width="1.6"`,
                  ),
                )
                .join("")
            : path(pts, attrs)
        }${text(tx, ty, ll, { size: explicit ? 8.5 : 10, anchor, color: review ? "#98611f" : "#153b71", attrs: `data-e="${esc(e.id)}" ${e.line_destination ? 'data-destination-label="true"' : ""} style="cursor:pointer"` })}</g>`,
      );
      edgeRecords.push({
        id: e.id,
        from,
        to,
        from_port: up.ports?.[e.id] || null,
        to_port: a.nodes[to].ports?.[e.id] || null,
        pts,
      });
      geometry[e.id] = pts;
    }
    for (const [id, n] of Object.entries(a.nodes)) {
      const p = P[id],
        bad = issues.some((x) => x.item === id),
        ink =
          n.kind === "antenna"
            ? n.dev === "Panel"
              ? "#1D4ED8"
              : n.dev === "Dome"
                ? "#DC2626"
                : bad
                  ? "#a33b22"
                  : "#111"
            : bad
              ? "#a33b22"
              : "#111",
        dd = n.diagram_placement,
        parts = [];
      const leaky = a.pe[id]?.cable === "LCK" && !(a.kids[id] || []).length;
      if (explicit && dd?.paths?.length) {
        for (const pp of dd.paths)
          parts.push(path(pp.map(point), `stroke="${ink}" stroke-width="1.2"`));
      } else if (n.kind === "source")
        parts.push(
          path(
            [
              [p.x - (explicit ? 28 : 8), p.y],
              [p.x + (explicit ? 0 : 28), p.y],
            ],
            'stroke="#111" stroke-width="1.7"',
          ),
          path(
            [
              [p.x + (explicit ? -8 : 20), p.y - 5],
              [p.x + (explicit ? 0 : 28), p.y],
              [p.x + (explicit ? -8 : 20), p.y + 5],
            ],
            'stroke="#111" stroke-width="1.3"',
          ),
        );
      else if (n.kind === "antenna")
        parts.push(
          path(
            [
              [p.x, p.y],
              [p.x, p.y - 35],
            ],
            `stroke="${ink}" stroke-width="1.4"`,
          ),
          path(
            [
              [p.x - 13, p.y - 46],
              [p.x, p.y - 35],
              [p.x + 13, p.y - 46],
            ],
            `stroke="${ink}" stroke-width="1.4"`,
          ),
          path(
            [
              [p.x, p.y - 35],
              [p.x, p.y - 49],
            ],
            `stroke="${ink}" stroke-width="1.4"`,
          ),
        );
      else if (n.kind === "device") {
        parts.push(
          `<rect x="${p.x - 25}" y="${p.y - 17}" width="50" height="34" fill="white" stroke="${ink}" stroke-width="1.2"/>`,
        );
        if (/^DC/.test(n.dev || ""))
          parts.push(
            path(
              [
                [p.x - 25, p.y],
                [p.x + 25, p.y],
              ],
              `stroke="${ink}" stroke-width="1.2"`,
            ),
            path(
              [
                [
                  p.x - 12,
                  p.y +
                    (Object.values(portAnchors[id]).some((q) => q[1] > p.y + 5)
                      ? 5
                      : -5),
                ],
                [
                  p.x,
                  p.y +
                    (Object.values(portAnchors[id]).some((q) => q[1] > p.y + 5)
                      ? 5
                      : -5),
                ],
                [
                  p.x,
                  p.y +
                    (Object.values(portAnchors[id]).some((q) => q[1] > p.y + 5)
                      ? 17
                      : -17),
                ],
              ],
              `stroke="${ink}" stroke-width="1.2"`,
            ),
          );
        else if (/^SPL/.test(n.dev || "")) {
          parts.push(
            path(
              [
                [p.x - 25, p.y],
                [p.x - 8, p.y],
              ],
              `stroke="${ink}" stroke-width="1.2"`,
            ),
          );
          for (const v of a.adj[id].filter(
            (v) => n.ports?.[v.edge.id] !== "IN",
          )) {
            const q = portAnchors[id][v.edge.id];
            parts.push(
              path([[p.x - 8, p.y], q], `stroke="${ink}" stroke-width="1.2"`),
            );
          }
        } else
          parts.push(
            text(p.x, p.y + 4, [n.dev || "?"], { size: 11, color: ink }),
          );
      } else if (n.connection_type==='ADAPTER') {
        parts.push(`<rect data-adapter="true" x="${p.x-6}" y="${p.y-4}" width="12" height="8" fill="white" stroke="#53606a"/><path d="M${p.x-2} ${p.y-4}V${p.y+4}M${p.x+2} ${p.y-4}V${p.y+4}" stroke="#53606a"/>`);
      } else if (leaky) {
        parts.push(
          path(
            [
              [p.x - 10, p.y],
              [p.x + 10, p.y],
            ],
            `stroke="#16854a" stroke-width="2"`,
          ),
          text(p.x, p.y - 12, ["LCX"], { size: 10, color: "#16854a" }),
        );
      } else if (a.adj[id].length > 2)
        parts.push(
          `<path d="M${p.x} ${p.y - 7}l7 7 -7 7 -7 -7Z" fill="#fff0dc" stroke="#a33b22"/><text x="${p.x + 10}" y="${p.y - 8}" font-size="9" fill="#a33b22">PASSIVE ?</text>`,
        );
      else
        parts.push(`<circle cx="${p.x}" cy="${p.y}" r="1.6" fill="${ink}"/>`);
      let labelXY =
          explicit && dd?.label_xy ? point(dd.label_xy) : [p.x, p.y - 71],
        anchor = explicit && dd?.label_xy ? "start" : "middle";
      if (n.kind === "antenna")
        parts.push(
          text(labelXY[0], labelXY[1], [n.dev + " antenna", ...labels(m, n)], {
            size: explicit ? 8.5 : 11,
            anchor,
            color: ink,
            attrs: `data-n="${esc(id)}" style="cursor:pointer"`,
          }),
        );
      else if (n.kind === "source")
        parts.push(
          text(p.x - 15, p.y - 30 - 13 * (m.meta?.tool_settings?.line_labels?.stairs === false ? 0 : (n.feed_annotation?.lines?.length || 0)), [C.sourceType(n) + " · " + (n.label || id), ...(m.meta?.tool_settings?.line_labels?.stairs === false ? [] : n.feed_annotation?.lines || [])], {
            size: 12,
            anchor: "start",
            color: "#111",
            attrs: `data-n="${esc(id)}" style="cursor:pointer"`,
          }),
        );
      else if (n.kind === "device") {
        let center =
            explicit && dd?.body_center ? point(dd.body_center) : [p.x, p.y],
          value =
            explicit && dd?.value_xy
              ? point(dd.value_xy)
              : [center[0], center[1] + 33];
        const model = /^DC(?:\d+|_PENDING)$/.test(n.dev || "")
          ? (n.dev === "DC_PENDING" ? "?" : n.dev.slice(2)) + " dB"
          : n.dev === "SPL2"
            ? "3.2 dB"
            : n.dev === "SPL3"
              ? "5.4 dB"
              : n.dev === "PASSIVE_UNKNOWN"
                ? "PASSIVE ?"
                : n.dev || "DEVICE ?";
        parts.push(
          text(
            value[0],
            value[1],
            [model],
            {
              size: 10,
              anchor: explicit && dd?.value_xy ? "start" : "middle",
              color: "#527b17",
              attrs: `data-n="${esc(id)}" style="cursor:pointer"`,
            },
          ),
        );
        for (const v of a.adj[id]) {
          const role = host.RFPlan?.assignments(m, n)?.[v.edge.id] || n.port_slots?.[v.edge.id] || n.ports?.[v.edge.id] || "?",
            q = portAnchors[id][v.edge.id];
          const dx = q[0] - center[0],
            dy = q[1] - center[1],
            vertical = Math.abs(dy) > Math.abs(dx);
          let x = q[0] + (vertical ? 8 : dx < 0 ? -6 : 6),
            y = q[1] + (vertical ? (dy < 0 ? -7 : 14) : -8);
          parts.push(
            text(x, y, [role], {
              size: 7,
              anchor: vertical ? "start" : dx < 0 ? "end" : "start",
              color: "#527b17",
              attrs: `data-port="${esc(role)}" data-port-edge="${esc(v.edge.id)}"`,
            }),
          );
        }
      }
      if (explicit && n.review?.includes("absent from legacy"))
        parts.push(
          text(p.x, p.y + 28, ["CAD ONLY / UNCONNECTED"], {
            size: 11,
            color: "#a33b22",
          }),
        );
      if (n.kind === "missing")
        parts.push(
          text(p.x, p.y - 12, ["MISSING NODE " + id], { color: "#a33b22" }),
        );
      const warning=rxWarnings['node:'+id]||rxWarnings['edge:'+(a.pe[id]?.id||'')];
      if(warning)parts.push(`<g data-rx-warning="true"><circle cx="${p.x}" cy="${p.y}" r="18" fill="none" stroke="#c7202b" stroke-width="2"/>${text(p.x+20,p.y+24,[`RX ${warning.received_dbm.toFixed(1)} dBm / ${warning.frequency_mhz} MHz`],{size:10,anchor:'start',color:'#ba1626',attrs:`data-rf-label="true" data-label-key="rx:${esc(id)}" data-anchor="${p.x},${p.y}"`})}</g>`);
      body.push(
        `<g data-node-id="${esc(id)}" data-symbol="${esc(n.kind === "device" ? (/^DC/.test(n.dev || "") ? "coupler" : /^SPL/.test(n.dev || "") ? "splitter" : "equipment") : n.kind === "antenna" ? "antenna" : n.kind === "source" ? "source" : leaky ? "lcx" : "junction")}"><title>${esc((n.label || id) + " | " + (n.dev || n.kind) + (bad ? " | CHECK" : ""))}</title>${parts.join("")}</g>`,
      );
    }
    const header = [
      `<svg xmlns="http://www.w3.org/2000/svg" id="rfTopologySVG" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Arial,Helvetica,sans-serif"><rect width="${W}" height="${H}" fill="white"/><rect x="20" y="20" width="${W - 40}" height="${H - 40}" fill="none" stroke="#333" stroke-width="1"/>`,
      text(
        55,
        58,
        [
          `${m.meta?.floor || "RF"} / RF LINE DIAGRAM${m.meta?.reference_only ? " — REFERENCE REVIEW" : ""}`,
        ],
        { size: 22, anchor: "start", color: "#111" },
      ),
      text(
        55,
        85,
        [
          `${C.sourceSummary(m)} | ${Object.keys(m.nodes).length} nodes | ${a.edges.length} cable sections | ${s.mode}`,
        ],
        { size: 11, anchor: "start", color: "#444" },
      ),
      text(
        55,
        132,
        [
          explicit
            ? "Original schematic wire colors preserved. Cable types / lengths remain subject to current CAD reconciliation."
            : "COUPLER: IN > THRU, side tap > COUPLED   |   SPLITTER: IN > separate OUT ports   |   Blue: 1/2 coax   Red: 1-1/4 coax   Green: LCX",
        ],
        { size: 10, anchor: "start", color: "#444" },
      ),
    ];
    for (const f of s.frames) {
      const name = f.comp.sources.length
        ? f.comp.sources.map((k) => C.sourceType(a.nodes[k]) + " · " + (a.nodes[k].label || k)).join(" / ")
        : "UNFED — " + f.comp.nodes.join(", ") + " (double-click to locate)";
      header.push(
        `<rect x="${f.left ?? 45}" y="${f.top}" width="${f.right != null ? f.right - f.left : W - 90}" height="${f.bottom - f.top}" fill="none" stroke="#aaa" stroke-dasharray="8 5"/>`,
        text(
          (f.left ?? 45) + 20,
          f.top + 25,
          [
            name +
              (f.comp.sources.length > 1 ? " — JOINED SOURCES / HOLD" : ""),
          ],
          {
            size: 12,
            anchor: "start",
            color: "#111",
            attrs: 'data-source-caption="true"' + (!f.comp.sources.length ? ` data-node-id="${esc(f.comp.nodes[0])}" style="cursor:pointer"` : ''),
          },
        ),
      );
    }
    const original =
        host.RFOriginal ||
        (typeof require === "function" ? require("./rf-original.js") : null),
      legend = original.legend(45, diagramH + 6, {
        reference_colors: explicit,
      });
    const svg =
      header.join("") +
      body.join("") +
      '<g data-legend="true">' +
      legend.svg +
      "</g>" +
      "" +
      (explicit
        ? text(
            270,
            diagramH + 58,
            [
              "Reference wire colors are preserved; cable classes still require current CAD reconciliation.",
            ],
            { size: 10, anchor: "start", color: "#a45b24" },
          )
        : "") +
      "</svg>";
    return {
      svg,
      width: W,
      height: H,
      nodeCount: Object.keys(a.nodes).length,
      edgeCount: a.edges.length,
      sourceCount: Object.values(m.nodes).filter((n) => n.kind === "source")
        .length,
      components: a.components.length,
      issues,
      positions: P,
      portAnchors,
      edgeRecords,
      placementMode: s.mode,
      frames: s.frames,
    };
  }
  const api = { render, signature };
  host.RFLine = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof globalThis === "undefined" ? this : globalThis);
