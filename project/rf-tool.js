/* Focused editor, viewport rendering, direct reconnection and vector PDF output. */
"use strict";
let ACTIVE_PDF_BYTES = null,
  BUNDLE_PDF_BYTES = null,
  DETAIL_VIEW = null,
  DETAIL_TASK = null,
  DETAIL_SEQ = 0,
  DETAIL_TIMER = null,
  LAST_SCENE = null,
  SCENE_KEY = "",
  RECONNECT = null;
const LINE_LABEL_DEFAULTS = Object.fromEntries([
  "nameCOX12", "lengthCOX12", "nameCOX114", "lengthCOX114",
  "nameLCK", "lengthLCK", "nameUNRESOLVED", "lengthUNRESOLVED",
  "antenna", "device", "ports", "source", "stairs", "legend"
].map(key => [key, true]));
let LINE_LABELS = { ...LINE_LABEL_DEFAULTS };
const toolLayerDefaults = {
  background: 1,
  symSource: 1,
  symAnt: 1,
  symDev: 1,
  cabLCK: 1,
  cabCOX12: 1,
  cabCOX114: 1,
  cabUNRESOLVED: 1,
  lblAnt: 1,
  lblDev: 1,
  lblSource: 1,
  lblLCK: 1,
  lblCOX12: 1,
  lblCOX114: 1,
  lblUNRESOLVED: 1,
  lblLen: 1,
  legend: 1,
  flagOrphan: 0,
  rxWarnings: 0,
};
function saveViewSettings() {
  M.meta.tool_settings = {
    ...(M.meta.tool_settings || {}),
    line_labels: { ...LINE_LABELS },
    label_size: UI.font,
    symbol_size: UI.sym,
    layers: { ...VIS },
    labels: showLbl,
  };
}
function restoreViewSettings() {
  RECONNECT = null;
  CURRENT_TOPO = null;
  tool = "select";
  draft = null;
  scalePts = [];
  for (const b of document.querySelectorAll("[data-tool]"))
    b.setAttribute("aria-pressed", b.dataset.tool === "select");
  $("#stage").style.cursor = "default";
  const s = M.meta.tool_settings || {};
  LINE_LABELS = { ...LINE_LABEL_DEFAULTS, ...s.line_labels };
  syncLineLabelControls();
  UI.font = s.label_size ?? UI.font;
  UI.sym = s.symbol_size ?? UI.sym;
  Object.assign(VIS, toolLayerDefaults, s.layers || {});
  showLbl = s.labels !== false;
  for (const id of ["uiFont", "uiFontNumber", "topoFont"])
    if ($("#" + id)) $("#" + id).value = UI.font;
  $("#uiSym").value = UI.sym;
  for (const el of document.querySelectorAll("[data-vis]"))
    el.checked = !!VIS[el.dataset.vis];
  SCENE_KEY = "";
  DETAIL_VIEW = null;
  $("#detailPdf")
    .getContext("2d")
    .clearRect(0, 0, $("#detailPdf").width, $("#detailPdf").height);
}
function setLabelSize(value) {
  const f = Math.min(28, Math.max(4, Number(value) || 9));
  UI.font = f;
  for (const id of ["uiFont", "uiFontNumber", "topoFont"])
    $("#" + id).value = f;
  M.meta.layout_font_px = ((M.meta.layout_base_font_px || 18) * f) / 9;
  saveViewSettings();
  draw();
  if ($("#topo").style.display === "flex") showTopology();
}
function sceneFont() {
  return M.meta.coordinate_transform
    ? ((M.meta.layout_base_font_px || 18) * UI.font) / 9
    : UI.font;
}
function drawToolScene() {
  RFDesign.normalize(M);
  $("#detailPdf").style.opacity = M.meta.background_opacity ?? 1;
  if($("#backgroundOpacity")&&document.activeElement!==$("#backgroundOpacity"))$("#backgroundOpacity").value=M.meta.background_opacity??1;
  syncProjectControls();
  const font = sceneFont(),
    symbol = planK(),
    key = JSON.stringify([
      PAGE,
      font,
      symbol,
      showLbl,
      VIS,
      M.nodes,
      M.edges,
      M.meta.label_positions?.layout,
      M.meta.legend_position,
      M.meta.rx_threshold_dbm,
    ]);
  if (key !== SCENE_KEY) {
    LAST_SCENE = RFScene.render(M, {
      width: PAGE.w || 3000,
      height: PAGE.h || 2000,
      font,
      symbol,
      vis: VIS,
      labels: showLbl,
    });
    SCENE_KEY = key;
  }
  const root = new DOMParser().parseFromString(
    LAST_SCENE.svg,
    "image/svg+xml",
  ).documentElement;
  svg.innerHTML = root.innerHTML;
  if (!pdfPage || !VIS.background)
    svg.prepend(
      el("rect", {
        x: 0,
        y: 0,
        width: PAGE.w || 3000,
        height: PAGE.h || 2000,
        fill: "white",
      }),
    );
  $("#detailPdf").style.visibility =
    pdfPage && VIS.background ? "visible" : "hidden";
  const k = planK(),
    hk = Math.max(k, 1.2 / view.z);
  if (sel && M.nodes[sel.id]) {
    const [x, y] = visualNode(sel);
    svg.append(
      el("circle", {
        "data-editor-overlay": "selection",
        cx: x,
        cy: y,
        r: 12 * hk,
        stroke: "#d69b19",
        "stroke-width": 1 / view.z,
        fill: "none",
        "pointer-events": "none",
      }),
    );
  }
  if (sel && M.edges[sel.id] && tool === "select") {
    const ps = visualPoints(sel);
    svg.append(
      el("path", {
        "data-editor-overlay": "selection",
        d: "M" + ps.map((p) => p.join(" ")).join(" L"),
        stroke: "#d59d20",
        "stroke-width": 5 / view.z,
        opacity: 0.3,
        fill: "none",
        "pointer-events": "none",
      }),
    );
    // bend points of the selected cable: square handles, drag to move (Shift: horizontal / vertical to the previous point),
    // double-click a handle to remove it, double-click the cable to add one (user 2026-11-19: 轉彎節點移動不了)
    const raw = M.edges[sel.id].pts || [];
    for (let i = 1; i < raw.length - 1; i++)
      svg.append(
        el("rect", {
          "data-editor-overlay": "bend",
          "data-bend-edge": sel.id,
          "data-bend-i": i,
          x: raw[i][0] - 4 / view.z,
          y: raw[i][1] - 4 / view.z,
          width: 8 / view.z,
          height: 8 / view.z,
          fill: "#ffffff",
          stroke: "#b07a11",
          "stroke-width": 1.5 / view.z,
          style: "pointer-events:all;cursor:move",
        }),
      );
    for (const end of ["a", "b"]) {
      const p = end === "a" ? ps[0] : ps.at(-1);
      svg.append(
        el("circle", {
          "data-editor-overlay": "reconnect",
          "data-reconnect-edge": sel.id,
          "data-end": end,
          cx: p[0],
          cy: p[1],
          r: 6 / view.z,
          fill: "#fff6d7",
          stroke: "#b07a11",
          "stroke-width": 1.7 / view.z,
          style: "pointer-events:all;cursor:crosshair",
        }),
      );
    }
  }
  for (const n of Object.values(M.nodes))
    if (
      n.kind === "device" &&
      VIS.symDev &&
      (tool === "draw" || RECONNECT || sel?.id === n.id)
    ) {
      const [x, y] = visualNode(n);
      for (const p of RFPlan.ports(M, n, k, hk)) {
        const g = el("g", {
          "data-editor-overlay": "port",
          "data-connect-node": n.id,
          "data-connect-slot": p.slot,
          "data-connect-role": p.role,
          style: "cursor:crosshair",
        });
        g.append(
          el("path", {
            d: `M${x},${y}L${p.x},${p.y}`,
            stroke: "#8296a4",
            "stroke-width": 0.7 / view.z,
            "pointer-events": "none",
          }),
          el("circle", {
            cx: p.x,
            cy: p.y,
            r: 4 * hk,
            fill: p.edge ? portColor[p.role] : "white",
            stroke: portColor[p.role],
            "stroke-width": 1.2 / view.z,
          }),
        );
        const t = el("text", {
          x: p.x + (p.slot === "IN" ? -7 : 7) * hk,
          y: p.y + (p.slot === "COUPLED" ? 11 : -6) * hk,
          "font-size": 10 / view.z,
          "text-anchor": p.slot === "IN" ? "end" : "start",
          fill: portColor[p.role],
          stroke: "white",
          "stroke-width": 2 / view.z,
          "paint-order": "stroke",
          "pointer-events": "none",
        });
        t.textContent = p.slot;
        g.append(t);
        svg.append(g);
      }
    }
  if (hover) {
    svg.append(
      el("circle", {
        "data-editor-overlay": "hover",
        cx: hover[0],
        cy: hover[1],
        r: 6 / view.z,
        stroke: "#d59d20",
        "stroke-width": 1.2 / view.z,
        fill: "none",
        "pointer-events": "none",
      }),
    );
  }
  if (draft?.pts?.length) {
    const ps = draft.pts.concat(draft.cur ? [draft.cur] : []);
    svg.append(
      el("path", {
        "data-editor-overlay": "draft",
        d: "M" + ps.map((p) => p.join(" ")).join(" L"),
        fill: "none",
        stroke: RFCore.CABLE[cable]?.color || "#465c98",
        "stroke-width": 1.5 / view.z,
        "stroke-dasharray": `${4 / view.z} ${3 / view.z}`,
        "pointer-events": "none",
      }),
    );
  }
  if (scalePts.length)
    for (const p of scalePts)
      svg.append(
        el("circle", {
          "data-editor-overlay": "scale",
          cx: p[0],
          cy: p[1],
          r: 3 / view.z,
          fill: "#d59d20",
        }),
      );
  $("#sNodes").textContent = Object.keys(M.nodes).length;
  $("#sEdges").textContent = Object.keys(M.edges).length;
  $("#sScale").textContent = M.meta.scale
    ? (1 / M.meta.scale).toFixed(2) + " pt/m"
    : "未設定";
  $("#sOrph").textContent = "";
  $("#labelFeedback").textContent = LAST_SCENE.report.conflicts
    ? `標籤重疊 ${LAST_SCENE.report.conflicts} 處：可拖動、調小字體或按自動排位`
    : "";
  stats();
  inspect();
}
function updatePDFPreview() {
  const cv = $("#detailPdf");
  if (DETAIL_VIEW) {
    const q = view.z / DETAIL_VIEW.z;
    cv.style.transform = `translate(${view.x - DETAIL_VIEW.x * q}px,${view.y - DETAIL_VIEW.y * q}px) scale(${q})`;
  }
  clearTimeout(DETAIL_TIMER);
  if (pdfPage) DETAIL_TIMER = setTimeout(() => paintVisiblePDF(), 90);
}
async function paintVisiblePDF() {
  clearTimeout(DETAIL_TIMER);
  DETAIL_TIMER = null;
  if (!pdfPage || !VIS.background) return;
  const ticket = ++DETAIL_SEQ;
  if (DETAIL_TASK)
    try {
      DETAIL_TASK.cancel();
    } catch (e) {}
  const stage = $("#stage"),
    ratio = Math.min(3, Math.max(2, (window.devicePixelRatio || 1) * 1.5)),
    w = stage.clientWidth,
    h = stage.clientHeight,
    off = document.createElement("canvas");
  off.width = Math.ceil(w * ratio);
  off.height = Math.ceil(h * ratio);
  const f = M.meta.cad_pdf_registration?.pdf_to_canvas || [1, 0, 0, 1, 0, 0],
    v = { ...view },
    transform = [
      f[0] * v.z * ratio,
      f[1] * v.z * ratio,
      f[2] * v.z * ratio,
      f[3] * v.z * ratio,
      (f[4] * v.z + v.x) * ratio,
      (f[5] * v.z + v.y) * ratio,
    ],
    page = pdfPage;
  const ctx = off.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, off.width, off.height);
  ctx.beginPath();
  const sheet = completeSheetBounds();
  ctx.rect(
    (v.x + sheet[0] * v.z) * ratio,
    (v.y + sheet[1] * v.z) * ratio,
    sheet[2] * v.z * ratio,
    sheet[3] * v.z * ratio,
  );
  ctx.clip();
  const task = page.render({
    canvasContext: ctx,
    viewport: page.getViewport({ scale: 1 }),
    transform,
    background: "rgb(255,255,255)",
  });
  DETAIL_TASK = task;
  try {
    await task.promise;
  } catch (error) {
    if (error.name !== "RenderingCancelledException")
      msg("PDF: " + error.message);
    return;
  }
  if (ticket !== DETAIL_SEQ || page !== pdfPage) return;
  const cv = $("#detailPdf");
  cv.width = off.width;
  cv.height = off.height;
  cv.style.width = w + "px";
  cv.style.height = h + "px";
  cv.style.transform = "none";
  cv.getContext("2d").drawImage(off, 0, 0);
  DETAIL_VIEW = v;
  DETAIL_TASK = null;
  LAST_CAD_PAINT = {
    floor: M.meta.floor,
    file: activeUnderlayFile,
    page: pageNum,
  };
}
function visibleLayoutScene() {
  draw();
  const root = svg.cloneNode(true);
  root.querySelectorAll("[data-editor-overlay]").forEach((el) => el.remove());
  root.querySelectorAll("text").forEach((el) => {
    el.setAttribute("stroke", "none");
    el.removeAttribute("stroke-width");
    el.style.pointerEvents = "none";
  });
  return {
    svg: new XMLSerializer().serializeToString(root),
    width: PAGE.w,
    height: PAGE.h,
    report: LAST_SCENE.report,
  };
}
function beginReconnect(eid, end) {
  cancelDraft();
  RECONNECT = { eid, end };
  setTool("select");
  draw();
  msg("Click a component port, node or another cable to reconnect");
}
function findPortAt(p) {
  const k = planK(),
    hk = Math.max(k, 1.2 / view.z);
  let best = null;
  for (const n of Object.values(M.nodes))
    if (n.kind === "device" && VIS.symDev)
      for (const slot of RFPlan.ports(M, n, k, hk)) {
        const d = Math.hypot(slot.x - p[0], slot.y - p[1]);
        if (d < 9 / view.z && (!best || d < best.d))
          best = { d, node: n, ...slot };
      }
  return best;
}
function connectTarget(p, eid, skip = new Set()) {
  const port = findPortAt(p);
  if (port) return { node: port.node, role: port.role, slot: port.slot };
  const nn = nearestNode(p, 14 / view.z, skip);
  if (!nn) return null;
  const n = nn.node,
    free = RFPlan.ports(M, n).filter((s) => !s.edge || s.edge === eid);
  return {
    node: n,
    role: free.length === 1 ? free[0].role : "",
    slot: free.length === 1 ? free[0].slot : "",
  };
}
function finishReconnect(p, eid, end) {
  let target = connectTarget(p, eid, new Set(M.nodes[M.edges[eid][end]]?.kind==='junction'?[M.edges[eid][end]]:[]));
  try {
    if (!target) {
      const hit = nearestOtherEdge(p, new Set([eid]));
      return msg(hit?'Insert a coupler or splitter on this cable, then connect to its free port.':'Choose a free component port, antenna IN, or cable endpoint.');
    }
    RFEdit.reconnect(M, eid, end, target.node, target.role, target.slot);
    sel = M.edges[eid];
    RECONNECT = null;
    draw();
    msg("Cable reconnected; name and selected length retained");
  } catch (e) {
    msg(e.message);
  }
}
function finishNodeDrop(n, p) {
  const es = edgesAt(n.id),
    near = nearestOtherEdge(p, new Set(es.map((e) => e.id)));
  if (
    n.kind === "device" &&
    near &&
    !es.some((e) => e.id === near.edge.id) &&
    es.length + 2 <= RFEdit.capacity(n)
  ) {
    try {
      RFEdit.split(M, near.edge.id, near.seg, near.pt, { node: n });
      sel = n;
      reseed();
      draw();
      msg("Component inserted into the existing cable — run length retained");
    } catch (e) {
      msg(e.message);
    }
    return;
  }
  if(n.kind==='junction'&&es.length===1)finishReconnect(p,es[0].id,es[0].a===n.id?'a':'b');

}
function startLabelDrag(ev, node, root, scope) {
  ev.preventDefault();
  ev.stopImmediatePropagation();
  snap();
  const key = node.getAttribute("data-label-key"),
    b = RFLabels.bounds(root, node),
    anchor = node.getAttribute("data-anchor").split(",").map(Number),
    start = [ev.clientX, ev.clientY],
    z = scope === "layout" ? view.z : topoZoom,
    originalTransform = node.getAttribute("transform") || "";
  let moved = false;
  const move = (e) => {
    const dx = (e.clientX - start[0]) / z,
      dy = (e.clientY - start[1]) / z;
    if (Math.hypot(dx, dy) < 1 && !moved) return;
    moved = true;
    M.meta.label_positions ??= {};
    M.meta.label_positions[scope] ??= {};
    M.meta.label_positions[scope][key] = {
      left: b[0] + dx - anchor[0],
      top: b[1] + dy - anchor[1],
    };
    node.setAttribute(
      "transform",
      `translate(${dx} ${dy}) ${originalTransform}`,
    );
  };
  const up = () => {
    removeEventListener("mousemove", move);
    removeEventListener("mouseup", up);
    if (!moved) {
      HIST.pop();
      // a TestPoint card: edit it (testpoint-edit.js)
      if (scope === "layout" && node.hasAttribute("data-tp") && window.RFTestPointEdit) return RFTestPointEdit.select(node.getAttribute("data-tp"));
      if (scope === "layout") {
        const nid = node.getAttribute("data-n"),
          eid = node.getAttribute("data-e");
        sel = M.nodes[nid] || M.edges[eid] || sel;
        inspect();
      }
    } else if (scope === "layout") draw();
    else {
      const z0 = topoZoom;
      showTopology();
      setTopoZoom(z0);
    }
  };
  addEventListener("mousemove", move);
  addEventListener("mouseup", up);
}
$("#stage").addEventListener(
  "mousedown",
  (ev) => {
    if (ev.button !== 0 || ev.altKey || ev.target.closest("#canvasbar")) return;
    // TestPoint pin / measured-point diamond: drag moves the point (testpoint-edit.js)
    const tpPoint = ev.target.closest("[data-tp-point]");
    if (tpPoint && tool === "select" && !RECONNECT && window.RFTestPointEdit) return RFTestPointEdit.startPointDrag(ev, tpPoint);
    const label = ev.target.closest(".rf-label");
    if (label && tool === "select" && !RECONNECT) {
      startLabelDrag(ev, label, svg, "layout");
      return;
    }
    const endpoint = ev.target.closest("[data-reconnect-edge]");
    if (endpoint) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      const eid = endpoint.dataset.reconnectEdge,
        end = endpoint.dataset.end;
      snap();
      RECONNECT = { eid, end, dragging: true };
      draw();
      const p0 = toLocal(ev),
        edge = M.edges[eid],
        i = end === "a" ? 0 : edge.pts.length - 1,
        original = [...edge.pts[i]];
      let moved = false;
      const mv = (e) => {
        const p = toLocal(e);
        if (dist(p, p0) > 2 / view.z) moved = true;
        edge.pts[i] = p;
        const ps = edge.pts;
        const overlay = svg.querySelector('[data-editor-overlay="selection"]');
        if (overlay)
          overlay.setAttribute(
            "d",
            "M" + ps.map((p) => p.join(" ")).join(" L"),
          );
        const handle = svg.querySelector(
          '[data-reconnect-edge="' + eid + '"][data-end="' + end + '"]',
        );
        if (handle) {
          handle.setAttribute("cx", p[0]);
          handle.setAttribute("cy", p[1]);
        }
      };
      const up = (e) => {
        removeEventListener("mousemove", mv);
        removeEventListener("mouseup", up);
        edge.pts[i] = original;
        if (moved) {
          finishReconnect(toLocal(e), eid, end);
          RECONNECT = null;
        } else beginReconnect(eid, end);
        draw();
      };
      addEventListener("mousemove", mv);
      addEventListener("mouseup", up);
      return;
    }
    if (RECONNECT) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      snap();
      finishReconnect(toLocal(ev), RECONNECT.eid, RECONNECT.end);
      return;
    }
  },
  true,
);
for (const event of ["mousedown", "wheel", "dblclick"])
  $("#canvasbar")?.addEventListener(event, (e) => e.stopPropagation());
