/**
 * 印章式代號牌 (from the prototype): the row number and market in the top corners, the ticker in
 * the middle and what the position is underneath (股票, the option's right and strike, 現金).
 * Stock, option and cash positions take different ink.
 */
export type HankoKind = 'stock' | 'option' | 'cash';

export default function HankoTile({ rank, ticker, market, label, kind }: {
  rank: number;
  ticker: string;
  market: string;
  label: string;
  kind: HankoKind;
}) {
  const text = ticker === 'USD' ? '$' : ticker === 'JPY' ? '¥' : ticker.replace(/\.T$/, '').slice(0, 5);
  return <span className={`hanko is-${kind}`} aria-hidden="true">
    <i className="hanko-rank">{String(rank).padStart(2, '0')}</i>
    <i className="hanko-market">{market}</i>
    <b className={text.length > 4 ? 'is-long' : ''}>{text}</b>
    <small>{label}</small>
  </span>;
}
