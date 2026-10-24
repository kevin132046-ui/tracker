# OptionFlow 桌面版（Linux・Windows）

和網站同一份程式，跑在自己的電腦上。視窗是 Electron；裡面的伺服器是 Cloudflare 自己的執行環境 workerd（透過 Miniflare），和正式站跑的是同一份 `dist/`。

- **資料**存在這台電腦：D1 變成 SQLite 檔，R2 變成資料夾。
  - Windows：`%APPDATA%\OptionFlow\data`
  - Linux：`~/.config/OptionFlow/data`
  - 選單「檔案 → 開啟資料資料夾」可以直接打開。
- **伺服器**只在 `127.0.0.1` 上聽（預設連接埠 47820，被占用時往後找），關掉 App 就停。前面有一層小 Worker，只接受帶著這次啟動隨機金鑰的請求，金鑰只有 App 視窗知道，所以同一台電腦上的其他程式、瀏覽器或使用者連進來都會得到 403。
- **App 當掉時**：workerd 不會跟著停。App 會在資料夾裡記下 `server.json`，下次啟動時把上次留下的 workerd 停掉，取回原本的連接埠。
- **Electron 安全開關（fuses）**：不能用 `ELECTRON_RUN_AS_NODE`、`NODE_OPTIONS` 或除錯參數改變 App 的行為，只從 `app.asar` 載入並驗證它的完整性，cookie 加密存放。視窗開啟沙箱與 contextIsolation，不能開 `<webview>`。
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

## 系統需求

- **Windows** 10／11，x64。Windows on ARM 會以 x64 模擬執行。
- **Linux** x64，glibc 2.35 以上（Ubuntu 22.04、Debian 12、Fedora 36 以上）。AppImage 需要 `libfuse2`（Ubuntu 24.04 是 `libfuse2t64`）；Ubuntu 24.04 的 AppArmor 可能擋下 AppImage 的沙箱，建議改用 `.deb`。

## 打包

```bash
cd desktop
npm run dist:linux   # release/ 裡產生 AppImage 與 deb
npm run dist:win     # 在 Windows 上產生安裝檔（NSIS）與免安裝 zip
```

網站建置（`../dist`）和內建背景會放進安裝檔的 `resources/`，workerd 執行檔則從 `app.asar` 解開，才能被啟動。

正式發佈交給 `.github/workflows/desktop.yml`：PR 動到 `desktop/` 時會打包並跑煙霧測試（安裝檔放在 workflow 的 artifacts）；推送 `desktop-v*` 標籤時另外建立 GitHub Release。

