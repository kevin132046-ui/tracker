'use client';

import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useEffect, useRef, useState } from 'react';

type Language = 'zh-TW' | 'ja-JP' | 'en';

const storageKey = 'optionflow-interface-language';
const languages: ReadonlyArray<{ id: Language; label: string }> = [
  { id: 'zh-TW', label: '中文' },
  { id: 'ja-JP', label: '日本語' },
  { id: 'en', label: 'English' },
];
const isLanguage = (value: unknown): value is Language => languages.some((language) => language.id === value);

// [中文, 日本語, English]. The page renders Chinese; this list swaps its text in place. English is
// null where a replacement would break other text (single characters such as 日／月 inside dates).
const translations: ReadonlyArray<readonly [string, string | null, string | null]> = [
  ['先選擇交易方向，再搜尋標的與策略。', 'まず取引の方向を選び、銘柄と戦略を検索します。', 'Pick the trade direction first, then search the symbol and strategy.'], ['支援美股、ETF 與選擇權交易。', '米国株、ETF、オプション取引に対応。', 'US stocks, ETFs and options.'], ['支援東京證券交易所 4 位股票代碼，價格以日圓顯示。', '東証の4桁銘柄コードに対応。価格は円で表示。', 'Tokyo Stock Exchange 4-digit codes; prices in yen.'], ['輸入 MS 搜尋 MSFT…', 'MS と入力して MSFT を検索…', 'Type MS to find MSFT…'], ['輸入 7203 或 Toyota…', '7203 または Toyota と入力…', 'Type 7203 or Toyota…'], ['設定日期與口數；填入平倉日會自動切換狀態。', '日付と数量を設定。決済日を入れると状態が自動で切り替わります。', 'Set dates and quantity; entering a close date switches the status automatically.'], ['輸入價格、費用與投入資本，損益會立即重算。', '価格、手数料、投下資本を入力すると損益がすぐ再計算されます。', 'Enter prices, fees and capital; P&L recalculates at once.'], ['記錄交易想法、催化劑或檢討…', '取引の考え、材料、振り返りをメモ…', 'Trade idea, catalyst or review…'], ['所有欄位可隨時回來修改，儲存後會同步更新圖表與持倉配置。', 'すべての項目は後から修正できます。保存するとチャートと構成も更新されます。', 'Every field can be changed later; saving updates the charts and allocation.'], ['資料會安全儲存並立即更新儀表板', 'データは安全に保存され、ダッシュボードにすぐ反映されます', 'Saved securely and shown on the dashboard right away'], ['記錄日期與目前可用現金；之後可隨時編輯或刪除。', '日付と現在の利用可能現金を記録。後から編集・削除できます。', 'Record the date and cash available; edit or delete it any time.'], ['現金以原幣餘額保存；組合總值會用最新 USD／JPY 匯率換算。', '現金は現地通貨残高で保存。合計は最新の USD／JPY レートで換算。', 'Cash is kept in its own currency; the total converts at the latest USD/JPY rate.'], ['原幣保存並納入持倉配置。', '現地通貨で保存し、構成に含めます。', 'Kept in its own currency and counted in the allocation.'], ['即時計算損益（USD）', 'リアルタイム損益（USD）', 'Live P&L (USD)'], ['納入組合價值（USD）', 'ポートフォリオ計上額（USD）', 'Counted in portfolio (USD)'], ['權利金 × 100 × 口數 − 手續費', 'プレミアム × 100 × 枚数 − 手数料', 'Premium × 100 × contracts − fees'], ['履約價 ∓ 每股權利金（已計入手續費）', '権利行使価格 ∓ 1株あたりプレミアム（手数料込み）', 'Strike ∓ premium per share (after fees)'], ['天（開倉至到期）', '日（建玉から満期まで）', 'days (open to expiry)'], ['到期天數（DTE）', '満期までの日数（DTE）', 'Days to expiry (DTE)'], ['正在取得最新可用報價…', '最新の価格を取得中…', 'Getting the latest quote…'], ['由上方幣別自動設定', '上の通貨から自動設定', 'Set from the currency above'], ['輸入 Ticker 後會自動填入', 'ティッカーを入力すると自動入力', 'Filled in once you enter a ticker'], ['尚未選擇標的', '銘柄未選択', 'No symbol yet'], ['尚未設定', '未設定', 'Not set'], ['不需股票 API', '株価 API 不要', 'No stock API needed'], ['收取權利金', '権利金を受取', 'Premium received'], ['支付權利金', '権利金を支払', 'Premium paid'], ['承接標的', '原資産を引受', 'Assigned shares'], ['日圓 JPY', '日本円 JPY', 'Yen JPY'], ['美元 USD', '米ドル USD', 'US dollar USD'], ['日本股票', '日本株', 'Japanese stocks'], ['未知股票', '不明な銘柄', 'Unknown stock'], ['需要到期日', '満期日が必要', 'Needs an expiry date'], ['選擇策略', '戦略を選択', 'Choose a strategy'], ['自動填入', '自動入力', 'Auto-filled'], ['已填入', '入力済み', 'Filled'], ['儲存中…', '保存中…', 'Saving…'], ['讀取中…', '読込中…', 'Loading…'], ['取得報價中…', '価格取得中…', 'Getting quote…'], ['重試', '再試行', 'Retry'], ['不適用', '該当なし', 'N/A'], ['或 185/180', 'または 185/180', 'or 185/180'], ['餘額', '残高', 'Balance'], ['價平', 'ATM', 'ATM'], ['幣別', '通貨', 'Currency'], ['成交價', '約定価格', 'Fill price'],
  ['返回持倉總覽', '保有資産一覧に戻る', 'Back to holdings'], ['跨券商資產追蹤與再平衡', '複数証券口座の資産追跡とリバランス', 'Cross-broker asset tracking and rebalancing'],
  ['外國投資人股息稅與現金入帳', '外国投資家の配当税と現金計上', 'Dividend tax for foreign investors and cash credit'], ['美股外國人股息預扣稅率', '米国株・外国人配当源泉税率', 'US dividend withholding rate for foreign investors'],
  ['日股外國人股息預扣稅率', '日本株・外国人配当源泉税率', 'Japan dividend withholding rate for foreign investors'], ['USD 稅後股息現金', 'USD 税引後配当現金', 'USD after-tax dividend cash'],
  ['JPY 稅後股息現金', 'JPY 税引後配当現金', 'JPY after-tax dividend cash'], ['股息自動入帳設定已保存', '配当の自動計上設定を保存しました', 'Dividend auto-credit settings saved'],
  ['股息自動入帳已關閉', '配当の自動計上を無効にしました', 'Dividend auto-credit turned off'], ['交易與持倉', '取引と保有資産', 'Trades and holdings'],
  ['持倉配置', 'ポートフォリオ構成', 'Allocation'], ['持倉市值', '保有時価', 'Market value'], ['組合占比', '構成比', 'Weight'], ['持倉數量', '保有数量', 'Quantity held'],
  ['標的價格波動／今日漲跌', '銘柄の値動き／本日の騰落', 'Price move / today\'s change'], ['成本均價／現價', '平均取得価格／現在値', 'Average cost / price'],
  ['損益／報酬率', '損益／リターン', 'P&L / return'], ['標的／公司', '銘柄／会社', 'Symbol / company'], ['圖形持倉', 'ビジュアル保有', 'Visual holdings'], ['交易明細', '取引明細', 'Trades'],
  ['未平倉', '保有中', 'Open'], ['已平倉', '決済済み', 'Closed'], ['選擇權', 'オプション', 'Options'], ['股票', '株式', 'Stocks'], ['現金', '現金', 'Cash'], ['全部', 'すべて', 'All'],
  ['股票均價', '平均取得価格', 'Average stock cost'], ['成交均價', '約定平均価格', 'Average fill price'], ['目前價格', '現在値', 'Current price'], ['正常收盤', '通常終値', 'Regular close'],
  ['盤前漲跌', 'プレマーケット騰落', 'Pre-market change'], ['盤後漲跌', 'アフターマーケット騰落', 'After-hours change'], ['標的今日漲跌', '本日の騰落', 'Today\'s change'],
  ['等待報價', '価格待ち', 'Waiting for quote'], ['不需報價', '価格取得不要', 'No quote needed'], ['手動價格', '手動価格', 'Manual price'], ['權利金手動', 'プレミアム手動', 'Manual premium'],
  ['API 無法取得', 'API 取得不可', 'API unavailable'], ['API 待更新', 'API 更新待ち', 'API update pending'], ['股息自動入帳', '配当自動計上', 'Dividend auto-credit'], ['現金餘額', '現金残高', 'Cash balance'],
  ['日本日期讀取中', '日本の日付を読込中', 'Loading Japan date'], ['日本祝日', '日本の祝日', 'Japanese holiday'], ['日股休市', '日本株休場', 'Japan market closed'], ['美股休市', '米国株休場', 'US market closed'], ['週末', '週末', 'Weekend'],
  ['發放公司', '配当支払会社', 'Paying company'], ['發放 · 稅後入帳', '支払 · 税引後計上', 'Paid · credited after tax'], ['股息發放公司', '配当支払会社', 'Dividend payer'],
  ['股息來源', '配当元', 'Dividend source'], ['調減股息入帳', '配当入金を減額', 'Reduce dividend credit'], ['調整後入帳金額', '調整後入金額', 'Adjusted credit'], ['原始稅後金額', '元の税引後金額', 'Original after-tax amount'], ['刪除股息', '配当を削除', 'Delete dividend'],
  ['目前入帳', '現在の入金額', 'Current credit'], ['手動調減', '手動減額', 'Manual reduction'], ['保存調整', '調整を保存', 'Save adjustment'], ['調減', '減額', 'Reduce'], ['還原', '復元', 'Restore'],
  ['馬丁路德金恩紀念日', 'キング牧師記念日', 'Martin Luther King Jr. Day'], ['華盛頓誕辰', 'ワシントン誕生日', 'Washington\'s Birthday'], ['耶穌受難日', '聖金曜日', 'Good Friday'], ['陣亡將士紀念日', '戦没将兵追悼記念日', 'Memorial Day'],
  ['六月節', 'ジューンティーンス', 'Juneteenth'], ['美國獨立日', '米国独立記念日', 'Independence Day'], ['勞動節', 'レイバー・デー', 'Labor Day'], ['感恩節', '感謝祭', 'Thanksgiving'], ['聖誕節', 'クリスマス', 'Christmas'],
  ['原幣現金', '現地通貨現金', 'Cash in original currency'], ['組合換算', 'ポートフォリオ換算', 'Portfolio value'], ['資料來源', 'データソース', 'Data source'], ['現金部位', '現金ポジション', 'Cash position'],
  ['新增交易', '取引を追加', 'Add trade'], ['編輯交易', '取引を編集', 'Edit trade'], ['交易設定', '取引設定', 'Trade settings'], ['交易類型', '取引タイプ', 'Trade type'],
  ['股票市場', '株式市場', 'Stock market'], ['現金幣別', '現金通貨', 'Cash currency'], ['美國', '米国', 'US'], ['日本', '日本', 'Japan'], ['美元', '米ドル', 'US dollar'], ['日圓', '日本円', 'Japanese yen'],
  ['賣方', '売り', 'Short'], ['買方', '買い', 'Long'], ['指派', '割当', 'Assigned'], ['現股持倉', '現物保有', 'Shares held'], ['USD／JPY 餘額', 'USD／JPY 残高', 'USD / JPY balance'],
  ['策略／事件', '戦略／イベント', 'Strategy / event'], ['履約價／組合', '権利行使価格／組合せ', 'Strike / combo'], ['合約期間', '契約期間', 'Contract period'], ['開倉日', '建玉日', 'Open date'],
  ['到期日', '満期日', 'Expiry'], ['平倉日', '決済日', 'Close date'], ['數量', '数量', 'Quantity'], ['價格與風險', '価格とリスク', 'Price and risk'], ['成本／成交價', '取得／約定価格', 'Cost / fill price'],
  ['持倉／平倉價', '保有／決済価格', 'Holding / exit price'], ['手續費', '手数料', 'Fees'], ['擔保／投入資本', '担保／投下資本', 'Collateral / capital'], ['報價方式', '価格取得方法', 'Quote source'],
  ['自動更新', '自動更新', 'Auto update'], ['手動輸入', '手動入力', 'Manual entry'], ['持倉狀態', '保有状態', 'Position status'], ['備註', 'メモ', 'Notes'], ['儲存交易', '取引を保存', 'Save trade'],
  ['取消', 'キャンセル', 'Cancel'], ['永久刪除', '完全に削除', 'Delete permanently'], ['刪除交易', '取引を削除', 'Delete trade'], ['保留紀錄', '記録を残す', 'Keep record'], ['交易預覽', '取引プレビュー', 'Trade preview'],
  ['現金預覽', '現金プレビュー', 'Cash preview'], ['原幣餘額', '現地通貨残高', 'Balance in original currency'], ['組合換算 USD', 'USD 換算', 'USD equivalent'], ['納入組合價值', 'ポートフォリオ計上額', 'Counted in portfolio'],
  ['即時計算損益', 'リアルタイム損益', 'Live P&L'], ['持有天數', '保有日数', 'Days held'], ['狀態', '状態', 'Status'], ['報價', '価格', 'Quote'], ['可用現金', '利用可能現金', 'Available cash'],
  ['設定', '設定', 'Settings'], ['總覽', '概要', 'Overview'], ['持倉', '保有資産', 'Holdings'], ['收益', 'リターン', 'Returns'], ['估值', 'バリュエーション', 'Valuation'], ['背景', '背景', 'Background'],
  ['換圖片', '画像変更', 'Change image'], ['原始', '標準', 'Default'], ['圖片', '画像', 'Image'], ['更新報價', '価格を更新', 'Refresh quotes'], ['非交易時段', '取引時間外', 'Market closed'], ['美股交易中', '米国市場取引中', 'US market open'],
  ['追蹤市值', '追跡時価', 'Tracked value'], ['未實現損益', '含み損益', 'Unrealized P&L'], ['擔保／投入資本', '担保／投下資本', 'Collateral / capital'], ['本年度加權年化 ROC', '今年度加重年率 ROC', 'Weighted annualized ROC this year'],
  ['日收益率', '日次リターン', 'Daily return'], ['週收益率', '週次リターン', 'Weekly return'], ['月收益率', '月次リターン', 'Monthly return'], ['年收益率', '年次リターン', 'Yearly return'],
  ['最近一期報酬率', '直近期間リターン', 'Latest period return'], ['我的組合', 'マイポートフォリオ', 'My portfolio'], ['匯率與美債價格波動', '為替・米国債価格変動', 'FX and Treasury price moves'],
  ['股票走勢', '株価推移', 'Stock chart'], ['最新收盤', '最新終値', 'Latest close'], ['最新價格', '最新価格', 'Latest price'], ['前收', '前日終値', 'Prev close'], ['日線價格', '日足価格', 'Daily price'], ['價格走勢', '価格推移', 'Price trend'], ['期間高點', '期間高値', 'Period high'], ['期間低點', '期間安値', 'Period low'],
  ['自由調整期間', '期間を自由に設定', 'Custom range'], ['開始', '開始', 'Start'], ['結束', '終了', 'End'], ['套用', '適用', 'Apply'], ['自訂', 'カスタム', 'Custom'], ['蠟燭', 'ローソク足', 'Candles'], ['技術線疊圖', 'テクニカル指標の重ね表示', 'Technical overlays'],
  ['公司資訊與財務品質', '企業情報と財務品質', 'Company profile and financial quality'], ['公司資訊', '企業情報', 'Company profile'], ['財務品質', '財務品質', 'Financial quality'], ['最近季度自由現金流', '直近四半期フリーCF', 'Latest quarterly free cash flow'],
  ['自由現金流', 'フリーキャッシュフロー', 'Free cash flow'], ['營運現金流', '営業キャッシュフロー', 'Operating cash flow'], ['資本支出', '設備投資', 'Capital expenditure'], ['營收', '売上高', 'Revenue'],
  ['淨利率', '純利益率', 'Net margin'], ['營業利益率', '営業利益率', 'Operating margin'], ['現金與短期投資', '現金・短期投資', 'Cash and short-term investments'], ['總負債', '有利子負債', 'Total debt'],
  ['淨現金／（淨負債）', 'ネットキャッシュ／（ネットデット）', 'Net cash / (net debt)'], ['股息殖利率', '配当利回り', 'Dividend yield'], ['配息率', '配当性向', 'Payout ratio'],
  ['最近除息日', '直近権利落ち日', 'Latest ex-dividend date'], ['最近每股股息', '直近1株配当', 'Latest dividend per share'], ['歷史', '履歴', 'History'], ['季度資料', '四半期データ', 'Quarterly data'], ['年度資料', '年次データ', 'Annual data'],
  ['長條', '棒', 'Bars'], ['折線', '折れ線', 'Line'], ['疊圖', '重ね表示', 'Overlay'], ['不疊加', '重ねない', 'No overlay'], ['季', '四半期', null], ['年', '年', null], ['日', '日', null], ['週', '週', null], ['月', '月', null],
  ['開啟 DCF 估值', 'DCF評価を開く', 'Open DCF valuation'], ['關閉 DCF 估值', 'DCF評価を閉じる', 'Close DCF valuation'], ['保存稅率', '税率を保存', 'Save tax rate'], ['開啟', '有効', 'On'], ['關閉', '無効', 'Off'],
  ['計算中', '計算中', 'Calculating'], ['保存中', '保存中', 'Saving'], ['讀取中', '読込中', 'Loading'], ['更新中', '更新中', 'Updating'], ['搜尋', '検索', 'Search'], ['新增', '追加', 'Add'], ['編輯', '編集', 'Edit'], ['刪除', '削除', 'Delete'],
  ['沒有符合目前篩選條件的持倉', '現在の条件に一致する保有資産はありません', 'No holdings match the current filters'], ['正在整理圖形化持倉', '保有資産を整理しています', 'Arranging visual holdings'],
  ['這個日期沒有持倉紀錄', 'この日付には保有記録がありません', 'No holdings on this date'], ['正在讀取歷史持倉', '過去の保有資産を読み込んでいます', 'Loading past holdings'],
  [' 筆', ' 件', ' items'], [' 股', ' 株', ' shares'], [' 天', ' 日', ' days'], ['最近計算', '直近計算', 'Last calculated'], ['預扣', '源泉徴収', 'withholding'], ['筆事件', '件のイベント', 'events'],
  // Holiday notice.
  ['休市預告', '休場予告', 'Market closures'], ['美日休市預告', '日米休場予告', 'US/Japan market closures'], ['關閉休市預告', '休場予告を閉じる', 'Hide closure notice'], ['美股提前收盤', '米国株短縮取引', 'US early close'],
  ['美國獨立日前夕', '米国独立記念日前日', 'Day before Independence Day'], ['感恩節翌日', '感謝祭翌日', 'Day after Thanksgiving'], ['平安夜', 'クリスマス・イブ', 'Christmas Eve'], ['· 今天', '· 今日', '· today'],
  ['週一', '月曜', 'Mon'], ['週二', '火曜', 'Tue'], ['週三', '水曜', 'Wed'], ['週四', '木曜', 'Thu'], ['週五', '金曜', 'Fri'],
  ['未來 7 天內有美股或日股休市、或美股提前收盤（13:00 ET）時，在頁首下方顯示一行提示。', '今後 7 日以内に米国株・日本株の休場、または米国株の短縮取引（13:00 ET）がある場合、ヘッダーの下に 1 行で表示します。', 'Shows a one-line notice under the header when the US or Japanese market is closed, or the US market closes early (13:00 ET), within the next 7 days.'],
  ['按提示右側的 × 只會隱藏目前這幾天；設定保存在這個瀏覽器。', '右側の × は現在表示中の日だけを非表示にします。設定はこのブラウザに保存されます。', 'The × on the right hides only the days shown now; the setting is saved in this browser.'],
  // Earnings calendar. Timing labels carry their separator so quote-session labels stay as they are.
  ['市場提醒', 'マーケット通知', 'Market notices'], ['財報', '決算', 'Earnings'], [' · 盤前', ' · 寄り前', ' · pre-market'], [' · 盤後', ' · 引け後', ' · after close'], ['（預估）', '（予想）', '(estimate)'], ['Yahoo 預估', 'Yahoo 予想', 'Yahoo estimate'],
  ['無法連線', '接続できません', 'Can\'t connect'], ['日股不支援', '日本株非対応', 'Japan not supported'], ['持倉財報日曆與提醒', '保有銘柄の決算カレンダーと通知', 'Earnings calendar and reminders for holdings'], ['持倉財報日', '保有銘柄の決算日', 'Holdings\' earnings dates'],
  ['手動財報日', '手動の決算日', 'Manual earnings date'], ['清除手動財報日', '手動の決算日をクリア', 'Clear manual earnings date'], ['目前沒有未平倉的股票或選擇權。', '保有中の株式・オプションはありません。', 'No open stocks or options.'],
  ['列出未平倉股票與選擇權標的的下一次財報日；財報前 7 天起在頁首下方提醒。日期來自 Yahoo Finance，查不到時可自行填入。', '保有中の株式・オプション銘柄の次回決算日を一覧表示し、決算の 7 日前からヘッダーの下で通知します。日付は Yahoo Finance から取得し、見つからない場合は手動で入力できます。', 'Lists the next earnings date for each open stock and option underlying, with a notice under the header from 7 days before. Dates come from Yahoo Finance; enter one yourself when none is found.'],
  ['手動日期優先於 Yahoo，過了那天會自動改回 Yahoo 的日期；手動日期與開關保存在這個瀏覽器。', '手動の日付は Yahoo より優先され、その日を過ぎると Yahoo の日付に戻ります。手動の日付と設定はこのブラウザに保存されます。', 'A manual date takes priority over Yahoo and switches back to Yahoo\'s date once it has passed; manual dates and the switch are saved in this browser.'],
  // AI earnings lookups.
  ['設定連結', '設定リンク', 'Setup links'], ['Claude API 金鑰', 'Claude API キー', 'Claude API keys'], ['OpenAI API 金鑰', 'OpenAI API キー', 'OpenAI API keys'], ['OpenAI 模型清單', 'OpenAI モデル一覧', 'OpenAI model list'], ['Cloudflare 後台', 'Cloudflare ダッシュボード', 'Cloudflare dashboard'], ['Access 設定說明', 'Access 設定ガイド', 'Access setup guide'], ['AI 查詢設定連結', 'AI 検索の設定リンク', 'AI lookup setup links'],
  ['ChatGPT 模型', 'ChatGPT モデル', 'ChatGPT model'], ['輸入 OpenAI 模型名稱', 'OpenAI のモデル名を入力', 'Enter an OpenAI model name'], ['查詢中…', '検索中…', 'Searching…'], ['（公司已公布）', '（会社発表済み）', '(announced by the company)'], ['（未經公司確認）', '（会社未確認）', '(not confirmed by the company)'],
  ['找不到日期', '日付が見つかりません', 'No date found'], ['略過', 'スキップ', 'Dismiss'], ['AI 查詢：確認登入狀態中…', 'AI 検索：ログイン状態を確認中…', 'AI lookup: checking sign-in…'],
  ['AI 查詢：可用 Claude／ChatGPT 上網查財報日；結果只是建議，按「套用」才會存成手動日期。每次查詢會使用你的 API 額度。', 'AI 検索：Claude／ChatGPT でウェブ上の決算日を調べます。結果は提案のみで、「適用する」を押すまで保存されません。検索ごとに API の利用枠を使います。', 'AI lookup: Claude or ChatGPT can search the web for the earnings date. It is only a suggestion until you press “Apply”, which saves it as a manual date. Each lookup uses your API credit.'],
  // SEC filings, AI settings and the analysis dialog.
  ['財報已公布', '決算発表済み', 'Earnings released'], [' · 查看解讀', ' · 解説を見る', ' · view analysis'], ['財報解讀', '決算解説', 'Earnings analysis'], ['重新產生分析', '分析を再生成', 'Regenerate analysis'], ['產生分析', '分析を生成', 'Generate analysis'],
  ['追問', '追加質問', 'Follow-up'], ['送出', '送信', 'Send'], ['申報', '提出', 'Filed'], ['預設 AI', '既定の AI', 'Default AI'], ['可使用', '使用可', 'Ready'], ['未啟用', '利用不可', 'Not enabled'],
  ['財報解讀問題清單', '決算解説の質問リスト', 'Earnings analysis questions'], ['還原預設問題', '既定の質問に戻す', 'Restore default questions'], ['清除金鑰', 'キーを削除', 'Clear keys'], ['顯示金鑰', 'キーを表示', 'Show keys'], ['隱藏金鑰', 'キーを隠す', 'Hide keys'],
  ['OpenAI 金鑰', 'OpenAI キー', 'OpenAI key'], ['Claude 金鑰', 'Claude キー', 'Claude key'], ['分析依據的 SEC 文件', '分析元の SEC 文書', 'SEC document analysed'], ['SEC XBRL 季度數字', 'SEC XBRL 四半期データ', 'SEC XBRL quarterly figures'],
  ['針對這份財報繼續發問…', 'この決算について追加で質問…', 'Ask more about this report…'], ['產生中…（約 30–90 秒）', '生成中…（約 30〜90 秒）', 'Generating… (about 30–90 s)'], ['回答中…', '回答中…', 'Answering…'],
  ['用於查財報日、產生財報解讀和追問，以及在「匯入」用一句話或截圖記錄交易。每次使用都會花費你的 API 額度；結果僅供參考，不是投資建議。', '決算日の検索、決算解説の生成と追加質問、そして「インポート」で一文やスクリーンショットから取引を記録するのに使います。使用するたびに API の利用枠を消費します。結果は参考情報であり、投資助言ではありません。', 'Used to look up earnings dates, write earnings analyses and answer follow-ups, and to record trades from a sentence or screenshot in “Import”. Each use spends your API credit; results are for reference only and are not investment advice.'],
  ['分析與追問只存在這個瀏覽器，超過半年自動刪除。內容由 AI 根據 SEC 文件產生，可能有誤，不是投資建議。', '分析と追加質問はこのブラウザにのみ保存され、半年を過ぎると自動的に削除されます。内容は AI が SEC 文書から生成したもので、誤りがある可能性があり、投資助言ではありません。', 'Analyses and follow-ups are kept only in this browser and deleted after six months. The AI writes them from SEC documents; they may contain mistakes and are not investment advice.'],
  ['剛在 Cloudflare 新增 Secret 的話，要等下一次部署或重新建置後才會生效。', 'Cloudflare で Secret を追加した直後は、次回のデプロイまたは再ビルド後に反映されます。', 'A secret just added in Cloudflare takes effect after the next deploy or rebuild.'],
  // OpenAI free-token allowance.
  ['今日免費剩餘', '本日の無料残量', 'Free left today'], ['組內共用', 'グループ内で共有', 'shared within the group'], ['UTC 00:00（台灣 08:00）重置', 'UTC 00:00（台湾 08:00）にリセット', 'resets at 00:00 UTC (08:00 Taiwan)'], ['OpenAI 使用層級', 'OpenAI 利用ティア', 'OpenAI usage tier'],
  ['Tier 1–2（較小額度，預設）', 'Tier 1–2（少ない枠・既定）', 'Tier 1–2 (smaller allowance, default)'], ['ChatGPT 模型（只列免費額度內的模型）', 'ChatGPT モデル（無料枠の対象のみ）', 'ChatGPT model (free-tier models only)'], ['OpenAI 每日免費額度', 'OpenAI の1日あたり無料枠', 'OpenAI daily free tokens'],
  ['已保留 5% 緩衝', '5% の余裕を確保', '5% kept in reserve'], ['今日已用', '本日の使用量', 'Used today'], ['剩餘', '残量', 'Left'], ['組別', 'グループ', 'Group'], ['token 組', 'token グループ', 'token group'], ['OpenAI 免費額度說明', 'OpenAI 無料枠の説明', 'About OpenAI free tokens'],
  ['正在查詢 ChatGPT 今日免費額度…', 'ChatGPT の本日の無料枠を確認中…', 'Checking today\'s free ChatGPT tokens…'], ['正在查詢 OpenAI 免費額度…', 'OpenAI の無料枠を確認中…', 'Checking OpenAI free tokens…'],
  // Dividend pay dates.
  ['入帳日', '入金日', 'Credit date'], ['發放日', '支払日', 'Pay date'], ['除息日', '権利落ち日', 'Ex-dividend date'], ['待入帳', '入金待ち', 'Pending'], ['已入帳', '入金済み', 'Credited'], [' · 除息 ', ' · 権利落ち ', ' · ex-div '], [' · 發放 ', ' · 支払 ', ' · paid '], ['除息 ', '権利落ち ', 'Ex-div '], ['預估', '推定', 'Estimated'],
  ['股息入帳日', '配当の入金日', 'Dividend credit date'], ['近期股息發放日', '最近の配当支払日', 'Upcoming dividend pay dates'], ['發放日已更新', '支払日を更新しました', 'Pay date updated'], ['發放日已改回自動判斷', '支払日を自動判定に戻しました', 'Pay date set back to automatic'],
  ['公司實際付款那天才加入現金；股數以除息日前一天收盤時的持股計算。', '会社が実際に支払った日に現金へ加算します。株数は権利落ち日前日の終値時点の保有数で計算します。', 'Cash is added on the day the company actually pays; the share count is the holding at the close before the ex-dividend date.'],
  ['在除息日就加入現金（舊做法）。', '権利落ち日に現金へ加算します（従来の方式）。', 'Add cash on the ex-dividend date (the old way).'],
  // Trader tools. Only whole phrases: a Japanese side must never occur inside Chinese UI text, or
  // switching back would rewrite it.
  ['目前（預設）', '現在（既定）', 'Current (default)'], ['精簡', 'コンパクト', 'Compact'], ['選擇權賣方', 'オプション売り手', 'Option seller'], ['風險', 'リスク', 'Risk'],
  ['顯示欄位', '表示する列', 'Columns'], ['選擇交易明細欄位', '取引明細の列を選択', 'Choose trade table columns'], ['欄位組合', '列プリセット', 'Column presets'], ['收合欄位選單', '列メニューを閉じる', 'Close column menu'],
  ['標的與操作欄固定顯示；股票與現金列的選擇權欄位顯示「—」。選擇會保存在這個瀏覽器。', '銘柄と操作の列は常に表示されます。株式・現金の行ではオプション列が「—」になります。選択はこのブラウザに保存されます。', 'Symbol and action columns always show; option columns read “—” on stock and cash rows. Your choice is saved in this browser.'],
  ['到期天數', '満期までの日数', 'Days to expiry'], ['價外%', 'OTM%', 'OTM %'], ['擔保占比', '担保比率', 'Collateral share'], ['被指派機率', '割当確率', 'Assignment probability'],
  ['Delta（股數當量）', 'デルタ（株数換算）', 'Delta (share equivalent)'], ['Theta/日（$）', 'シータ/日（$）', 'Theta/day ($)'], ['Vega（每 1 vol 點 $）', 'ベガ（1 ボラポイントあたり $）', 'Vega ($ per vol point)'], ['IV（隱含波動率）', 'IV（インプライド・ボラティリティ）', 'IV (implied volatility)'],
  ['選擇權賣方風險摘要', 'オプション売り手のリスク概要', 'Option seller risk summary'], ['選擇權部位風險', 'オプション建玉のリスク', 'Option position risk'], ['筆未平倉選擇權', '件の保有中オプション', 'open options'], ['筆未計入 Greeks', '件はグリークス未計算', 'not included in Greeks'],
  ['淨 Delta（股數當量）', '純デルタ（株数換算）', 'Net delta (share equivalent)'], ['標的名目', '原資産の想定元本', 'Underlying notional'], ['等待標的報價', '原資産価格を待機中', 'Waiting for underlying quote'], ['每日 Theta', '1日あたりのシータ', 'Daily theta'],
  ['每過一天；賣方為正收入', '1日ごと；売り手はプラス収入', 'Per day; positive income for sellers'], ['Vega（$／vol 點）', 'ベガ（$／ボラポイント）', 'Vega ($ / vol point)'], ['隱含波動率上升 1 點', 'IV が 1 ポイント上昇', 'IV up 1 point'],
  ['最近到期', '直近の満期', 'Nearest expiry'], ['未填到期日', '満期日未入力', 'No expiry entered'], ['最高被指派機率', '最大割当確率', 'Highest assignment probability'], ['沒有賣方部位', '売り建玉なし', 'No short positions'],
  ['擔保占用', '担保使用額', 'Collateral in use'], ['占全部投入資本', '全投下資本に占める割合', 'of all capital'], ['賣方選擇權的投入資本', '売りオプションの投下資本', 'Capital in short options'],
  ['選擇開倉日', '建玉日を選択', 'Choose open date'], ['選擇到期日', '満期日を選択', 'Choose expiry'], ['選擇平倉日', '決済日を選択', 'Choose close date'], ['上個月', '前月', 'Previous month'], ['下個月', '翌月', 'Next month'],
  ['快速選擇到期日', '満期日のクイック選択', 'Quick expiry picks'], ['快速選擇日期', '日付のクイック選択', 'Quick date picks'], ['上個交易日', '前営業日', 'Previous trading day'],
  ['月選擇權到期', '月次オプション満期', 'Monthly option expiry'], ['週選', '週次', 'Weekly'], ['月選', '月次', 'Monthly'], ['距今', '残り', 'from today'], ['已過', '経過', 'passed'], ['非交易日', '非取引日', 'Non-trading day'], ['清除', 'クリア', 'Clear'],
  ['選擇權快速策略', 'オプションのクイック戦略', 'Option quick strategies'], ['快速策略', 'クイック戦略', 'Quick strategies'],
  ['賣 PUT', 'PUT 売り', 'Sell PUT'], ['賣 CALL', 'CALL 売り', 'Sell CALL'], ['買 PUT', 'PUT 買い', 'Buy PUT'], ['買 CALL', 'CALL 買い', 'Buy CALL'],
  ['履約價快選', '行使価格クイック選択', 'Strike picks'], ['輸入 Ticker 後會顯示現價附近的履約價', 'Ticker を入力すると現在値付近の行使価格を表示します', 'Strikes near the price show after you enter a ticker'], ['現價附近的履約價', '現在値付近の行使価格', 'Strikes near the price'],
  ['賣出 PUT 擔保：履約價', 'PUT 売りの担保：行使価格', 'Short PUT collateral: strike'], ['自動填入擔保', '担保を自動入力', 'Fill in collateral'], ['已套用', '適用済み', 'Applied'],
  ['損益兩平', '損益分岐点', 'Breakeven'], ['最大獲利', '最大利益', 'Max profit'], ['無上限', '上限なし', 'Unlimited'], ['若到期歸零的年化報酬', '満期で価値ゼロの場合の年率リターン', 'Annualized return if it expires worthless'], ['隱含波動率', 'インプライド・ボラティリティ', 'Implied volatility'],
  ['取得標的報價後顯示隱含波動率與 Delta。', '原資産の価格を取得すると IV とデルタを表示します。', 'IV and delta show once the underlying has a quote.'], ['填入單一履約價與到期日後計算隱含波動率與 Delta。', '単一の行使価格と満期日を入力すると IV とデルタを計算します。', 'IV and delta are calculated after you enter one strike and an expiry.'],
  ['匯出 CSV', 'CSV エクスポート', 'Export CSV'], ['匯入交易 CSV', '取引 CSV をインポート', 'Import trades CSV'], ['拖放 CSV 檔到這裡', 'CSV ファイルをここにドロップ', 'Drop a CSV file here'], ['選擇檔案', 'ファイルを選択', 'Choose file'], ['換一個檔案', '別のファイルを選択', 'Choose another file'],
  ['支援逗號、Tab、分號分隔與引號欄位；可直接匯入本工具「匯出 CSV」的檔案，也能辨識常見券商欄位（英文／中文／日本語）。', 'カンマ・タブ・セミコロン区切りと引用符付きフィールドに対応。このツールの「CSV エクスポート」ファイルをそのまま読み込め、一般的な証券会社の列名（英語／中国語／日本語）も認識します。', 'Comma, tab and semicolon delimiters and quoted fields are supported. Files from this tool\'s “Export CSV” import as they are, and common broker columns (English / Chinese / Japanese) are recognised.'],
  ['欄位對應', '列の対応付け', 'Column mapping'], ['買賣方向', '売買区分', 'Buy / sell'], ['（略過）', '（スキップ）', '(skip)'], ['預覽與檢查', 'プレビューとチェック', 'Preview and checks'], ['勾選建議列', '推奨行を選択', 'Select suggested rows'], ['全部取消', 'すべて解除', 'Clear selection'],
  ['檢查結果', 'チェック結果', 'Check result'], ['重複列預設不勾選，可逐列勾選。', '重複行は既定で未選択です。行ごとに選択できます。', 'Duplicate rows are unchecked by default; you can check them one by one.'], ['關閉匯入視窗', 'インポート画面を閉じる', 'Close import window'],
  // AI trade entry (a sentence or a screenshot) and the Claude model choice.
  ['AI 輸入（一句話／截圖）', 'AI 入力（一文／スクリーンショット）', 'AI entry (sentence / screenshot)'], ['CSV 檔案', 'CSV ファイル', 'CSV file'], ['用 AI 記錄交易', 'AI で取引を記録', 'Record trades with AI'],
  ['用一句話說你做了什麼交易（可以一次寫好幾筆）', '取引内容を一文で入力（複数件まとめて可）', 'Describe your trades in a sentence (several at once is fine)'], ['附上券商截圖（選用）', '証券会社のスクリーンショットを添付（任意）', 'Attach a broker screenshot (optional)'], ['移除截圖', 'スクリーンショットを削除', 'Remove screenshot'],
  ['用 Claude 解析', 'Claude で解析', 'Read with Claude'], ['用 ChatGPT 解析', 'ChatGPT で解析', 'Read with ChatGPT'], ['確認 AI 設定中…', 'AI 設定を確認中…', 'Checking AI settings…'], ['請選擇 ChatGPT 模型。', 'ChatGPT のモデルを選択してください。', 'Choose a ChatGPT model.'],
  ['AI 只會產生預覽；下方逐筆確認後按「匯入」才會寫入。平倉（買回、賣出持股）會對應到你現有的持倉。截圖可以直接貼上（Ctrl／⌘＋V）。', 'AI はプレビューを作るだけです。下で 1 件ずつ確認して「インポート」を押すまで保存されません。決済（買い戻し・保有株の売却）は既存の保有と照合します。スクリーンショットは貼り付け（Ctrl／⌘＋V）もできます。', 'The AI only makes a preview; nothing is saved until you check the rows below and press “Import”. Closing fills (buy-backs, share sales) are matched to your open positions. You can paste a screenshot (Ctrl/⌘+V).'],
  ['每次解析都會使用你的 Claude API 額度', '解析のたびに Claude API の利用枠を使います', 'Each read uses your Claude API credit'], ['今天以 2.30 賣出 KO 11/20 到期 75 PUT 一口', '本日 KO 11/20 満期 75 PUT を 2.30 で 1 枚売り', 'Sold 1 KO Nov 20 75 PUT at 2.30 today'],
  ['昨天 0.05 買回 KO 75P 平倉，手續費 0.65', '昨日 KO 75P を 0.05 で買い戻して決済、手数料 0.65', 'Bought back the KO 75P at 0.05 yesterday, fees 0.65'], ['9/15 買入 AAPL 10 股，成交價 228.5', '9/15 AAPL を 10 株 228.5 で購入', 'Bought 10 AAPL at 228.5 on 9/15'],
  ['平倉：更新現有交易', '決済：既存の取引を更新', 'Closing: update existing trades'], ['將標為已平倉', '決済済みにします', 'Will be marked closed'], ['可更新', '更新可能', 'Can update'], ['無法更新', '更新不可', 'Can\'t update'], ['AI 需要你確認：', 'AI からの確認事項：', 'The AI needs you to confirm:'],
  ['已勾選新增', '選択中：新規', 'Selected: new'], [' 筆、平倉 ', ' 件・決済 ', ' items, closing '], [' 筆；按下「匯入」前不會寫入。', ' 件。「インポート」を押すまで保存されません。', ' items; nothing is saved until you press “Import”.'],
  ['部分平倉請在交易明細手動拆分', '一部決済は取引明細で手動で分割してください', 'split partial closes by hand in the trade table'], ['缺少平倉價', '決済価格がありません', 'Missing exit price'], ['缺少平倉日', '決済日がありません', 'Missing close date'],
  ['Claude 模型', 'Claude モデル', 'Claude model'], ['（預設）', '（既定）', '(default)'], ['（最強）', '（最上位）', '(most capable)'], ['（較快、較省）', '（高速・低コスト）', '(faster, cheaper)'],
  ['伺服器預設', 'サーバー既定', 'Server default'], ['模型', 'モデル', 'Model'], ['只支援 PNG、JPEG、WebP 或 GIF 圖片。', 'PNG・JPEG・WebP・GIF 画像のみ対応しています。', 'Only PNG, JPEG, WebP or GIF images are supported.'], ['圖片超過 4 MB，請裁切或壓縮後再試。', '画像が 4 MB を超えています。切り抜くか圧縮してください。', 'The image is over 4 MB; crop or compress it and try again.'],
  ['沒有讀到交易。請寫明標的、買或賣、數量與價格。', '取引を読み取れませんでした。銘柄・売買・数量・価格を書いてください。', 'No trades found. Say the symbol, buy or sell, quantity and price.'], ['匯入方式', 'インポート方法', 'Import method'],
  // 和風介面 theme card.
  ['和風介面', '和風インターフェース', 'Japanese-style theme'], ['夜的書齋 · 紺與金', '夜の書斎 · 紺と金', 'Night study · navy and gold'],
  ['雪夜湯宿 · 青與琥珀', '雪夜の湯宿 · 青と琥珀', 'Snowy hot-spring night · teal and amber'], ['每次開啟時選一個', '開くたびにどちらかを選択', 'Picks one each time you open the page'], ['介面主題', 'テーマ', 'Theme'],
  ['桔梗與時雨兩個主題：明朝字體、角色光環與和紙質感。兩者只差外觀，資料與功能完全相同；選擇保存在這個瀏覽器。', '桔梗と時雨の 2 つのテーマ：明朝体、キャラクターの光輪、和紙の質感。違うのは見た目だけで、データと機能は同じです。選択はこのブラウザに保存されます。', 'Two themes, 桔梗 and 時雨: Mincho type, the characters\' halos and a washi-paper feel. Only the look differs; data and features are the same. The choice is saved in this browser.'],
  ['隨機', 'ランダム', 'Random'],
  ['和風背景與音樂', '和風の背景と音楽', 'Japanese-style backdrop & music'], ['每個主題可以放自己的背景圖、開場剪影與背景音樂。檔案只存在你的 Cloudflare R2，不會進 GitHub。', 'テーマごとに背景画像、オープニングの影絵、BGM を設定できます。ファイルはあなたの Cloudflare R2 だけに保存され、GitHub には入りません。', 'Each theme can have its own backdrop, opening silhouette and music. Files are kept only in your Cloudflare R2, never on GitHub.'],
  ['顯示背景圖', '背景画像を表示', 'Show the backdrop picture'], ['光影特效（桔梗的光束、時雨的落雪與燈籠）', '光の演出（桔梗の光の筋、時雨の雪と灯籠）', 'Light effects (桔梗\'s beam, 時雨\'s snow and lantern)'], ['頂欄音樂播放器', 'ヘッダーの音楽プレーヤー', 'Music player in the top bar'], ['開場與介面音效', 'オープニングと操作の効果音', 'Opening and interface sounds'],
  ['無法讀取已上傳的檔案：', 'アップロード済みファイルを読み込めません：', 'Cannot read the uploaded files: '], ['開場剪影', 'オープニングの影絵', 'Opening silhouette'], ['背景音樂', 'BGM', 'Music'], ['背景圖', '背景画像', 'Backdrop'],
  ['會縮到 2400 px 並轉成 JPEG', '2400 px に縮小して JPEG に変換', 'Resized to 2400 px and saved as JPEG'], ['去背 PNG 最好；一般圖片以邊緣顏色自動去背', '切り抜き PNG が最適。通常の画像は縁の色で自動切り抜き', 'A cut-out PNG works best; other pictures are cut out by their edge colour'],
  ['映在障子上的影子', '障子に映る影', 'A shadow on the shoji'], ['染在暖簾上的白抜き圖樣', '暖簾に染め抜く白抜き模様', 'Dyed white into the noren'], ['未上傳', '未アップロード', 'Not uploaded'], ['個檔案', 'ファイル', ' files'],
  ['可以直接選 zip 壓縮檔（例如和風素材.zip），或一次選多個檔案；依檔名放進對應欄位：含「桔梗」或「時雨」；含「剪影」的是剪影，音檔是背景音樂，其餘圖片是背景圖。', 'zip ファイル（和風素材.zip など）をそのまま選ぶか、複数のファイルをまとめて選択すると、名前で振り分けます：「桔梗」か「時雨」を含むこと。「剪影」を含むものは影絵、音声は BGM、その他の画像は背景画像になります。', 'Pick the zip (such as 和風素材.zip) or several files at once; each goes where its name says: it must contain 桔梗 or 時雨; 剪影 means a silhouette, audio is music, other pictures are backdrops.'],
  ['解壓縮中：', '展開中：', 'Unzipping: '], ['無法解壓縮', '展開できません', 'Cannot unzip'], ['這不是可讀的 zip 壓縮檔。', '読み取れる zip ファイルではありません。', 'This is not a readable zip file.'], ['不支援 ZIP64 壓縮檔，請改用一般 zip。', 'ZIP64 には対応していません。通常の zip を使ってください。', 'ZIP64 is not supported; use a regular zip.'], ['zip 壓縮檔內容損壞。', 'zip ファイルが壊れています。', 'The zip file is damaged.'],
  ['一次上傳全部', 'まとめてアップロード', 'Upload all at once'], ['檔名看不出是桔梗或時雨，已略過：', '名前から桔梗か時雨か分からないためスキップ：', 'Skipped (name says neither 桔梗 nor 時雨): '], ['上傳中', 'アップロード中', 'Uploading'], ['失敗：', '失敗：', 'Failed: '],
  ['頂欄的通知集中顯示財報公布、財報日、美日休市、7 天內到期的選擇權與股息入帳，可逐則關閉或全部標為已讀。', 'ヘッダーの通知に、決算発表、決算日、日米の休場、7 日以内に満期のオプション、配当の入金をまとめて表示します。1 件ずつ閉じるか、すべて既読にできます。', 'The top-bar notifications gather results, earnings dates, US/JP closures, options expiring within 7 days and dividend payments; dismiss them one by one or mark all read.'],
  ['關閉後改回頁首的提示列，不另外計算通知。', 'オフにすると従来のヘッダーの案内行に戻り、通知は計算しません。', 'Off: the header notice line returns and no notifications are worked out.'],
  ['全部標為已讀', 'すべて既読にする', 'Mark all read'], ['目前沒有通知。', '通知はありません。', 'No notifications.'], ['則未讀', '件未読', ' unread'], ['通知中心', '通知センター', 'Notification center'],
  ['選擇權到期', 'オプション満期', 'Option expiry'], ['股息即將入帳', '配当入金予定', 'Dividend due'], ['股息已入帳', '配当入金済み', 'Dividend paid'], [' 入帳', ' 入金', ' paid'], ['通知', '通知', 'Notifications'],
  ['側欄的「AI」可以問關於自己持倉的問題：到期、風險、損益。送出時附上持倉摘要（代號、數量、價格與總額，不含備註），使用「AI 設定」中的金鑰與模型；只提供分析，不會更動交易。', 'サイドバーの「AI」で自分のポジションについて質問できます（満期、リスク、損益）。送信時にポジションの要約（銘柄、数量、価格、合計。メモは含みません）を添え、「AI 設定」のキーとモデルを使います。分析のみで、取引は変更しません。', 'The AI item in the side bar answers questions about your positions (expiries, risk, P&L). Each question sends a summary of them (tickers, sizes, prices and totals, no notes) and uses the keys and models in AI settings; it only analyses and never changes a trade.'],
  ['關閉後側欄不顯示 AI，也不載入這部分的程式。', 'オフにするとサイドバーに AI が表示されず、このプログラムも読み込みません。', 'Off: no AI item in the side bar, and its code is not loaded.'],
  ['只提供分析，不會更動任何交易；不是投資建議。', '分析のみで、取引は変更しません。投資助言ではありません。', 'Analysis only; it never changes a trade. Not investment advice.'],
  ['問問你的持倉…（Enter 送出，Shift+Enter 換行）', 'ポジションについて質問…（Enter で送信、Shift+Enter で改行）', 'Ask about your positions… (Enter to send, Shift+Enter for a new line)'],
  ['請先在「設定 → AI 設定」選擇 ChatGPT 模型。', '先に「設定 → AI 設定」で ChatGPT のモデルを選んでください。', 'Choose a ChatGPT model in Settings → AI settings first.'], [' · 使用你的 Claude API 額度', ' · Claude API の利用枠を使います', ' · uses your Claude API credit'],
  ['角色（桔梗／時雨）', 'キャラクター（桔梗／時雨）', 'Character (桔梗 / 時雨)'], ['回覆失敗，請稍後再試。', '回答に失敗しました。しばらくしてから再試行してください。', 'The reply failed; try again later.'],
  ['關閉 AI 助理', 'AI アシスタントを閉じる', 'Close the AI assistant'], ['AI 助理', 'AI アシスタント', 'AI assistant'], ['清除對話', '会話を消去', 'Clear chat'], ['思考中', '考え中', 'Thinking'], ['口吻', '口調', 'Voice'], ['中性', 'ニュートラル', 'Neutral'], ['停止', '停止', 'Stop'],
  ['手機上把主選單放到畫面底部（總覽、持倉、收益、AI、設定、更多），目前所在的項目浮著角色光環；估值與背景在「更多」裡。', 'スマホではメインメニューを画面下部に置きます（概要、保有、収益、AI、設定、その他）。現在の項目にはキャラクターの光輪が浮かび、評価と背景は「その他」にあります。', 'On phones the main menu sits along the bottom (overview, positions, returns, AI, settings, more); the current item wears the character\'s halo, and valuation and backdrop are under More.'],
  ['關閉後改回頁面上方的選單列；電腦版不受影響。', 'オフにすると上部のメニューバーに戻ります。PC 版には影響しません。', 'Off: the menu strip at the top returns. The desktop page is unaffected.'],
  ['iPhone／iPad：用 Safari 開啟 → 分享 → 加入主畫面。Android：Chrome 選單 → 安裝應用程式（或加到主畫面）。安裝後全螢幕開啟，資料與網頁版相同。', 'iPhone／iPad：Safari で開く → 共有 → ホーム画面に追加。Android：Chrome のメニュー → アプリをインストール（またはホーム画面に追加）。インストール後は全画面で開き、データは Web 版と同じです。', 'iPhone/iPad: open in Safari → Share → Add to Home Screen. Android: Chrome menu → Install app (or Add to Home screen). It then opens full screen with the same data as the website.'],
  ['安裝成手機 App', 'スマホアプリとしてインストール', 'Install as a phone app'], ['安裝 App', 'アプリをインストール', 'Install app'],
  ['手機底部選單', 'スマホ下部メニュー', 'Phone bottom menu'], ['換背景圖片', '背景画像を変更', 'Change backdrop'], ['背景圖片', '背景画像', 'Backdrop picture'], ['主選單', 'メインメニュー', 'Main menu'], ['更多', 'その他', 'More'],
  ['處理中…', '処理中…', 'Working…'], ['已上傳。', 'アップロードしました。', 'Uploaded.'], ['已移除。', '削除しました。', 'Removed.'], ['上傳失敗。', 'アップロードに失敗しました。', 'Upload failed.'], ['移除失敗。', '削除に失敗しました。', 'Remove failed.'],
  ['更換', '変更', 'Replace'], ['上傳', 'アップロード', 'Upload'], ['移除', '削除', 'Remove'],
  ['瀏覽器擋下自動播放，請再按一次播放。', 'ブラウザが自動再生を止めました。もう一度再生を押してください。', 'The browser blocked autoplay; press play again.'], ['音檔讀取失敗。', '音源を読み込めませんでした。', 'Could not load the track.'],
  ['還沒有音樂：到「設定 → 和風背景與音樂」上傳。', 'まだ音楽がありません：「設定 → 和風の背景と音楽」からアップロードしてください。', 'No music yet: upload it in Settings → Japanese-style backdrop & music.'],
  ['播放中', '再生中', 'Playing'], ['已暫停', '一時停止中', 'Paused'], ['暫停', '一時停止', 'Pause'], ['播放', '再生', 'Play'], ['下一首', '次の曲', 'Next'], ['音量', '音量', 'Volume'],
  ['桔梗 · 背景音樂', '桔梗・BGM', '桔梗 · music'], ['時雨 · 背景音樂', '時雨・BGM', '時雨 · music'],
  ['開場動畫', 'オープニング', 'Opening'], ['每個分頁一次', 'タブごとに 1 回', 'Once per tab'], ['每次開啟', '毎回', 'Every time'], ['預覽開場', 'オープニングをプレビュー', 'Preview opening'],
  ['裝置較慢時自動改用輕量開場（不顯示水墨）', '端末が遅いときは軽量版に自動で切り替える（水墨なし）', 'Use the lite opening on slow devices (no ink)'], ['這台裝置已改用輕量開場。', 'この端末は軽量版のオープニングを使用しています。', 'This device uses the lite opening.'], ['重新偵測', '再検出', 'Detect again'],
  // English only: labels and notes the Japanese list never covered.
  ['即時市場時間', 'リアルタイム市場時間', 'Live market time'], ['美東', '米東部', 'New York'], ['報價每 60 秒更新 · 上次', '価格は60秒ごとに更新 · 前回', 'Quotes refresh every 60 s · last'],
  ['筆未平倉持倉', '件の保有ポジション', 'open positions'], ['筆有效平倉交易', '件の有効な決済取引', 'closed trades counted'], ['股票採買入成本；賣方選擇權採擔保金或履約價名目', '株式は取得原価、売りオプションは証拠金または権利行使価格の想定元本', 'Stocks at cost; short options at collateral or strike notional'],
  ['查看明細', '明細を見る', 'Details'], ['收益率', 'リターン', 'Return'], ['區間累積', '期間累計', 'Period total'],
  ['時間加權報酬：每日損益 ÷ 當日占用資本；股票用 Yahoo 含息調整收盤，選擇權以進出場價線性估算', '時間加重リターン：日次損益 ÷ 当日の使用資本。株式は Yahoo の配当調整後終値、オプションは建値と決済値の線形補間で推定', 'Time-weighted return: daily P&L ÷ capital in use that day; stocks use Yahoo\'s dividend-adjusted close, options are estimated linearly between entry and exit prices'], ['（估算：', '（推定：', '(estimated: '], ['匯率與美債殖利率', '為替と米国債利回り', 'FX and Treasury yields'],
  ['黃金／原油', '金／原油', 'Gold / crude oil'], ['↻ 更新', '↻ 更新', '↻ Refresh'], ['· 每 60 秒', '· 60秒ごと', '· every 60 s'],
  ['部分即時資料暫時延遲，已保留最近一次有效報價', '一部のリアルタイムデータが遅延しています。直近の有効な価格を表示中', 'Some live data is delayed; showing the last valid quotes'], ['等待更新', '更新待ち', 'Waiting for update'], ['暫時沒有歷史資料', '履歴データはまだありません', 'No history yet'],
  ['美國公債10年期', '米国債10年', 'US 10-year Treasury'], ['美國公債30年期', '米国債30年', 'US 30-year Treasury'], ['殖利率（%）', '利回り（%）', 'Yield (%)'],
  ['美元／日圓顯示至小數點後 2 位；美國 10 年與 30 年公債顯示殖利率、變動點數與漲跌幅。', 'ドル円は小数点以下2桁。米国債10年・30年は利回り、変化幅（ポイント）と騰落率を表示。', 'USD/JPY shows 2 decimals; US 10- and 30-year Treasuries show the yield, its change in points and the percent change.'], ['圓餅圖', '円グラフ', 'Pie chart'], ['長條圖', '棒グラフ', 'Bar chart'],
  ['1 個月', '1か月', '1 month'], ['3 個月', '3か月', '3 months'], ['歷史日期', '履歴日付', 'History date'],
  ['目前曝險', '現在のエクスポージャー', 'Current exposure'], ['其他', 'その他', 'Other'], ['股票按目前價格、選擇權按擔保金、現金按原幣餘額計算；日圓部位會換算為 USD。', '株式は現在値、オプションは証拠金、現金は現地通貨残高で計算。円建てポジションは USD に換算。', 'Stocks at current price, options at collateral, cash at its original-currency balance; yen positions are converted to USD.'],
  ['匯入', 'インポート', 'Import'], ['等待走勢', 'チャート待ち', 'Waiting for chart'], ['現金／稅後股息', '現金／税引後配当', 'Cash / after-tax dividends'],
  ['現金不呼叫股票報價；股息依持有期間、除息事件與設定的外國投資人預扣稅率試算。', '現金は株価を取得しません。配当は保有期間、権利落ち日、設定した外国投資家の源泉徴収税率で試算します。', 'Cash needs no stock quote; dividends are estimated from holding periods, ex-dividend events and the foreign-investor withholding rates in Settings.'], ['筆 · 持倉數量', '件 · 保有数量', 'trades · quantity held'], ['股票 API 報價', '株価 API', 'Stock API quote'],
  ['加入背景圖片', '背景画像を追加', 'Add background image'], ['點擊編輯網頁標題', 'クリックしてページタイトルを編集', 'Click to edit the page title'], ['編輯網頁標題', 'ページタイトルを編集', 'Edit page title'],
  ['切換即時時區', 'タイムゾーンを切り替え', 'Switch time zone'], ['投資組合摘要', 'ポートフォリオ概要', 'Portfolio summary'], ['計算明細', '計算の明細', 'calculation details'],
  ['收益率期間', 'リターン期間', 'Return period'], ['宏觀歷史期間', 'マクロ履歴期間', 'Macro history period'], ['調整收益圖與持倉配置寬度', 'リターンチャートと構成の幅を調整', 'Resize the returns chart and allocation'],
  ['持倉配置圖表類型', '構成チャートの種類', 'Allocation chart type'], ['持倉配置歷史日期', '構成の履歴日付', 'Allocation history date'], ['按標的計算的互動持倉圓環', '銘柄別のインタラクティブ保有リング', 'Interactive holdings ring by symbol'],
  ['持倉顯示方式', '保有の表示方法', 'Holdings view'], ['搜尋 ticker、策略或備註', 'ティッカー、戦略、メモを検索', 'Search ticker, strategy or notes'], ['搜尋交易', '取引を検索', 'Search trades'],
  ['頁面切換', 'ページ切替', 'Page navigation'], ['OptionFlow 首頁', 'OptionFlow ホーム', 'OptionFlow home'], ['向上切換至黃金與原油期貨', '金・原油先物に切り替え', 'Switch to gold and crude oil futures'],
  ['欄位', '列', 'Columns'], ['標的', '銘柄', 'Symbol'], ['交易／策略', '取引／戦略', 'Trade / strategy'],
  ['開倉／到期', '建玉日／満期', 'Opened / expiry'], ['履約價', '権利行使価格', 'Strike'], ['買入／成交價', '取得／約定価格', 'Entry / fill price'],
  ['損益', '損益', 'P&L'], ['操作', '操作', 'Actions'], ['選擇要啟用的擴充工作區。', '有効にする拡張ワークスペースを選択します。', 'Choose which extra workspaces to turn on.'],
  ['預設關閉', '既定でオフ', 'Off by default'], ['已開啟', 'オン', 'On'], ['暫定 30%，可依適用協定修改', '暫定 30%。適用される租税条約に合わせて変更可能', '30% for now; change it to your treaty rate'],
  ['上市股票預設 15.315%，可自行修改', '上場株式は既定 15.315%。変更可能', 'Listed stocks default to 15.315%; you can change it'], ['確認登入狀態中…', 'ログイン状態を確認中…', 'Checking sign-in…'], ['Tier 3 以上', 'Tier 3 以上', 'Tier 3 and above'],
  ['金鑰、ChatGPT 模型與財報解讀問題在下方「AI 設定」。', 'キー、ChatGPT モデル、決算分析の質問は下の「AI 設定」にあります。', 'Keys, the ChatGPT model and the earnings-analysis questions are in “AI settings” below.'], ['金鑰只存在這個瀏覽器，使用時經 HTTPS 送到本站伺服器轉呼叫，伺服器不保存。任何能在此網頁執行的程式都讀得到它；共用電腦請勿保存。', 'キーはこのブラウザにのみ保存され、使用時に HTTPS で本サイトのサーバーへ送られます。サーバーは保存しません。このページで動くスクリプトは読み取れるため、共用のコンピューターでは保存しないでください。', 'Keys stay in this browser and reach this site\'s server over HTTPS only when used; the server does not keep them. Any script on this page can read them, so don\'t save them on a shared computer.'], ['每次產生財報解讀時，AI 會逐題回答這些問題。', '決算分析のたびに、AI がこれらの質問に順に答えます。', 'Each earnings analysis answers these questions one by one.'],
  ['（留空則用伺服器金鑰）', '（空欄ならサーバーのキーを使用）', '(leave empty to use the server key)'], ['伺服器尚未設定 Cloudflare Access（ACCESS_TEAM_DOMAIN、ACCESS_AUD），AI 查詢已停用。', 'サーバーに Cloudflare Access（ACCESS_TEAM_DOMAIN、ACCESS_AUD）が未設定のため、AI 検索は無効です。', 'Cloudflare Access is not set up on the server (ACCESS_TEAM_DOMAIN, ACCESS_AUD), so AI lookups are off.'], ['AI 查詢：', 'AI 検索：', 'AI lookup: '],
  ['把不同券商的手動部位聚合成單一全景，提供 USD／JPY 平抑檢視、偏離診斷、只買不賣試算與跨券商待辦清單。', '複数の証券会社の手動ポジションを一つにまとめ、USD／JPY 中立ビュー、乖離診断、買い増しのみのリバランス試算、証券会社横断の ToDo を提供します。', 'Combines manual positions from different brokers into one view, with a USD/JPY neutral view, drift check, buy-only rebalancing and a cross-broker to-do list.'], ['關閉時不載入資料、不啟動額外計算；再次開啟時會保留原資料。', 'オフの間はデータを読み込まず、追加の計算もしません。再びオンにすると以前のデータが残っています。', 'While off, no data loads and nothing extra runs; turning it on again keeps the earlier data.'], ['依美股與日股持倉在除息事件日的股數，分別計算稅後股息並自動加入 USD／JPY 現金。稅率可依券商、稅務身分或租稅協定自行調整。', '米国株・日本株の権利落ち日の保有株数から税引後配当を計算し、USD／JPY 現金に自動で加えます。税率は証券会社、税務上の身分、租税条約に合わせて調整できます。', 'Calculates after-tax dividends from US and Japanese holdings on each ex-dividend date and adds them to USD / JPY cash. Adjust the tax rates for your broker, tax status or treaty.'],
  ['目前為手動聚合與試算工具，不會登入券商、讀取券商帳密或送出真實訂單。', '手動の集約・試算ツールです。証券会社へのログイン、認証情報の読み取り、実際の注文は行いません。', 'A manual aggregation and planning tool: it never signs in to brokers, reads broker credentials or sends real orders.'], ['的股息資料暫時無法取得', 'の配当データは現在取得できません', ' dividend data is unavailable for now'], ['走勢', '推移', 'trend'],
  ['日走勢', '日足推移', 'Daily trend'], ['週走勢', '週足推移', 'Weekly trend'], ['月走勢', '月足推移', 'Monthly trend'], ['年走勢', '年足推移', 'Yearly trend'],
  ['目前', '現在', 'Now'], ['預設', '既定', 'Default'], ['（每行一題，最多', '（1行に1問、最大', ' (one per line, up to'], ['題）', '問）', ')'],
  // Guide bar, quick sheet, tabbed settings and the research drawer.
  ['左右滑切換區塊，點一下回頂部，往上滑或長按開啟快捷面板', '左右スワイプでセクション切替、タップで先頭へ、上スワイプか長押しでクイックメニュー', 'Swipe left or right to switch sections, tap for the top, swipe up or hold for the quick menu'],
  ['匯入 CSV／截圖', 'CSV・画像取込', 'Import CSV / screenshot'], ['AI 助手', 'AI アシスタント', 'AI assistant'], ['個股研究', '銘柄リサーチ', 'Stock research'], ['通知與休市', '通知・休場', 'Notices & closures'],
  ['底部導覽', 'ボトムナビ', 'Bottom navigation'], ['引導條（預設）', 'ホームバー（既定）', 'Guide bar (default)'], ['選單列（手機）', 'メニューバー（スマホ）', 'Menu bar (phone)'], ['引導條', 'ホームバー', 'Guide bar'], ['選單列', 'メニューバー', 'Menu bar'],
  ['匯入與匯出', '取込と書出', 'Import and export'], ['外觀', '外観', 'Look'], ['模組', 'モジュール', 'Modules'], ['資料', 'データ', 'Data'], ['音樂', '音楽', 'Music'],
  ['技術面', 'テクニカル', 'Technical'], ['基本面', 'ファンダメンタルズ', 'Fundamentals'], ['DCF 估值', 'DCF 評価', 'DCF valuation'], ['購買紀錄', '購入履歴', 'Purchase lots'], ['關閉個股研究', '銘柄リサーチを閉じる', 'Close stock research'],
  ['平均取得', '平均取得', 'Avg cost'], ['效能模式', 'パフォーマンスモード', 'Performance mode'],
  // AI settings: master switch, bring-your-own-key mode, key checks and model detection.
  ['AI 功能總開關：關閉後所有 AI 按鈕都會隱藏，不送出任何 AI 請求。', 'AI 機能のマスタースイッチ：オフにするとすべての AI ボタンが隠れ、AI リクエストは送信されません。', 'Master switch for AI: when off, every AI button is hidden and no AI request is sent.'],
  ['AI 功能已關閉：不顯示財報解讀、AI 查財報日、AI 記錄交易與 AI 助理，也不會送出任何 AI 請求。其他功能照常。', 'AI 機能はオフです：決算解説、AI 決算日検索、AI 取引記録、AI アシスタントは表示されず、AI リクエストも送信されません。ほかの機能は通常どおりです。', 'AI is off: filing analysis, AI earnings dates, AI trade entry and the AI assistant are hidden, and no AI request is sent. Everything else works as usual.'],
  ['開啟後可用 Claude 或 ChatGPT；金鑰只存在這個瀏覽器。', 'オンにすると Claude または ChatGPT を使えます。キーはこのブラウザにだけ保存されます。', 'Turn on to use Claude or ChatGPT; keys stay in this browser only.'],
  ['OpenAI 管理金鑰（選填，只用來讀今日用量、檢查免費額度）', 'OpenAI 管理キー（任意。本日の使用量を読んで無料枠を確認するためだけに使用）', 'OpenAI admin key (optional; only reads today\'s usage to check the free tier)'],
  ['重新檢查金鑰', 'キーを再確認', 'Check keys again'], ['正在檢查金鑰並偵測可用模型…', 'キーを確認し、使えるモデルを検出中…', 'Checking keys and detecting models…'],
  ['輸入金鑰後會自動檢查是否有效，並偵測可用的模型。', 'キーを入力すると有効か自動で確認し、使えるモデルを検出します。', 'Keys are checked automatically once entered, and their models detected.'],
  ['（列出模型不花 token）', '（モデル一覧の取得はトークンを消費しません）', ' (listing models costs no tokens)'], ['金鑰與模型清單檢查於', 'キーとモデル一覧の確認時刻', 'Keys and models checked at'],
  ['無法檢查金鑰：', 'キーを確認できません：', 'Cannot check keys: '], ['其他可用（會計費）', 'その他（課金されます）', 'Other models (billed)'], ['其他可用（不在免費額度，會被擋下）', 'その他（無料枠外のためブロック）', 'Other models (outside the free tier, blocked)'],
  ['免費額度內', '無料枠内', 'Free tier'], ['（依金鑰偵測）', '（キーから検出）', ' (detected from key)'], ['自備金鑰模式', '自前キーモード', 'Bring-your-own-key mode'], ['自備金鑰', '自前キー', 'Own keys'], ['待設定金鑰', 'キー未設定', 'Key needed'],
  ['檢查中…', '確認中…', 'Checking…'], ['✓ 有效', '✓ 有効', '✓ Valid'], ['✗ 無效', '✗ 無効', '✗ Invalid'], ['✗ 權限不足', '✗ 権限不足', '✗ Not permitted'], ['✗ 額度或速率受限', '✗ 残高・レート制限', '✗ Quota or rate limited'], ['✗ 無法確認', '✗ 確認不可', '✗ Unknown'], ['（伺服器金鑰）', '（サーバーキー）', ' (server key)'],
  ['已通過 Cloudflare Access（可使用伺服器金鑰）。', 'Cloudflare Access 認証済み（サーバーキーを使用可）。', 'Signed in through Cloudflare Access (server keys available).'],
  ['未設定 OpenAI 管理金鑰，無法檢查免費額度：', 'OpenAI 管理キーが未設定のため無料枠を確認できません：', 'No OpenAI admin key, so the free tier cannot be checked: '], ['照常使用，用量由你的 OpenAI 帳戶計費。', 'は通常どおり使え、使用量はあなたの OpenAI アカウントに課金されます。', ' works as usual and is billed to your OpenAI account.'],
];

