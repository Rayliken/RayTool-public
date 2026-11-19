/* Workspace navigation and spreadsheet preview. All views share M. */
let workspace = "layout",
  previewWorkbook = null,
  previewSheet = "Received signal";
function syncLinkedSourcePowers(){
 if(!window.RFProjectCatalog||!window.RFCrossFloor)return [];
 const cat={...RFProjectCatalog,...WORKING_FLOORS,[M.meta.floor]:M};
 return RFCrossFloor.refresh(cat,RFCore);
}
function setWorkspace(name) {
  syncLinkedSourcePowers();
  workspace = name;
  for (const button of document.querySelectorAll("[data-workspace]"))
    button.setAttribute("aria-pressed", button.dataset.workspace === name);
  $("#topo").style.display = "none";
  $("#excelWorkspace").hidden = name !== "excel";
  $("#exportCurrent").textContent =
    name === "excel"
      ? "匯出 Excel"
      : name === "line"
        ? "匯出 Line PDF"
        : "匯出 Layout PDF";
  if (name === "line") showTopology();
  if (name === "excel") refreshWorkbook();
  if (name === "layout") {
    draw();
    paint();
    syncUnderlayFields();
  }
}
for (const button of document.querySelectorAll("[data-workspace]"))
  button.onclick = () => setWorkspace(button.dataset.workspace);
$("#exportCurrent").onclick = () =>
  workspace === "excel"
    ? exportWorkbook()
    : workspace === "line"
      ? exportLinePDF()
      : exportLayoutPDF();
