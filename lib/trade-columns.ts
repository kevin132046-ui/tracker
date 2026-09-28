/**
 * Columns of the 交易明細 (trade details) table: ids, labels, groups and presets.
 * The default selection is exactly the table's original eleven columns.
 */

export type TradeColumnId =
  | 'ticker' | 'strategy' | 'dates' | 'dte' | 'held' | 'strike' | 'otm' | 'quantity' | 'entry' | 'current'
  | 'pnl' | 'roc' | 'annualRoc' | 'capitalBase' | 'capitalShare' | 'delta' | 'theta' | 'vega' | 'iv'
  | 'assignment' | 'status' | 'actions';

export type TradeColumnGroupId = 'basic' | 'options' | 'risk';

export type TradeColumn = {
  id: TradeColumnId;
  /** Header text. */
  label: string;
  /** Name in the column picker when it differs from the header. */
  pickerLabel?: string;
  group: TradeColumnGroupId;
  /** Always shown; not listed as a choice. */
  locked?: boolean;
  /** Shows "—" on stock and cash rows. */
  optionOnly?: boolean;
  description?: string;
};

/** Every column in table order. */
export const tradeColumns: readonly TradeColumn[] = [
  { id: 'ticker', label: '標的', group: 'basic', locked: true },
  { id: 'strategy', label: '交易／策略', group: 'basic' },
  { id: 'dates', label: '開倉／到期', group: 'basic' },
  { id: 'dte', label: '到期天數', pickerLabel: '到期天數（DTE）', group: 'basic', optionOnly: true, description: '距到期日的日曆天數，僅未平倉選擇權' },
  { id: 'held', label: '持有天數', group: 'basic', description: '開倉至今天（或平倉日）的天數' },
  { id: 'strike', label: '履約價', group: 'basic' },
  { id: 'otm', label: '價外%', group: 'options', optionOnly: true, description: 'PUT：(S−K)÷S；CALL：(K−S)÷S；正值代表價外' },
  { id: 'quantity', label: '數量', group: 'basic' },
  { id: 'entry', label: '買入／成交價', group: 'basic' },
  { id: 'current', label: '目前價格', group: 'basic' },
  { id: 'pnl', label: '損益', group: 'basic' },
  { id: 'roc', label: 'ROC', group: 'basic' },
  { id: 'annualRoc', label: '年化 ROC', group: 'basic', description: '單利年化：ROC × 365 ÷ 持有天數' },
  { id: 'capitalBase', label: '資本基礎', group: 'risk', description: 'ROC 使用的投入資本：擔保金、履約價名目、買入成本或權利金' },
  { id: 'capitalShare', label: '擔保占比', group: 'risk', description: '這筆投入資本 ÷ 全部未平倉投入資本' },
  { id: 'delta', label: 'Delta（股數當量）', group: 'options', optionOnly: true, description: 'Delta × 方向 × 100 × 口數；賣方為 −1' },
  { id: 'theta', label: 'Theta/日（$）', group: 'options', optionOnly: true, description: '每過一個日曆日的部位價值變化；賣方為正收入' },
  { id: 'vega', label: 'Vega（每 1 vol 點 $）', group: 'options', optionOnly: true, description: '隱含波動率上升 1 個百分點的部位價值變化' },
  { id: 'iv', label: 'IV', pickerLabel: 'IV（隱含波動率）', group: 'options', optionOnly: true, description: '以目前權利金與標的價格反推的 Black–Scholes 隱含波動率' },
  { id: 'assignment', label: '被指派機率', group: 'risk', optionOnly: true, description: '到期價內機率：CALL 為 N(d2)，PUT 為 N(−d2)' },
  { id: 'status', label: '狀態', group: 'basic' },
  { id: 'actions', label: '操作', group: 'basic', locked: true },
];

export const tradeColumnGroups: ReadonlyArray<{ id: TradeColumnGroupId; label: string }> = [
  { id: 'basic', label: '基本' },
  { id: 'options', label: '選擇權' },
  { id: 'risk', label: '風險' },
];

