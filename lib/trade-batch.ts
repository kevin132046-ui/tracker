/** Shared by the batch and clear-all endpoints and the pages that call them. */

/** Changes per /api/trades/batch request: D1's free plan allows 50 queries per invocation, and setup uses some. */
export const maxBatchOperations = 35;

/** The phrase a request must carry to delete every trade (設定 → 資料 → 清除所有交易資料). */
export const clearAllPhrase = 'DELETE ALL TRADES';

export type BatchChanges<T> = { updates: Array<T & { id: number }>; creates: T[]; deletes: number[] };

/** Splits changes into requests of at most maxBatchOperations, updates and inserts before deletes. */
export function chunkChanges<T>(changes: BatchChanges<T>): Array<BatchChanges<T>> {
  const operations = [
    ...changes.updates.map((item) => ({ kind: 'update' as const, item })),
    ...changes.creates.map((item) => ({ kind: 'create' as const, item })),
    ...changes.deletes.map((id) => ({ kind: 'delete' as const, id })),
  ];
  const chunks: Array<BatchChanges<T>> = [];
  for (let index = 0; index < operations.length; index += maxBatchOperations) {
    const chunk: BatchChanges<T> = { updates: [], creates: [], deletes: [] };
    for (const operation of operations.slice(index, index + maxBatchOperations)) {
      if (operation.kind === 'update') chunk.updates.push(operation.item);
      else if (operation.kind === 'create') chunk.creates.push(operation.item);
      else chunk.deletes.push(operation.id);
    }
    chunks.push(chunk);
  }
  return chunks;
}

/** Sends the changes in chunks; reports progress after each request. Stops at the first failure. */
export async function applyTradeChanges<T>(changes: BatchChanges<T>, onProgress?: (done: number, total: number) => void) {
  const chunks = chunkChanges(changes);
  const total = changes.updates.length + changes.creates.length + changes.deletes.length;
  let done = 0;
  for (const chunk of chunks) {
    const response = await fetch('/api/trades/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(chunk) });
    const payload = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new Error(`${payload.error ?? `儲存失敗（${response.status}）`}。已完成 ${done} / ${total} 項。`);
    done += chunk.updates.length + chunk.creates.length + chunk.deletes.length;
    onProgress?.(done, total);
  }
  return done;
}