$("#reviewFloor").onchange = async () => {
  await openReviewFloor($("#reviewFloor").value);
  setWorkspace(workspace);
};
const loadProjectFile = $("#load").onchange;
$("#load").onchange = async (e) => {
  await loadProjectFile(e);
  setWorkspace(workspace);
};
$("#refreshExcel").onclick = refreshWorkbook;
function refreshWorkbook() {
  previewWorkbook = buildWorkbook();
  $("#sheetTabs").replaceChildren();
  // sheet tabs grouped by purpose: results, schedules, review (unknown sheets go to the last group)
  const GROUPS = [
    ["計算結果", ["Link Budget", "Received signal", "Provisional path loss", "Provisional RF", "Endpoint feed", "Sources", "Source mapping"]],
    ["清單", ["Cable schedule", "Components", "Stair schedule", "Name register", "CAD sections", "Reference devices", "Physical joins"]],
    ["核對", ["Checks", "Layout PDF review", "Assumptions", "Calculation basis"]],
  ];
  const known = new Set(GROUPS.flatMap((g) => g[1]));
  GROUPS[2][1].push(...previewWorkbook.SheetNames.filter((n) => !known.has(n)));
  for (const [title, names] of GROUPS) {
    const present = names.filter((n) => previewWorkbook.SheetNames.includes(n));
    if (!present.length) continue;
    const box = document.createElement("span");
    box.className = "sheetGroup";
    box.append(Object.assign(document.createElement("small"), { textContent: title }));
    for (const name of present) {
      const b = document.createElement("button");
      b.textContent = name;
      b.setAttribute("aria-pressed", name === previewSheet);
      b.onclick = () => {
        previewSheet = name;
        refreshWorkbook();
      };
      box.append(b);
    }
    $("#sheetTabs").append(box);
  }
  if(previewSheet==='Checks'&&window.ProjectChecks){ProjectChecks.render();return;}
  const ws = previewWorkbook.Sheets[previewSheet],
    data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true }),
    table = document.createElement("table"),
    thead = document.createElement("thead"),
    tbody = document.createElement("tbody");
  data.forEach((row, r) => {
    const tr = document.createElement("tr");
    if(r&&previewSheet==='Received signal'&&String(row[17]).startsWith('LOW'))tr.className='rxLow';
    row.forEach((value, c) => {
      const cell = document.createElement(r ? "td" : "th"),
        sourceEdit = previewSheet === "Sources" && r && c === 4 && row[1] && !M.nodes[row[1]]?.upstream_connection && !M.nodes[row[1]]?.reference_only,
        lengthEdit = previewSheet === "Cable schedule" && r && c === 7,
        receiverEdit=previewSheet==='Received signal'&&r&&(c===10||c===11);
      if (sourceEdit || lengthEdit || receiverEdit) {
        const input = document.createElement("input");
        input.type = "number";
        input.step = lengthEdit ? "1" : "0.1";
        input.value = value;
        input.setAttribute(
          "aria-label",
          sourceEdit
            ? `${row[2]} ${row[3]} MHz power`
            : receiverEdit?`${row[0]} ${row[2]}MHz ${c===10?'range':'penetration'}`:`${row[1] || row[0]} length`,
        );
        if (lengthEdit) input.min = "0";
        input.onchange = () => {
          const number = RFCore.number(input.value);
          if (lengthEdit && (number === null || number < 0 || !Number.isInteger(number))) {
            input.value = value;
            return;
          }
          if(lengthEdit&&RFCore.lengthInfo(M,M.edges[row[0]]).value===number)return;
          snap();
          if (sourceEdit) {
            const n = M.nodes[row[1]];
            n.power_dbm ??= {};
            n.power_dbm[row[3]] = number;
          } else if(receiverEdit){
            const item=row[1]==='Leaky'?M.edges[row[21]]:M.nodes[row[21]],freq=row[2];
            item.coverage??={};item.coverage.by_frequency??={};item.coverage.by_frequency[freq]??={};
            item.coverage.by_frequency[freq][c===10?'range_m':'penetration_db']=number;
            item.coverage.by_frequency[freq].basis='USER_EDITED_RECEIVER_INPUT';
          } else {
            const e = M.edges[row[0]];
            e.length = { ...e.length, mode: "manual", manual_m: number };
            e.review_verified = true;
            e.layout_section_labels=[];
          }
          SCENE_KEY = "";
          draw();syncLinkedSourcePowers();window.ProjectStudio?.changed();window.Ray3D?.refresh();refreshWorkbook();
        };
        cell.append(input);
      } else
        cell.textContent =
          typeof value === "number"
            ? String(Math.round(value * 10000) / 10000)
            : value;
      const source = ws[XLSX.utils.encode_cell({ r, c })];
      if (source?.f) cell.title = "Excel formula: =" + source.f;
      tr.append(cell);
    });
    (r ? tbody : thead).append(tr);
  });
  table.append(thead, tbody);
  $("#sheetTable").replaceChildren(table);
  $("#excelHint").textContent =
    previewSheet === 'Received signal'
      ? 'Received power at the design coverage point; LOW means below −85dBm. Edit range and penetration here or in Layout. Blank means missing input or invalid design; review results are not a site acceptance.'
      : previewSheet === "Sources"
      ? "可編輯原始 ORU 功率（dBm）；跨層繼承輸入由上游重新計算。空白代表缺少數據。"
      : previewSheet === "Cable schedule"
        ? "可編輯 Selected m 整數線長；同步至 Layout、Line Diagram、3D 及預算。原 CAD 長度保留作比較。"
        : "Preview of the workbook to be exported. Change components, names and connections in Layout. Blank results need the inputs shown in State / Review issues.";
}
function syncUnderlayFields() {
  const f = M.meta.cad_pdf_registration?.pdf_to_canvas || [1, 0, 0, 1, 0, 0];
  $("#underlayFields").replaceChildren();
  ["a", "b", "c", "d", "x", "y"].forEach((key, i) => {
    const label = document.createElement("label");
    label.className = "row";
    const text = document.createElement("span");
    text.textContent = key;
    const input = document.createElement("input");
    input.type = "number";
    input.step = "any";
    input.dataset.affine = i;
    input.value = f[i];
    label.append(text, input);
    $("#underlayFields").append(label);
  });
}
$("#applyUnderlay").onclick = async () => {
  const f = [...document.querySelectorAll("[data-affine]")].map((el) =>
    Number(el.value),
  );
  if (!f.every(Number.isFinite) || Math.abs(f[0] * f[3] - f[1] * f[2]) < 1e-10)
    return msg("Use a non-zero alignment scale");
  snap();
  M.meta.cad_pdf_registration = {
    ...M.meta.cad_pdf_registration,
    pdf_to_canvas: f,
    canvas_size: [PAGE.w, PAGE.h],
  };
  fitCompleteSheet();
  await paint();
  draw();
  msg("Full underlay alignment updated; cable lengths unchanged");
};
$("#resetUnderlay").onclick = async () => {
  snap();
  const reg = RFProjectCatalog[M.meta.floor]?.meta.cad_pdf_registration;
  if (reg) M.meta.cad_pdf_registration = structuredClone(reg);
  else delete M.meta.cad_pdf_registration;
  syncUnderlayFields();
  fitCompleteSheet();
  await paint();
  draw();
};
$("#topowrap").addEventListener("dblclick", (event) => {
  const group = event.target.closest("[data-node-id],[data-edge-id]");
  if (!group) return;
  const id = group.dataset.nodeId || group.dataset.edgeId;
  setWorkspace("layout");
  RFReview.select(id);
  $("#focusSelected").click();
});
window.RFStudio = {
  setWorkspace,
  getWorkspace: () => workspace,
  buildWorkbook,
  completeSheetBounds,
  refreshWorkbook,
};