$("#arrangeLabels").onclick = () => {
  snap();
  M.meta.label_positions ??= {};
  M.meta.label_positions.layout = {};
  draw();
  msg("Labels automatically arranged");
};
$("#arrangeTopoLabels").onclick = () => {
  snap();
  M.meta.label_positions ??= {};
  M.meta.label_positions.topology = {};
  showTopology();
};
function syncLineLabelControls() {
  for (const el of document.querySelectorAll("[data-line-label]"))
    el.checked = LINE_LABELS[el.dataset.lineLabel] !== false;
}
for (const el of document.querySelectorAll("[data-line-label]"))
  el.onchange = () => {
    LINE_LABELS[el.dataset.lineLabel] = el.checked;
    saveViewSettings();
    showTopology();
  };
for (const el of document.querySelectorAll("[data-line-label-all]"))
  el.onclick = () => {
    for (const key of Object.keys(LINE_LABEL_DEFAULTS))
      LINE_LABELS[key] = el.dataset.lineLabelAll === "show";
    syncLineLabelControls();
    saveViewSettings();
    showTopology();
  };
function buildToolTopology() {
  saveViewSettings();
  const r = RFLine.render(M),
    doc = new DOMParser().parseFromString(r.svg, "image/svg+xml"),
    root = doc.documentElement,
    ratio = UI.font / 9;
  for (const g of [...root.querySelectorAll("[data-edge-id]")]) {
    const e = M.edges[g.getAttribute("data-edge-id")];
    if (e && !VIS["cab" + e.cable]) {
      g.remove();
      continue;
    }

  }
  for (const g of [...root.querySelectorAll("[data-node-id]")]) {
    const n = M.nodes[g.getAttribute("data-node-id")];
    if (!n) continue;
    if (
      (n.kind === "device" && !VIS.symDev) ||
      (n.kind === "antenna" && !VIS.symAnt) ||
      (n.kind === "source" && !VIS.symSource)
    ) {
      g.remove();
      continue;
    }

  }
  for (const g of root.querySelectorAll("[data-node-id]")) {
    const node = M.nodes[g.getAttribute("data-node-id")];
    if (node && LINE_LABELS[node.kind] === false)
      g.querySelectorAll("text[data-n]").forEach(t => t.remove());
    if (LINE_LABELS.ports === false)
      g.querySelectorAll("text[data-port]").forEach(t => t.remove());
  }
  if (LINE_LABELS.source === false)
    root.querySelectorAll("[data-source-caption]").forEach(t => t.remove());
  if (LINE_LABELS.legend === false)
    root.querySelectorAll("[data-legend]").forEach(g => g.remove());
  for (const t of root.querySelectorAll(
    "[data-node-id] text,[data-edge-id] text",
  )) {
    const f = Number(t.getAttribute("font-size"));
    if (f) t.setAttribute("font-size", f * ratio);
    for (const sp of t.querySelectorAll("tspan[dy]"))
      sp.setAttribute("dy", Number(sp.getAttribute("dy")) * ratio);
  }
  if(!VIS.rxWarnings)root.querySelectorAll('[data-rx-warning]').forEach(g=>g.remove());
  const placed = RFLabels.resolve(
    new XMLSerializer().serializeToString(root),
    M,
    "topology",
  );
  return { ...r, ...placed };
}
function bindTopologyLabels() {
  const root = $("#topowrap > svg");
  for (const t of root.querySelectorAll(".rf-label"))
    t.addEventListener("mousedown", (ev) => {
      if (ev.button === 0) startLabelDrag(ev, t, root, "topology");
    });
}
addEventListener("keydown", (e) => {
  if (e.key === "Escape" && RECONNECT) {
    RECONNECT = null;
    draw();
    msg("Reconnection cancelled");
  }
});
function nearestOtherEdge(p, excluded, tol = 14 / view.z) {
  let best = null;
  for (const e of Object.values(M.edges)) {
    if (excluded.has(e.id) || !edgeShown(e)) continue;
    const ps = visualPoints(e);
    for (let i = 1; i < ps.length; i++) {
      const q = projSeg(p, ps[i - 1], ps[i]);
      if (q.d < tol && (!best || q.d < best.d))
        best = {
          d: q.d,
          edge: e,
          seg: i,
          pt: projSeg(p, e.pts[i - 1], e.pts[i]).p,
        };
    }
  }
  return best;
}
window.RFTool = {
  scene: visibleLayoutScene,
  getLabelReport: () => LAST_SCENE?.report,
  draw: () => draw(),
  setLabelSize,
  exportLayoutPDF,
  exportLinePDF,
  buildTopology: buildToolTopology,
  edit: RFEdit,
  getPDFRender: () => ({
    width: $("#detailPdf").width,
    height: $("#detailPdf").height,
    view: DETAIL_VIEW,
  }),
  getView: () => ({ ...view }),
};