const column: Record<Language, 0 | 1 | 2> = { 'zh-TW': 0, 'ja-JP': 1, en: 2 };
const pairCache = new Map<string, ReadonlyArray<readonly [string, string]>>();

/** Source → target pairs between two languages, longest source first so phrases win over their parts. */
function pairsFor(from: Language, to: Language) {
  const key = `${from}>${to}`;
  const cached = pairCache.get(key);
  if (cached) return cached;
  const seen = new Set<string>();
  const pairs = translations.flatMap((entry) => {
    const source = entry[column[from]];
    const target = entry[column[to]];
    if (!source || !target || source === target || seen.has(source)) return [];
    seen.add(source);
    return [[source, target] as const];
  }).sort((a, b) => b[0].length - a[0].length);
  pairCache.set(key, pairs);
  return pairs;
}

const skipElement = (element: Element | null) => !element || Boolean(element.closest('[data-i18n-skip],script,style,textarea,[contenteditable="true"]'));

function translateValue(value: string, pairs: ReadonlyArray<readonly [string, string]>) {
  return pairs.reduce((next, [source, target]) => next.includes(source) ? next.replaceAll(source, target) : next, value);
}

/**
 * What each translated text node or attribute said before translation, and what was written over it.
 * A switch starts again from the original instead of translating a translation, so English text
 * that was on the page all along (such as the "Holdings" eyebrow) is never turned into Chinese.
 */
