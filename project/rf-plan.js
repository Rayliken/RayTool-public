/* Plan-view geometry shared by drawing, hit testing and exports.
 * Survey coordinates and cable lengths are never changed for symbol clearance. */
(function (host) {
  "use strict";
  const esc = (s) =>
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
  function at(m, id) {
    return Object.values(m.edges || {}).filter((e) => e.a === id || e.b === id);
  }
  function direction(n, e) {
    const ps = e.a === n.id ? e.pts : [...(e.pts || [])].reverse();
    for (const p of ps || []) {
      const x = p[0] - n.x,
        y = p[1] - n.y,
        l = Math.hypot(x, y);
      if (l > 0.001) return [x / l, y / l];
    }
    return [-1, 0];
  }
  function angle(m, n) {
    if (Number.isFinite(n.layout_rotation))
      return (n.layout_rotation * Math.PI) / 180;
    const e = at(m, n.id).find((e) => n.ports?.[e.id] === "IN");
    if (!e) return 0;
    const d = direction(n, e);
    return (Math.round(Math.atan2(-d[1], -d[0]) / (Math.PI / 2)) * Math.PI) / 2;
  }
  function position(m, n, k = 1) {
    if (
      n.kind === "device" &&
      at(m, n.id).some(
        (e) =>
          e.direct_symbol_link &&
          m.nodes[e.a === n.id ? e.b : e.a]?.kind === "antenna" &&
          Math.hypot(
            m.nodes[e.a === n.id ? e.b : e.a].x - n.x,
            m.nodes[e.a === n.id ? e.b : e.a].y - n.y,
          ) < 0.01,
      )
    ) {
      const a = angle(m, n);
      return [n.x - Math.sin(a) * 30 * k, n.y + Math.cos(a) * 30 * k];
    }
    return [n.x, n.y];
  }
  function points(m, e, k = 1) {
    const p = (e.pts || []).map((v) => [...v]);
    if (p.length) {
      for (const end of ["a", "b"]) {
        const n = m.nodes[e[end]];
        if (!n) continue;
        const port =
          n.kind === "device"
            ? ports(m, n, k).find((p) => p.edge === e.id)
            : null;
        p[end === "a" ? 0 : p.length - 1] = port
          ? [port.x, port.y]
          : position(m, n, k);
      }
    }
    return p;
  }
  function coupledSide(m, n, k = 1) {
    const e = at(m, n.id).find((e) => n.ports?.[e.id] === "COUPLED");
    if (!e) return 1;
    const c = position(m, n, k),
      ps = e.pts,
      p = e.a === n.id ? ps : [...ps].reverse(),
      q = p.find((q) => Math.hypot(q[0] - c[0], q[1] - c[1]) > 0.001);
    if (!q) return 1;
    const a = angle(m, n);
    return -(q[0] - c[0]) * Math.sin(a) + (q[1] - c[1]) * Math.cos(a) < 0
      ? -1
      : 1;
  }
  function slots(n) {
    if (/^DC(?:\d+|_PENDING)$/.test(n.dev || ""))
      return [
        { slot: "IN", role: "IN", x: -11, y: 0 },
        { slot: "THRU", role: "THRU", x: 11, y: 0 },
        { slot: "COUPLED", role: "COUPLED", x: 0, y: 11 },
      ];
    const count = { SPL2: 2, SPL3: 3, POI: 1 }[n.dev];
    return count
      ? [
          { slot: "IN", role: "IN", x: -11, y: 0 },
          ...Array.from({ length: count }, (_, i) => ({
            slot: "OUT" + (i + 1),
            role: "OUT",
            x: 11,
            y: (i - (count - 1) / 2) * 11,
          })),
        ]
      : [];
  }
  function assignments(m, n) {
    const es = at(m, n.id),
      used = new Set(),
      out = {};
    for (const e of es) {
      const s = slots(n).find(
        (s) =>
          s.slot === n.port_slots?.[e.id] &&
          s.role === n.ports?.[e.id] &&
          !used.has(s.slot),
      );
      if (s) {
        out[e.id] = s.slot;
        used.add(s.slot);
      }
    }
    for (const e of es)
      if (!out[e.id]) {
        const s = slots(n).find(
          (s) => s.role === n.ports?.[e.id] && !used.has(s.slot),
        );
        if (s) {
          out[e.id] = s.slot;
          used.add(s.slot);
        }
      }
    return out;
  }
  function ports(m, n, k = 1, portK = k) {
    const p = position(m, n, k),
      a = angle(m, n),
      taken = assignments(m, n);
    return slots(n).map((v) => {
      const s = {
        ...v,
        y: v.role === "COUPLED" ? v.y * coupledSide(m, n, k) : v.y,
      };
      return {
        ...s,
        x: p[0] + (Math.cos(a) * s.x - Math.sin(a) * s.y) * portK,
        y: p[1] + (Math.sin(a) * s.x + Math.cos(a) * s.y) * portK,
        edge: Object.keys(taken).find((e) => taken[e] === s.slot) || null,
      };
    });
  }
  function name(n) {
    return /^DC(?:\d+|_PENDING)$/.test(n.dev || "")
      ? (n.dev === "DC_PENDING" ? "?" : n.dev.slice(2)) + " dB coupler"
      : {
          SPL2: "2-way splitter · 3.2 dB",
          SPL3: "3-way splitter · 5.4 dB",
          POI: "POI",
          PASSIVE_UNKNOWN: "Passive type / dB pending",
        }[n.dev] ||
          n.dev ||
          n.kind;
  }
  function glyph(m, n, k = 1) {
    const [x, y] = position(m, n, k),
      col =
        n.kind === "antenna"
          ? n.dev === "Panel"
            ? "#2563ab"
            : "#cf3434"
          : "#263c4c",
      w = 15 * k,
      h = 9 * k,
      r = 4.6 * k,
      a = (angle(m, n) * 180) / Math.PI;
    let shape = "";
    // a stair pass-through feed port is a FEED even when its From-floor cable is unknown (no upstream node)
    const st = n.kind === "source" ? (n.stair_pass ? "FEED" : host.RFCore.sourceType(n)) : "";
    if (n.kind === "source")
      shape = `<rect x="${x - 6 * k}" y="${y - 6 * k}" width="${12 * k}" height="${12 * k}" rx="${2 * k}" fill="${st === "ORU" ? "#f0b429" : st === "FEED" ? "#d8efff" : "#eeeeee"}" stroke="#526577"/><text x="${x}" y="${y + 3 * k}" text-anchor="middle" font-size="${5 * k}" fill="#14181b">${st}</text>`;
    else if (n.kind === "antenna") {
      if (n.dev === "Yagi")
        shape = `<path d="M${x - r * 1.1},${y}H${x + r * 1.1}M${x - r * 0.5},${y - r * 0.8}V${y + r * 0.8}M${x + r * 0.1},${y - r * 0.6}V${y + r * 0.6}M${x + r * 0.7},${y - r * 0.42}V${y + r * 0.42}"/>`;
      else
        shape =
          (n.dev === "Panel"
            ? `<rect x="${x - r}" y="${y - r}" width="${2 * r}" height="${2 * r}" fill="white"/>`
            : `<circle cx="${x}" cy="${y}" r="${r}" fill="white"/>`) +
          `<path data-antenna-detail="true" d="M${x - r * 0.58},${y + r * 0.46}L${x},${y - r * 0.62}L${x + r * 0.58},${y + r * 0.46}Z"/>`;
    } else if (n.kind === "device") {
      if (n.dev === "PASSIVE_UNKNOWN")
        shape = `<path d="M${x},${y - 6 * k}L${x + 6 * k},${y}L${x},${y + 6 * k}L${x - 6 * k},${y}Z" stroke-dasharray="${2 * k} ${k}"/><text x="${x}" y="${y + 3 * k}" font-size="${8 * k}" text-anchor="middle" fill="${col}" stroke="none">?</text>`;
      else {
        const inner = /^DC/.test(n.dev)
          ? `M${-w * 0.18},${(coupledSide(m, n, k) * h) / 2}V0H${w * 0.2}`
          : n.dev === "POI"
            ? `M${-w * 0.2},0H${w * 0.2}M0,${-h * 0.3}V${h * 0.3}`
            : `M${-w / 2},0H${-w * 0.12}M${w / 2},${-h / 2}L${-w * 0.12},0L${w / 2},${h / 2}`;
        shape = `<g transform="translate(${x} ${y}) rotate(${a})"><rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" fill="white"/><path data-component-detail="true" d="${inner}"/></g>`;
      }
    } else if(n.connection_type==='ADAPTER')shape=`<rect data-adapter="true" x="${x-3*k}" y="${y-2*k}" width="${6*k}" height="${4*k}" fill="white"/><path d="M${x-k},${y-2*k}V${y+2*k}M${x+k},${y-2*k}V${y+2*k}"/>`;
    else shape = `<circle cx="${x}" cy="${y}" r="${1.7 * k}" fill="${col}"/>`;
    const displaced =
      Math.hypot(x - n.x, y - n.y) > 0.01
        ? `<path data-survey-leader="true" d="M${n.x},${n.y}L${x},${y}" stroke="#748596" stroke-dasharray="${2 * k} ${2 * k}" stroke-width="${0.5 * k}"/><circle cx="${n.x}" cy="${n.y}" r="${1.4 * k}" fill="#748596"/>`
        : "";
    let marks = "";
    if (n.kind === "device")
      for (const p of ports(m, n, k)) {
        const color = {
            IN: "#a76300",
            THRU: "#125aba",
            COUPLED: "#a41d82",
            OUT: "#08734e",
          }[p.role],
          size = 2.4 * k;
        const marker =
          p.role === "IN"
            ? `<path d="M${p.x - size},${p.y - size}L${p.x + size},${p.y}L${p.x - size},${p.y + size}Z"/>`
            : p.role === "COUPLED"
              ? `<path d="M${p.x},${p.y - size}L${p.x + size},${p.y}L${p.x},${p.y + size}L${p.x - size},${p.y}Z"/>`
              : `<rect x="${p.x - size}" y="${p.y - size}" width="${2 * size}" height="${2 * size}"/>`;
        const tx = p.x + (p.role === "IN" ? -4 : 4) * k,
          ty = p.y - 4 * k;
        marks += `<g data-port-symbol="${p.slot}" transform="${p.role==='IN'?`rotate(${a} ${p.x} ${p.y})`:''}" fill="${color}" stroke="white" stroke-width="${0.5 * k}">${marker}</g><text data-port="${p.slot}" x="${tx}" y="${ty}" text-anchor="${p.role === "IN" ? "end" : "start"}" font-size="${4.5 * k}" fill="${color}" stroke="white" stroke-width="${1.1 * k}" paint-order="stroke">${p.slot}</text>`;
      }
    return `<g data-node-id="${esc(n.id)}" fill="none" stroke="${col}" stroke-width="${1.1 * k}" stroke-linejoin="round"><title>${esc((n.label || n.id) + " | " + name(n))}</title>${displaced}${shape}${marks}</g>`;
  }
  host.RFPlan = {
    position,
    points,
    ports,
    assignments,
    slots,
    glyph,
    name,
    angle,
  };
  if (typeof module !== "undefined") module.exports = host.RFPlan;
})(typeof globalThis === "undefined" ? this : globalThis);
