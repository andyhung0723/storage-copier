# Storage Copier

Chrome 擴充套件，可在不同分頁間複製貼上 `sessionStorage`、`localStorage`、`Cookie`。

## 安裝

1. 前往 `chrome://extensions`
2. 開啟右上角「開發者模式」
3. 點擊「載入未封裝項目」→ 選擇本目錄

## 使用方式

### 複製（A 網站）

1. 在 A 網站開啟 popup
2. 勾選要複製的類型：`sessionStorage` / `localStorage` / `Cookies`（可多選）
3. 按「讀取」，列表會顯示所有 entries
4. 勾選要複製的項目（預設全選），點 value 可展開完整內容
5. 按「複製選取項目」

### 貼上（B 網站）

1. 切換到 B 網站，開啟 popup
2. 上方會顯示剪貼簿預覽（來源 domain、筆數、類型）
3. 按「貼上到此網站」完成寫入，剪貼簿會自動清除
4. 或按「清除」丟棄剪貼簿資料
