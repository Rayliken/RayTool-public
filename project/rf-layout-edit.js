/* Layout editing: fixed physical slots, named cables and reversible disconnection. */
const portColor = {
  IN: "#d28a13",
  THRU: "#3987eb",
  COUPLED: "#cf53af",
  OUT: "#26a97b",
};
function cableDescription(e, nid) {
  const peer = M.nodes[e.a === nid ? e.b : e.a];
  return `${e.label || "Unnamed cable"} [${e.id}]${e.stair ? ` · From ${e.stair.from||"?"} to ${e.stair.to||"?"}` : ""} → ${peer?.label || peer?.id || "?"} (${lengthInfo(e).value==null?"?":Number(lengthInfo(e).value.toFixed(2))} m)`;
}
function componentPortInspector(n) {
  const assignments = RFPlan.assignments(M, n),
    edges = edgesAt(n.id),
    slots = RFPlan.slots(n);
  return `<button class="btn" id="rotateComponent">Rotate 90°</button><div class="portList">${slots
    .map((p) => {
      const id = Object.keys(assignments).find(
          (e) => assignments[e] === p.slot,
        ),
        e = M.edges[id];
      return `<section class="portRow" style="--port-color:${portColor[p.role]}"><b>${p.slot}</b><select data-port-slot="${p.slot}"><option value="">Unconnected</option>${edges.map((e) => `<option value="${htmlEscape(e.id)}" ${e.id === id ? "selected" : ""}>${htmlEscape(cableDescription(e, n.id))}</option>`).join("")}</select><p>${e ? htmlEscape(cableDescription(e, n.id)) : "Drag a cable endpoint here, or draw from this port."}</p>${e ? `<div class="portActions"><button data-show-wire="${e.id}">Show cable</button><button data-detach="${e.id}">Disconnect</button><button data-rewire="${e.id}">Reconnect</button></div>` : ""}</section>`;
    })
    .join("")}${
    edges.filter((e) => !assignments[e.id]).length
      ? `<p class="hint">Attached but unassigned: ${edges
          .filter((e) => !assignments[e.id])
          .map((e) => htmlEscape(cableDescription(e, n.id)))
          .join("<br>")}. Choose these cables in a free port above.</p>`
      : ""
  }</div>`;
}
function bindComponentPorts(n) {
  if (n.kind !== "device") return;
  $("#rotateComponent").onclick = () => {
    snap();
    n.layout_rotation = ((RFPlan.angle(M, n) * 180) / Math.PI + 90) % 360;
    draw();
  };
  document.querySelectorAll("[data-port-slot]").forEach(
    (el) =>
      (el.onchange = () => {
        const mapping = RFPlan.assignments(M, n),
          slot = el.dataset.portSlot,
          old = Object.keys(mapping).find((id) => mapping[id] === slot),
          chosen = el.value,
          previous = mapping[chosen];
        snap();
        n.ports ??= {};
        n.port_slots ??= {};
        if (!chosen) {
          if (old)
            RFEdit.disconnect(M, old, M.edges[old].a === n.id ? "a" : "b");
        } else {
          const role = RFPlan.slots(n).find((s) => s.slot === slot).role;
          n.ports[chosen] = role;
          n.port_slots[chosen] = slot;
          if (old && old !== chosen) {
            if (previous) {
              n.ports[old] = RFPlan.slots(n).find(
                (s) => s.slot === previous,
              ).role;
              n.port_slots[old] = previous;
            } else {
              delete n.ports[old];
              delete n.port_slots[old];
            }
          }
        }
        reseed();
        draw();
        msg("Port assignment updated; cable names and lengths retained");
      }),
  );
  document.querySelectorAll("[data-show-wire]").forEach(
    (el) =>
      (el.onclick = () => {
        RFReview.select(el.dataset.showWire);
        $("#focusSelected").click();
      }),
  );
  document
    .querySelectorAll("[data-detach]")
    .forEach((el) => (el.onclick = () => detachWire(el.dataset.detach, n.id)));
  document.querySelectorAll("[data-rewire]").forEach(
    (el) =>
      (el.onclick = () => {
        const e = M.edges[el.dataset.rewire];
        beginReconnect(e.id, e.a === n.id ? "a" : "b");
      }),
  );
}
function detachWire(id, nid) {
  const e = M.edges[id];
  snap();
  RFEdit.disconnect(M, id, e.a === nid ? "a" : "b");
  reseed();
  sel = e;
  draw();
  msg(
    "Disconnected. Drag the yellow endpoint to another port; Ctrl+Z restores it.",
  );
}
function tuck(parent, title, elements) {
  const details = document.createElement("details"),
    summary = document.createElement("summary");
  summary.textContent = title;
  details.append(summary);
  for (const el of elements) if (el) details.append(el);
  if (details.children.length > 1) parent.append(details);
}
function simplifyCableInspector(e) {
  const box = $("#insp");
  tuck(
    box,
    "Length references & review",
    ["iCad", "iReason", "iCadRef", "iVerified", "iLengthVerified"].map((id) =>
      $("#" + id)?.closest(".row,label"),
    ),
  );
  // stair fields: shown for every leaky cable and every cable with stair data, also when they are still empty (user
  // 2026-11-19: From / To were hidden while empty, so a missing stair code could not be filled in)
  const active =
    e.cable === "LCK" ||
    e.stair ||
    e.length?.is_stair ||
    e.length?.mode === "stair_reserve";
  for (const id of ["iReserve", "iStairNo", "iStairFrom", "iStairTo"])
    $("#" + id).closest(".row").hidden = !active;
  const hint = [...box.querySelectorAll("p.hint")].find((e) =>
    e.textContent.startsWith("Used:"),
  );
  if (hint) tuck(box, "Length details", [hint]);
}
function simplifyNodeInspector() {
  const box = $("#insp");
  tuck(
    box,
    "Advanced / review",
    [
      "iKind",
      "iConn",
      "iConnectionChecked",
      "iPositionChecked",
      "iFeedChecked",
      "iDeviceVerified",
    ].map((id) => $("#" + id)?.closest(".row,label")),
  );
}
const contextMenu = document.createElement("div");
contextMenu.id = "connectionMenu";
contextMenu.hidden = true;
document.body.append(contextMenu);
function menuAction(text, fn) {
  const b = document.createElement("button");
  b.textContent = text;
  b.onclick = () => {
    contextMenu.hidden = true;
    fn();
  };
  contextMenu.append(b);
}
$("#stage").addEventListener("contextmenu", (event) => {
  event.preventDefault();
  contextMenu.replaceChildren();
  const target = event.target.closest("[data-connect-node],[data-node-id]"),
    nid = target?.dataset.connectNode || target?.dataset.nodeId,
    n = M.nodes[nid];
  if (n?.kind === "device") {
    sel = n;
    draw();
    const mapping = RFPlan.assignments(M, n);
    for (const p of RFPlan.slots(n)) {
      const id = Object.keys(mapping).find((id) => mapping[id] === p.slot),
        e = M.edges[id];
      const title = document.createElement("strong");
      title.textContent = p.slot + " · " + (e?.label || e?.id || "Unconnected");
      title.style.color = portColor[p.role];
      contextMenu.append(title);
      if (e) {
        menuAction("Disconnect " + p.slot, () => detachWire(id, n.id));
        menuAction("Reconnect " + p.slot, () =>
          beginReconnect(id, e.a === n.id ? "a" : "b"),
        );
      } else
        menuAction("Draw from " + p.slot, () => {
          setTool("draw");
          sel = n;
          draw();
          msg("Click the " + p.slot + " port, then click the destination");
        });
    }
  } else {
    const hit = event.target.closest("[data-edge-id],[data-reconnect-edge]"),
      e =
        M.edges[hit?.dataset.edgeId || hit?.dataset.reconnectEdge] ||
        nearestOtherEdge(toLocal(event), new Set())?.edge;
    if (!e) return;
    sel = e;
    draw();
    for (const end of ["a", "b"]) {
      const n = M.nodes[e[end]],
        title = document.createElement("strong");
      title.textContent =
        (end === "a" ? "Start" : "End") + " · " + (n.label || n.id);
      contextMenu.append(title);
      menuAction("Disconnect " + (end === "a" ? "start" : "end"), () =>
        detachWire(e.id, n.id),
      );
      menuAction("Reconnect " + (end === "a" ? "start" : "end"), () =>
        beginReconnect(e.id, end),
      );
    }
  }
  contextMenu.hidden = false;
  contextMenu.style.left = Math.min(event.clientX, innerWidth - 360) + "px";
  contextMenu.style.top =
    Math.min(event.clientY, innerHeight - contextMenu.offsetHeight - 10) + "px";
});
addEventListener("mousedown", (e) => {
  if (!contextMenu.contains(e.target)) contextMenu.hidden = true;
});
addEventListener("keydown", (e) => {
  if (e.key === "Escape") contextMenu.hidden = true;
});
$("#stage").addEventListener(
  "mousedown",
  (ev) => {
    const lg = ev.target.closest('[data-layer="legend"]');
    if (!lg || ev.button !== 0) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    snap();
    const p = toLocal(ev),
      start = M.meta.legend_position || [20, 20],
      scale = sceneFont() / 10;
    const move = (e) => {
      const q = toLocal(e);
      M.meta.legend_position = [start[0] + q[0] - p[0], start[1] + q[1] - p[1]];
      lg.setAttribute(
        "transform",
        `translate(${M.meta.legend_position.join(" ")}) scale(${scale})`,
      );
    };
    const up = () => {
      removeEventListener("mousemove", move);
      removeEventListener("mouseup", up);
      SCENE_KEY = "";
      draw();
    };
    addEventListener("mousemove", move);
    addEventListener("mouseup", up);
  },
  true,
);
// A visible reset action also makes a legend outside the current zoom easy to recover.
const legendControl = document
    .querySelector('[data-vis="legend"]')
    .closest("label"),
  findLegend = document.createElement("button");
findLegend.textContent = "把圖例移到目前視野";
findLegend.className = "btn";
findLegend.onclick = () => {
  snap();
  M.meta.legend_position = [(20 - view.x) / view.z, (100 - view.y) / view.z];
  VIS.legend = 1;
  document.querySelector('[data-vis="legend"]').checked = true;
  saveViewSettings();
  SCENE_KEY = "";
  draw();
};
legendControl.parentElement.after(findLegend);

const opacityLabel = document.createElement("label");
opacityLabel.className = "row";
opacityLabel.innerHTML =
  '<span>透明度</span><input id="backgroundOpacity" type="range" min="0.15" max="1" step="0.05" value="1">';
document.querySelector(".underlaySettings").before(opacityLabel);
$("#backgroundOpacity").oninput = (e) => {
  M.meta.background_opacity = Number(e.target.value);
  $("#detailPdf").style.opacity = e.target.value;
};