const originals = new WeakMap<Node, { source: string; written: string }>();
const attributeOriginals = new WeakMap<Element, Map<string, { source: string; written: string }>>();

/** New text for a value: from its recorded original while our last write is still in place. */
function retranslate(current: string, record: { source: string; written: string } | undefined, language: Language) {
  const source = record && record.written === current ? record.source : current;
  // Untouched text in Chinese still turns stray Japanese back, as before English existed.
  const next = language === 'zh-TW' ? (record && record.written === current ? source : translateValue(source, pairsFor('ja-JP', 'zh-TW'))) : translateValue(source, pairsFor('zh-TW', language));
  return { source, next };
}

function translateRoot(root: Element, language: Language) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  nodes.forEach((node) => {
    const current = node.nodeValue ?? '';
    if (skipElement(node.parentElement) || !current.trim()) return;
    const { source, next } = retranslate(current, originals.get(node), language);
    if (next === source) originals.delete(node);
    else originals.set(node, { source, written: next });
    if (next !== current) node.nodeValue = next;
  });
  const elements = [root, ...root.querySelectorAll('*')];
  elements.forEach((element) => {
    if (skipElement(element)) return;
    ['placeholder', 'aria-label', 'title'].forEach((attribute) => {
      const current = element.getAttribute(attribute);
      if (!current) return;
      const records = attributeOriginals.get(element);
      const { source, next } = retranslate(current, records?.get(attribute), language);
      if (next === source) records?.delete(attribute);
      else if (records) records.set(attribute, { source, written: next });
      else attributeOriginals.set(element, new Map([[attribute, { source, written: next }]]));
      if (next !== current) element.setAttribute(attribute, next);
    });
  });
}

