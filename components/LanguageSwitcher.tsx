'use client';

import { useEffect, useState } from 'react';

type Language = 'zh-TW' | 'ja-JP';

const storageKey = 'optionflow-interface-language';
const translations = [
  ['返回持倉總覽', '保有資産一覧に戻る'], ['跨券商資產追蹤與再平衡', '複数証券口座の資産追跡とリバランス'],
  ['外國投資人股息稅與現金入帳', '外国投資家の配当税と現金計上'], ['美股外國人股息預扣稅率', '米国株・外国人配当源泉税率'],
  ['日股外國人股息預扣稅率', '日本株・外国人配当源泉税率'], ['USD 稅後股息現金', 'USD 税引後配当現金'],
  ['JPY 稅後股息現金', 'JPY 税引後配当現金'], ['股息自動入帳設定已保存', '配当の自動計上設定を保存しました'],
  ['股息自動入帳已關閉', '配当の自動計上を無効にしました'], ['交易與持倉', '取引と保有資産'],
  ['持倉配置', 'ポートフォリオ構成'], ['持倉市值', '保有時価'], ['組合占比', '構成比'], ['持倉數量', '保有数量'],
  ['標的價格波動／今日漲跌', '銘柄の値動き／本日の騰落'], ['成本均價／現價', '平均取得価格／現在値'],
  ['損益／報酬率', '損益／リターン'], ['標的／公司', '銘柄／会社'], ['圖形持倉', 'ビジュアル保有'], ['交易明細', '取引明細'],
  ['未平倉', '保有中'], ['已平倉', '決済済み'], ['選擇權', 'オプション'], ['股票', '株式'], ['現金', '現金'], ['全部', 'すべて'],
  ['股票均價', '平均取得価格'], ['成交均價', '約定平均価格'], ['目前價格', '現在値'], ['正常收盤', '通常終値'],
  ['盤前漲跌', 'プレマーケット騰落'], ['盤後漲跌', 'アフターマーケット騰落'], ['標的今日漲跌', '本日の騰落'],
  ['等待報價', '価格待ち'], ['不需報價', '価格取得不要'], ['手動價格', '手動価格'], ['權利金手動', 'プレミアム手動'],
  ['API 無法取得', 'API 取得不可'], ['API 待更新', 'API 更新待ち'], ['股息自動入帳', '配当自動計上'], ['現金餘額', '現金残高'],
  ['日本日期讀取中', '日本の日付を読込中'], ['日本祝日', '日本の祝日'], ['日股休市', '日本株休場'], ['美股休市', '米国株休場'], ['週末', '週末'],
  ['發放公司', '配当支払会社'], ['發放 · 稅後入帳', '支払 · 税引後計上'], ['股息發放公司', '配当支払会社'],
  ['馬丁路德金恩紀念日', 'キング牧師記念日'], ['華盛頓誕辰', 'ワシントン誕生日'], ['耶穌受難日', '聖金曜日'], ['陣亡將士紀念日', '戦没将兵追悼記念日'],
  ['六月節', 'ジューンティーンス'], ['美國獨立日', '米国独立記念日'], ['勞動節', 'レイバー・デー'], ['感恩節', '感謝祭'], ['聖誕節', 'クリスマス'],
  ['原幣現金', '現地通貨現金'], ['組合換算', 'ポートフォリオ換算'], ['資料來源', 'データソース'], ['現金部位', '現金ポジション'],
  ['新增交易', '取引を追加'], ['編輯交易', '取引を編集'], ['交易設定', '取引設定'], ['交易類型', '取引タイプ'],
  ['股票市場', '株式市場'], ['現金幣別', '現金通貨'], ['美國', '米国'], ['日本', '日本'], ['美元', '米ドル'], ['日圓', '日本円'],
  ['賣方', '売り'], ['買方', '買い'], ['指派', '割当'], ['現股持倉', '現物保有'], ['USD／JPY 餘額', 'USD／JPY 残高'],
  ['策略／事件', '戦略／イベント'], ['履約價／組合', '権利行使価格／組合せ'], ['合約期間', '契約期間'], ['開倉日', '建玉日'],
  ['到期日', '満期日'], ['平倉日', '決済日'], ['數量', '数量'], ['價格與風險', '価格とリスク'], ['成本／成交價', '取得／約定価格'],
  ['持倉／平倉價', '保有／決済価格'], ['手續費', '手数料'], ['擔保／投入資本', '担保／投下資本'], ['報價方式', '価格取得方法'],
  ['自動更新', '自動更新'], ['手動輸入', '手動入力'], ['持倉狀態', '保有状態'], ['備註', 'メモ'], ['儲存交易', '取引を保存'],
  ['取消', 'キャンセル'], ['永久刪除', '完全に削除'], ['刪除交易', '取引を削除'], ['保留紀錄', '記録を残す'], ['交易預覽', '取引プレビュー'],
  ['現金預覽', '現金プレビュー'], ['原幣餘額', '現地通貨残高'], ['組合換算 USD', 'USD 換算'], ['納入組合價值', 'ポートフォリオ計上額'],
  ['即時計算損益', 'リアルタイム損益'], ['持有天數', '保有日数'], ['狀態', '状態'], ['報價', '価格'], ['可用現金', '利用可能現金'],
  ['設定', '設定'], ['總覽', '概要'], ['持倉', '保有資産'], ['收益', 'リターン'], ['估值', 'バリュエーション'], ['背景', '背景'],
  ['換圖片', '画像変更'], ['原始', '標準'], ['圖片', '画像'], ['更新報價', '価格を更新'], ['非交易時段', '取引時間外'], ['美股交易中', '米国市場取引中'],
  ['追蹤市值', '追跡時価'], ['未實現損益', '含み損益'], ['擔保／投入資本', '担保／投下資本'], ['本年度加權年化 ROC', '今年度加重年率 ROC'],
  ['日收益率', '日次リターン'], ['週收益率', '週次リターン'], ['月收益率', '月次リターン'], ['年收益率', '年次リターン'],
  ['最近一期報酬率', '直近期間リターン'], ['我的組合', 'マイポートフォリオ'], ['匯率與美債價格波動', '為替・米国債価格変動'],
  ['股票走勢', '株価推移'], ['最新收盤', '最新終値'], ['最新價格', '最新価格'], ['前收', '前日終値'], ['日線價格', '日足価格'], ['價格走勢', '価格推移'], ['期間高點', '期間高値'], ['期間低點', '期間安値'],
  ['自由調整期間', '期間を自由に設定'], ['開始', '開始'], ['結束', '終了'], ['套用', '適用'], ['自訂', 'カスタム'], ['蠟燭', 'ローソク足'], ['技術線疊圖', 'テクニカル指標の重ね表示'],
  ['公司資訊與財務品質', '企業情報と財務品質'], ['公司資訊', '企業情報'], ['財務品質', '財務品質'], ['最近季度自由現金流', '直近四半期フリーCF'],
  ['自由現金流', 'フリーキャッシュフロー'], ['營運現金流', '営業キャッシュフロー'], ['資本支出', '設備投資'], ['營收', '売上高'],
  ['淨利率', '純利益率'], ['營業利益率', '営業利益率'], ['現金與短期投資', '現金・短期投資'], ['總負債', '有利子負債'],
  ['淨現金／（淨負債）', 'ネットキャッシュ／（ネットデット）'], ['股息殖利率', '配当利回り'], ['配息率', '配当性向'],
  ['最近除息日', '直近権利落ち日'], ['最近每股股息', '直近1株配当'], ['歷史', '履歴'], ['季度資料', '四半期データ'], ['年度資料', '年次データ'],
  ['長條', '棒'], ['折線', '折れ線'], ['疊圖', '重ね表示'], ['不疊加', '重ねない'], ['季', '四半期'], ['年', '年'], ['日', '日'], ['週', '週'], ['月', '月'],
  ['開啟 DCF 估值', 'DCF評価を開く'], ['關閉 DCF 估值', 'DCF評価を閉じる'], ['保存稅率', '税率を保存'], ['開啟', '有効'], ['關閉', '無効'],
  ['計算中', '計算中'], ['保存中', '保存中'], ['讀取中', '読込中'], ['更新中', '更新中'], ['搜尋', '検索'], ['新增', '追加'], ['編輯', '編集'], ['刪除', '削除'],
  ['沒有符合目前篩選條件的持倉', '現在の条件に一致する保有資産はありません'], ['正在整理圖形化持倉', '保有資産を整理しています'],
  ['這個日期沒有持倉紀錄', 'この日付には保有記録がありません'], ['正在讀取歷史持倉', '過去の保有資産を読み込んでいます'],
  [' 筆', ' 件'], [' 股', ' 株'], [' 天', ' 日'], ['最近計算', '直近計算'], ['預扣', '源泉徴収'], ['筆事件', '件のイベント'],
] as const;

