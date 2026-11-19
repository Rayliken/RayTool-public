pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";

const CABLE = {
  UNRESOLVED: {
    n: "Unresolved RF cable",
    c: "#8a6e55"
  },
  LCK: {
    n: "Leaky",
    c: "#00A85A"
  },
  COX12: {
    n: '1/2" coax',
    c: "#6C7BD8"
  },
  COX114: {
    n: '1-1/4" coax',
    c: "#EF5350"
  },
};
const DEVS = [
  ["PASSIVE_UNKNOWN", "Passive · value required"],
  ["DC_PENDING", "Coupler · dB pending"],
  ["SPL2", "2-way splitter"],
  ["SPL3", "3-way splitter"],
  ["POI", "POI"],
  ["DC6", "6 dB coupler"],
  ["DC10", "10 dB coupler"],
  ["DC15", "15 dB coupler"],
];
const ANTS = [
  ["Dome", "Dome"],
  ["Panel", "Panel"],
  ["Yagi", "Yagi"],
];
const isCoupler = (d) => /^DC/.test(d || "");
const CAPTION = {
  LCK: "Leaky Cable:",
  COX12: '1/2" Cable:',
  COX114: '1-1/4" Cable:',
};
/** every run is an H/L pair on site, so a label block always shows both */
function pairLines(label) {
  const obj = [...Object.values(M.nodes), ...Object.values(M.edges)].find(
    (x) => x.label === label,
  );
  const all = RFCore.labels(M, obj || label);
  if (M.meta.layout_label_style !== "compact") return all;
  return [
    ...new Set(
      all.map((s) =>
        s
        .replace(new RegExp("^PRJ-RS-" + M.meta.floor + "-[HL]-"), "")
        .replace(/-(H|L)-/, "-[H/L]-"),
      ),
    ),
  ];
}
const roleOpts = (d) =>
  isCoupler(d) ? ["IN", "THRU", "COUPLED"] : ["IN", "OUT"];
const ROLE_EN = {
  IN: "Input",
  OUT: "Output",
  THRU: "Thru",
  COUPLED: "Coupled",
};
const ROLE_COL = {
  IN: "#F0B429",
  OUT: "#DCE3E7",
  THRU: "#DCE3E7",
  COUPLED: "#37C6D0",
};

function edgesAt(id) {
  return Object.values(M.edges).filter((e) => e.a === id || e.b === id);
}
/** drop ports for cables that no longer exist, then force a legal port set */
function normalizePorts(n) {
  if (n.kind !== "device") return;
  const live = new Set(edgesAt(n.id).map((e) => e.id));
  n.ports = n.ports || {};
  for (const k of Object.keys(n.ports))
    if (!live.has(k)) delete n.ports[k];
  // Preserve explicit roles. Unassigned or conflicting ports are review items.
}
/** setting one port swaps whoever held that exclusive role */
function setPort(n, eid, role) {
  n.ports = n.ports || {};
  const excl = isCoupler(n.dev) ? ["IN", "THRU", "COUPLED"] : ["IN"];
  if (excl.includes(role)) {
    for (const k of Object.keys(n.ports))
      if (k !== eid && n.ports[k] === role)
        n.ports[k] = isCoupler(n.dev) ?
        ["IN", "THRU", "COUPLED"].find(
          (r) =>
          r !== role &&
          !Object.entries(n.ports).some(([j, v]) => j !== k && v === r),
        ) || "COUPLED" :
        "OUT";
  }
  n.ports[eid] = role;
  normalizePorts(n);
}

function portCheck(n) {
  return RFCore.portCheck(M, n);
}

function defRole(n, eid) {
  const free = RFPlan.ports(M, n).filter((p) => !p.edge || p.edge === eid);
  return free.length === 1 ? free[0].role : "";
}

function otherEnd(e, id) {
  return e.a === id ? e.b : e.a;
}
/** unit direction from a device node along one of its edges, for drawing port marks */
function portDir(n, e) {
  const pts = e.a === n.id ? e.pts : e.pts.slice().reverse();
  const q = pts[1] || pts[0];
  const dx = q[0] - n.x,
    dy = q[1] - n.y,
    L = Math.hypot(dx, dy) || 1;
  return [dx / L, dy / L];
}

let M = RFCore.migrate({
  nodes: {},
  edges: {},
  meta: {
    scale: null,
    floor: "B1",
    band: "H",
    paired_labels: true
  },
});
let hover = null,
  PAGE = {
    w: 0,
    h: 0
  };
let uid = 1,
  tool = "select",
  cable = "LCK",
  sel = null,
  draft = null,
  scalePts = [],
  view = {
    z: 1,
    x: 0,
    y: 0
  },
  pdfDoc = null,
  pageNum = 1,
  showLbl = true;
const UI = {
  sym: 1,
  font: 9
};
let draftBefore = null;
const planK = () =>
  UI.sym *
  (M.meta.coordinate_transform ? (M.meta.layout_base_font_px || 18) / 8 : 1);
const visualNode = (n) => RFPlan.position(M, n, planK());
const visualPoints = (e) => RFPlan.points(M, e, planK());
const VIS = {
  background: 1,
  lblSource: 1,
  symSource: 1,
  cabUNRESOLVED: 1,
  lblUNRESOLVED: 1,
  legend: 1,
  flagOrphan: 0,
  symAnt: 1,
  symDev: 1,
  cabLCK: 1,
  cabCOX12: 1,
  cabCOX114: 1,
  lblAnt: 1,
  lblDev: 1,
  lblLCK: 1,
  lblCOX12: 1,
  lblCOX114: 1,
  lblLen: 1,
  testPoints: 1,
  tpb400: 1,
  tpb800: 1,
  tpb1795: 1,
  tpb1910: 1,
  tpNotes: 1,
};
const edgeShown = (e) => !!VIS["cab" + e.cable];
const edgeLabelled = (e) => !!VIS["lbl" + e.cable];
const nodeShown = (n) =>
  n.kind === "source" ?
  VIS.symSource !== 0 :
  n.kind === "antenna" ?
  !!VIS.symAnt :
  n.kind === "device" ?
  !!VIS.symDev :
  true;
const HIST = [],
  FUT = [];

function reseed() {
  uid =
    1 +
    Math.max(
      0,
      ...[...Object.keys(M.nodes), ...Object.keys(M.edges)].map(
        (k) => parseInt(k.slice(1)) || 0,
      ),
    );
}

function snap() {
  HIST.push(JSON.stringify(M));
  if (HIST.length > 80) HIST.shift();
  FUT.length = 0;
}

function undo() {
  if (draftBefore != null) {
    cancelDraft();
    draw();
    return msg("Pending cable cancelled");
  }
  if (!HIST.length) return msg("Nothing to undo");
  FUT.push(JSON.stringify(M));
  M = JSON.parse(HIST.pop());
  sel = null;
  draft = null;
  reseed();
  draw();
  msg("Undo");
}

function redo() {
  if (!FUT.length) return msg("Nothing to redo");
  HIST.push(JSON.stringify(M));
  M = JSON.parse(FUT.pop());
  sel = null;
  draft = null;
  reseed();
  draw();
  msg("Redo");
}
const $ = (s) => document.querySelector(s),
  svg = $("#svg"),
  pan = $("#pan");
const nid = (p) => p + uid++;

/* ---------------- geometry ---------------- */
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function polyLen(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]);
  return s;
}

function edgeGeoM(e) {
  return M.meta.scale ? polyLen(e.pts) * M.meta.scale : null;
}
/** e.len overrides the drawn length — stairs and risers run longer than the plan shows */
function parseLengthM(v) {
  return RFCore.parseLength(v);
}

function lengthInfo(e) {
  return RFCore.lengthInfo(M, e);
}

function validateModel() {
  return RFCore.issues(M).map((i) => [i.code, i.item, i.message]);
}

function edgeLenM(e) {
  return lengthInfo(e).value;
}

function projSeg(p, a, b) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy;
  if (!L2) return {
    t: 0,
    p: a,
    d: dist(p, a)
  };
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2;
  t = Math.max(0, Math.min(1, t));
  const q = [a[0] + t * dx, a[1] + t * dy];
  return {
    t,
    p: q,
    d: dist(p, q)
  };
}

function nearestEdge(p, tol) {
  let best = null;
  tol = tol ?? 8 / view.z;
  for (const e of Object.values(M.edges)) {
    if (!edgeShown(e) || e.layout_handoff) continue;
    const ps = visualPoints(e);
    for (let i = 1; i < ps.length; i++) {
      if (e.layout_breaks?.includes(i)) continue;
      const r = projSeg(p, ps[i - 1], ps[i]);
      if (r.d < tol && (!best || r.d < best.d))
        best = {
          d: r.d,
          edge: e,
          seg: i,
          pt: r.p
        };
    }
  }
  return best;
}
/** what the next click will attach to. Never snaps back onto the vertex we
    just placed, nor onto the node the current line started from. */
