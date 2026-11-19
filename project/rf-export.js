/* One-sheet vector exports. The original PDF is embedded, never rasterized. */
function completeSheetBounds() {
  if (window.RFCADUnderlay?.building_only && M.meta.cad_background_mode === 'clean' && !M.meta.reference_only && M.meta.coordinate_transform) {
    const t=M.meta.coordinate_transform, k=t.canvas_per_mm, w=(t.hi[0]-t.lo[0])*k, h=(t.hi[1]-t.lo[1])*k, pad=Math.max(w,h)*0.03;
    const x=Math.min(0,100-pad), y=Math.min(0,100-pad);
    return [x,y,Math.max(PAGE.w,100+w+pad)-x,Math.max(PAGE.h,100+h+pad)-y];
  }
  const points = [
    [0, 0],
    [PAGE.w, PAGE.h],
  ];
  if (pdfPage && VIS.background) {
    const v = pdfPage.getViewport({ scale: 1 }),
      f = M.meta.cad_pdf_registration?.pdf_to_canvas || [1, 0, 0, 1, 0, 0];
    for (const [x, y] of [
      [0, 0],
      [v.width, 0],
      [0, v.height],
      [v.width, v.height],
    ])
      points.push([f[0] * x + f[2] * y + f[4], f[1] * x + f[3] * y + f[5]]);
  }
  const x = Math.min(...points.map((p) => p[0])),
    y = Math.min(...points.map((p) => p[1]));
  return [
    x,
    y,
    Math.max(...points.map((p) => p[0])) - x,
    Math.max(...points.map((p) => p[1])) - y,
  ];
}
function fitCompleteSheet() {
  const [x, y, w, h] = completeSheetBounds(),
    stage = $("#stage"),
    z = Math.min((stage.clientWidth - 48) / w, (stage.clientHeight - 80) / h);
  view = {
    z,
    x: (stage.clientWidth - w * z) / 2 - x * z,
    y: 48 + (stage.clientHeight - 80 - h * z) / 2 - y * z,
  };
  applyView();
}
function drawingBounds(root, base) {
  const holder = document.createElement("div");
  holder.style.cssText = "position:fixed;left:-100000px;visibility:hidden";
  const copy = document.importNode(root, true);
  holder.append(copy);
  document.body.append(holder);
  const b = copy.getBBox();
  holder.remove();
  const x = Math.min(base[0], b.x - 12),
    y = Math.min(base[1], b.y - 12),
    right = Math.max(base[0] + base[2], b.x + b.width + 12),
    bottom = Math.max(base[1] + base[3], b.y + b.height + 12);
  return [x, y, right - x, bottom - y];
}
// Vector PDF implementation is loaded below.
function multiply(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
function cleanPDFSVG(s) {
  const root = new DOMParser().parseFromString(
    s,
    "image/svg+xml",
  ).documentElement;
  root.querySelectorAll("[data-editor-overlay]").forEach((e) => e.remove());
  // jsPDF standard fonts are WinAnsi only: arrows and maths signs otherwise print as "!'" etc.
  const PDF_TEXT = { "→": "->", "←": "<-", "↔": "<->", "⇒": "=>", "≥": ">=", "≤": "<=", "−": "-", "≈": "~", "Ω": "ohm" };
  const walker = root.ownerDocument.createTreeWalker(root, 4);
  for (let n = walker.nextNode(); n; n = walker.nextNode())
    if (/[→←↔⇒≥≤−≈Ω]/.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace(/[→←↔⇒≥≤−≈Ω]/g, (c) => PDF_TEXT[c]);
  for (const t of root.querySelectorAll("text")) {
    t.setAttribute("stroke", "none");
    t.removeAttribute("stroke-width");
  }
  // one embedded font for all PDF text (Chinese room names otherwise print as WinAnsi garbage, Latin as Times)
  if (window.RFPdfFonts) for (const t of [root, ...root.querySelectorAll("[font-family]")]) t.setAttribute("font-family", "NotoSansTC");
  return root;
}
// Noto Sans TC subset (vendor/fonts), loaded on the first PDF export only
let pdfFontsLoading = null;
function loadPdfFonts() {
  return (pdfFontsLoading ??= new Promise((resolve) => {
    if (window.RFPdfFonts) return resolve(true);
    const s = document.createElement("script");
    s.src = "vendor/fonts/noto-sans-tc-subset.js";
    s.onload = () => resolve(!!window.RFPdfFonts);
    s.onerror = () => resolve(false);
    document.head.append(s);
  }));
}
function registerPdfFonts(doc) {
  if (!window.RFPdfFonts) return;
  doc.addFileToVFS("NotoSansTC-Regular.ttf", window.RFPdfFonts.regular);
  doc.addFont("NotoSansTC-Regular.ttf", "NotoSansTC", "normal");
  doc.addFileToVFS("NotoSansTC-Bold.ttf", window.RFPdfFonts.bold);
  doc.addFont("NotoSansTC-Bold.ttf", "NotoSansTC", "bold");
}
async function svgPage(root, W, H, paper = "a0", viewport = null, footer = "") {
  if (await loadPdfFonts()) root.querySelectorAll?.("text").forEach((t) => t.setAttribute("font-family", "NotoSansTC"));
  const JP = jspdf.jsPDF,
    box = viewport || [0, 0, W, H],
    landscape = box[2] >= box[3],
    naturalScale = Math.min(1, 14000 / Math.max(box[2], box[3])),
    format =
      paper === "auto"
        ? [box[2] * naturalScale + 36, box[3] * naturalScale + 52]
        : paper,
    doc = new JP({
      orientation: landscape ? "landscape" : "portrait",
      unit: "pt",
      format,
      compress: true,
    }),
    pw = doc.internal.pageSize.getWidth(),
    ph = doc.internal.pageSize.getHeight(),
    margin = 18,
    footerH = footer ? 16 : 0,
    scale = Math.min(
      (pw - 2 * margin) / box[2],
      (ph - 2 * margin - footerH) / box[3],
    ),
    x = (pw - box[2] * scale) / 2,
    y = (ph - footerH - box[3] * scale) / 2;
  registerPdfFonts(doc);
  root = root.cloneNode(true);
  if (window.RFPdfFonts) root.setAttribute("font-family", "NotoSansTC");
  root.setAttribute("viewBox", box.join(" "));
  root.setAttribute("width", box[2]);
  root.setAttribute("height", box[3]);
  root.setAttribute("preserveAspectRatio", "xMinYMin meet");
  const ns = "http://www.w3.org/2000/svg",
    defs = document.createElementNS(ns, "defs"),
    clip = document.createElementNS(ns, "clipPath"),
    rect = document.createElementNS(ns, "rect"),
    group = document.createElementNS(ns, "g");
  clip.id = "sheetViewportClip";
  for (const [key, value] of Object.entries({
    x: box[0],
    y: box[1],
    width: box[2],
    height: box[3],
  }))
    rect.setAttribute(key, value);
  clip.append(rect);
  defs.append(clip);
  while (root.firstChild) group.append(root.firstChild);
  group.setAttribute("clip-path", "url(#sheetViewportClip)");
  root.append(defs, group);
  await doc.svg(root, { x, y, width: box[2] * scale, height: box[3] * scale });
  if (footer) {
    doc.setFontSize(8);
    doc.setTextColor(70, 80, 90);
    doc.text(footer, margin, ph - 12);
  }
  return {
    doc,
    bytes: doc.output("arraybuffer"),
    width: pw,
    height: ph,
    scale,
    x,
    y,
  };
}
let exportPdfSourceBytes=null, exportPdfSourceDoc=null;
async function activePdfSource(){if(exportPdfSourceBytes!==ACTIVE_PDF_BYTES){exportPdfSourceBytes=ACTIVE_PDF_BYTES;exportPdfSourceDoc=PDFLib.PDFDocument.load(ACTIVE_PDF_BYTES);}return exportPdfSourceDoc;}
async function exportLayoutPDFDrawing() {
  if(typeof syncLinkedSourcePowers==='function')syncLinkedSourcePowers();
  try {
    msg("Preparing vector layout PDF…");
    const l = visibleLayoutScene(),
      root = cleanPDFSVG(l.svg),
      box = drawingBounds(root, completeSheetBounds()),
      r = await svgPage(root, l.width, l.height, "a0", box);
    let bytes = r.bytes;
    if (VIS.background && pdfPage && ACTIVE_PDF_BYTES) {
      const P = PDFLib,
        out = await P.PDFDocument.create(),
        source = await activePdfSource(),
        sourcePage = source.getPage(pageNum - 1),
        media = sourcePage.getMediaBox(),
        bg = await out.embedPage(
          sourcePage,
          {
            left: media.x,
            bottom: media.y,
            right: media.x + media.width,
            top: media.y + media.height,
          },
          [1, 0, 0, 1, 0, 0],
        ),
        overlay = await out.embedPdf(r.bytes),
        page = out.addPage([r.width, r.height]),
        frame = M.meta.cad_pdf_registration?.pdf_to_canvas || [
          1, 0, 0, 1, 0, 0,
        ],
        world2pdf = [
          r.scale,
          0,
          0,
          -r.scale,
          r.x - box[0] * r.scale,
          r.height - r.y + box[1] * r.scale,
        ],
        matrix = multiply(
          multiply(world2pdf, frame),
          pdfPage.getViewport({ scale: 1 }).transform,
        ),
        name = page.node.newXObject("CAD", bg.ref);
      page.pushOperators(
        P.pushGraphicsState(),
        P.rectangle(
          r.x,
          r.height - r.y - box[3] * r.scale,
          box[2] * r.scale,
          box[3] * r.scale,
        ),
        P.clip(),
        P.endPath(),
        P.concatTransformationMatrix(...matrix),
        P.setGraphicsState(
          page.node.newExtGState(
            "UnderlayOpacity",
            out.context.obj({
              Type: "ExtGState",
              ca: M.meta.background_opacity ?? 1,
              CA: M.meta.background_opacity ?? 1,
            }),
          ),
        ),
        P.drawObject(name),
        P.popGraphicsState(),
      );
      page.drawPage(overlay[0], {
        x: 0,
        y: 0,
        width: r.width,
        height: r.height,
      });
      out.setTitle((M.meta.floor || "RF") + " RF Layout");
      bytes = await out.save();
    }
    const today = new Date();
    const date = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, "0"), String(today.getDate()).padStart(2, "0")].join("");
    dl(new Blob([bytes], { type: "application/pdf" }), `${M.meta.floor} layout ${date}.pdf`);
    msg("Layout PDF saved — visible layers only, vector graphics");
  } catch (e) {
    msg("PDF export failed: " + e.message);
    console.error(e);
  }
}
async function exportLinePDFDrawing() {
  if(typeof syncLinkedSourcePowers==='function')syncLinkedSourcePowers();
  try {
    const t = buildToolTopology(),
      root = cleanPDFSVG(t.svg),
      box = drawingBounds(root, [0, 0, t.width, t.height]);
    msg("Preparing complete line diagram…");
    const r = await svgPage(
      root,
      t.width,
      t.height,
      "auto",
      box,
      (M.meta.floor || "RF") + " / RF LINE DIAGRAM",
    );
    dl(
      new Blob([r.bytes], { type: "application/pdf" }),
      fname("Line Diagram", "pdf"),
    );
    msg("Line diagram saved — one complete vector PDF");
  } catch (e) {
    msg("PDF export failed: " + e.message);
    console.error(e);
  }
}

// user 2026-11-18: delivered Layout / Line Diagram PDFs carry no "below -85 dBm" marks (RX circles, TestPoint red frames);
// the on-screen switch is left as it was
async function withoutRxMarks(fn) {
  const was = VIS.rxWarnings;
  VIS.rxWarnings = 0; SCENE_KEY = "";
  try { return await fn(); } finally { VIS.rxWarnings = was; SCENE_KEY = ""; draw(); }
}
async function exportLayoutPDF() { return withoutRxMarks(exportLayoutPDFDrawing); }
async function exportLinePDF() { return withoutRxMarks(exportLinePDFDrawing); }
