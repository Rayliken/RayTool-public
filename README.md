# RayTool

A browser tool for indoor radio (DAS) riser design: draw the network on a floor plan (cables, splitters / couplers,
antennas, leaky cables, signal sources), and get the link budget, line diagram, 3D view and PDF / Excel exports.

Everything runs in the browser; nothing is uploaded. Open `project/index.html` (or this repository's GitHub Pages
address) in Chrome or Edge.

## Start

- **檔案 › 開啟樓層 JSON…** opens a floor model; **開啟全專案（.raytool）…** opens a whole project someone shared with you.
- Or start from a PDF floor plan: open it as the underlay, calibrate the scale (**校準比例**, K), then draw.
- Tools: 選取／移動 (V), 畫電纜 (L), 插入元件 (C), 插入天線 (A), 設為訊號源 (S), 點 TestPoint (P), 校準比例 (K);
  T turns all labels on / off. Select a cable to drag its bend points (double-click a handle to remove one, double-click
  the cable to add one).
- Work is kept in the browser; use **儲存樓層 JSON** / **儲存全專案** to keep a file.

## Programme Studio

A separate browser tool for editing an engineering master programme (Gantt chart): MS Project-compatible scheduling,
"why this date" tracing, MS Project XML import / export and print-ready PDF. Open
[`programme-studio/index.html`](programme-studio/index.html), or
<https://rayliken.github.io/RayTool-public/programme-studio/>. Nothing is uploaded.

## Notes

- This package holds the tool only. No project data, drawings or results are included.
- Default naming follows `PRJ-RS-<floor>-<band>-<kind>-<number>`.
