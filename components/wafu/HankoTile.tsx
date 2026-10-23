/**
 * 印章式代號牌 (from the prototype): the row number and market in the top corners, the ticker in
 * the middle and what the position is underneath (股票, the option's right and strike, 現金).
 * Stock, option and cash positions take different ink.
 */
export type HankoKind = 'stock' | 'option' | 'cash';

const sealText = (ticker: string) => ticker === 'USD' ? '$' : ticker === 'JPY' ? '¥' : ticker.replace(/\.T$/, '').slice(0, 5);

export default function HankoTile({ rank, ticker, market, label, kind }: {
  rank: number;
  ticker: string;
  market: string;
  label: string;
  kind: HankoKind;
}) {
  const text = sealText(ticker);
  return <span className={`hanko is-${kind}`} aria-hidden="true">
    <i className="hanko-rank">{String(rank).padStart(2, '0')}</i>
    <i className="hanko-market">{market}</i>
    <b className={text.length > 4 ? 'is-long' : ''}>{text}</b>
    <small>{label}</small>
  </span>;
}

/**
 * The same seal wherever a ticker is shown outside 圖形持倉 (交易明細, the technical view, a lot, a
 * dividend's source), so every list uses one mark: the ticker, and in the corner the market or the
 * option's right. Replaces the company logos.
 */
export function TickerSeal({ ticker, kind, corner, size = 40 }: { ticker: string; kind: HankoKind; corner?: string; size?: 40 | 56 }) {
  const text = sealText(ticker);
  return <span className={`hanko seal-${size} is-${kind}`} aria-hidden="true">
    {corner && <i className="hanko-market">{corner}</i>}
    <b className={text.length > 4 ? 'is-long' : ''}>{text}</b>
  </span>;
}

/** 不需報價: a small 現 seal in the cash ink (in place of the old ◎ and dot). */
export function CashSeal({ size = 18 }: { size?: 18 | 40 }) {
  return <span className={`hanko seal-${size} is-cash is-word`} aria-hidden="true"><b>現</b></span>;
}
