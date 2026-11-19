/* The exact same visible scene is used for the editor and layout PDF. */
(function (host) {
  "use strict";
  const C = host.RFCore,
    P = host.RFPlan,
    esc = (s) =>
      String(s ?? "").replace(
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
  // TestPoint band colours, shared by every TestPoint annotation and the antenna label extra lines
  const BAND_COLOR = { 400: "#1d4ed8", 800: "#c2410c", 1795: "#7e22ce", 1910: "#0f766e" };
  function render(m, o) {
    const { width: W, height: H, font: fs, symbol: k, vis: v, labels: on } = o,
      parts = [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Arial,Helvetica,sans-serif">`,
      ],
      seen = new Set();
    // every label is drawn like the TestPoint cards: white box (LABEL_BG opacity) with a frame in the label's colour
    // (user 2026-11-19: 所有的 label 都改成 testpoint 紫色 label 一樣的形式，平時也有白底和框，透明度再高一點)
    // ... and, like the TestPoint card headings, in bold with a deeper colour (user 2026-11-19: label 的字體和顏色加粗加深)
    function deep(c) {
      const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c || ""));
      if (!m) return c;
      const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join("") : m[1];
      let [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let H = 0, S = 0; const Lm = (mx + mn) / 2, d = mx - mn;
      if (d) { S = d / (1 - Math.abs(2 * Lm - 1)); H = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; H *= 60; if (H < 0) H += 360; }
      const S2 = Math.min(1, S * 1.15 + 0.05), L2 = Math.max(0.12, Lm * 0.72), C2 = (1 - Math.abs(2 * L2 - 1)) * S2, X = C2 * (1 - Math.abs(((H / 60) % 2) - 1)), M0 = L2 - C2 / 2;
      const [r1, g1, b1] = H < 60 ? [C2, X, 0] : H < 120 ? [X, C2, 0] : H < 180 ? [0, C2, X] : H < 240 ? [0, X, C2] : H < 300 ? [X, 0, C2] : [C2, 0, X];
      return "#" + [r1, g1, b1].map((v) => Math.round((v + M0) * 255).toString(16).padStart(2, "0")).join("");
    }
    function label(x, y, lines, key, attrs, color0, size = fs) {
      if (!on || !lines.length) return "";
      const L = lines.filter(Boolean);
      if (!L.length) return "";
      const tx = x + 10 * k, ty = y - 9 * k, color = deep(color0);
      return `<g class="rf-label" data-rf-label="true" data-label-key="${esc(key)}" data-anchor="${x},${y}" ${attrs}>${labelBox(tx, ty, L.map((s) => s?.t ?? s), size, color, "start")}<text x="${tx}" y="${ty}" fill="${color}" font-size="${size}" font-weight="700">${L
        .map(
          (s, i) =>
            `<tspan x="${tx}" dy="${i ? size * 1.2 : 0}"${s?.c ? ` fill="${deep(s.c)}"` : ""}>${esc(s?.t ?? s)}</tspan>`,
        )
        .join("")}</text></g>`;
    }
    // the box behind a label: text starting (or centred, anchor "middle") at tx, first baseline at ty
    function labelBox(tx, ty, texts, size, color, anchor) {
      const pad = size * 0.32, w = Math.max(...texts.map((t) => tw(t, size) * 1.08)) + 2 * pad,   // bold is ~8% wider
        h = size * (1.2 * (texts.length - 1) + 1.15) + 2 * pad, x0 = anchor === "middle" ? tx - w / 2 : tx - pad;
      return `<rect x="${x0}" y="${ty - size * 0.88 - pad}" width="${w}" height="${h}" rx="${size * 0.18}" fill="white" fill-opacity="${LABEL_BG}" stroke="${color}" stroke-width="${0.6 * k}"/>`;
    }
    function length(e) {
      if (e.route_status === "INHERITED_STAIR_REFERENCE") return `${e.reference_reserve_m ?? 100} m`;
      if (e.handoff_reference) return "Port boundary";
      const L = C.lengthInfo(m, e);
      if (L.value == null) return "Length pending";
      return Number(L.value.toFixed(2)) + " m";
    }
    // Card: white box, header line(s) and one row per band with a colour chip (BAND_COLOR); values below -85 dBm get a red
    // frame. Shared by every TestPoint annotation and by antenna labels that carry test values.
    const fh = fs * 0.86, fr = fs * 0.78, LABEL_BG = 0.78;   // white box opacity of labels and cards
    const tw = (str, size) => [...String(str)].reduce((w, ch) => w + (ch.codePointAt(0) > 0x2e80 ? size : size * 0.58), 0);
    // card(cx, cy, head, rows, o): head = {t: text or [lines], color, frame, size, weight}; rows = [{b, t, low}] or [{t, c}]
    const card = (cx, cy, head, rows, o = {}) => {
      const hl = head ? [].concat(head.t) : [], hs = head?.size || fh;
      const pad = fr * 0.4, chipW = fr * 2.15, rh = fr * 1.32, hh = head ? hs * (1.2 * hl.length + 0.25) : 0;
      const rowW = (r) => (r.b ? chipW + fr * 0.4 : 0) + tw(r.t, fr);
      const w = Math.max(...hl.map((t) => tw(t, hs)), ...rows.map(rowW), fr * 2) + 2 * pad;
      const h = (head ? hh : pad * 0.7) + rows.length * rh + (rows.length ? pad * 0.7 : 0);
      const x = cx - w / 2, y = cy - h / 2, frame = o.frame || "#333";
      let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${fr * 0.18}" fill="white" fill-opacity="${LABEL_BG}" stroke="${frame}" stroke-width="${0.6 * k}"/>`;
      if (head) {
        if (head.frame) s += `<rect data-role="room-frame" x="${x}" y="${y}" width="${w}" height="${hh}" rx="${fr * 0.18}" fill="white" stroke="${head.frame}" stroke-width="${1.1 * k}"/>`;
        else if (rows.length) s += `<line x1="${x}" y1="${y + hh}" x2="${x + w}" y2="${y + hh}" stroke="${frame}" stroke-width="${0.35 * k}" opacity="0.5"/>`;
        s += `<text data-role="${o.role || "head"}" x="${x + pad}" y="${y + hs * 1.05}" font-size="${hs}" font-weight="${head.weight || 700}" fill="${head.color || "#111"}">${hl.map((t, i) => `<tspan x="${x + pad}" dy="${i ? hs * 1.2 : 0}">${esc(t)}</tspan>`).join("")}</text>`;
      }
      rows.forEach((r, i) => {
        const ry = y + (head ? hh : pad * 0.7) + i * rh, base = ry + rh * 0.73;
        let tx = x + pad;
        if (r.b) {
          s += `<rect x="${tx}" y="${ry + rh * 0.13}" width="${chipW}" height="${rh * 0.74}" rx="${fr * 0.16}" fill="${BAND_COLOR[r.b] || "#555"}"/><text x="${tx + chipW / 2}" y="${ry + rh * 0.66}" text-anchor="middle" font-size="${fr * 0.74}" font-weight="700" fill="white">${esc(r.b)}</text>`;
          tx += chipW + fr * 0.4;
        }
        // below -85 dBm: red frame around the row, as the RX below -85 dBm warning marks the model; the same switch
        // (vis.rxWarnings) turns both off
        const low = r.low && v.rxWarnings;
        if (low) s += `<rect data-role="low" x="${tx - fr * 0.2}" y="${ry + rh * 0.06}" width="${tw(r.t, fr) + fr * 0.4}" height="${rh * 0.88}" rx="${fr * 0.12}" fill="#fde8e8" stroke="#d71920" stroke-width="${0.8 * k}"/>`;
        s += `<text data-role="value" x="${tx}" y="${base}" font-size="${fr}"${low ? ' font-weight="700"' : ""} fill="${low ? "#d71920" : r.c || "#111"}">${esc(r.t)}</text>`;
      });
      return { s, x, y, w, h };
    };
    // TestPoint stair readings ("LT 9d From L1 to GF -90 L2-L1 (L1M) -83") as band rows "→GF -90 · L2-L1 (L1M) -83"
    const TP_BANDS = ["400", "800", "1795", "1910"], tpOn = (b) => v["tpb" + b] !== 0;
    const stairRows = (sr) => TP_BANDS.filter((b) => tpOn(b) && sr.bands?.[b]).map((b) => {
      const body = String(sr.bands[b]).replace(/^\S*LT\s*\S+\s*/i, ""),
        segs = [...body.matchAll(/(.*?)\s*(-\d+(?:\.\d+)?)(?:\s*dBm)?(?=\s|$)/gi)].filter((x) => x[2]);
      const name = (l) => { l = l.trim().replace(/:$/, "").trim(); const to = l.match(/^(?:from\s+\S+\s+)?to\s+(\S+)$/i); return to ? "→" + to[1] : l; };
      const t = segs.length ? segs.map((x) => [name(x[1]), x[2]].filter(Boolean).join(" ")).join(" · ") : body;
      return { b, t, low: segs.some((x) => Number(x[2]) < -85) };
    });
    // user 2026-11-18: every TestPoint has one style (purple card); stair readings are TestPoints of their own again and
    // the stair cable keeps its plain label (STAIR_ON_EDGE stays empty)
    const STAIR_ON_EDGE = {};
    // grey stair reference notes (meta.layout_reference_annotations, "LT13a(SZ) From B2 to LG: 70 m"): not drawn since the
    // stair pass-through drawings show the same (user 2026-11-19: 這些灰色的標籤要刪掉); the data stays, VIS.refNotes = 1 shows them
    if(v.cabLCK&&v.refNotes){
      const outlined=new Set();
      for(const a of m.meta?.layout_reference_annotations||[]){
        const anchor=a.anchor;if(!anchor)continue;
        let shapes='';
        for(const [i,ps]of(a.outlines_canvas||[]).entries()){
          const key=(a.outline_handles||[])[i]||JSON.stringify(ps);
          if(outlined.has(key)||ps.length<2)continue;outlined.add(key);
          shapes+=`<path d="M${ps.map(p=>p.join(' ')).join('L')}" fill="none" stroke="#72857a" stroke-width="${1.1*k}"/>`;
        }
        const dot=`<rect x="${anchor[0]-3*k}" y="${anchor[1]-3*k}" width="${6*k}" height="${6*k}" fill="white" stroke="#72857a"/>`;
        parts.push(`<g data-reference-only="true" data-layer="cabLCK">${shapes}${dot}${v.lblLCK?label(anchor[0],anchor[1],a.lines||[],"reference:"+a.annotation_id,`data-reference-id="${esc(a.annotation_id)}"`,"#52665b",fs*.86):''}</g>`);
      }
    }
    for (const e of Object.values(m.edges)) {
      if (!v["cab" + e.cable]) continue;
      if (e.layout_handoff) {
        const ps = P.points(m, e, k), hf = e.layout_handoff;
        for (const [side, p, sign] of [["a", ps[0], 1], ["b", ps[ps.length - 1], -1]]) {
          const q = [p[0] + sign * 36 * k, p[1]], co = C.CABLE[e.cable]?.color || "#8a6e55";
          const lines = [];
          if (v["lbl" + e.cable]) lines.push((side === "a" ? "To " + hf.to : "From " + hf.from), hf.id);
          if (v.lblLen) lines.push(length(e));
          parts.push(`<g data-edge-id="${esc(e.id)}" data-layer="cab${e.cable}"><path d="M${p[0]} ${p[1]}L${q[0]} ${q[1]}" fill="none" stroke="${co}" stroke-width="${1.3*k}"${e.review_verified ? "" : ` stroke-dasharray="${4*k} ${2*k}"`}/><circle cx="${q[0]}" cy="${q[1]}" r="${2*k}" fill="white" stroke="${co}"/>${label(q[0],q[1],lines,"edge:"+e.id+":handoff:"+side,`data-e="${esc(e.id)}"`,co,fs*.85)}</g>`);
        }
        continue;
      }
      const ps = P.points(m, e, k);
      if (ps.length < 2) continue;
      const co = C.CABLE[e.cable]?.color || "#8a6e55";
      let text = "";
      if (
        on &&
        (v["lbl" + e.cable] || v.lblLen || e.stair) &&
        !e.direct_symbol_link
      ) {
        let longest = 1;
        for (let i = 2; i < ps.length; i++)
          if (!e.layout_breaks?.includes(i) &&
            Math.hypot(ps[i][0] - ps[i - 1][0], ps[i][1] - ps[i - 1][1]) >
            Math.hypot(
              ps[longest][0] - ps[longest - 1][0],
              ps[longest][1] - ps[longest - 1][1],
            )
          )
            longest = i;
        const x = (ps[longest - 1][0] + ps[longest][0]) / 2,
          y = (ps[longest - 1][1] + ps[longest][1]) / 2;
        const sectionNames = new Set();
        function sections(items, origin) {
          for (const [i, s] of items.entries()) {
            const key = origin + ":" + i;
            if (seen.has(key)) continue;
            seen.add(key);
            // a CAD section label often carries only the H name: shown with its L pair, like the cable's own label
            // (user 2026-11-19: 部份 cox cable 的 label 只顯示 H)
            const ids = [...new Set((s.ids || []).flatMap((id) => (/-H-/.test(id) ? [id, id.replace("-H-", "-L-")] : [id])))];
            ids.forEach((id) => sectionNames.add(id));
            const anchor = s.anchor || s.anchor_reference || [x, y];
            text += label(
              anchor[0],
              anchor[1],
              [
                ...(v["lbl" + e.cable] ? ids : []),
                ...(v.lblLen && (s.display_m ?? s.cad_m) != null
                  ? [Math.round(Number(s.display_m ?? s.cad_m)) + " m"]
                  : []),
              ],
              "edge:" + origin + ":section:" + i,
              `data-e="${esc(e.id)}" data-layer="lbl${e.cable}"`,
              co,
              fs * 0.9,
            );
          }
        }
        // stair cables: names, stair no. and length are in the main label / card; their section labels only repeated them
        if (!e.stair) sections(e.layout_section_labels || [], e.id);
        if (e.split_origin && !e.stair)
          sections(
            e.split_origin.layout_section_labels || [],
            e.split_origin.edge_id,
          );
        const L = C.lengthInfo(m, e),
          names = C.labels(m, e),
          sameSections =
            names.length && names.every((s) => sectionNames.has(s));
        if (!e.layout_section_labels?.length || L.is_reserve || e.stair) {
          const lines = [
            ...(v["lbl" + e.cable] && !sameSections ? names : []),
            // user 2026-11-18: no "Stair Excel F2 = 56 m" line on drawings (the cell stays in the data)
            // stair line from the cable's own stair fields (editable in the cable panel); a pass-through drawing lists each
            // run it stands for (stair-passing.cjs writes those lines)
            ...(e.stair_pass && e.stair_annotation?.lines?.length
              ? e.stair_annotation.lines.filter((l) => !/^Stair Excel\b/i.test(l))
              : e.stair
                ? [`${e.stair.location || e.stair.code || "LT?"} · From ${e.stair.from || "?"} to ${e.stair.to || "?"}`]
                : []),
            // no "0 m" on pass-through drawings and on stair copies whose local length is unknown (0 is a placeholder)
            ...(v.lblLen && !e.stair_pass && e.stair?.local_length_status !== "UNKNOWN_NOT_ZERO_MEASUREMENT" && (!e.layout_section_labels?.length || L.is_reserve || e.stair) ? [length(e)] : []),
          ];
          const rows = (STAIR_ON_EDGE[e.id] || []).flatMap(stairRows);
          if (rows.length) {
            // stair cable label + the TestPoint stair readings of this stair: one card, same key as the plain label
            const head = lines.length ? { t: lines, color: co, size: fs * 0.9, weight: 400 } : { t: STAIR_ON_EDGE[e.id][0].stair_no, color: co };
            const c0 = card(0, 0, head, rows), c = card(x + 10 * k + c0.w / 2, y - 9 * k - fs + c0.h / 2, head, rows, { frame: co });
            text += `<g class="rf-label" data-rf-label="true" data-label-key="edge:${esc(e.id)}:main" data-anchor="${x},${y}" data-e="${esc(e.id)}" data-layer="lbl${e.cable}" data-stair-card="${esc(STAIR_ON_EDGE[e.id].map((r) => r.stair_no).join(" "))}">${c.s}</g>`;
          } else text += label(x, y, lines, "edge:" + e.id + ":main", `data-e="${esc(e.id)}" data-layer="lbl${e.cable}"`, co, fs * 0.9);
        }
      }
      parts.push(
        `<g data-edge-id="${esc(e.id)}" data-layer="cab${e.cable}"><path d="${ps.map((p,i) => (i === 0 || e.layout_breaks?.includes(i) ? "M" : "L") + p.join(" ")).join(" ")}" fill="none" stroke="${co}" stroke-width="${1.3 * k}" stroke-linejoin="round" stroke-linecap="round"${e.review_only && !e.review_verified ? ' stroke-dasharray="' + 5 * k + " " + 3 * k + '"' : ""}/>${text}</g>`,
      );
    }
    const antTop = [];
    for (const n of Object.values(m.nodes)) {
      if (
        (n.kind === "antenna" && !v.symAnt) ||
        (n.kind === "device" && !v.symDev) ||
        (n.kind === "source" && v.symSource === 0)
      )
        continue;
      const [x, y] = P.position(m, n, k),
        type =
          n.kind === "antenna"
            ? "symAnt"
            : n.kind === "device"
              ? "symDev"
              : "symSource";
      // antennas are drawn last, above every other layer (user 2026-11-18: 天線的圖層最高 priority)
      (n.kind === "antenna" ? antTop : parts).push(P.glyph(m, n, k).replace("<g ", `<g data-layer="${type}" `));
      const attrs = `data-n="${esc(n.id)}" data-layer="${n.kind === "device" ? "lblDev" : n.kind === "antenna" ? "lblAnt" : "lblSource"}"${n.kind === "antenna" ? ' data-label-priority="-0.5"' : ""}`;
      if (n.kind === "antenna" && v.lblAnt) {
        // TestPoint blue tags on this antenna: the label becomes a card (names + one band row each), same style as TP cards
        const col = n.dev === "Panel" ? "#2563ab" : "#bd3030",
          info = v.testPoints && !v.tpClean ? (m.meta.test_points?.antenna_info?.[n.label] || []).filter((t) => v["tpb" + String(t).split(":")[0]] !== 0) : [];
        if (on && info.length) {
          const rows = info.map((t) => { const [b, ...rest] = String(t).split(":"), val = rest.join(":").trim(); return { b, t: val, low: parseFloat(val) < -85 }; });
          const head = { t: C.labels(m, n), color: col, size: fs, weight: 400 }, c0 = card(0, 0, head, rows);
          const c = card(x + 10 * k + c0.w / 2, y - 9 * k - fs + c0.h / 2, head, rows, { frame: col });
          parts.push(`<g class="rf-label" data-rf-label="true" data-label-key="node:${esc(n.id)}" data-anchor="${x},${y}" data-antenna-card="" ${attrs}>${c.s}</g>`);
        } else parts.push(label(x, y, C.labels(m, n), "node:" + n.id, attrs, col));
      }
      if (n.kind === "device" && v.lblDev && on && /^DC(?:\d+|_PENDING)$/.test(n.dev))
        {
          const t = `${n.dev === "DC_PENDING" ? "?" : n.dev.slice(2)} dB`;
          parts.push(
            `<g class="rf-label" data-device-db="${esc(n.id)}" data-n="${esc(n.id)}" data-rf-label="true" data-label-key="db:${esc(n.id)}" data-anchor="${x},${y}">${labelBox(x, y + 28 * k, [t], fs, deep("#715114"), "middle")}<text x="${x}" y="${y + 28 * k}" text-anchor="middle" fill="${deep("#715114")}" font-size="${fs}" font-weight="700">${esc(t)}</text></g>`,
          );
        }
      // the end of a stair cable ("LT15c / To L4") repeats the stair cable's own label (stair no. · From .. to ..): not drawn
      // user 2026-11-18: every stair cable reads feed port -> cable -> "To L5M2" (the floor it goes to), or "LT13D end" on that
      // floor itself; the end label replaces the CAD text ("LT15c / To L4") that repeated the cable label
      const stairEdge = n.kind === "termination" && Object.values(m.edges).find((e) => (e.a === n.id || e.b === n.id) && (e.stair || e.length?.is_stair));
      const sto = stairEdge?.stair?.to, sloc = stairEdge?.stair?.location || stairEdge?.stair?.code;
      const endText = n.display ? [n.display] : stairEdge ? [sto && sto !== m.meta.floor ? `To ${sto}` : `${sloc || "Stair"} end`] : null;
      // stair feed ports: one line "LT15C feed port" (user 2026-11-18), the ORU / via lines stay in the data
      const feedText = n.kind === "source" && n.feed_annotation?.stair_no ? [`${n.feed_annotation.stair_no} feed port`] : null;
      if (["source", "termination"].includes(n.kind) && v.lblSource !== 0)
        parts.push(
          label(x, y, feedText || endText || [n.label || n.id, ...(n.kind === "source" ? n.feed_annotation?.lines || [] : [])], "node:" + n.id, attrs, "#715114"),
        );
    }
    // TestPoint layer (meta.test_points of the floor JSON, CAD mm). Every annotation is a white card: a header line and
    // one row per band. Bands carry a fixed colour chip (BAND_COLOR); values below -85 dBm get a red frame. Leaders run from the
    // card edge to the target: TP = yellow pin, measured point = black diamond, stair reading = green dot.
    const TPD = m.meta.test_points, TT = m.meta.coordinate_transform;
    if (v.testPoints && TPD && TT) {
      const cv = (p) => [(p[0] - TT.lo[0]) * TT.canvas_per_mm + 100, (TT.hi[1] - p[1]) * TT.canvas_per_mm + 100],
        g = [], bandOrder = ["400", "800", "1795", "1910"], LOW = -85,
        txt = (x, y, lines, color, size, extra = "") =>
          `<text x="${x}" y="${y}" fill="${color}" font-size="${size}" stroke="white" stroke-width="${size * 0.14}" paint-order="stroke" ${extra}>${lines.map((s, i) => `<tspan x="${x}" dy="${i ? size * 1.2 : 0}" ${s.c ? `fill="${s.c}"` : ""}>${esc(s.t ?? s)}</tspan>`).join("")}</text>`;
      g.push(`<defs><marker id="tpArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0L10,5L0,10z" fill="context-stroke"/></marker></defs>`);
      // Band switches (Layout > TestPoint): only the bands that are on are drawn.
      const bandOn = (b) => v["tpb" + b] !== 0, onBands = bandOrder.filter(bandOn);
      const edge = (c, p) => [Math.min(Math.max(p[0], c.x), c.x + c.w), Math.min(Math.max(p[1], c.y), c.y + c.h)];
      // a card is a movable label: RFLabels keeps it at its drawing position unless it collides, draws the leader to the
      // anchor in the card's colour, and remembers manual drags (meta.label_positions.layout[key])
      // data-tp = the TestPoint item the card shows (click it to edit: testpoint-edit.js); the selected one is highlighted
      const TPSEL = host.RFTestPointEdit?.selected;
      const movable = (c, key, anchor, color, w = 0.7, ref = "") =>
        `<g class="rf-label" data-rf-label="true" data-label-key="${esc(key)}" data-anchor="${anchor ? anchor.join(",") : `${c.x + c.w / 2},${c.y + c.h / 2}`}" data-keep-place="" data-label-priority="3" data-leader-color="${color}" data-leader-width="${w * k}"${ref ? ` data-tp="${esc(ref)}"` : ""}${ref && ref === TPSEL ? " data-tp-selected=\"\"" : ""}>${c.s}</g>`;
      const leader = (c, p, color, w = 0.7) => { const e = edge(c, p); return Math.hypot(e[0] - p[0], e[1] - p[1]) < 2 * k ? "" : `<line x1="${e[0]}" y1="${e[1]}" x2="${p[0]}" y2="${p[1]}" stroke="${color}" stroke-width="${w * k}"/>`; };
      const diamond = ([x, y], color = "#111", ref = "") => { const d = 2.6 * k; return `<path data-label-obstacle=""${ref ? ` data-tp-point="${esc(ref)}"` : ""} d="M${x},${y - d}L${x + d},${y}L${x},${y + d}L${x - d},${y}z" fill="white" stroke="${color}" stroke-width="${0.8 * k}"/>`; };
      const dbm = (vs) => vs.map((x) => `${x} dBm`).join(" / ");
      const pin = ([x, y], ref) => { const q = 0.8 * k; return `<path data-label-obstacle="" data-tp-point="${esc(ref)}" d="M${x},${y}c${-2.2 * q},${-3 * q} ${-4 * q},${-5 * q} ${-4 * q},${-7.2 * q}a${4 * q},${4 * q} 0 1 1 ${8 * q},0c0,${2.2 * q} ${-1.8 * q},${4.2 * q} ${-4 * q},${7.2 * q}z" fill="#f4c20d" stroke="#6b5200" stroke-width="${0.6 * k}"/><circle cx="${x}" cy="${y - 7.2 * q}" r="${1.4 * q}" fill="#6b5200"/>`; };
      // v.tpClean (clean TestPoint layout, user 2026-11-18): TestPoints only, names without readings
      if (TPD.measurements && !v.tpClean) {
        // measurement: red-framed room name (as marked in the TestPoint PDF) + one row per band; diamond at the measured point
        for (const ms of TPD.measurements) {
          if (ms.deleted) continue;
          const rows = onBands.filter((b) => ms.values?.[b]?.length).map((b) => ({ b, t: dbm(ms.values[b]), low: Math.min(...ms.values[b]) < LOW }));
          if (!rows.length) continue;
          const p = cv(ms.point_mm), c = card(...cv(ms.label_mm), ms.room ? { t: ms.room, frame: "#d71920" } : null, rows, { frame: "#222", role: "room" });
          g.push(`<g data-testpoint-measurement="${esc(ms.id)}"${ms.room ? ` data-room="${esc(ms.room)}"` : ""}>${diamond(p, "#111", "m:" + ms.id)}${movable(c, "tpm:" + ms.id, p, "#222", 0.7, "m:" + ms.id)}</g>`);
        }
        for (const [ri, r] of (TPD.rooms || []).entries()) {
          if (r.deleted || !Object.keys(r.bands || {}).some(bandOn)) continue;
          const c = card(...cv(r.label_mm), { t: r.text, frame: "#d71920" }, [], { role: "room" });
          g.push(`<g data-testpoint-room="${esc(r.text)}">${movable(c, "tpr:" + r.text + ":" + Math.round(r.label_mm[0]), r.tip_mm && cv(r.tip_mm), "#d71920", 0.6, "r:" + ri)}</g>`);
        }
      } else if (!v.tpClean) {
        // older data without measurements: readings grouped by measured point
        const groups = [];
        for (const r of TPD.readings || []) {
          if (!bandOn(r.band)) continue;
          const gp = groups.find((q) => Math.hypot(q.p[0] - r.point_mm[0], q.p[1] - r.point_mm[1]) < 300);
          if (gp) { if (!gp.v.some((x) => x.band === r.band && x.value_dbm === r.value_dbm)) gp.v.push(r); } else groups.push({ p: r.point_mm, l: r.label_mm, v: [r] });
        }
        for (const q of groups) {
          const p = cv(q.p), rows = q.v.sort((a, b) => bandOrder.indexOf(a.band) - bandOrder.indexOf(b.band)).map((r) => ({ b: r.band, t: `${r.value_dbm} dBm`, low: r.value_dbm < LOW }));
          const c = card(...cv(q.l), null, rows, { frame: "#222" });
          g.push(`<g data-testpoint-reading="true">${diamond(p)}${movable(c, "tpg:" + Math.round(q.p[0]) + "," + Math.round(q.p[1]), p, "#222")}</g>`);
        }
      }
      // stair readings: "LT 5d To 1F: -70 To 3F: -73" per band -> "→1F -70 · →3F -73"
      for (const [si, sr] of (TPD.stair_readings || []).entries()) {
        if (sr.deleted) continue;
        const rows = v.tpClean ? [] : stairRows(sr);
        const head = sr.name || (String(sr.text).match(/LT\s*\S+/i) || [sr.stair_no])[0];
        const c = card(...cv(sr.label_mm), { t: head, color: "#6b21a8" }, rows, { frame: "#7a1f86" });
        const tip = sr.tip_mm && cv(sr.tip_mm);
        g.push(`<g data-testpoint-stair="${esc(sr.stair_no)}"><title>${esc(`${head} | ${sr.stair_no} | ${sr.text || ""}`)}</title>${tip ? pin(tip, "s:" + si) : ""}${movable(c, "tps:" + sr.stair_no + ":" + Math.round(sr.label_mm[0]), tip, "#7a1f86", 0.6, "s:" + si)}</g>`);
      }
      // other plan text from the PDFs (ELV, To L1, ...): not room names; optional, small and grey
      if (v.tpNotes !== 0 && !v.tpClean)
        for (const nt of TPD.notes || []) {
          if (nt.is_room === true || (TPD.measurements && !Object.keys(nt.bands || {}).some(bandOn))) continue;
          const [lx, ly] = cv(nt.label_mm);
          g.push(`<g data-testpoint-note="true">${nt.tip_mm ? `<line x1="${lx}" y1="${ly}" x2="${cv(nt.tip_mm)[0]}" y2="${cv(nt.tip_mm)[1]}" stroke="#888" stroke-width="${0.45 * k}"/>` : ""}${txt(lx, ly, [nt.text], "#666", fr * 0.9)}</g>`);
        }
      // test points: purple card "TP-001" + blue-tag rows per band; yellow pin at the test point
      for (const t of TPD.tps || []) {
        if (t.deleted) continue;
        const p = cv(t.mm), o = t.label_offset_mm || [0, 4000], lp = cv([t.mm[0] + o[0], t.mm[1] + o[1]]);
        // stair TestPoints (up / down) look like every other TestPoint: stair and direction only in the data and lists (user 2026-11-18)
        const rows = [...(v.tpClean ? [] : onBands.filter((b) => t.bands?.[b]?.tags?.length || t.bands?.[b]?.tag_dbm != null)
          .map((b) => ({ b, t: (t.bands[b].tags || [t.bands[b].tag_dbm + " dBm"]).join(", "), low: t.bands[b].tag_dbm != null && t.bands[b].tag_dbm < LOW })))];
        // a TestPoint is always drawn, with or without values in the shown bands (user 2026-11-18)
        const review = /^different/.test(t.room), moved = t.moved_m > 0;
        // the room hint (nearest antenna in another room) was decided for delivery (2026-11-18): only in the tooltip now
        void review;
        const name = String(t.name || t.tp);   // TestPoint name, e.g. PRJ-L2-TP-001
        const c = card(...lp, { t: name, color: "#6b21a8" }, rows, { frame: "#7a1f86" });
        let s = "";
        if (moved) { const [ox, oy] = cv(t.original_mm); s += `<circle cx="${ox}" cy="${oy}" r="${3 * k}" fill="none" stroke="#9a8a40" stroke-dasharray="${2 * k} ${1.5 * k}"/><line x1="${ox}" y1="${oy}" x2="${p[0]}" y2="${p[1]}" stroke="#9a8a40" stroke-width="${0.6 * k}" stroke-dasharray="${2 * k} ${1.5 * k}"/>`; }
        const [x, y] = p, q = 0.8 * k;
        s += `<path data-label-obstacle="" data-tp-point="tp:${esc(t.tp)}" d="M${x},${y}c${-2.2 * q},${-3 * q} ${-4 * q},${-5 * q} ${-4 * q},${-7.2 * q}a${4 * q},${4 * q} 0 1 1 ${8 * q},0c0,${2.2 * q} ${-1.8 * q},${4.2 * q} ${-4 * q},${7.2 * q}z" fill="#f4c20d" stroke="#6b5200" stroke-width="${0.6 * k}"/><circle cx="${x}" cy="${y - 7.2 * q}" r="${1.4 * q}" fill="#6b5200"/>`;
        s += movable(c, "tp:" + t.tp, p, "#7a1f86", 0.6, "tp:" + t.tp);
        g.push(`<g data-testpoint="${esc(t.tp)}" data-room="${esc(t.room)}"><title>${esc(`${t.name} | antenna ${t.antenna || "-"} ${t.antenna_dist_m ?? ""} m | ${t.room}${moved ? ` | moved ${t.moved_m} m` : ""}`)}</title>${s}</g>`);
      }
      parts.push(`<g data-layer="testPoints">${g.join("")}</g>`);
    }
    if(v.rxWarnings){
      for(const [key,r] of Object.entries(host.RFDesign.warnings(m))){
        if(r.kind==='Antenna'&&!v.symAnt||r.kind==='Leaky'&&!v.cabLCK)continue;
        const n=m.nodes[r.node_id], [x,y]=P.position(m,n,k);
        const caption=`RX ${r.received_dbm.toFixed(1)} dBm / ${r.frequency_mhz} MHz`;
        parts.push(`<g data-rx-warning="true" data-layer="rxWarnings"><circle cx="${x}" cy="${y}" r="${9*k}" fill="none" stroke="#c7202b" stroke-width="${1.8*k}"/>${label(x,y,[caption],'rx:'+key,`data-n="${esc(n.id)}"`,'#ba1626',fs*.9)}</g>`);
      }
    }
    // stairs in the stair Excel with no cable in the model (meta.stair_checks, scripts/integration/stair-single-feed.cjs):
    // dashed orange ring at the CAD stair label, shown with the leaky-cable layer
    if (v.cabLCK && m.meta.coordinate_transform) {
      const TS = m.meta.coordinate_transform, cvs = (p) => [(p[0] - TS.lo[0]) * TS.canvas_per_mm + 100, (TS.hi[1] - p[1]) * TS.canvas_per_mm + 100];
      for (const c of m.meta.stair_checks || []) {
        if (c.code !== 'STAIR_NOT_MODELLED' || !c.mm) continue;
        const [x, y] = cvs(c.mm);
        parts.push(`<g data-stair-missing="${esc(c.stair)}"><circle cx="${x}" cy="${y}" r="${12 * k}" fill="none" stroke="#d97706" stroke-width="${1.6 * k}" stroke-dasharray="${3 * k} ${2 * k}"/>${label(x, y, [`模型缺 ${c.stair} ${c.from}→${c.to}`, `Excel ${c.cell} = ${c.excel_m} m`], 'stairmiss:' + c.stair + c.from + c.to, '', '#b45309', fs * .85)}</g>`);
      }
    }
    // stair leaky cables passing through this floor are model objects (feed port + cable + end, stair_pass: true;
    // scripts/integration/stair-passing.cjs); meta.stair_passing keeps the list
    for(const n of Object.values(m.nodes))if(n.kind==='junction'&&Object.values(m.edges).filter(e=>e.a===n.id||e.b===n.id).length>2){
      const [x,y]=P.position(m,n,k);
      parts.push(`<g data-design-error="${esc(n.id)}"><circle cx="${x}" cy="${y}" r="${8*k}" fill="none" stroke="#c7202b" stroke-width="${1.6*k}"/>${label(x,y,['SPLITTER / COUPLER REQUIRED'],'design:'+n.id,`data-n="${esc(n.id)}"`,'#ba1626',fs*.8)}</g>`);
    }
    parts.push(...antTop);
    if (v.legend) {
      const lg = host.RFOriginal.legend(0, 0),
        scale = fs / 10,
        pos = m.meta.legend_position || [20, 20];
      parts.push(
        `<g data-layer="legend" style="pointer-events:all;cursor:move" transform="translate(${pos[0]} ${pos[1]}) scale(${scale})">${lg.svg}</g>`,
      );
    }
    parts.push("</svg>");
    return host.RFLabels.resolve(parts.join(""), m, "layout");
  }
  host.RFScene = { render };
})(globalThis);
