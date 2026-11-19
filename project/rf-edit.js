(function(host) {
  "use strict";
  const C =
    host.RFCore ||
    (typeof require === "function" ? require("./rf-core.js") : null);
  const clone = (v) => JSON.parse(JSON.stringify(v)),
    at = (m, id) =>
    Object.values(m.edges).filter((e) => e.a === id || e.b === id);

  function uid(m, p) {
    let i = 1;
    while (m.nodes[p + i] || m.edges[p + i]) i++;
    return p + i;
  }

  function length(ps) {
    return ps
      .slice(1)
      .reduce((s, p, i) => s + Math.hypot(p[0] - ps[i][0], p[1] - ps[i][1]), 0);
  }

  function capacity(n) {
    return C.physical.capacity(n);
  }

  function split(m, eid, seg, pt, options = {}) {
    const e = m.edges[eid];
    if (!e) throw Error("Cable not found");
    const old = clone(e),
      a = C.analyze(m),
      info = C.lengthInfo(m, e),
      existing = options.node;
    if (existing && (e.a === existing.id || e.b === existing.id))
      throw Error("This component is already an endpoint of this cable");
    if (existing && at(m, existing.id).length + 2 > capacity(existing))
      throw Error("This component has no room for two additional cable ends");
    const n = existing || {
      id: uid(m, "n"),
      kind: options.kind || "junction",
      x: pt[0],
      y: pt[1],
      ...(options.extra || {}),
    };
    if (capacity(n) < 2) throw Error('An antenna has one IN and cannot be inserted between two cables. Insert a splitter or coupler instead.');
    n.x = pt[0];
    n.y = pt[1];
    m.nodes[n.id] = n;
    if (n.kind === "device") {
      n.ports ??= {};
      n.device_status ??= "candidate";
      if (!n.label) {
        n.label = C.nextDevice(m, n.dev);
        n.generated_label = true;
      }
    }
    // Move endpoints already connected to the component together with it.
    for (const it of at(m, n.id)) {
      if (it.a === n.id) it.pts[0] = [n.x, n.y];
      if (it.b === n.id) it.pts[it.pts.length - 1] = [n.x, n.y];
    }
    const ps1 = e.pts.slice(0, seg).concat([
        [...pt]
      ]),
      ps2 = [
        [...pt]
      ].concat(e.pts.slice(seg)),
      total = length(ps1) + length(ps2),
      run = e.length?.run_id || e.id,
      runTotal = e.length?.run_total_m ?? info.value;
    const first = {
      ...clone(e),
      id: uid(m, "e"),
      a: e.a,
      b: n.id,
      pts: ps1
    };
    m.edges[first.id] = first;
    const second = {
      ...clone(e),
      id: uid(m, "e"),
      a: n.id,
      b: e.b,
      pts: ps2
    };
    m.edges[second.id] = second;
    for (const part of [first, second]) {
      for (const key of [
          "len",
          "measured",
          "surveyed",
          "cad_m",
          "cad_sections",
          "layout_section_labels",
        ])
        delete part[key];
      part.length = {
        mode: "allocation",
        allocated_m: info.value == null ?
          null :
          info.value * (total ? length(part.pts) / total : 0.5),
        run_id: run,
        run_total_m: runTotal,
        parent_cad_m: e.length?.parent_cad_m ?? info.cad_m,
        cad_ref: info.ref,
        reason: "Inserted component / junction on " +
          eid +
          "; selected run total retained",
        verified: false,
      };
      part.split_origin = e.split_origin || {
        edge_id: e.id,
        label: e.label || "",
        cad_sections: clone(e.cad_sections || []),
        layout_section_labels: clone(e.layout_section_labels || []),
      };
      part.review_verified = false;
    }
    delete m.edges[eid];
    if (e.name_basis?.startsWith("USER_") || / (?:Jumper|Link) /.test(e.label||"")) {
      first.label=C.nextConnectionLabel(m,first);first.cad_ids=[first.label];first.name_basis=[m.nodes[first.a],m.nodes[first.b]].some(n=>n?.kind==="antenna")?"USER_JUMPER_RULE":"USER_LINK_RULE";
    }
    second.label=C.nextConnectionLabel(m,second);second.cad_ids=[second.label];
    second.name_basis=[m.nodes[second.a],m.nodes[second.b]].some(n=>n?.kind==="antenna")?"USER_JUMPER_RULE":"USER_LINK_RULE";
    for (const [id, part] of [
        [e.a, first],
        [e.b, second],
      ])
      for (const key of ["ports", "port_slots"]) {
        const p = m.nodes[id]?.[key];
        if (p && Object.hasOwn(p, eid)) {
          p[part.id] = p[eid];
          delete p[eid];
        }
      }
    delete m.edges[eid];
    if (n.kind === "device") {
      const up =
        a.nodeComponent[e.a]?.sources.length === 1 ?
        a.par[e.b] === e.a && a.pe[e.b]?.id === e.id ?
        first :
        a.par[e.a] === e.b && a.pe[e.a]?.id === e.id ?
        second :
        null :
        null;
      if (up && !Object.values(n.ports).includes("IN")) n.ports[up.id] = "IN";
      const down = up === first ? second : up === second ? first : null;
      if (down && !/^DC/.test(n.dev)) n.ports[down.id] = "OUT";
      if (down && /^DC/.test(n.dev) && !Object.values(n.ports).includes("THRU"))
        n.ports[down.id] = "THRU";
    }
    C.physical.markAdapter(m, n);
    return {
      node: n,
      e1: first,
      e2: second,
      original: old
    };
  }

  function reconnect(m, eid, end, target, role = "", slot = "") {
    const e = m.edges[eid],
      n = typeof target === "string" ? m.nodes[target] : target;
    if (!e || !n || !["a", "b"].includes(end))
      throw Error("Choose an existing cable end and a target node");
    const other = end === "a" ? "b" : "a";
    if (e[other] === n.id)
      throw Error("A cable cannot connect both ends to the same node");
    const old = m.nodes[e[end]];
    C.physical.assertRoom(m, n, eid);
    if (n.kind === "device") {
      const live = at(m, n.id).filter((v) => v.id !== eid);
      if (live.length >= capacity(n))
        throw Error("All component ports are occupied");
      if (role === 'OUT' && slot) {
        const outputs = Array.from({
            length: ({
              SPL2: 2,
              SPL3: 3,
              POI: 1
            } [n.dev] || 0)
          }, (_, i) => 'OUT' + (i + 1)),
          taken = new Set(live.filter(e => n.ports?.[e.id] === 'OUT').map(e => n.port_slots?.[e.id]).filter(v => outputs.includes(v)));
        for (const e of live.filter(e => n.ports?.[e.id] === 'OUT' && !outputs.includes(n.port_slots?.[e.id]))) taken.add(outputs.find(s => !taken.has(s)));
        if (taken.has(slot)) throw Error(slot + ' is already connected')
      }
      if (slot && live.some((v) => n.port_slots?.[v.id] === slot))
        throw Error(slot + " is already connected");
      if (
        role && ["IN", "THRU", "COUPLED"].includes(role) &&
        live.some((v) => n.ports?.[v.id] === role)
      )
        throw Error(role + " is already connected");
    }
    const selectedLength = C.lengthInfo(m, e);
    if (selectedLength.method === "geometry" && selectedLength.value != null)
      e.length = {
        ...(e.length || {}),
        mode: "manual",
        manual_m: selectedLength.value,
        reason: "Length retained while reconnecting cable",
      };
    if (old) {
      for (const key of ["ports", "port_slots"])
        if (old[key]) delete old[key][eid];
    }
    e[end] = n.id;
    if(e.name_basis?.startsWith("USER_") || / (?:Jumper|Link) /.test(e.label||"")) {
      const previousLabel=e.label;
      e.label=C.nextConnectionLabel(m,e);e.cad_ids=[e.label];
      for(const section of [...(e.cad_sections||[]),...(e.layout_section_labels||[])])if(section.ids?.includes(previousLabel))section.ids=section.ids.map(v=>v===previousLabel?e.label:v);
      e.name_basis=[m.nodes[e.a],m.nodes[e.b]].some(v=>v?.kind==="antenna")?"USER_JUMPER_RULE":"USER_LINK_RULE";
    }
    e.pts[end === "a" ? 0 : e.pts.length - 1] = [n.x, n.y];
    e.review_verified = false;
    if (n.kind === "device") {
      n.ports ??= {};
      n.port_slots ??= {};
      n.ports[eid] = role || "";
      if (slot) n.port_slots[eid] = slot;
    }
    if (
      old &&
      old.id !== n.id &&
      old.kind === "junction" &&
      !old.label &&
      !at(m, old.id).length
    )
      delete m.nodes[old.id];
    if (old && m.nodes[old.id]) C.physical.markAdapter(m, old);
    C.physical.markAdapter(m, n);
    return e;
  }

  function disconnect(m, eid, end) {
    const selected = C.lengthInfo(m, m.edges[eid]);
    if (selected.method === 'geometry' && selected.value != null) m.edges[eid].length = {
      ...(m.edges[eid].length || {}),
      mode: 'manual',
      manual_m: selected.value,
      reason: 'Length retained before disconnecting'
    };
    const e = m.edges[eid],
      old = m.nodes[e[end]],
      xy = [...e.pts[end === "a" ? 0 : e.pts.length - 1]],
      id = uid(m, "n");
    m.nodes[id] = {
      id,
      kind: "junction",
      x: xy[0],
      y: xy[1]
    };
    e[end] = id;
    if (old?.ports) delete old.ports[eid];
    if (old?.port_slots) delete old.port_slots[eid];
    if (old) C.physical.markAdapter(m, old);
    return m.nodes[id];
  }
  host.RFEdit = {
    split,
    reconnect,
    disconnect,
    capacity
  };
  if (typeof module !== "undefined") module.exports = host.RFEdit;
})(typeof globalThis === "undefined" ? this : globalThis);