function snapAt(p) {
  const last =
    draft && draft.pts.length ? draft.pts[draft.pts.length - 1] : null;
  const gap = 14 / view.z;
  const skip = new Set();
  if (draft && draft.startNode && draft.pts.length === 1)
    skip.add(draft.startNode.id);
  const far = (q) => !last || dist(q, last) > gap;
  const nn = nearestNode(p, null, skip);
  if (nn && nn.node.id !== draft?.startNode?.id)
    return {
      node: nn.node,
      pt: visualNode(nn.node)
    };
  const ne = nearestEdge(p);
  if (ne && far(ne.pt)) return {
    edge: ne,
    pt: ne.pt
  };
  return {
    pt: p
  };
}

function ortho(a, b) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    ax = Math.abs(dx),
    ay = Math.abs(dy),
    K = 2.4142;
  if (ax > ay * K) return [b[0], a[1]];
  if (ay > ax * K) return [a[0], b[1]];
  const d = (ax + ay) / 2,
    sx = Math.sign(dx) || 1,
    sy = Math.sign(dy) || 1;
  return [a[0] + sx * d, a[1] + sy * d];
}

function nearestNode(p, tol, skip) {
  let best = null;
  tol = tol ?? Math.max(9, 6.5 * UI.sym) / view.z;
  for (const n of Object.values(M.nodes)) {
    if (skip && skip.has(n.id)) continue;
    if (!nodeShown(n)) continue;
    const d = dist(p, visualNode(n));
    if (d < tol && (!best || d < best.d)) best = {
      d,
      node: n
    };
  }
  return best;
}

/* ---------------- model ops ---------------- */
function addNode(x, y, kind = "junction", extra = {}) {
  const id = nid("n");
  M.nodes[id] = {
    id,
    x,
    y,
    kind,
    ...extra
  };
  if (kind === "device") M.nodes[id].device_status ??= "candidate";
  if (kind === "device" && !M.nodes[id].label) {
    M.nodes[id].label = RFCore.nextDevice(M, M.nodes[id].dev);
    M.nodes[id].generated_label = true;
  }
  const node = M.nodes[id];
  if (kind === 'source') {
    node.power_reference_plane ??= 'ORU_BEFORE_POI';
    if (!Object.keys(node.power_dbm || {}).length) node.power_dbm = {
      400: 31,
      850: 31,
      1950: 31
    };
  }
  if (kind === 'antenna') node.connector_count_mode ??= 'estimate';
  return node;
}

function addEdge(a, b, pts, cab) {
  RFDesign.assertRoom(M, M.nodes[a]);
  RFDesign.assertRoom(M, M.nodes[b]);
  const id = nid("e");
  M.edges[id] = {
    id,
    a,
    b,
    pts,
    cable: cab
  };
  RFDesign.markAdapter(M, M.nodes[a]);
  RFDesign.markAdapter(M, M.nodes[b]);
  return M.edges[id];
}

/** split an edge at a point on segment index i — the two halves stay joined through the new node */
function splitEdge(e, segIdx, pt, kind = "junction", extra = {}) {
  const r = RFEdit.split(M, e.id, segIdx, pt, {
    kind,
    extra
  });
  reseed();
  return r;
}

function delNode(id) {
  for (const e of Object.values(M.edges))
    if (e.a === id || e.b === id) delete M.edges[e.id];
  delete M.nodes[id];
}

function autoLabel(kind) {
  return RFCore.nextLabel(M, kind);
}

/* ---------------- rendering ---------------- */
function toLocal(ev) {
  const r = $("#pdf").getBoundingClientRect();
  return [(ev.clientX - r.left) / view.z, (ev.clientY - r.top) / view.z];
}

function el(t, a) {
  const n = document.createElementNS("http://www.w3.org/2000/svg", t);
  for (const k in a) n.setAttribute(k, a[k]);
  return n;
}

function draw() {
  return drawToolScene();
}