export type TradeColumnPresetId = 'default' | 'compact' | 'seller' | 'risk' | 'all';

export const tradeColumnPresets: ReadonlyArray<{ id: TradeColumnPresetId; label: string; columns: readonly TradeColumnId[] }> = [
  { id: 'default', label: '目前（預設）', columns: ['ticker', 'strategy', 'dates', 'strike', 'quantity', 'entry', 'current', 'pnl', 'roc', 'status', 'actions'] },
  { id: 'compact', label: '精簡', columns: ['ticker', 'strategy', 'dte', 'strike', 'pnl', 'roc', 'actions'] },
  { id: 'seller', label: '選擇權賣方', columns: ['ticker', 'strategy', 'dates', 'dte', 'strike', 'otm', 'quantity', 'entry', 'current', 'pnl', 'annualRoc', 'capitalShare', 'theta', 'assignment', 'status', 'actions'] },
  { id: 'risk', label: '風險', columns: ['ticker', 'strategy', 'dte', 'strike', 'otm', 'quantity', 'capitalBase', 'capitalShare', 'delta', 'theta', 'vega', 'iv', 'assignment', 'actions'] },
  { id: 'all', label: '全部', columns: tradeColumns.map((column) => column.id) },
];

export const defaultTradeColumns: readonly TradeColumnId[] = tradeColumnPresets[0].columns;
export const tradeColumnsStorageKey = 'optionflow-trade-columns-v1';

const columnOrder = new Map(tradeColumns.map((column, index) => [column.id, index]));
const lockedColumns = tradeColumns.filter((column) => column.locked).map((column) => column.id);

/** Known ids in table order with the locked columns added; the default set for anything invalid. */
export function normalizeTradeColumns(value: unknown): TradeColumnId[] {
  if (!Array.isArray(value)) return [...defaultTradeColumns];
  const ids = new Set<TradeColumnId>(lockedColumns);
  for (const item of value) if (typeof item === 'string' && columnOrder.has(item as TradeColumnId)) ids.add(item as TradeColumnId);
  return [...ids].sort((a, b) => (columnOrder.get(a) ?? 0) - (columnOrder.get(b) ?? 0));
}

export const sameTradeColumns = (a: readonly TradeColumnId[], b: readonly TradeColumnId[]) => a.length === b.length && a.every((id, index) => id === b[index]);

export const isDefaultTradeColumns = (columns: readonly TradeColumnId[]) => sameTradeColumns(columns, defaultTradeColumns);

export function presetForColumns(columns: readonly TradeColumnId[]): TradeColumnPresetId | null {
  return tradeColumnPresets.find((preset) => sameTradeColumns(normalizeTradeColumns(preset.columns), columns))?.id ?? null;
}

export function toggleTradeColumn(columns: readonly TradeColumnId[], id: TradeColumnId): TradeColumnId[] {
  if (lockedColumns.includes(id)) return [...columns];
  return normalizeTradeColumns(columns.includes(id) ? columns.filter((column) => column !== id) : [...columns, id]);
}

/** Saved selection from localStorage; the default columns when storage is empty, invalid or blocked. */
export function readStoredTradeColumns(): TradeColumnId[] {
  if (typeof window === 'undefined') return [...defaultTradeColumns];
  try {
    const raw = window.localStorage.getItem(tradeColumnsStorageKey);
    return raw ? normalizeTradeColumns(JSON.parse(raw)) : [...defaultTradeColumns];
  } catch {
    return [...defaultTradeColumns];
  }
}

export function writeStoredTradeColumns(columns: readonly TradeColumnId[]) {
  try {
    if (isDefaultTradeColumns(columns)) window.localStorage.removeItem(tradeColumnsStorageKey);
    else window.localStorage.setItem(tradeColumnsStorageKey, JSON.stringify(columns));
  } catch {
    // Private browsing can block storage; the choice still applies until the page reloads.
  }
}
