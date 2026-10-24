# OptionFlow 桌面版（Linux・Windows）

和網站同一份程式，跑在自己的電腦上。視窗是 Electron；裡面的伺服器是 Cloudflare 自己的執行環境 workerd（透過 Miniflare），和正式站跑的是同一份 `dist/`。

- **資料**存在這台電腦：D1 變成 SQLite 檔，R2 變成資料夾。
  - Windows：`%APPDATA%\OptionFlow\data`
  - Linux：`~/.config/OptionFlow/data`
  - 選單「檔案 → 開啟資料資料夾」可以直接打開。
- **伺服器**只在 `127.0.0.1` 上聽（預設連接埠 47820，被占用時往後找），只有這台電腦連得到，關掉 App 就停。
- **沒有 Cloudflare Access**：資料端點只接受 `127.0.0.1`／`localhost` 來的請求，別的網站送來的寫入一律拒絕（和網站版同一套檢查）。AI 功能用你在「設定 → AI」貼的金鑰。
- **第一次打開**會寫入虛構的示範交易，背景是內建的卡帶未來主義主控台（`resources/default-background.jpg`，原始碼在 `art/`）。換掉或改回原始之後就不會再自動放回來。
- **搬資料**：在網站版「設定 → 資料 → 匯出完整備份」，再到桌面版「從備份還原」。

## 開發

需要 Node.js 22.13 以上。

```bash
# 1. 在 repo 根目錄建置網站（產生 dist/）
npx -y pnpm@10 install --frozen-lockfile
npm run build

# 2. 桌面版
cd desktop
npm install
npm test          # 用 dist/ 啟動本機伺服器，測首頁、資料、重開後資料還在、跨站請求被拒
npm start         # 開視窗
npm run smoke     # 開視窗、確認頁面與資料端點正常後自動關閉（CI 用）
```

Linux 以 root 執行 Electron 時要加 `--no-sandbox`（例如在容器裡）。
