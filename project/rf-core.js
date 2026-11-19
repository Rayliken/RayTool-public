/* RF Riser R03 — shared project, lengths, forest and calculation core. */
(function(host) {
  "use strict";
  const CABLE = {
    COX12: {
      name: '1/2" coax',
      color: "#5364bc",
      loss: [4.3, 6.6, 10.8]
    },
    COX114: {
      name: '1-1/4" coax',
      color: "#c23e40",
      loss: [2, 3, 4.5]
    },
    LCK: {
      name: "Leaky cable",
      color: "#16834a",
      loss: [2.61, 4.01, 7.21]
    },
  };
  CABLE.UNRESOLVED = {
    name: "Unresolved RF cable",
    color: "#8a6e55",
    loss: [null, null, null],
  };
  const THRU = {
    5: 2.3,
    6: 1.85,
    7: 1.55,
    10: 0.9,
    15: 0.5,
    20: 0.4,
    30: 0.35,
    40: 0.3,
  };
  const FREQ = [400, 850, 1950],
    GAINS = {
      Dome: [3, 3, 3],
      Panel: [3, 4, 7],
      Yagi: [11, 11, 10.5]
    };
  const finite = (v) => typeof v === "number" && Number.isFinite(v);

  function number(v) {
    if (v == null || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    return finite(n) ? n : null;
  }

  function parseLength(v) {
    if (v == null || v === "") return null;
    const m = String(v)
      .trim()
      .match(/^([0-9]+(?:\.[0-9]+)?)\s*(mm|m|metres?|meters?|ft|feet|')?$/i);
    if (!m) return null;
    const scale = /^(ft|feet|')$/i.test(m[2] || "") ?
      0.3048 :
      /^mm$/i.test(m[2] || "") ?
      0.001 :
      1;
    return +m[1] * scale;
  }

  function geometry(m, e) {
    const pts = e.pts || [];
    const scale = number(m.meta?.scale);
    if (!(scale > 0) || pts.length < 2) return null;
    let d = 0;
    for (let i = 1; i < pts.length; i++)
      d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return d * scale;
  }

  function lengthInfo(m, e) {
    const a = e.length || {},
      cad = number(a.cad_m ?? e.cad_m),
      geo = geometry(m, e);
    let mode = a.mode || "auto",
      v = null;
    if (mode === "auto")
      mode =
      a.is_stair || e.is_stair ?
      "stair_reserve" :
      cad != null ?
      "cad" :
      a.manual_m != null || (e.len != null && e.len !== "") ?
      "manual" :
      a.survey_m != null || e.surveyed != null ?
      "survey" :
      a.pdf_m != null || e.measured != null ?
      "pdf" :
      "geometry";
    if (mode === "stair_reserve")
      v = number(a.reserve_m ?? m.meta?.stair_reserve_m ?? 100);
    else if (mode === "cad") v = cad;
    else if (mode === "manual") v = parseLength(a.manual_m ?? e.len);
    else if (mode === "survey") v = parseLength(a.survey_m ?? e.surveyed);
    else if (mode === "pdf") v = parseLength(a.pdf_m ?? e.measured);
    else if (mode === "geometry") v = geo;
    else if (mode === "allocation") v = number(a.allocated_m);
    if (!finite(v) || v < 0) v = null;
    const names = {
      cad: "CAD marked",
      manual: "Manual override",
      stair_reserve: "Stair reserve",
      survey: "Survey",
      pdf: "PDF measurement",
      geometry: "Drawn estimate",
      allocation: "Allocated estimate",
    };
    return {
      value: v,
      method: mode,
      source: names[mode] || "MISSING",
      cad_m: cad,
      geometry_m: geo,
      delta_m: v != null && cad != null ? v - cad : null,
      is_estimate: ["geometry", "allocation"].includes(mode),
      is_reserve: mode === "stair_reserve",
      ref: a.cad_ref || e.cad_ref || e.cad_handle || "",
      reason: a.reason || "",
      cad_raw: a.cad_raw || "",
      run_id: a.run_id || null,
    };
  }

  function logicalLabel(s) {
    return String(s || "")
      .trim()
      .toUpperCase()
      .replace(/-(H|L)-/, "-");
  }

  function parseId(s) {
    const m = String(s || "")
      .trim()
      .replace(/\s*\([^)]*\)\s*$/, "")
      .trim()
      .match(
        /^(PRJ-RS)-([A-Z0-9>]+)-([HL])-(ANT|COX|LCK)-([A-Z]*)(\d+)(-\d+)?$/i,
      );
    return m ?
      {
        prefix: m[1].toUpperCase(),
        floor: m[2].toUpperCase(),
        band: m[3].toUpperCase(),
        kind: m[4].toUpperCase(),
        letter: m[5].toUpperCase(),
        serial: +m[6],
        width: m[6].length,
        part: m[7] || "",
      } :
      null;
  }

  function pattern(m, kind) {
    const saved = m.meta?.naming?.[kind];
    if (saved) return {
      ...saved
    };
    const c = {};
    for (const o of [
        ...Object.values(m.nodes || {}),
        ...Object.values(m.edges || {}),
      ]) {
      const p = parseId(o.label);
      if (
        p &&
        p.kind === kind &&
        p.floor === String(m.meta?.floor || "").toUpperCase()
      )
        c[p.letter] = (c[p.letter] || 0) + 1;
    }
    return {
      letter: Object.keys(c).sort((a, b) => c[b] - c[a] || a.localeCompare(b))[0] ??
        (kind === "COX" ? "" : "A"),
      width: 3,
    };
  }

  function nextLabel(m, kind) {
    const p = pattern(m, kind),
      floor = String(m.meta?.floor || "B1").toUpperCase(),
      band = String(m.meta?.band || "H").toUpperCase();
    if (
      !/^[A-Z0-9>]+$/.test(floor) ||
      !["H", "L"].includes(band) ||
      !/^[A-Z]*$/.test(p.letter || "")
    )
      throw Error("Invalid naming floor, band or suffix prefix");
    let max = 0;
    const all = [
      ...Object.values(m.nodes || {}),
      ...Object.values(m.edges || {}),
      ...(m.meta?.reserved_ids || []).map((label) => ({
        label
      })),
    ];
    for (const o of all) {
      const n = parseId(o.label);
      if (
        n &&
        n.floor === floor &&
        n.kind === kind &&
        n.letter === (p.letter || "")
      )
        max = Math.max(max, n.serial);
    }
    const used = new Set(all.map((o) => logicalLabel(o.label)));
    let label;
    do {
      label = `PRJ-RS-${floor}-${band}-${kind}-${p.letter || ""}${String(++max).padStart(p.width || 3, "0")}`;
    } while (used.has(logicalLabel(label)));
    return label;
  }

  function nextConnectionLabel(m, edge) {
    const floor=String(m.meta?.floor||"B1").toUpperCase();
    const ant=[m.nodes[edge.a],m.nodes[edge.b]].find(n=>n?.kind==="antenna");
    const used=new Set(Object.values(m.edges||{}).filter(e=>e.id!==edge.id).map(e=>e.label));
    const code=ant?.label?.match(/ANT-A?(\d+)/)?.[1];
    if(code){
      const base=floor+" Jumper "+code;
      if(!used.has(base))return base;
      let i=2;while(used.has(base+" ("+i+")"))i++;
      return base+" ("+i+")";
    }
    let i=1;while(used.has(floor+" Link "+String(i).padStart(2,"0")))i++;
    return floor+" Link "+String(i).padStart(2,"0");
  }

  function nextSource(m) {
    const labels = new Set(Object.values(m.nodes || {}).map((n) => n.label));
    let i = 1;
    while (labels.has("ORU-" + String(i).padStart(3, "0"))) i++;
    return "ORU-" + String(i).padStart(3, "0");
  }

  function nextDevice(m, dev) {
    const type = /^DC/.test(dev || "") ? "CPL" : dev === "POI" ? "POI" : "SPL",
      prefix = `PRJ-RS-${String(m.meta?.floor || "B1").toUpperCase()}-${String(m.meta?.band || "H").toUpperCase()}-${type}-`;
    const used = new Set(
      Object.values(m.nodes || {}).map((n) =>
        String(n.label || "").toUpperCase(),
      ),
    );
    let i = 1;
    while (used.has(prefix + String(i).padStart(3, "0"))) i++;
    return prefix + String(i).padStart(3, "0");
  }

  function labels(m, obj) {
    if (
      Array.isArray(obj?.cad_ids) &&
      obj.cad_ids.length &&
      (!obj.label || obj.cad_ids.includes(obj.label))
    )
      return [...new Set(obj.cad_ids)];
    const s = typeof obj === "string" ? obj : obj?.label;
    if (!s) return [];
    if (m.meta?.paired_labels === true) {
      if (/-H-/.test(s)) return [s, s.replace("-H-", "-L-")];
      if (/-L-/.test(s)) return [s.replace("-L-", "-H-"), s];
    }
    return [s];
  }

  function analyze(m) {
    const nodes = {
        ...(m.nodes || {})
      },
      edges = Object.values(m.edges || {}),
      adj = {},
      missing = [];
    for (const e of edges)
      for (const k of [e.a, e.b])
        if (!nodes[k]) {
          nodes[k] = {
            id: k,
            kind: "missing",
            label: "MISSING " + k
          };
          missing.push([e.id, k]);
        }
    for (const k of Object.keys(nodes)) adj[k] = [];
    for (const e of edges) {
      adj[e.a].push({
        node: e.b,
        edge: e
      });
      if (e.b !== e.a) adj[e.b].push({
        node: e.a,
        edge: e
      });
    }
    const seen = new Set(),
      components = [],
      nodeComponent = {};
    for (const start of Object.keys(nodes)) {
      if (seen.has(start)) continue;
      const queue = [start],
        ids = [],
        edgeSet = new Set();
      seen.add(start);
      for (let i = 0; i < queue.length; i++) {
        const u = queue[i];
        ids.push(u);
        for (const a of adj[u]) {
          edgeSet.add(a.edge.id);
          if (!seen.has(a.node)) {
            seen.add(a.node);
            queue.push(a.node);
          }
        }
      }
      const sources = ids.filter((k) => nodes[k].kind === "source");
      const c = {
        id: "c" + (components.length + 1),
        nodes: ids,
        edges: edges.filter((e) => edgeSet.has(e.id)),
        sources,
        hasCycle: edgeSet.size > ids.length - 1,
      };
      for (const k of ids) nodeComponent[k] = c;
      components.push(c);
    }
    const par = {},
      pe = {},
      kids = {},
      order = [],
      owner = {},
      roots = [],
      depth = {},
      treeEdges = new Set();
    for (const c of components) {
      const seeds = c.sources.length ?
        c.sources :
        [
          c.nodes
          .slice()
          .sort(
            (a, b) =>
            adj[b].length - adj[a].length ||
            a.localeCompare(b, undefined, {
              numeric: true
            }),
          )[0],
        ];
      const q = [];
      for (const id of seeds) {
        roots.push(id);
        owner[id] = id;
        depth[id] = 0;
        q.push(id);
      }
      for (let i = 0; i < q.length; i++) {
        const u = q[i];
        order.push(u);
        for (const a of adj[u])
          if (owner[a.node] === undefined) {
            owner[a.node] = owner[u];
            par[a.node] = u;
            pe[a.node] = a.edge;
            (kids[u] ??= []).push(a.node);
            depth[a.node] = depth[u] + 1;
            treeEdges.add(a.edge.id);
            q.push(a.node);
          }
      }
    }
    return {
      nodes,
      edges,
      adj,
      components,
      nodeComponent,
      missing,
      par,
      pe,
      kids,
      order,
      owner,
      roots,
      depth,
      extraEdges: edges.filter((e) => !treeEdges.has(e.id)),
      treeEdges,
    };
  }

  function portCheck(m, n) {
    const es = Object.values(m.edges || {}).filter(
        (e) => e.a === n.id || e.b === n.id,
      ),
      p = n.ports || {},
      count = (r) => es.filter((e) => p[e.id] === r).length;
    if (/^DC(?:\d+|_PENDING)$/.test(n.dev || ""))
      return (
        es.length === 3 &&
        count("IN") === 1 &&
        count("THRU") === 1 &&
        count("COUPLED") === 1
      );
    const out = {
      SPL2: 2,
      SPL3: 3,
      POI: 1
    } [n.dev];
    return (
      out != null &&
      es.length === out + 1 &&
      count("IN") === 1 &&
      count("OUT") === out
    );
  }

  function modelIssues(m) {
    const a = analyze(m),
      out = [];
    const add = (code, item, message, component) =>
      out.push({
        code,
        item,
        message,
        component: component || a.nodeComponent[item]?.id || null,
      });
    for (const [e, n] of a.missing) add("ENDPOINT", e, "Missing endpoint " + n);
    for (const c of a.components) {
      if (!c.sources.length)
        add("NO_SOURCE", c.nodes[0], "This component has no source", c.id);
      if (c.sources.length > 1)
        add(
          "JOINED_SOURCES",
          c.sources.join(", "),
          "Sources share one RF component; isolate feeds or model the combining device explicitly",
          c.id,
        );
      if (c.hasCycle)
        add(
          "CYCLE",
          c.nodes[0],
          "Loop / parallel route requires an explicit RF model",
          c.id,
        );
    }
    const names = new Map();
    for (const n of Object.values(m.nodes || {})) {
      if (n.kind === "source" && n.source_status === "INHERITED_FEED_PENDING")
        add("INHERITED_FEED_PENDING", n.id, "Upstream port and power must be inherited; this interface is not a new ORU");
      if (
        n.kind === "source" &&
        n.source_status === "CAD_SHAFT_INTERFACE_REVIEW"
      )
        add(
          "FEED_INTERFACE_REVIEW",
          n.id,
          "CAD shaft end identifies a proposed floor feed plane; verify source and upstream connection",
        );
      if (n.position_status === "USER_EDITED_CAD_FRAME" && !n.position_verified)
        add(
          "POSITION_EDIT_REVIEW",
          n.id,
          "Position was edited in the CAD coordinate frame; confirm placement",
        );
      if (
        n.antenna_route_link_status === "PROPOSED_WITHIN_2M_JUMPER_REACH" &&
        !n.connection_verified
      )
        add(
          "ANTENNA_JUMPER_ROUTE_REVIEW",
          n.id,
          "Route end associated within the 2m jumper allowance; confirm physical connection",
        );
      if (
        n.kind === "antenna" && ["ANNOTATION_ONLY_UNPLACED", "LABEL_POSITION_ONLY"].includes(
          n.symbol_status,
        ) &&
        !n.position_verified
      )
        add(
          "CAD_POSITION_REQUIRED",
          n.id,
          "Annotated endpoint has no reconciled current CAD symbol position",
        );
      if (
        n.kind === "device" &&
        n.alignment?.status?.endsWith("_REVIEW") &&
        n.device_status !== "checked"
      )
        add(
          "PASSIVE_MAPPING_REVIEW",
          n.id,
          "Actual reference dB retained; confirm this device placement on the current CAD route",
        );
      if (
        n.kind === "device" && ["candidate", "legacy_unverified", "assumed"].includes(n.device_status)
      )
        add(
          "PASSIVE_VALUE_UNCONFIRMED",
          n.id,
          "Confirm actual passive type and dB value; imported / default values are unverified",
        );
      if (n.kind === "device" && !portCheck(m, n))
        add(
          "PORTS",
          n.id,
          "Device type / port capacity / IN-THRU-COUPLED assignment is invalid",
        );
      if (n.kind === "antenna" && parseLength(n.jumper ?? 2) == null)
        add(
          "JUMPER",
          n.id,
          "Antenna jumper must be a nonnegative length in metres",
        );
      if (
        n.connector_count != null &&
        n.connector_count !== "" &&
        (!Number.isInteger(number(n.connector_count)) ||
          number(n.connector_count) < 0)
      )
        add(
          "CONNECTOR_COUNT",
          n.id,
          "Connector count must be a nonnegative integer",
        );
      if (n.kind === "antenna" && !GAINS[n.dev])
        add("TYPE", n.id, "Resolve antenna type");
      if (n.kind === "antenna" && a.adj[n.id].length !== 1)
        add("ANTENNA", n.id, "Antenna must terminate exactly one cable");
      if (n.kind === "junction" && a.adj[n.id].length > 2)
        add(
          "PASSIVE",
          n.id,
          "Branch requires an identified splitter or coupler",
        );
      if (
        n.kind === "device" &&
        a.nodeComponent[n.id].sources.length === 1 &&
        a.pe[n.id] &&
        (n.ports || {})[a.pe[n.id].id] !== "IN"
      )
        add("DIRECTION", n.id, "Upstream cable must use IN");
    }
    for (const obj of [
        ...Object.values(m.nodes || {}),
        ...Object.values(m.edges || {}),
      ])
      if (
        obj.label &&
        !obj.label.startsWith("?") &&
        !obj.label.startsWith("JOIN?")
      ) {
        const key = String(obj.label).trim().toUpperCase();
        if (
          names.has(key) &&
          !(obj.length?.run_id && obj.length.run_id === names.get(key).run)
        )
          add("DUPLICATE", obj.id, "Label duplicates " + names.get(key).id);
        else names.set(key, {
          id: obj.id,
          run: obj.length?.run_id
        });
      }
    const runs = new Map();
    for (const e of a.edges) {
      const id = e.length?.run_id;
      if (id) {
        if (!runs.has(id)) runs.set(id, []);
        runs.get(id).push(e);
      }
    }
    for (const [id, es] of runs) {
      if (es.length < 2) continue;
      if (es.filter((e) => lengthInfo(m, e).is_reserve).length > 1)
        for (const e of es)
          add(
            "RUN_RESERVE_DUPLICATED",
            e.id,
            "100m / other stair reserve is repeated on run " + id,
            a.nodeComponent[e.a]?.id,
          );
      const allocated = es.filter((e) => e.length?.mode === "allocation"),
        totals = allocated
        .map((e) => number(e.length.run_total_m))
        .filter((v) => v != null);
      if (allocated.length === es.length && totals.length === es.length) {
        const sum = allocated.reduce(
          (n, e) => n + (lengthInfo(m, e).value ?? 0),
          0,
        );
        if (
          totals.some((t) => Math.abs(t - totals[0]) > 0.01) ||
          Math.abs(sum - totals[0]) > 0.01
        )
          for (const e of es)
            add(
              "RUN_LENGTH_TOTAL",
              e.id,
              "Allocated segment lengths do not equal preserved total for run " +
              id,
              a.nodeComponent[e.a]?.id,
            );
      }
    }
    for (const e of a.edges) {
      const c = a.nodeComponent[e.a]?.id,
        L = lengthInfo(m, e);
      if (L.value == null)
        add("LENGTH", e.id, "Missing or invalid selected length", c);
      else if (L.is_estimate && !e.length?.verified)
        add(
          "ESTIMATED_LENGTH",
          e.id,
          "Geometry length requires confirmation or a CAD / reserved length",
          c,
        );
      if (e.route_status === "legacy_only" && !e.cad_confirmed)
        add(
          "CAD_ROUTE_UNCONFIRMED",
          e.id,
          "Legacy connection must be reconciled with current Layout-CAD",
          c,
        );
      if (!CABLE[e.cable] || !CABLE[e.cable].loss.every(finite))
        add("CABLE", e.id, "Unknown cable type", c);
      if (
        (e.review_only ||
          e.candidate_label ||
          e.identity_status === "candidate") &&
        !e.review_verified
      )
        add(
          "CAD_REVIEW",
          e.id,
          "Confirm route identity / proposed connection",
          c,
        );
      if (
        L.cad_m != null &&
        L.value != null &&
        Math.abs(L.delta_m) > 0.01 &&
        L.method === "manual" &&
        !L.reason
      )
        add(
          "LENGTH_OVERRIDE_REASON",
          e.id,
          "Manual length differs from CAD; record a reason",
          c,
        );
    }
    return out;
  }

  function pathTo(a, id) {
    const out = [],
      seen = new Set();
    while (a.par[id] !== undefined) {
      if (seen.has(id)) throw Error("Parent cycle");
      seen.add(id);
      out.push({
        node: a.nodes[id],
        edge: a.pe[id]
      });
      id = a.par[id];
    }
    return out.reverse();
  }

  function autoPorts(m) {
    const a = analyze(m);
    let changed = 0;
    for (const id of a.order) {
      const n = m.nodes[id],
        up = a.pe[id];
      if (
        !n ||
        n.kind !== "device" ||
        !up ||
        a.nodeComponent[id].sources.length !== 1 ||
        a.nodeComponent[id].hasCycle
      )
        continue;
      n.ports ??= {};
      if (!n.ports[up.id]) {
        n.ports[up.id] = "IN";
        changed++;
      }
      if (!/^DC/.test(n.dev || ""))
        for (const it of a.adj[id])
          if (it.edge.id !== up.id && !n.ports[it.edge.id]) {
            n.ports[it.edge.id] = "OUT";
            changed++;
          }
    }
    return changed;
  }

  function collectTerminals(m) {
    const a = analyze(m),
      allIssues = issues(m),
      rows = [];

    function make(id, e, kind) {
      const c = a.nodeComponent[id],
        root = a.owner[id],
        src = a.nodes[root]?.kind === "source" ? a.nodes[root] : null;
      const path = pathTo(a, id),
        edgeSet = new Set(path.map((s) => s.edge.id)),
        nodeSet = new Set([root, ...path.map((s) => s.node.id)]);
      const probs = allIssues.filter(
        (x) =>
        x.component === c.id &&
        (["NO_SOURCE", "JOINED_SOURCES", "CYCLE"].includes(x.code) ||
          edgeSet.has(x.item) ||
          nodeSet.has(x.item)),
      );
      const n = a.nodes[id],
        len = {
          COX12: 0,
          COX114: 0,
          LCK: 0
        },
        cnt = {},
        segments = [],
        components = [];
      let missing = false;
      for (let i = 0; i < path.length; i++) {
        const s = path[i],
          L = lengthInfo(m, s.edge);
        segments.push({
          edge_id: s.edge.id,
          label: s.edge.label,
          ...L,
          cable: s.edge.cable,
        });
        if (
          L.value == null ||
          !CABLE[s.edge.cable] ||
          !CABLE[s.edge.cable].loss.every(finite)
        )
          missing = true;
        else len[s.edge.cable] += L.value;
        if (i < path.length - 1 && s.node.kind === "device") {
          const next = path[i + 1].edge,
            role = s.node.ports?.[next.id];
          const k = /^DC/.test(s.node.dev || "") ?
            s.node.dev + ":" + role :
            s.node.dev;
          cnt[k] = (cnt[k] || 0) + 1;
          components.push({
            node_id: s.node.id,
            dev: s.node.dev,
            role,
            loss_db: s.node.loss_db,
            reference: s.node.reference || null,
          });
        }
      }
      const label = kind === "Leaky" ? e.label || e.id : n.label || n.id,
        jumper = kind === "Antenna" ? parseLength(n.jumper ?? 2) : 0;
      if (kind === "Open end")
        probs.push({
          code: "OPEN_END",
          item: id,
          message: "Unterminated coax branch",
        });
      rows.push({
        id: kind === "Leaky" ? e.id : id,
        node_id: id,
        label,
        kind,
        type: kind === "Antenna" ? n.dev : "NA",
        source_id: src?.id || null,
        source_label: src?.label || src?.id || null,
        source_power_dbm: src?.power_dbm || {},
        component_id: c.id,
        path_edge_ids: path.map((s) => s.edge.id),
        cnt,
        len: missing ? null : len,
        segments,
        components,
        jumper,
        manual: segments.filter((s) => s.method === "manual").length,
        hops: path.length,
        status: probs.length ? "HOLD" : "PATH_READY",
        issues: probs,
        connector_count: number(n.connector_count),
        connector_count_estimate: 2 + 2 * components.length,
      });
    }
    const emitted = new Set();
    for (const id of a.order) {
      const n = a.nodes[id],
        up = a.pe[id];
      if (up?.cable === "LCK") {
        make(id, up, "Leaky");
        emitted.add(up.id);
      }
      if (n.kind === "antenna") make(id, up, "Antenna");
      else if (
        !(a.kids[id] || []).length &&
        !["source", "termination"].includes(n.kind) &&
        up?.cable !== "LCK"
      )
        make(id, up, "Open end");
    }
    for (const e of a.edges)
      if (e.cable === "LCK" && !emitted.has(e.id)) make(e.b, e, "Leaky");
    return rows;
  }

  function migrateSchema(m) {
    if (!m || typeof m.nodes !== "object" || typeof m.edges !== "object")
      throw Error("Project requires nodes and edges");
    m.meta ??= {};
    const oldSchema = m.meta.schema !== "rf-riser/3";
    m.meta.schema = "rf-riser/3";
    if (oldSchema)
      for (const n of Object.values(m.nodes))
        if (n.kind === "device" && !n.device_status)
          n.device_status = "legacy_unverified";
    m.meta.stair_reserve_m ??= 100;
    m.meta.naming ??= {};
    for (const kind of ["ANT", "COX", "LCK"])
      m.meta.naming[kind] ??= pattern(m, kind);
    for (const n of Object.values(m.nodes))
      if (n.kind === "device" && !n.label) {
        n.label = nextDevice(m, n.dev);
        n.generated_label = true;
      }
    return m;
  }

  function issues(m) {
    return [...modelIssues(m), ...physical.designIssues(m)];
  }

  function migrate(m) {
    const model = migrateSchema(m);
    model.meta.connector_policy ??= 'v14_estimate';
    return physical.normalize(model);
  }

  function terminalRows(m) {
    return collectTerminals(m).map(row => {
      const node = m.nodes[row.node_id];
      const estimated = node?.connector_count_mode === 'estimate' ||
        row.connector_count == null && node?.connector_count_mode !== 'manual' &&
        m.meta.connector_policy === 'v14_estimate';
      return {
        ...row,
        connector_count: estimated ? row.connector_count_estimate : row.connector_count,
        connector_count_basis: estimated ? 'V14_AUTO_ESTIMATE_EXCLUDING_INLINE_ADAPTERS' : 'USER_PATH_COUNT_EXCLUDING_INLINE_ADAPTERS',
        coverage: (row.kind === 'Leaky' ? m.edges[row.id] : node)?.coverage || null
      };
    });
  }

  function calculate(m, row, frequency) {
    return budget.calculate(m, row, frequency);
  }

  function reviewCalculation(m, row, frequency) {
    return budget.reviewCalculation(m, row, frequency);
  }
  // Electrical roots include remote inputs; only physical equipment is an ORU.
  function sourceType(n) {
    if (n.reference_only) return "REF";
    if (n.upstream_connection) return "FEED";
    return "ORU";
  }
  function sourceSummary(m) {
    const counts = {ORU:0, FEED:0, REF:0};
    Object.values(m.nodes).filter(n=>n.kind==='source').forEach(n=>counts[sourceType(n)]++);
    return `${counts.ORU} ORU groups | ${counts.FEED} cross-floor inputs | ${counts.REF} reference inputs`;
  }
  function lineModel(m) {
    if (!m.meta?.line_hide_disconnected) return m;
    const wired=new Set(Object.values(m.edges).flatMap(e=>[e.a,e.b]));
    return {...m,nodes:Object.fromEntries(Object.entries(m.nodes).filter(([id])=>wired.has(id)))};
  }
  const api = {
    sourceType, sourceSummary, lineModel,
    reviewCalculation,
    CABLE,
    FREQ,
    GAINS,
    THRU,
    number,
    parseLength,
    geometry,
    lengthInfo,
    logicalLabel,
    parseId,
    pattern,
    nextLabel,
    nextConnectionLabel,
    nextSource,
    nextDevice,
    labels,
    analyze,
    portCheck,
    issues,
    pathTo,
    autoPorts,
    terminalRows,
    calculate,
    migrate,
  };
  const physicalFactory = host.RFPhysical || require('./rf-physical.js');
  const budgetFactory = host.RFBudget || require('./rf-budget.js');
  const physical = physicalFactory.create(api);
  const budget = budgetFactory.create(api, physical);
  api.physical = physical;
  api.budget = budget;
  host.RFCore = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof globalThis === "undefined" ? this : globalThis);
