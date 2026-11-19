# Programme Studio

在瀏覽器裏編輯工程 Master Programme（甘特圖），不用安裝任何軟件。

- 排程計算和 MS Project 一致：FS / SS / FF / SF 連結、lag、約束（SNET、MSO 等）、Deadline、工作日和假期。
- 「為什麼是這個日期」：選中工作就會顯示決定它日期的前置工作或約束，以及總浮時。
- 「檢查」分頁：列出遲於期限、循環連結、約束衝突等問題。
- 開啟和匯出 **MS Project XML**；匯出向量 **PDF**（A4–A1，可先預覽）、CSV、項目 JSON。

所有資料只在你的瀏覽器裏處理，不會上傳到任何伺服器。

## 使用

打開網站：<https://rayliken.github.io/RayTool-public/programme-studio/>

`.mpp` 檔請先在 MS Project 另存為 XML 再開啟。PDF 使用標準 Helvetica 字型，工作名稱請用英文。

## 第三方元件

- [jsPDF](https://github.com/parallax/jsPDF)（MIT）
- [JSZip](https://github.com/Stuk/jszip)（MIT）

兩者都在頁面載入時從 cdnjs 讀取。
