# OptionFlow

選擇權與股票的交易紀錄網站：記錄賣出賣權（cash-secured put）、買賣權、股票與現金股息，計算未實現損益、年化 ROC、時間加權報酬，並提供財報日曆、休市提醒、SEC 財報分析與 CSV 匯入匯出。

跑在 **Cloudflare Workers** 上（[vinext](https://www.npmjs.com/package/vinext)＋React 19），資料存在 **D1**，自訂背景圖存在 **R2**。

> English summary: a personal options and stock trade tracker for Cloudflare Workers (vinext, D1, R2). Clone it, create your own D1 database, R2 bucket, API keys and Cloudflare Access application, then deploy. The repo contains no personal data: the sample trades are fictional and every key is read from Cloudflare secrets.

## 這個 repo 不含任何個人資料

- `lib/server/database.ts` 裡的示範交易是**虛構的**，只在全新、空白的資料庫第一次啟動時寫入一次。
- API 金鑰、Cloudflare Access 設定都不在程式碼裡，全部從 Cloudflare 的 Secrets／Variables 讀取。
- 對帳單（`*.pdf`）、匯出的交易 CSV、`/private/` 資料夾都已列在 `.gitignore`，不會被提交。
- `prototype/` 的和風介面原型用虛構持倉；原型用到的插畫、剪影與音樂不在 repo 內。

## 功能

| 區塊 | 內容 |
|---|---|
| 交易明細 | 新增／編輯交易、欄位挑選、CSV 匯入（先預覽、偵測重複）與匯出 |
| 績效 | 未實現損益、年化 ROC（依擔保金／成本）、時間加權報酬與基準比較 |
| 選擇權工具 | Black–Scholes 定價、隱含波動率、Greeks、賣方風險條、到期日曆 |
| 提醒 | 美日休市前一週提示、持倉的財報日（7 天前、1 天前） |
| 股息 | 依除息日持股計算，在發放日入帳；稅率與發放日可手動調整 |
| AI（選用） | 用 Claude 或 ChatGPT 查財報日、讀 SEC 財報寫分析；ChatGPT 會先檢查每日免費額度 |

## 本機開發

需要 Node.js 22.13 以上與 pnpm。

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

本機的 D1 由 Wrangler 模擬（存在 `.wrangler/state`），第一次啟動會自動建表並寫入虛構的示範交易。

檢查指令：

```bash
npx tsc --noEmit -p .
pnpm lint
pnpm build
```

## 部署到你自己的 Cloudflare 帳號

1. **建立 D1 與 R2**
   - Cloudflare 後台 → Storage & Databases → D1 → 建一個資料庫，記下它的 Database ID。
   - R2 → 建一個 bucket（放自訂背景圖）。
2. **改成你的資源**
   - `vite.config.ts`：把 `SITE_CREATOR_DATABASE_ID`、`database_name`、`bucket_name` 換成你的 D1 與 R2。
   - Binding 名稱維持 `DB` 與 `BACKGROUND_IMAGES`（程式靠這兩個名字找資源）。
3. **建置與部署**

   ```bash
   pnpm build
   npx wrangler deploy --name <你的 Worker 名稱>
   ```

   也可以在 Cloudflare 後台用 Workers Builds 連接你 fork 的 repo：建置指令 `pnpm build`，部署指令 `npx wrangler deploy`。
4. **Preview 環境**要另外綁一次 `DB` 與 `BACKGROUND_IMAGES`，否則預覽網址讀不到資料，畫面會顯示 $0。

## Secrets 與 Variables

在 Worker → Settings → Variables and Secrets 新增，或用 `npx wrangler secret put <名稱>`。全部都是選用的，沒設定的功能會停用，其他功能照常運作。

| 名稱 | 類型 | 用途 |
|---|---|---|
| `ACCESS_TEAM_DOMAIN` | Variable | Cloudflare Access 的 team domain，例如 `yourteam.cloudflareaccess.com` |
| `ACCESS_AUD` | Variable | Access 應用程式的 AUD tag；正式網址與預覽網址分開時用逗號隔開 |
| `OPENAI_API_KEY` | Secret | ChatGPT（Responses API） |
| `OPENAI_ADMIN_KEY` | Secret | 讀 OpenAI 組織的 Usage API，用來檢查每日免費額度；只在伺服器端使用，不要貼進網頁 |
| `OPENAI_MODEL` | Variable | 設定卡片沒指定時使用的 ChatGPT 模型 |
| `ANTHROPIC_API_KEY` | Secret | Claude |
| `SEC_CONTACT` | Variable | 向 SEC EDGAR 請求時放在 User-Agent 的聯絡 Email（SEC 規定） |

**新增 Secret 後要重新部署一次**，新的版本才讀得到。

## 保護 AI 功能：Cloudflare Access

`/api/ai` 會呼叫付費 API，所以只接受通過 Cloudflare Access 的請求。沒有設定 Access 時，這個端點會直接拒絕（fail closed），網站其他部分照常運作。

1. Cloudflare 後台 → Zero Trust → Access → Applications → Add an application → Self-hosted。
2. 網域填你的 Worker 網址（`<worker>.<subdomain>.workers.dev`），政策只允許你自己的 Email。
3. 把應用程式的 **AUD tag** 填進 `ACCESS_AUD`，team domain 填進 `ACCESS_TEAM_DOMAIN`，然後重新部署。

## 匯入你自己的交易

打開網站 → 交易明細 → 匯入 CSV，先預覽，確認後才寫入。格式和「匯出 CSV」相同，可以先匯出一份來當範本。示範交易可以直接刪除。

## `prototype/`：和風介面原型

桔梗與時雨兩個主題的介面原型（React 19＋Vite），含開場動畫、水墨流體、光環圖示、AI 助理與匯入畫面。資料全部是虛構的示範值，不會連到正式站。

```bash
cd prototype
pnpm install
pnpm dev
```

原型的背景插畫、開場剪影與背景音樂不在 repo 內：

- **背景**：沒有圖時只顯示主題底色；可以用側欄的「背景」上傳自己的圖。
- **剪影**：`src/assets/silhouettes.ts` 留空時，開場照常播放，只是不畫剪影。
- **音樂**：把自己的音檔放在 `public/bgm/`（檔名見 `src/lib/audio.ts`），這個資料夾已被 `.gitignore` 排除。
