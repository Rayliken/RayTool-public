/* TestPoint editing on the Layout.
   - Click a TestPoint card (TP, measurement, room, stair): the right panel edits its name / room / values per band.
   - Drag a yellow pin or a black diamond: moves the test point / measured point.
   - Antenna and stair-cable selections get a "TestPoint values" section for their blue tags / stair readings.
   Every change is undoable (snap), autosaved, marked user_edited (deleted items are only flagged), and kept when the
   TestPoint data is reassembled from the PDFs (scripts/integration/testpoint-merge.cjs). */
(() => {
  "use strict";
  const BANDS = ["400", "800", "1795", "1910"],
    COLOR = { 400: "#1d4ed8", 800: "#c2410c", 1795: "#7e22ce", 1910: "#0f766e" },
    h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]),
    T = () => M.meta.test_points,
    nums = (s) => (String(s).match(/[-−]?\d+(?:\.\d+)?/g) || []).map((x) => Number(x.replace("−", "-")));
  const api = (window.RFTestPointEdit = { selected: null, select, item, startPointDrag, add });

  // 點 TestPoint tool: a new purple TestPoint at canvas point p, named after the floor's last PRJ-<floor>-TP-nnn
  function add(p) {
    const t = M.meta.coordinate_transform;
    if (!t) return msg("This floor has no CAD coordinate frame; a TestPoint cannot be placed.");
    snap();
    const d = (M.meta.test_points ??= { schema: "raytool-testpoints/2", tps: [], measurements: [], rooms: [], notes: [], stair_readings: [], antenna_info: {} });
    d.tps ??= [];
    const floor = M.meta.floor, nums = [...d.tps, ...(d.stair_readings || [])].map((x) => +(String(x.name || x.tp || "").match(/TP-(?:[A-Z]+-)?(\d+)\s*$/i) || [])[1]).filter(Number.isFinite);
    const n = String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, "0"), id = `TP-${n}`;
    const mm = [Math.round(((p[0] - 100) / t.canvas_per_mm + t.lo[0]) * 10) / 10, Math.round((t.hi[1] - (p[1] - 100) / t.canvas_per_mm) * 10) / 10];
    d.tps.push({ tp: d.tps.some((x) => x.tp === id) ? `${id}-${Date.now() % 100000}` : id, name: `PRJ-${floor}-TP-${n}`, mm, bands: {},
      label_offset_mm: [0, 4000], src: { created: true }, user_edited: true, user_created: true, edited_on: new Date().toISOString().slice(0, 10) });
    VIS.testPoints = 1; const c = document.querySelector('[data-vis="testPoints"]'); if (c) c.checked = true;
    select("tp:" + d.tps[d.tps.length - 1].tp);
    msg(`TestPoint ${d.tps[d.tps.length - 1].name} added; fill in its values on the right`);
  }

  function item(ref) {
    const d = T(), i = String(ref || "").indexOf(":"), k = String(ref).slice(0, i), id = String(ref).slice(i + 1);
    if (!d || i < 0) return null;
    return k === "tp" ? d.tps?.find((t) => t.tp === id) : k === "m" ? d.measurements?.find((x) => x.id === id)
      : k === "r" ? d.rooms?.[+id] : k === "s" ? d.stair_readings?.[+id] : null;
  }
  // first edit keeps where the item came from, so a later reassembly from the PDFs can find and keep the edit
  function mark(it) {
    if (!it.src) it.src = JSON.parse(JSON.stringify({ tp: it.tp, id: it.id, text: it.text, stair_no: it.stair_no, mm: it.mm, point_mm: it.point_mm, label_mm: it.label_mm, tip_mm: it.tip_mm }));
    it.user_edited = true;
    it.edited_on = new Date().toISOString().slice(0, 10);
  }
  function commit(fn) { snap(); fn(); SCENE_KEY = ""; draw(); render(); }
  function select(ref) { api.selected = ref; sel = null; SCENE_KEY = ""; draw(); render(); }

  // ---------- right panel ----------
  const field = (label, html) => `<label class="row"><span>${label}</span>${html}</label>`;
  const bandInputs = (vals, hint) => BANDS.map((b) => `<div class="bandIn"><b style="background:${COLOR[b]}">${b}</b><input data-band="${b}" value="${h(vals[b] ?? "")}" placeholder="${hint}"></div>`).join("");
  function render() {
    const it = item(api.selected), box = $("#insp");
    if (!it || !box) return;
    const [k] = api.selected.split(":"), d = T();
    let html = "";
    if (k === "tp") {
      const vals = Object.fromEntries(BANDS.map((b) => [b, (it.bands?.[b]?.tags || (it.bands?.[b]?.tag_dbm != null ? [it.bands[b].tag_dbm + " dBm"] : [])).join(", ")]));
      html = `<h4>TestPoint</h4>${field("名稱", `<input data-f="name" value="${h(it.name || it.tp)}">`)}
        <p class="meta">藍色標籤（每頻段，可多個，用逗號分隔）</p>${bandInputs(vals, "（空白）例 -60 dBm")}
        ${field("X mm", `<input data-f="x" type="number" step="10" value="${Math.round(it.mm[0])}">`)}${field("Y mm", `<input data-f="y" type="number" step="10" value="${Math.round(it.mm[1])}">`)}
        <p class="meta">最近天線 ${h(it.antenna || "-")}（${it.antenna_dist_m ?? "-"} m）· ${h(it.room || "")}</p>`;
    } else if (k === "m") {
      const vals = Object.fromEntries(BANDS.map((b) => [b, (it.values?.[b] || []).join(" / ")]));
      html = `<h4>測量點 ${h(it.id)}</h4>${field("房間名", `<input data-f="room" value="${h(it.room || "")}" placeholder="（沒有）">`)}
        <label class="row"><span>Lock</span><input data-f="locked" type="checkbox"${it.locked ? " checked" : ""}></label>
        <p class="meta">實測讀數 dBm（每頻段，可多個，用 / 分隔）</p>${bandInputs(vals, "（空白）例 -84")}
        ${field("X mm", `<input data-f="x" type="number" step="10" value="${Math.round(it.point_mm[0])}">`)}${field("Y mm", `<input data-f="y" type="number" step="10" value="${Math.round(it.point_mm[1])}">`)}`;
    } else if (k === "r") {
      html = `<h4>房間（沒有讀數）</h4>${field("房間名", `<input data-f="text" value="${h(it.text)}">`)}
        <label class="row"><span>Lock</span><input data-f="locked" type="checkbox"${it.locked ? " checked" : ""}></label>`;
    } else if (k === "s") {
      html = `<h4>TestPoint</h4>${field("名稱", `<input data-f="name" value="${h(it.name || it.stair_no)}">`)}
        <p class="meta">樓梯 ${h(it.stair_no)} 的讀數；每頻段原文，例如「LT 9d From L1 to GF -90」</p>${bandInputs(Object.fromEntries(BANDS.map((b) => [b, it.bands?.[b] || ""])), "（空白）")}`;
    }
    html += `<p class="meta">拖動黃色圖釘或黑色菱形可移動點位；拖動卡片只移動標籤。</p>${it.user_edited ? `<p class="edited">已手動修改（${h(it.edited_on || "")}），重新從 PDF 組裝時保留。</p>` : ""}
      <button class="btn danger" data-act="delete">刪除</button>`;
    box.innerHTML = `<div class="tpEdit">${html}</div>`;
    box.querySelectorAll("input").forEach((inp) => inp.addEventListener("change", () => apply(it, k, inp)));
    box.querySelector('[data-act="delete"]').onclick = () => { if (confirm("刪除這個 TestPoint 項目？（可用 Ctrl+Z 復原）")) commit(() => { mark(it); it.deleted = true; api.selected = null; }); };
    void d;
  }
  function apply(it, k, inp) {
    const f = inp.dataset.f, b = inp.dataset.band, v = inp.type === "checkbox" ? inp.checked : inp.value.trim();
    commit(() => {
      mark(it);
      if (f === "x" || f === "y") { const key = k === "tp" ? "mm" : "point_mm"; it[key] = [...it[key]]; it[key][f === "x" ? 0 : 1] = Number(v); }
      else if (f === "name") it.name = v || it.name || it.tp || it.stair_no;
      else if (f === "room") { it.room = v || null; it.locked = /lock/i.test(v) || it.locked; }
      else if (f === "text") it.text = v;
      else if (f === "locked") it.locked = v;
      else if (b && k === "tp") {
        const tags = String(v).split(/[,，]/).map((s) => s.trim()).filter(Boolean).map((s) => (/^[-−]?\d+(\.\d+)?$/.test(s) ? s.replace("−", "-") + " dBm" : s));
        it.bands ??= {};
        if (tags.length) it.bands[b] = { ...(it.bands[b] || {}), tags, tag_dbm: nums(tags[0])[0] ?? null };
        else delete it.bands[b];
      } else if (b && k === "m") {
        const n = nums(v);
        it.values ??= {};
        if (n.length) it.values[b] = n; else delete it.values[b];
      } else if (b && k === "s") {
        it.bands ??= {};
        if (v) it.bands[b] = v; else delete it.bands[b];
      }
    });
  }

  // antenna / stair cable selected: add their TestPoint values below the normal panel
  const baseInspect = inspect;
  inspect = function () {
    if (sel || !VIS.testPoints) api.selected = null;   // TestPoint layer off: no TestPoint editing at all
    if (!sel && api.selected && item(api.selected)) return render();
    baseInspect.apply(this, arguments);
    const d = T(), box = $("#insp");
    if (!d || !sel || !box || !VIS.testPoints) return;
    if (sel.kind === "antenna") {
      const lines = d.antenna_info?.[sel.label] || [], vals = {};
      for (const l of lines) { const [bb, ...r] = String(l).split(":"); vals[bb] = r.join(":").trim(); }
      const sec = document.createElement("div");
      sec.className = "tpEdit";
      sec.innerHTML = `<h4>TestPoint 數值（藍色標籤）</h4>${bandInputs(vals, "（空白）")}`;
      box.append(sec);
      sec.querySelectorAll("input").forEach((inp) => inp.addEventListener("change", () => commit(() => {
        const cur = Object.fromEntries((d.antenna_info?.[sel.label] || []).map((l) => { const [bb, ...r] = String(l).split(":"); return [bb, r.join(":").trim()]; }));
        let val = inp.value.trim(); if (/^[-−]?\d+(\.\d+)?$/.test(val)) val = val.replace("−", "-") + " dBm";
        if (val) cur[inp.dataset.band] = val; else delete cur[inp.dataset.band];
        d.antenna_info ??= {};
        d.antenna_info[sel.label] = BANDS.filter((x) => cur[x]).map((x) => `${x}: ${cur[x]}`);
        if (!d.antenna_info[sel.label].length) delete d.antenna_info[sel.label];
        ((d.user_edits ??= {}).antenna_info ??= {})[sel.label] = new Date().toISOString().slice(0, 10);
      })));
    } else if (sel.a && sel.b) {
      (d.stair_readings || []).forEach((sr, i) => {
        if (sr.deleted || !(sr.edges || []).includes(sel.id)) return;
        const sec = document.createElement("div");
        sec.className = "tpEdit";
        sec.innerHTML = `<h4>TestPoint 樓梯讀數 ${h(sr.stair_no)}</h4>${bandInputs(Object.fromEntries(BANDS.map((b) => [b, sr.bands?.[b] || ""])), "（空白）")}`;
        box.append(sec);
        sec.querySelectorAll("input").forEach((inp) => inp.addEventListener("change", () => apply(sr, "s", inp)));
      });
    }
  };
  // TestPoint layer off: band chips and plan notes switch are greyed out
  const tpToggle = document.querySelector('[data-vis="testPoints"]'), syncOff = () => document.querySelector("#rail")?.classList.toggle("tpOff", !tpToggle?.checked);
  tpToggle?.addEventListener("change", syncOff); setTimeout(syncOff, 0);
  // a click anywhere else ends the TestPoint selection
  $("#stage").addEventListener("mousedown", (e) => { if (!e.target.closest("[data-tp],[data-tp-point]")) api.selected = null; }, true);

  // ---------- drag a pin / diamond ----------
  function startPointDrag(ev, el) {
    ev.preventDefault();
    ev.stopImmediatePropagation();
    const ref = el.getAttribute("data-tp-point"), it = item(ref);
    if (!it) return;
    snap();
    const start = [ev.clientX, ev.clientY], z = view.z;
    let moved = false, dx = 0, dy = 0;
    const move = (e) => {
      dx = (e.clientX - start[0]) / z; dy = (e.clientY - start[1]) / z;
      if (!moved && Math.hypot(dx, dy) < 1) return;
      moved = true;
      el.setAttribute("transform", `translate(${dx} ${dy})`);
    };
    const up = () => {
      removeEventListener("mousemove", move);
      removeEventListener("mouseup", up);
      if (!moved) { HIST.pop(); select(ref); return; }
      const kmm = M.meta.coordinate_transform.canvas_per_mm, key = ref.startsWith("tp:") ? "mm" : ref.startsWith("s:") ? "tip_mm" : "point_mm";
      mark(it);
      it[key] = [Math.round((it[key][0] + dx / kmm) * 10) / 10, Math.round((it[key][1] - dy / kmm) * 10) / 10];
      api.selected = ref; sel = null; SCENE_KEY = ""; draw(); render();
    };
    addEventListener("mousemove", move);
    addEventListener("mouseup", up);
  }
})();