$("#insertDeviceType").innerHTML = DEVS.filter(
  (d) => d[0] !== "PASSIVE_UNKNOWN",
)
  .map((d) => '<option value="' + d[0] + '">' + d[1] + "</option>")
  .join("");

function updateInteractionOverlays() {
  for (const e of svg.querySelectorAll(
    '[data-editor-overlay="hover"],[data-editor-overlay="draft"],[data-editor-overlay="scalePreview"]',
  ))
    e.remove();
  if (hover)
    svg.append(
      el("circle", {
        "data-editor-overlay": "hover",
        cx: hover[0],
        cy: hover[1],
        r: 6 / view.z,
        stroke: "#d59d20",
        "stroke-width": 1.2 / view.z,
        fill: "none",
        "pointer-events": "none",
      }),
    );
  if (draft?.pts?.length) {
    const ps = draft.pts.concat(draft.cur ? [draft.cur] : []);
    svg.append(
      el("path", {
        "data-editor-overlay": "draft",
        d: "M" + ps.map((p) => p.join(" ")).join(" L"),
        fill: "none",
        stroke: RFCore.CABLE[cable]?.color || "#465c98",
        "stroke-width": 1.5 / view.z,
        "stroke-dasharray": `${4 / view.z} ${3 / view.z}`,
        "pointer-events": "none",
      }),
    );
  } else if (scalePts.length && draft?.cur)
    svg.append(
      el("path", {
        "data-editor-overlay": "scalePreview",
        d:
          "M" +
          scalePts
            .concat([draft.cur])
            .map((p) => p.join(" "))
            .join(" L"),
        fill: "none",
        stroke: "#d59d20",
        "stroke-width": 1.2 / view.z,
        "stroke-dasharray": `${4 / view.z} ${3 / view.z}`,
        "pointer-events": "none",
      }),
    );
}