function applyView() {
  pan.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.z})`;
  updatePDFPreview();
}

function stats() {
  const t = {};
  let n = 0;
  for (const e of Object.values(M.edges)) {
    const L = edgeLenM(e);
    if (L != null) {
      t[e.cable] = (t[e.cable] || 0) + L;
    }
  }
  for (const nd of Object.values(M.nodes))
    if (nd.kind === "antenna") n++;
  $("#stats").innerHTML =
    Object.keys(CABLE)
    .map(
      (k) =>
      `<div class="stat"><i>${{ UNRESOLVED: "未定線材", LCK: "漏纜", COX12: '1/2" coax', COX114: '1-1/4" coax' }[k] || CABLE[k].n}</i><span>${(t[k] || 0).toFixed(1)} m</span></div>`,
    )
    .join("") + `<div class="stat"><i>天線</i><span>${n}</span></div>`;
}

/* ---------------- inspector ---------------- */
function inspect() {
  return inspectR04();
}

function cancelDraft() {
  if (draftBefore != null) {
    M = JSON.parse(draftBefore);
    reseed();
  }
  draftBefore = null;
  draft = null;
}

function portAvailable(n, slot) {
  return !RFPlan.ports(M, n).find((p) => p.slot === slot)?.edge;
}

function cableClick(p, explicit = null) {
  if (explicit && !portAvailable(explicit.node, explicit.slot))
    return msg(explicit.slot + " is already connected; choose a free port");
  if (!draft && draftBefore == null) draftBefore = JSON.stringify(M);
  const sn = explicit ?
    {
      node: explicit.node,
      pt: visualNode(explicit.node),
      slot: explicit.slot,
      role: explicit.role,
    } :
    snapAt(p);
  let anchor = sn.node || null,
    pt = sn.pt;
  if (sn.edge) {
    if (!draft) cancelDraft();
    return msg('A cable cannot branch here. Drop a coupler or splitter onto this cable, then draw from its free port.');
  }
  if (anchor) {
    try {
      RFDesign.assertRoom(M, anchor);
    } catch (e) {
      if (!draft) cancelDraft();
      return msg(e.message);
    }
  }
  if (
    anchor?.kind === "device" &&
    !RFPlan.ports(M, anchor).some((p) => !p.edge) &&
    RFPlan.slots(anchor).length
  ) {
    if (!draft) cancelDraft();
    return msg("All rated component ports are occupied");
  }
  if (!draft)
    draft = {
      pts: [pt],
      startNode: anchor,
      startSlot: sn.slot,
      startRole: sn.role,
    };
  else {
    draft.pts.push(pt);
    if (anchor) {
      commitDraft(anchor, sn.slot, sn.role);
      return;
    }
  }
  draw();
}
/* ---------------- interaction ---------------- */
$("#stage").addEventListener("mousedown", (ev) => {
  if (document.activeElement && document.activeElement.blur)
    document.activeElement.blur();
  if (ev.button === 1 || ev.altKey) {
    ev.preventDefault();
    const sx = ev.clientX,
      sy = ev.clientY,
      ox = view.x,
      oy = view.y;
    const mv = (e) => {
      view.x = ox + e.clientX - sx;
      view.y = oy + e.clientY - sy;
      applyView();
    };
    const up = () => {
      removeEventListener("mousemove", mv);
      removeEventListener("mouseup", up);
    };
    addEventListener("mousemove", mv);
    addEventListener("mouseup", up);
    return;
  }
  const portTarget = ev.target.closest?.("[data-connect-node]");
  if (portTarget) {
    if (tool !== "draw") {
      tool = "draw";
      document
        .querySelectorAll("[data-tool]")
        .forEach((b) =>
          b.setAttribute("aria-pressed", b.dataset.tool === tool),
        );
    }
    const n = M.nodes[portTarget.dataset.connectNode];
    cableClick(visualNode(n), {
      node: n,
      slot: portTarget.dataset.connectSlot,
      role: portTarget.dataset.connectRole,
    });
    return;
  }
  let p = toLocal(ev);
  if (ev.shiftKey) {
    if (tool === "draw" && draft && draft.pts.length)
      p = ortho(draft.pts[draft.pts.length - 1], p);
    if (tool === "scale" && scalePts.length)
      p = ortho(scalePts[scalePts.length - 1], p);
  }

  if (tool === "scale") {
    scalePts.push(p);
    if (scalePts.length === 2) {
      const px = dist(scalePts[0], scalePts[1]);
      const m = parseFloat(
        prompt(
          `Real distance between these two points, in metres?\n(measured ${px.toFixed(1)} pt on screen)`,
          "9",
        ),
      );
      if (m > 0) {
        snap();
        M.meta.scale = m / px;
        msg(`Scale set: 1 m = ${(px / m).toFixed(2)} pt`);
      }
      scalePts = [];
      setTool("select");
    }
    draw();
    return;
  }

  if (tool === "draw") {
    cableClick(p);
    return;
  }
  // 點 TestPoint: a new purple TestPoint at the click (testpoint-edit.js), then edit its name / values in the panel
  if (tool === "testpoint") {
    window.RFTestPointEdit?.add(p);
    return;
  }

  if (tool === "device" || tool === "antenna") {
    snap();
    const nn = nearestNode(p);
    if (nn) {
      const n = nn.node;
      if (n.kind !== 'junction') {
        sel = n;
        draw();
        return msg('Existing equipment selected. Place a new component on a cable or place an antenna at a free cable end.');
      }
      const proposed = {
        ...n,
        kind: tool === 'device' ? 'device' : 'antenna',
        dev: tool === 'device' ? $('#insertDeviceType').value : 'Dome'
      };
      if (edgesAt(n.id).length > RFDesign.capacity(proposed)) return msg('Antenna has one IN only; use a splitter or coupler for branching.');
      if (tool === 'device' && edgesAt(n.id).length === 3) {
        RFDesign.convertBranch(M, n.id, proposed.dev);
        sel = n;
        draw();
        return;
      }
      n.kind = tool === "device" ? "device" : "antenna";
      n.dev = tool === "device" ? $("#insertDeviceType").value : "Dome";
      if (n.kind === "device") {
        n.previous_label = n.label;
        n.label = RFCore.nextDevice(M, n.dev);
        n.ports = {};
        edgesAt(n.id).forEach((e) => (n.ports[e.id] = defRole(n, e.id)));
      }
      if (tool === "antenna") {
        n.jumper = 2;
        n.previous_label = n.label;
        n.label = autoLabel("ANT");
        n.connector_count_mode = 'estimate';
      }
      sel = n;
      draw();
      return;
    }
    const ne = nearestEdge(p, 10 / view.z);
    if (ne) {
      if (tool === 'antenna') return msg('An antenna cannot be inserted through a cable. Place it at a free cable end or connect a new single feed to it.');
      const s = splitEdge(
        ne.edge,
        ne.seg,
        ne.pt,
        tool === "device" ? "device" : "antenna",
        tool === "device" ?
        {
          dev: $("#insertDeviceType").value
        } :
        {
          dev: "Dome",
          jumper: 2,
          label: autoLabel("ANT")
        },
      );
      sel = s.node;
      draw();
      msg(
        tool === "device" ?
        "Component inserted — cable split in two, still connected" :
        "Antenna inserted on cable",
      );
      return;
    }
    if (tool === "device") {
      sel = addNode(p[0], p[1], "device", {
        dev: $("#insertDeviceType").value,
        ports: {},
      });
      draw();
      msg("Component placed — click a named port to connect");
      return;
    }
    sel = addNode(p[0], p[1], 'antenna', {
      dev: 'Dome',
      jumper: 2,
      label: autoLabel('ANT')
    });
    draw();
    msg('Antenna placed with one IN. Connect a cable endpoint or a free passive output.');
    return;
  }

  if (tool === "source") {
    snap();
    const nn = nearestNode(p);
    if (nn) {
      if (edgesAt(nn.node.id).length > 1) return msg('An ORU has one output. Insert a splitter before branching.');
      if (nn.node.kind !== "source") {
        nn.node.kind = "source";
        nn.node.label = RFCore.nextSource(M);
        nn.node.power_reference_plane = 'ORU_BEFORE_POI';
        nn.node.power_dbm = {
          400: 31,
          850: 31,
          1950: 31
        };
      }
      sel = nn.node;
      draw();
    } else {
      const n = addNode(p[0], p[1], "source", {
        label: RFCore.nextSource(M),
        power_dbm: {},
      });
      sel = n;
      draw();
    }
    return;
  }

  // drag a bend point of the selected cable (handles drawn by rf-tool.js)
  const bend = ev.target.closest?.("[data-bend-edge]");
  if (bend && tool === "select") {
    const e = M.edges[bend.dataset.bendEdge], i = +bend.dataset.bendI;
    if (e?.pts?.[i]) {
      snap();
      const sx = ev.clientX, sy = ev.clientY, [ox, oy] = e.pts[i];
      const mv = (m) => {
        let q = [ox + (m.clientX - sx) / view.z, oy + (m.clientY - sy) / view.z];
        if (m.shiftKey) q = ortho(e.pts[i - 1], q);
        e.pts[i] = q;
        e.route_user_edited = true;
        if (e.stair_pass) e.user_edited = true;   // stair-passing.cjs keeps a pass-through route the user changed
        draw();
      };
      const up = () => {
        removeEventListener("mousemove", mv);
        removeEventListener("mouseup", up);
      };
      addEventListener("mousemove", mv);
      addEventListener("mouseup", up);
      return;
    }
  }
  const direct = ev.target.closest?.("[data-select-node],[data-node-id]");
  const nn = direct ?
    {
      node: M.nodes[direct.dataset.selectNode || direct.dataset.nodeId]
    } :
    nearestNode(p);
  if (nn) {
    sel = nn.node;
    snap();
    const n = nn.node,
      sx = ev.clientX,
      sy = ev.clientY,
      ox = n.x,
      oy = n.y;
    const mv = (e) => {
      const dx = (e.clientX - sx) / view.z,
        dy = (e.clientY - sy) / view.z;
      n.x = ox + dx;
      n.y = oy + dy;
      if (M.meta.revision === "R05" && M.meta.coordinate_transform) {
        const t = M.meta.coordinate_transform;
        n.original_source_xy_mm ??= n.source_xy_mm;
        n.source_xy_mm = [
          (n.x - 100) / t.canvas_per_mm + t.lo[0],
          t.hi[1] - (n.y - 100) / t.canvas_per_mm,
        ];
        n.position_status = "USER_EDITED_CAD_FRAME";
        n.position_verified = false;
      }
      for (const g of Object.values(M.edges)) {
        if (g.a === n.id) g.pts[0] = [n.x, n.y];
        if (g.b === n.id) g.pts[g.pts.length - 1] = [n.x, n.y];
      }
      draw();
    };
    const up = (ev) => {
      removeEventListener("mousemove", mv);
      removeEventListener("mouseup", up);
      if (Math.hypot(n.x - ox, n.y - oy) > 3 / view.z)
        finishNodeDrop(n, toLocal(ev));
    };
    addEventListener("mousemove", mv);
    addEventListener("mouseup", up);
    draw();
    return;
  }
  const ne = nearestEdge(p);
  sel = ne ? ne.edge : null;
  draw();
});
$("#stage").addEventListener("mousemove", (ev) => {
  const raw = toLocal(ev);
  const prev = hover;
  if (tool === "draw") {
    const sn = snapAt(raw);
    hover = sn.node || sn.edge ? sn.pt : null;
  } else if (tool === "device" || tool === "antenna") {
    const nn = nearestNode(raw),
      ne = nn ? null : nearestEdge(raw, 10 / view.z);
    hover = nn ? visualNode(nn.node) : ne ? ne.pt : null;
  } else hover = null;
  if (!(draft || scalePts.length)) {
    if (String(prev) !== String(hover)) updateInteractionOverlays();
    return;
  }
  let c = raw;
  if (ev.shiftKey) {
    const last =
      draft && draft.pts.length ?
      draft.pts[draft.pts.length - 1] :
      scalePts.length ?
      scalePts[scalePts.length - 1] :
      null;
    if (last) c = ortho(last, c);
  }
  if (draft) draft.cur = c;
  else draft = {
    pts: [],
    cur: c
  };
  updateInteractionOverlays();
});
$("#stage").addEventListener("dblclick", (ev) => {
  if (draft) return commitDraft(null);
  // bend points: double-click a handle removes it, double-click the selected cable adds one there
  const bend = ev.target.closest?.("[data-bend-edge]");
  const shift = (e, from, by) => { if (e.layout_breaks) e.layout_breaks = e.layout_breaks.filter((b) => by > 0 || b !== from).map((b) => (b >= from + (by < 0 ? 1 : 0) ? b + by : b)); };
  if (bend) {
    const e = M.edges[bend.dataset.bendEdge], i = +bend.dataset.bendI;
    if (e?.pts?.length > 2) { snap(); e.pts.splice(i, 1); shift(e, i, -1); e.route_user_edited = true; if (e.stair_pass) e.user_edited = true; draw(); }
    return;
  }
  if (tool === "select" && sel && M.edges[sel.id]) {
    const e = M.edges[sel.id], ne = nearestEdge(toLocal(ev), 10 / view.z);
    if (ne && ne.edge.id === e.id && e.pts) { snap(); e.pts.splice(ne.seg, 0, ne.pt); shift(e, ne.seg, 1); e.route_user_edited = true; if (e.stair_pass) e.user_edited = true; draw(); }
  }
});
$("#stage").addEventListener("contextmenu", (e) => {
  e.preventDefault();
  if (draft) commitDraft(null);
});
$("#stage").addEventListener(
  "wheel",
  (ev) => {
    ev.preventDefault();
    const f = ev.deltaY < 0 ? 1.12 : 1 / 1.12,
      r = $("#stage").getBoundingClientRect();
    const mx = ev.clientX - r.left,
      my = ev.clientY - r.top;
    view.x = mx - (mx - view.x) * f;
    view.y = my - (my - view.y) * f;
    view.z *= f;
    applyView();
    draw();
    clearTimeout(paintT);
    paintT = setTimeout(paint, 220);
  }, {
    passive: false
  },
);

function commitDraft(endAnchor, endSlot, endRole) {
  if (!draft || draft.pts.length < 2) {
    cancelDraft();
    draw();
    return;
  }
  const pts = draft.pts,
    a = draft.startNode || addNode(pts[0][0], pts[0][1]),
    b = endAnchor || addNode(pts[pts.length - 1][0], pts[pts.length - 1][1]);
  if (a.id === b.id) {
    cancelDraft();
    draw();
    return msg("Start and end are the same node — nothing drawn");
  }
  const capacity = (n) =>
    edgesAt(n.id).length < RFDesign.capacity(n) && (!RFPlan.slots(n).length || RFPlan.ports(M, n).some((p) => !p.edge));
  if (!capacity(a) || !capacity(b)) {
    cancelDraft();
    draw();
    return msg("Component port capacity reached");
  }
  HIST.push(draftBefore || JSON.stringify(M));
  if (HIST.length > 80) HIST.shift();
  FUT.length = 0;
  pts[0] = [a.x, a.y];
  pts[pts.length - 1] = [b.x, b.y];
  const e = addEdge(a.id, b.id, pts, cable);
  e.label = RFCore.nextConnectionLabel(M,e);
  e.name_basis = M.nodes[e.a]?.kind === "antenna" || M.nodes[e.b]?.kind === "antenna" ? "USER_JUMPER_RULE" : "USER_LINK_RULE";
  for (const [nd, slot, role] of [
      [a, draft.startSlot, draft.startRole],
      [b, endSlot, endRole],
    ])
    if (nd.kind === "device") {
      nd.ports ??= {};
      nd.port_slots ??= {};
      const free = RFPlan.ports(M, nd).filter((p) => !p.edge),
        chosen = slot ?
        free.find((p) => p.slot === slot) :
        free.length === 1 ?
        free[0] :
        null;
      if (chosen) {
        nd.ports[e.id] = chosen.role;
        nd.port_slots[e.id] = chosen.slot;
      } else nd.ports[e.id] = "";
    }
  draftBefore = null;
  draft = null;
  sel = e;
  draw();
}
addEventListener("keydown", (e) => {
  if (
    e.target.matches?.(
      "input:not([type=range]):not([type=checkbox]),textarea,select,[contenteditable=true]",
    )
  )
    return;
  const k0 = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k0 === "z") {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && k0 === "y") {
    e.preventDefault();
    redo();
    return;
  }
  const tn = (e.target.tagName || "").toLowerCase();
  if (
    tn === "textarea" ||
    (tn === "input" && !/range|checkbox|radio/.test(e.target.type || ""))
  )
    return;
  if (tn === "select" && !"vlcasktp".includes(k0)) return;
  if (tn === "select") e.target.blur();
  const k = k0;
  if (k === "escape") {
    cancelDraft();
    scalePts = [];
    draw();
  }
  if (k === "enter" && draft) commitDraft(null);
  if (k === "v") setTool("select");
  if (k === "l") setTool("draw");
  if (k === "c") setTool("device");
  if (k === "a") setTool("antenna");
  if (k === "s") setTool("source");
  if (k === "k") setTool("scale");
  // P: TestPoint pin (T stays "all labels on / off"; both were T, user 2026-11-19)
  if (k === "p") setTool("testpoint");
  if (k === "t") toggleLbl();
  if ((k === "delete" || k === "backspace") && sel) {
    snap();
    if (M.edges[sel.id]) delete M.edges[sel.id];
    else delNode(sel.id);
    sel = null;
    draw();
  }
});

function setTool(t) {
  if (draft) cancelDraft();
  tool = t;
  draft = null;
  scalePts = [];
  document
    .querySelectorAll("[data-tool]")
    .forEach((b) => b.setAttribute("aria-pressed", b.dataset.tool === t));
  $("#stage").style.cursor = t === "select" ? "default" : "crosshair";
  draw();
}
document
  .querySelectorAll("[data-tool]")
  .forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));

function toggleLbl() {
  showLbl = !showLbl;
  saveViewSettings();
  $("#tLbl").setAttribute("aria-pressed", showLbl);
  draw();
}
$("#tLbl").onclick = toggleLbl;
document.querySelectorAll(".cable").forEach(
  (b) =>
  (b.onclick = () => {
    cable = b.dataset.cable;
    document
      .querySelectorAll(".cable")
      .forEach((x) => x.setAttribute("aria-pressed", x === b));
  }),
);
document.querySelectorAll("[data-vis]").forEach(
  (c) =>
  (c.onchange = () => {
    VIS[c.dataset.vis] = c.checked ? 1 : 0;
    saveViewSettings();
    draw();
    if (c.dataset.vis === "background" && c.checked) paint();
    if (CURRENT_TOPO && $("#topo").style.display === "flex") showTopology();
  }),
);
let orphIdx = 0;

$("#uiSym").oninput = (e) => {
  UI.sym = +e.target.value;
  saveViewSettings();
  draw();
};
$("#uiFont").oninput = (ev) => setLabelSize(ev.target.value);
for (const id of ["uiFontNumber", "topoFont"]) {
  $("#" + id).oninput = (ev) => {
    const n = Number(ev.target.value);
    if (n >= 4 && n <= 28) setLabelSize(n);
  };
  $("#" + id).onchange = (ev) => setLabelSize(ev.target.value);
}
$("#pfFloor").onchange = (e) => (M.meta.floor = e.target.value);
$("#pfBand").onchange = (e) => (M.meta.band = e.target.value);
let msgT;

function msg(s) {
  $("#sMsg").textContent = s;
  clearTimeout(msgT);
  msgT = setTimeout(() => ($("#sMsg").textContent = ""), 4000);
}

/* ---------------- pdf ---------------- */
$("#fpdf").onchange = async (ev) => {
  const f = ev.target.files[0];
  if (!f) return;
  const registration = M.meta?.cad_pdf_registration;
  if (
    registration &&
    f.name !== registration.source_file &&
    f.name !== registration.bundle_source_file
  ) {
    M.meta.cad_pdf_registration = {
      ...registration,
      source_file: f.name
    };
    msg("New PDF uses the current alignment; use Underlay alignment to adjust");
  }
  activeUnderlayFile = f.name;
  ACTIVE_PDF_BYTES = new Uint8Array(await f.arrayBuffer());
  pdfDoc = await pdfjsLib.getDocument({
      data: ACTIVE_PDF_BYTES.slice()
    })
    .promise;
  $("#page").max = pdfDoc.numPages;
  $("#page").value =
    f.name === registration?.bundle_source_file ?
    registration.bundle_page_index :
    1;
  $("#page").disabled = f.name === registration?.bundle_source_file;
  renderPage();
};
$("#page").onchange = () => renderPage();
let pdfPage = null,
  rendering = false,
  repaintQ = false,
  paintT = null,
  CAD_RENDER_TASK = null,
  CAD_RENDER_SEQ = 0,
  LAST_CAD_PAINT = null;
async function renderPage() {
  if (!pdfDoc) return;
  pageNum = Math.min(Math.max(1, +$("#page").value || 1), pdfDoc.numPages);
  pdfPage = await pdfDoc.getPage(pageNum);
  const vp = pdfPage.getViewport({
    scale: 1
  });
  PAGE = M.meta?.cad_pdf_registration?.pdf_to_canvas ?
    {
      w: M.meta.cad_pdf_registration.canvas_size[0],
      h: M.meta.cad_pdf_registration.canvas_size[1],
    } :
    {
      w: vp.width,
      h: vp.height
    };
  M.meta.underlay = {
    file: activeUnderlayFile,
    page: pageNum
  };
  M.meta.page_size = PAGE;
  const cv = $("#pdf");
  cv.style.width = PAGE.w + "px";
  cv.style.height = PAGE.h + "px";
  svg.setAttribute("width", PAGE.w);
  svg.setAttribute("height", PAGE.h);
  svg.setAttribute("viewBox", `0 0 ${PAGE.w} ${PAGE.h}`);
  $("#empty").style.display = "none";
  view = {
    z: Math.min(
      1,
      ($("#stage").clientWidth - 50) / PAGE.w,
      ($("#stage").clientHeight - 50) / PAGE.h,
    ),
    x: 20,
    y: 20,
  };
  applyView();
  fitCompleteSheet();
  await paint();
  draw();
}
/** re-rasterise at a density that matches the current zoom, so the plan stays legible */
async function paint() {
  return paintVisiblePDF();
}

/* ---------------- topology ---------------- */
/** nodes with no path back to the source — drawn but not fed */
function orphanSet() {
  const a = RFCore.analyze(M);
  return new Set(
    Object.keys(M.nodes).filter((k) => !a.nodeComponent[k].sources.length),
  );
}
/** split the unconnected nodes into separate islands */
function orphanGroups() {
  const o = orphanSet();
  if (!o || !o.size) return [];
  const adj = {};
  for (const e of Object.values(M.edges)) {
    if (!o.has(e.a) || !o.has(e.b)) continue;
    (adj[e.a] = adj[e.a] || []).push(e.b);
    (adj[e.b] = adj[e.b] || []).push(e.a);
  }
  const seen = new Set(),
    out = [];
  for (const id of o) {
    if (seen.has(id)) continue;
    const g = [],
      q = [id];
    seen.add(id);
    while (q.length) {
      const u = q.shift();
      g.push(u);
      for (const v of adj[u] || [])
        if (!seen.has(v)) {
          seen.add(v);
          q.push(v);
        }
    }
    out.push(g);
  }
  return out.sort((a, b) => b.length - a.length);
}

function buildTree() {
  return RFCore.analyze(M);
}
/** Point each component's input at the source. A Thru/Coupled choice the user
    has already made is never overwritten — only missing or illegal ones are filled in. */
function autoPorts() {
  return RFCore.autoPorts(M);
}

function pathOf(t, id) {
  const path = [];
  let u = id;
  while (t.par[u] !== undefined) {
    path.push({
      node: M.nodes[u],
      edge: t.pe[u]
    });
    u = t.par[u];
  }
  return path.reverse();
}

function termName(t, id) {
  const n = M.nodes[id];
  if (n.label) return n.label;
  const e = t.pe[id];
  return (e && e.label) || id;
}

function keyName(k) {
  const [d, r] = k.split(":");
  const base = (DEVS.find((x) => x[0] === d) || ["", d])[1];
  return r ? `${base} ${r === "COUPLED" ? "Coupled" : "Thru"}` : base;
}

function budgetRows() {
  return RFCore.terminalRows(M);
}

let CURRENT_TOPO = null,
  topoZoom = 1;

function setTopoZoom(z) {
  if (!CURRENT_TOPO) return;
  topoZoom = Math.min(8, Math.max(0.001, z));
  const el = document.querySelector("#topowrap > svg");
  if (el) {
    el.setAttribute("width", CURRENT_TOPO.width * topoZoom);
    el.setAttribute("height", CURRENT_TOPO.height * topoZoom);
  }
  $("#topoPercent").textContent = Math.round(topoZoom * 100) + "%";
}

function showTopology() {
  const previous =
    $("#topo").style.display === "flex" ?
    {
      z: topoZoom,
      x: $("#topowrap").scrollLeft,
      y: $("#topowrap").scrollTop,
    } :
    null;
  $("#drawingTitle").textContent = "RF line diagram";
  CURRENT_TOPO = buildToolTopology();
  CURRENT_TOPO.kind = "Line Diagram";
  $("#topowrap").innerHTML = CURRENT_TOPO.svg;
  $("#topoInfo").textContent =
    CURRENT_TOPO.sourceCount +
    " sources · " +
    CURRENT_TOPO.nodeCount +
    " nodes · " +
    CURRENT_TOPO.edgeCount +
    " cables";
  $("#topo").style.display = "flex";
  $("#topoFont").value = UI.font;
  setTopoZoom(
    previous ?
    previous.z :
    Math.min(
      1,
      ($("#topowrap").clientWidth - 45) / CURRENT_TOPO.width,
      ($("#topowrap").clientHeight - 45) / CURRENT_TOPO.height,
    ),
  );
  $("#topowrap").scrollTop = previous?.y || 0;
  $("#topowrap").scrollLeft = previous?.x || 0;
  bindTopologyLabels();
  window.RFUnfed?.refresh();
}
$("#genTopo").onclick = () => setWorkspace("line");

/* ---------------- export ---------------- */
const stamp = () =>
  new Date().toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15);
const fname = (what, ext) => {
  const kind = what.toLowerCase();
  if (!["layout", "line diagram", "riser"].includes(kind))
    return `${M.meta.floor} ${what} ${stamp()}.${ext}`;
  const today = new Date();
  const date = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, "0"), String(today.getDate()).padStart(2, "0")].join("");
  return `${M.meta.floor} ${kind} ${date}.${ext}`;
};

function dl(blob, name) {
  const a = document.createElement("a"),
    url = URL.createObjectURL(blob);
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function nodeName(n) {
  if (!n) return "";
  return n.kind === "device" ?
    (n.label || n.id) + " [" + (n.dev || "TBD") + "]" :
    n.label || n.id;
}

function budgetAOA() {
  return budgetTable();
}

function cableAOA() {
  return cableTable();
}

function compAOA() {
  const head = [
    "Component",
    "Model",
    "Input cable",
    "Thru / Output cables",
    "Coupled cable",
    "Ports valid",
  ];
  const body = Object.values(M.nodes)
    .filter((n) => n.kind === "device")
    .map((n) => {
      const P = n.ports || {},
        es = edgesAt(n.id);
      const pick = (r) =>
        es
        .filter((e) => P[e.id] === r)
        .map((e) => e.label || e.id)
        .join(", ");
      return [
        n.label || n.id,
        (DEVS.find((d) => d[0] === n.dev) || ["", n.dev])[1],
        pick("IN"),
        [pick("THRU"), pick("OUT")].filter(Boolean).join(", "),
        pick("COUPLED"),
        portCheck(n) ? "yes" : "NO",
      ];
    });
  return [head].concat(body);
}

function exportXlsx() {
  return exportWorkbook();
}
$("#expXls").onclick = exportXlsx;
$("#save").onclick = () =>
  dl(
    new Blob([JSON.stringify(M, null, 1)], {
      type: "application/json"
    }),
    fname("riser", "json"),
  );

function loadProject(project) {
  // Floor JSON saved before the TestPoint layer existed: take this floor's test points from the project.
  const tpSource = window.RFProjectCatalog?.[project?.meta?.floor]?.meta?.test_points;
  if (project?.meta && !project.meta.test_points && tpSource) project.meta.test_points = structuredClone(tpSource);
  HIST.length = 0;
  FUT.length = 0;
  if (project.meta?.schema == null && project.meta?.paired_labels == null) {
    project.meta ??= {};
    project.meta.paired_labels = true;
  }
  const priorFloor = M.meta.floor;
  M = RFCore.migrate(project);
  M.meta.editor_view = "original";
  M.meta.layout_label_style = "full";
  M.meta.diagram_style = "rf_line";
  draftBefore = null;
  restoreViewSettings();
  const keepPdf =
    pdfPage &&
    activeUnderlayFile !== window.RFCADUnderlay?.file &&
    priorFloor === M.meta.floor &&
    !M.meta.coordinate_transform &&
    !M.meta.geometry_basis &&
    (!M.meta.underlay?.file || M.meta.underlay.file === activeUnderlayFile);
  if (!keepPdf) {
    pdfPage = null;
    pdfDoc = null;
    activeUnderlayFile = "";
    const cv = $("#pdf");
    cv.getContext("2d").clearRect(0, 0, cv.width, cv.height);
  }
  reseed();
  sel = null;
  draft = null;
  $("#empty").style.display = "none";
  $("#pfFloor").value = M.meta.floor || "B1";
  $("#pfBand").value = M.meta.band || "H";
  for (const kind of ["COX", "ANT", "LCK"])
    $("#name" + kind).value = RFCore.pattern(M, kind).letter || "";
  $("#stairDefault").value = M.meta.stair_reserve_m;
  const pts = [
    ...Object.values(M.nodes).map((n) => [n.x, n.y]),
    ...Object.values(M.edges).flatMap((e) => e.pts || []),
  ];
  if (pts.length) {
    const minx = Math.min(...pts.map((p) => p[0])),
      miny = Math.min(...pts.map((p) => p[1])),
      maxx = Math.max(...pts.map((p) => p[0])),
      maxy = Math.max(...pts.map((p) => p[1]));
    PAGE = keepPdf ?
      {
        w: pdfPage.getViewport({
          scale: 1
        }).width,
        h: pdfPage.getViewport({
          scale: 1
        }).height,
      } :
      {
        w: Math.max(800, maxx + 100),
        h: Math.max(600, maxy + 100)
      };
    if (!keepPdf) {
      const cv = $("#pdf");
      cv.width = 1;
      cv.height = 1;
      cv.style.width = PAGE.w + "px";
      cv.style.height = PAGE.h + "px";
    }
    $("#svg").setAttribute("viewBox", `0 0 ${PAGE.w} ${PAGE.h}`);
    $("#svg").setAttribute("width", PAGE.w);
    $("#svg").setAttribute("height", PAGE.h);
    const r = $("#stage").getBoundingClientRect();
    view.z = Math.min(
      (r.width - 70) / (maxx - minx || 1),
      (r.height - 70) / (maxy - miny || 1),
    );
    view.x = 35 - minx * view.z;
    view.y = 35 - miny * view.z;
    applyView();
  }
  draw();
  msg(M.meta.review_status || "Project loaded; all sources retained");
}
$("#load").onchange = async (ev) => {
  try {
    loadProject(JSON.parse(await ev.target.files[0].text()));
    if (
      CAD_BUNDLE_DOC &&
      M.meta.cad_pdf_registration?.bundle_source_file === RFCADUnderlay.file
    ) {
      await useCADBackground();
    }
  } catch (error) {
    msg("Project load failed: " + error.message);
  }
};

let activeUnderlayFile = "";

function htmlEscape(v) {
  return String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
    ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[
      c
    ],
  );
}

function syncProjectControls() {
  if ($("#reviewFloor") && window.RFProjectCatalog?.[M.meta.floor])
    $("#reviewFloor").value = M.meta.floor;
  for (const kind of ["COX", "ANT", "LCK"]) {
    const el = $("#name" + kind);
    if (el && document.activeElement !== el)
      el.value = RFCore.pattern(M, kind).letter || "";
  }
  const sd = $("#stairDefault");
  if (sd && document.activeElement !== sd)
    sd.value = M.meta.stair_reserve_m ?? 100;
}

function inspectR04() {
  inspectSelection();
  inspectDesignControls();
}

function inspectSelection() {
  const box = $("#insp"),
    h = htmlEscape;
  if (!sel || (!M.edges[sel.id] && !M.nodes[sel.id])) {
    sel = null;
    box.innerHTML =
      '<p class="hint">在圖上點選電纜、元件或天線。</p>';
    return;
  }
  const edge = M.edges[sel.id];
  if (edge) {
    const e = edge,
      a = e.length || {},
      L = lengthInfo(e);
    const field = (id, title, value, type = "number") =>
      `<div class="row"><span>${title}</span><input id="${id}" type="${type}" ${type === "number" ? 'step="0.01" min="0"' : ""} value="${h(value)}"></div>`;
    box.innerHTML = `<div class="row"><span>Cable</span><select id="iC">${Object.keys(
      CABLE,
    )
      .map(
        (k) =>
          `<option value="${k}" ${e.cable === k ? "selected" : ""}>${h(CABLE[k].n)}</option>`,
      )
      .join(
        "",
      )}</select></div>${field("iL", "CAD ID", e.label || "", "text")}<div class="row"><span>Length basis</span><select id="iBasis">${[
      ["auto", "Automatic"],
      ["cad", "CAD marked"],
      ["stair_reserve", "Stair reserve"],
      ["manual", "Manual override"],
      ["survey", "Survey"],
      ["pdf", "PDF measurement"],
      ["geometry", "Drawn estimate"],
      ["allocation", "Allocated split"],
    ]
      .map(
        ([k, v]) =>
          `<option value="${k}" ${(a.mode || "auto") === k ? "selected" : ""}>${v}</option>`,
      )
      .join(
        "",
      )}</select></div>${field("iCad", "CAD m", a.cad_m ?? e.cad_m ?? "")}${field("iLen", "Manual m", a.manual_m ?? e.len ?? "")}<label class="hint"><input id="iStair" type="checkbox" ${a.is_stair || a.mode === "stair_reserve" ? "checked" : ""}> Stair section — reserve once per cable run</label>${field("iReserve", "Reserve m", a.reserve_m ?? M.meta.stair_reserve_m ?? 100)}${field("iStairNo", "樓梯編號", e.stair?.location || "", "text")}${field("iStairFrom", "From", e.stair?.from || "", "text")}${field("iStairTo", "To", e.stair?.to || "", "text")}${field("iReason", "Reason", a.reason || "", "text")}${field("iCadRef", "CAD ref", a.cad_ref || e.cad_ref || e.cad_handle || "", "text")}<p class="hint">Used: <b>${L.value == null ? "MISSING" : L.value.toFixed(2) + " m"}</b> (${h(L.source)})<br>CAD: ${L.cad_m == null ? "not linked" : L.cad_m.toFixed(2) + " m"}<br>Drawn: ${L.geometry_m == null ? "not calibrated" : L.geometry_m.toFixed(2) + " m"}${L.delta_m != null && Math.abs(L.delta_m) > 0.01 ? "<br>CAD difference: " + L.delta_m.toFixed(2) + " m" : ""}</p><label class="hint"><input id="iVerified" type="checkbox" ${e.review_verified ? "checked" : ""}> Route / identity checked</label><label class="hint"><input id="iLengthVerified" type="checkbox" ${a.verified ? "checked" : ""}> Estimated / split length checked</label><button class="btn" id="iAuto">Generate next free ID</button><button class="btn" id="reconnectA">Reconnect start</button><button class="btn" id="reconnectB">Reconnect end</button><button class="btn" id="iDel">Delete cable</button>`;
    const spec = () => (e.length ??= a);
    const change = (id, fn) =>
      ($(id).onchange = (ev) => {
        snap();
        fn(ev.target);
        draw();
      });
    change("#iC", (el) => (e.cable = el.value));
    change("#iL", (el) => (e.label = el.value.trim()));
    change("#iBasis", (el) => (spec().mode = el.value));
    change("#iCad", (el) => {
      spec().cad_m = RFCore.number(el.value);
      spec().mode = spec().is_stair ? "stair_reserve" : "cad";
    });
    change("#iLen", (el) => {
      spec().manual_m = RFCore.number(el.value);
      spec().mode = "manual";
    });
    change("#iStair", (el) => {
      spec().is_stair = el.checked;
      spec().mode = el.checked ? "stair_reserve" : "auto";
      spec().reserve_m ??= M.meta.stair_reserve_m ?? 100;
      if (el.checked)
        spec().reason =
        "User standard: stair cable run reserved at 100 m unless explicitly changed";
    });
    change("#iReserve", (el) => {
      spec().reserve_m = RFCore.number(el.value);
      spec().mode = "stair_reserve";
      spec().is_stair = true;
    });
    // stair code / From / To (user 2026-11-19: LT 編號要能改); the label line is built from these (rf-scene.js)
    change("#iStairNo", (el) => {
      e.stair ??= {};
      e.stair.location = el.value.trim().toUpperCase().replace(/\s+/g, "") || null;
      e.stair.user_edited = true;
    });
    change("#iStairFrom", (el) => {
      e.stair ??= {};
      e.stair.from = el.value.trim().toUpperCase() || null;
      e.stair.user_edited = true;
    });
    change("#iStairTo", (el) => {
      e.stair ??= {};
      e.stair.to = el.value.trim().toUpperCase() || null;
      e.stair.user_edited = true;
    });
    simplifyCableInspector(e);
    change("#iReason", (el) => (spec().reason = el.value));
    change("#iCadRef", (el) => (spec().cad_ref = el.value));
    change("#iVerified", (el) => {
      e.review_verified = el.checked;
      if (e.route_status === "legacy_only") e.cad_confirmed = el.checked;
    });
    change("#iLengthVerified", (el) => (spec().verified = el.checked));
    $("#reconnectA").onclick = () => beginReconnect(e.id, "a");
    $("#reconnectB").onclick = () => beginReconnect(e.id, "b");
    $("#iAuto").onclick = () => {
      snap();
      e.label = RFCore.nextConnectionLabel(M,e);
      e.name_basis = M.nodes[e.a]?.kind === "antenna" || M.nodes[e.b]?.kind === "antenna" ? "USER_JUMPER_RULE" : "USER_LINK_RULE";
      e.cad_ids = [e.label];
      draw();
    };
    $("#iDel").onclick = () => {
      snap();
      delete M.edges[e.id];
      sel = null;
      draw();
    };
    return;
  }
  const n = M.nodes[sel.id];
  let extra = "";
  if (n.kind === "device") {
    extra =
      `<div class="row"><span>Component</span><select id="iD">${DEVS.map(([k, t]) => `<option value="${k}" ${n.dev === k ? "selected" : ""}>${h(t)}</option>`).join("")}</select></div>` +
      componentPortInspector(n);
  }

  if (n.kind === "antenna")
    extra = `<div class="row"><span>Antenna</span><select id="iD"><option value="">Type unresolved</option>${ANTS.map(([k, t]) => `<option value="${k}" ${n.dev === k ? "selected" : ""}>${t}</option>`).join("")}</select></div><div class="row"><span>Jumper m</span><input id="iJ" type="number" min="0" step=".1" value="${n.jumper ?? 2}"></div>`;
  if (n.kind === "source")
    extra =
    RFCore.FREQ.map(
      (f) =>
      `<div class="row"><span>${f} MHz dBm</span><input data-power="${f}" type="number" step=".1" value="${h(n.power_dbm?.[f] ?? "")}" placeholder="unconfirmed"></div>`,
    ).join("") +
    '<p class="hint">Applicable power at this feed reference plane; no default ORU output is assumed.</p>';
  const reviewControls =
    (n.kind === "source" ?
      `<label class="hint"><input id="iFeedChecked" type="checkbox" ${n.source_status === "checked" ? "checked" : ""}> Floor feed reference plane checked</label>` :
      n.kind === "antenna" ?
      `<label class="hint"><input id="iConnectionChecked" type="checkbox" ${n.connection_verified ? "checked" : ""}> Antenna connection checked</label>` :
      "") +
    (M.meta.revision === "R05" ?
      `<label class="hint"><input id="iPositionChecked" type="checkbox" ${n.position_verified ? "checked" : ""}> CAD position checked</label>` :
      "");
  const connector =
    n.kind === "source" ?
    "" :
    `<div class="row"><span>Connectors</span><input id="iConn" type="number" min="0" step="1" value="${h(n.connector_count ?? "")}" placeholder="path count, if confirmed"></div>`;
  box.innerHTML = `<div class="row"><span>Kind</span><select id="iKind">${["junction", "source", "device", "antenna"].map((k) => `<option ${n.kind === k ? "selected" : ""}>${k}</option>`).join("")}</select></div><div class="row"><span>Name / ID</span><input id="iL" value="${h(n.label || "")}"></div>${extra}${reviewControls}${connector}${n.reference ? '<p class="hint">Reference: ' + h(typeof n.reference === "string" ? n.reference : [n.reference.file, n.reference.value_text, n.reference.handle].filter(Boolean).join(" · ")) + "</p>" : ""}<button class="btn" id="iDel">Delete node</button>`;
  for (const [id, field] of [
      ["iConnectionChecked", "connection_verified"],
      ["iPositionChecked", "position_verified"],
    ])
    if ($("#" + id))
      $("#" + id).onchange = (ev) => {
        snap();
        n[field] = ev.target.checked;
        draw();
      };
  if ($("#iFeedChecked"))
    $("#iFeedChecked").onchange = (ev) => {
      snap();
      n.source_status = ev.target.checked ?
        "checked" :
        "CAD_SHAFT_INTERFACE_REVIEW";
      draw();
    };
  $("#iKind").onchange = (ev) => {
    snap();
    n.kind = ev.target.value;
    if (n.kind === "source") {
      n.label = RFCore.nextSource(M);
      n.power_dbm ??= {};
    } else if (n.kind === "device") {
      n.dev ??= "SPL2";
      n.ports ??= {};
      n.device_status = "candidate";
      if (!n.label) n.label = RFCore.nextDevice(M, n.dev);
    } else if (n.kind === "antenna") {
      n.dev = GAINS_SAFE(n.dev);
      n.jumper ??= 2;
      if (!RFCore.parseId(n.label)) n.label = autoLabel("ANT");
    }
    draw();
  };
  $("#iL").onchange = (ev) => {
    snap();
    n.label = ev.target.value.trim();
    n.generated_label = false;
    draw();
  };
  if ($("#iDeviceVerified"))
    $("#iDeviceVerified").onchange = (ev) => {
      snap();
      n.device_status = ev.target.checked ? "checked" : "candidate";
      draw();
    };
  if ($("#iD"))
    $("#iD").onchange = (ev) => {
      snap();
      n.dev = ev.target.value;
      n.port_slots = {};
      draw();
    };
  if ($("#iJ"))
    $("#iJ").onchange = (ev) => {
      snap();
      n.jumper = RFCore.number(ev.target.value);
      draw();
    };
  if ($("#iConn"))
    $("#iConn").onchange = (ev) => {
      snap();
      n.connector_count = RFCore.number(ev.target.value);
      draw();
    };
  bindComponentPorts(n);
  document.querySelectorAll("[data-port]").forEach(
    (el) =>
    (el.onchange = (ev) => {
      snap();
      n.ports ??= {};
      n.ports[el.dataset.port] = ev.target.value;
      draw();
    }),
  );
  simplifyNodeInspector();
  document.querySelectorAll("[data-power]").forEach(
    (el) =>
    (el.onchange = () => {
      snap();
      n.power_dbm ??= {};
      n.power_dbm[el.dataset.power] = RFCore.number(el.value);
      draw();
    }),
  );
  if ($("#iAuto2"))
    $("#iAuto2").onclick = () => {
      snap();
      autoPorts();
      draw();
    };
  $("#iDel").onclick = () => {
    snap();
    delNode(n.id);
    sel = null;
    draw();
  };
}

function GAINS_SAFE(k) {
  return RFCore.GAINS[k] ? k : "Dome";
}

function cableTable() {
  const a = RFCore.analyze(M);
  return [
    [
      "Edge",
      "Cable ID H",
      "Cable ID L",
      "Cable",
      "Source",
      "From",
      "To",
      "Selected m",
      "Basis",
      "CAD m",
      "Drawn m",
      "CAD delta m",
      "CAD reference",
      "Stair reserve",
      "Review",
    ],
    ...Object.values(M.edges).map((e) => {
      const L = lengthInfo(e),
        p = RFCore.labels(M, e);
      return [
        e.id,
        p.find((v) => v.includes("-H-")) ||
        (!p.some((v) => v.includes("-L-")) ? p[0] : "") ||
        "",
        p.find((v) => v.includes("-L-")) || "",
        CABLE[e.cable]?.n || e.cable,
        a.nodeComponent[e.a]?.sources
        .map((id) => M.nodes[id].label || id)
        .join(" / "),
        nodeName(M.nodes[e.a]),
        nodeName(M.nodes[e.b]),
        L.value,
        L.source,
        L.cad_m,
        L.geometry_m,
        L.delta_m,
        L.ref,
        L.is_reserve ? "YES" : "",
        e.cad_confirmed ?
        "CAD route checked" :
        e.route_status === "legacy_only" ?
        "Legacy route; CAD check pending" :
        e.review_verified ?
        "checked" :
        e.review || "",
      ];
    }),
  ];
}

function budgetTable() {
  return [
    [
      "Source ID",
      "Source name",
      "Endpoint",
      "MHz",
      "State",
      "Cable loss dB",
      "Passive loss dB",
      "Jumper loss dB",
      "Subtotal dB",
      "Connectors",
      "Connector loss dB",
      "Path loss dB",
      "Source dBm",
      "Terminal dBm",
      "Gain dBi",
      "EIRP dBm",
      "Path edges",
      "Issues",
    ],
    ...budgetRows().flatMap((r) =>
      RFCore.FREQ.map((f) => {
        const c = RFCore.calculate(M, r, f);
        return [
          c.source_id,
          c.source_label,
          r.label,
          f,
          c.status,
          c.cable_loss_db,
          c.passive_loss_db,
          c.jumper_loss_db,
          c.subtotal_loss_db,
          c.connector_count,
          c.connector_loss_db,
          c.path_loss_db,
          c.source_dbm,
          c.terminal_dbm,
          c.gain_dbi,
          c.eirp_dbm,
          r.path_edge_ids.join(" > "),
          r.issues.map((i) => i.code + ": " + i.item).join("; "),
        ];
      }),
    ),
  ];
}
$("#topoSheet").onclick = () =>
  CURRENT_TOPO &&
  setTopoZoom(
    Math.min(
      ($("#topowrap").clientWidth - 45) / CURRENT_TOPO.width,
      ($("#topowrap").clientHeight - 45) / CURRENT_TOPO.height,
    ),
  );
$("#topoFit").onclick = () =>
  CURRENT_TOPO &&
  setTopoZoom(($("#topowrap").clientWidth - 45) / CURRENT_TOPO.width);
$("#topo100").onclick = () => setTopoZoom(1);
$("#topoPlus").onclick = () => setTopoZoom(topoZoom * 1.25);
$("#topoMinus").onclick = () => setTopoZoom(topoZoom / 1.25);
for (const kind of ["COX", "ANT", "LCK"])
  $("#name" + kind).onchange = (ev) => {
    const value = ev.target.value.trim().toUpperCase();
    if (!/^[A-Z]*$/.test(value)) {
      msg("Suffix prefix uses letters only, or stays empty");
      syncProjectControls();
      return;
    }
    snap();
    M.meta.naming ??= {};
    M.meta.naming[kind] = {
      letter: value,
      width: 3
    };
    draw();
  };
$("#stairDefault").onchange = (ev) => {
  const v = RFCore.number(ev.target.value);
  if (v == null || v < 0) return;
  snap();
  M.meta.stair_reserve_m = v;
  draw();
};
async function layoutWithCadBackground() {
  return visibleLayoutScene();
}
$("#expPdf").onclick = () => exportLayoutPDF();
$("#fitFloor").onclick = () => {
  fitCompleteSheet();
  draw();
  paint();
};
$("#focusSelected").onclick = () => {
  if (!sel) return msg("Select a component, antenna or cable first");
  const r = $("#stage").getBoundingClientRect(),
    p = M.nodes[sel.id] ?
    visualNode(sel) :
    sel.pts[Math.floor(sel.pts.length / 2)];
  view.z = Math.max(
    view.z,
    M.meta.coordinate_transform ? 12 / (M.meta.layout_base_font_px || 18) : 2,
  );
  view.x = r.width / 2 - p[0] * view.z;
  view.y = r.height / 2 - p[1] * view.z;
  applyView();
  draw();
  paint();
};
$("#insertDeviceType").onchange = () => {
  if (tool !== "device") setTool("device");
};

function downloadCurrentSvg() {
  const t = CURRENT_TOPO;
  if (t)
    dl(
      new Blob([t.svg], {
        type: "image/svg+xml"
      }),
      fname(t.kind || "Drawing", "svg"),
    );
}

function downloadCurrentPdf() {
  return exportLinePDF();
}
$("#topoPdf").onclick = downloadCurrentPdf;
let CAD_BUNDLE_DOC = null,
  CLEAN_CAD_BUNDLE_DOC = null,
  CLEAN_BUNDLE_PDF_BYTES = null;
async function useCADBackground() {
  const mode = M.meta.cad_background_mode || "original";
  if (mode === "clean" && RFCADUnderlay.clean_base64 && !CLEAN_CAD_BUNDLE_DOC) {
    CLEAN_BUNDLE_PDF_BYTES = Uint8Array.from(atob(RFCADUnderlay.clean_base64), c => c.charCodeAt(0));
    CLEAN_CAD_BUNDLE_DOC = await pdfjsLib.getDocument({
      data: CLEAN_BUNDLE_PDF_BYTES.slice()
    }).promise;
  }
  pdfDoc = mode === "clean" && CLEAN_CAD_BUNDLE_DOC ? CLEAN_CAD_BUNDLE_DOC : CAD_BUNDLE_DOC;
  ACTIVE_PDF_BYTES = mode === "clean" && CLEAN_CAD_BUNDLE_DOC ? CLEAN_BUNDLE_PDF_BYTES : BUNDLE_PDF_BYTES;
  activeUnderlayFile = RFCADUnderlay.file;
  $("#cadBackgroundMode").value = mode;
  $("#page").max = pdfDoc.numPages;
  $("#page").value = M.meta.cad_pdf_registration.bundle_page_index;
  $("#page").disabled = true;
  await renderPage();
}
$("#cadBackgroundMode").onchange = async ev => {
  snap();
  M.meta.cad_background_mode = ev.target.value;
  await useCADBackground();
  draw();
};
const WORKING_FLOORS = {};
async function openReviewFloor(f) {
  if (!window.RFProjectCatalog?.[f] && !WORKING_FLOORS[f]) return;
  if (draftBefore != null) cancelDraft();
  if (
    M.meta.floor &&
    M.meta.coordinate_transform &&
    M.meta.cad_pdf_registration?.bundle_source_file ===
    window.RFCADUnderlay?.file &&
    Object.keys(M.nodes || {}).length &&
    RFProjectCatalog[M.meta.floor]
  )
    WORKING_FLOORS[M.meta.floor] = structuredClone(M);
  const project = structuredClone(WORKING_FLOORS[f] || RFProjectCatalog[f]);
  loadProject(project);
  if (CAD_BUNDLE_DOC) {
    await useCADBackground();
  }
  return M;
}
$("#reviewFloor").onchange = () => openReviewFloor($("#reviewFloor").value);
// floor picker: the catalog's floors bottom to top (B4 … L5M2), not in catalog order (user 2026-11-18); unknown floors go
// last. Called again when a project pack brings other floors (project-studio.js).
function refreshFloorPicker() {
  if (!window.RFProjectCatalog) return;
  const pick = document.querySelector('#reviewFloor'), UP = ['B4','B3','B2','B1','LG','L1','L1M','L2','L3','L3M','L4','L4M1','L4M2','L5','L5M1','L5M2'],
    rank = (f) => (UP.includes(f) ? UP.indexOf(f) : UP.length);
  pick.replaceChildren(...Object.keys(RFProjectCatalog).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).map((f) => new Option(f, f)));
  if (M?.meta?.floor && RFProjectCatalog[M.meta.floor]) pick.value = M.meta.floor;
}
// CAD underlay (a multi-page PDF, one page per floor, as base64): built into the tool (cad-underlay*.js) or carried by a
// project pack saved with 儲存全專案（含底圖） (user 2026-11-19: one tool, the drawings come with the project)
async function loadCADUnderlay(u) {
  window.RFCADUnderlay = u;
  const raw = atob(u.base64), bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  BUNDLE_PDF_BYTES = bytes.slice();
  ACTIVE_PDF_BYTES = bytes.slice();
  CAD_BUNDLE_DOC = await pdfjsLib.getDocument({ data: bytes }).promise;
  CLEAN_CAD_BUNDLE_DOC = null; CLEAN_BUNDLE_PDF_BYTES = null;
}
async function initializeReviewCatalog() {
  // CAD1102_DYNAMIC_FLOORS
  refreshFloorPicker();
  if (window.RFCADUnderlay?.building_only) { const opt=document.querySelector('#cadBackgroundMode option[value="original"]'); if(opt){opt.disabled=false;opt.textContent='Full drawing';} const clean=document.querySelector('#cadBackgroundMode option[value="clean"]');if(clean)clean.textContent='Building only'; }
  if (!window.RFProjectCatalog) return;
  const initial = new URLSearchParams(location.search).get("floor") || "L4";
  await openReviewFloor(RFProjectCatalog[initial] ? initial : Object.keys(RFProjectCatalog)[0]);
  if (window.RFCADUnderlay?.base64) {
    msg("Loading registered CAD backgrounds...");
    await loadCADUnderlay(window.RFCADUnderlay);
    await openReviewFloor(M.meta.floor);
    msg(M.meta.floor === "L1" ? "Review: see the project workbook for remaining engineering conflicts" : "CAD background aligned; Building only removes original RF artwork");
    if (M.meta.floor === "L1") $("#fitNetwork").click();
  }
}

window.RFReview = {
  setModel: (m) => loadProject(m),
  getModel: () => M,
  getUnderlay: () => ({
    loaded: !!pdfPage,
    file: activeUnderlayFile,
    rendered:
      !!pdfPage &&
      (!M.meta.cad_pdf_registration ||
        (LAST_CAD_PAINT?.floor === M.meta.floor &&
          LAST_CAD_PAINT?.file === activeUnderlayFile &&
          LAST_CAD_PAINT?.page === pageNum)),
  }),
  parseLengthM,
  lengthInfo,
  portCheck,
  validateModel,
  budgetRows,
  core: RFCore,
  render: RFRender,
  showTopology,
  select: (id) => {
    sel = M.nodes[id] || M.edges[id];
    draw();
  },
  splitEdge,
  screenPoint: (xy) => {
    const r = $("#pdf").getBoundingClientRect();
    return [r.left + xy[0] * view.z, r.top + xy[1] * view.z];
  },
  visualNode,
  visualPoints,
  planK,
  layoutWithCadBackground,
  openFloor: openReviewFloor,
  exportXlsx: exportWorkbook,
};