const skipElement = (element: Element | null) => !element || Boolean(element.closest('[data-i18n-skip],script,style,textarea,[contenteditable="true"]'));

function translateValue(value: string, language: Language) {
  const pairs = language === 'ja-JP' ? translations : translations.map(([zh, ja]) => [ja, zh] as const);
  return [...pairs].sort((a, b) => b[0].length - a[0].length).reduce((next, [source, target]) => next.includes(source) ? next.replaceAll(source, target) : next, value);
}

function translateRoot(root: Element, language: Language) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  nodes.forEach((node) => {
    if (skipElement(node.parentElement) || !node.nodeValue?.trim()) return;
    const next = translateValue(node.nodeValue, language);
    if (next !== node.nodeValue) node.nodeValue = next;
  });
  const elements = [root, ...root.querySelectorAll('*')];
  elements.forEach((element) => {
    if (skipElement(element)) return;
    ['placeholder', 'aria-label', 'title'].forEach((attribute) => {
      const value = element.getAttribute(attribute);
      if (!value) return;
      const next = translateValue(value, language);
      if (next !== value) element.setAttribute(attribute, next);
    });
  });
}

export default function LanguageSwitcher() {
  const [language, setLanguage] = useState<Language>('zh-TW');

  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey);
    if (saved === 'ja-JP') queueMicrotask(() => setLanguage('ja-JP'));
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

  return <div className="language-switcher" data-i18n-skip role="group" aria-label="介面語言">
    <button type="button" className={language === 'zh-TW' ? 'active' : ''} aria-pressed={language === 'zh-TW'} onClick={() => setLanguage('zh-TW')}>中文</button>
    <button type="button" className={language === 'ja-JP' ? 'active' : ''} aria-pressed={language === 'ja-JP'} onClick={() => setLanguage('ja-JP')}>日本語</button>
  </div>;
}