const globe = <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.6 2.6 3.9 5.6 3.9 9s-1.3 6.4-3.9 9c-2.6-2.6-3.9-5.6-3.9-9s1.3-6.4 3.9-9Z" /></svg>;
const chevron = <svg className="language-picker-chevron" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>;
const check = <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>;

/** Interface language, as a pill that folds open into an iOS-style menu of 中文／日本語／English. */
export default function LanguageSwitcher() {
  const [language, setLanguage] = useState<Language>('zh-TW');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey);
    if (isLanguage(saved) && saved !== 'zh-TW') queueMicrotask(() => setLanguage(saved));
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    window.localStorage.setItem(storageKey, language);
    let frame = 0;
    const apply = () => {
      frame = 0;
      translateRoot(document.body, language);
    };
    apply();
    const observer = new MutationObserver(() => {
      if (!frame) frame = window.requestAnimationFrame(apply);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'aria-label', 'title'] });
    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [language]);

  // Folds closed on a tap outside, like an iOS menu.
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    const current = languages.findIndex((item) => item.id === language);
    window.requestAnimationFrame(() => itemRefs.current[current]?.focus());
    return () => document.removeEventListener('pointerdown', outside);
  }, [language, open]);

  const choose = (next: Language) => {
    setLanguage(next);
    setOpen(false);
    toggleRef.current?.focus();
  };

  const onMenuKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = itemRefs.current.filter((item): item is HTMLButtonElement => Boolean(item));
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); toggleRef.current?.focus(); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); items[(index + 1) % items.length]?.focus(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); items[(index - 1 + items.length) % items.length]?.focus(); }
    else if (event.key === 'Tab') setOpen(false);
  };

  const current = languages.find((item) => item.id === language) ?? languages[0];
  return <div ref={rootRef} className={`language-picker${open ? ' is-open' : ''}`} data-i18n-skip>
    <button ref={toggleRef} type="button" className="language-picker-toggle" aria-haspopup="menu" aria-expanded={open} aria-label={`介面語言 · Language：${current.label}`} onClick={() => setOpen((value) => !value)}>
      {globe}<span>{current.label}</span>{chevron}
    </button>
    <div className="language-picker-menu" role="menu" aria-label="介面語言 · Language" aria-hidden={!open} inert={!open} onKeyDown={onMenuKey}>
      {languages.map((item, index) => <button key={item.id} ref={(node) => { itemRefs.current[index] = node; }} type="button" role="menuitemradio" aria-checked={item.id === language} tabIndex={open ? 0 : -1} lang={item.id} onClick={() => choose(item.id)}>
        <span>{item.label}</span>{item.id === language && check}
      </button>)}
    </div>
  </div>;
}