$("#fitNetwork").onclick = () => {
  const points = [
    ...Object.values(M.nodes).map(visualNode),
    ...Object.values(M.edges).flatMap(visualPoints),
  ];
  if (!points.length) return;
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]),
    x = Math.min(...xs) - 80,
    y = Math.min(...ys) - 80,
    w = Math.max(...xs) - x + 80,
    h = Math.max(...ys) - y + 80,
    stage = $("#stage"),
    z = Math.min((stage.clientWidth - 48) / w, (stage.clientHeight - 100) / h);
  view = { z, x: 24 - x * z, y: 65 - y * z };
  applyView();
  draw();
  paint();
};

// Locate source-less nodes without changing their connectivity.
const unfedLocator = document.createElement("select");
unfedLocator.id = "unfedLocator";
unfedLocator.title = "Locate an UNFED node in Layout; use Selection Delete to remove it";
$("#topoInfo").after(unfedLocator);
unfedLocator.onchange = () => {
  const id = unfedLocator.value;
  if (!id) return;
  setWorkspace("layout");
  RFReview.select(id);
  $("#focusSelected").click();
};
window.RFUnfed = {
  refresh() {
    const graph = RFCore.analyze(M);
    const ids = graph.components.filter(c => !c.sources.length).flatMap(c => c.nodes).filter(id => {
      const n = M.nodes[id];
      return !(M.meta?.line_hide_unused_junctions && n.kind === "junction" && !graph.adj[id].length && !String(n.label || "").trim());
    });
    unfedLocator.replaceChildren(new Option(`Locate UNFED (${ids.length})`, ""));
    for (const id of ids) {
      const n = M.nodes[id];
      unfedLocator.add(new Option(`${id} · ${n.label || n.dev || n.kind}`, id));
    }
    unfedLocator.hidden = !ids.length;
  }
};

// File menu (header): close after choosing an item or clicking elsewhere
(() => {
  const menu = document.querySelector(".fileMenu");
  if (!menu) return;
  menu.querySelector(".fileMenuPanel").addEventListener("click", (e) => {
    if (e.target.closest("button")) menu.open = false;
  });
  menu.querySelectorAll("input[type=file]").forEach((i) => i.addEventListener("change", () => (menu.open = false)));
  document.addEventListener("click", (e) => { if (!menu.contains(e.target)) menu.open = false; });
})();
