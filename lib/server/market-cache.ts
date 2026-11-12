/**
 * Public market data kept in D1 (`market_cache`), so a new isolate reads what an earlier one already
 * fetched instead of asking the sources again. Three layers: this isolate's memory, the table, the
 * source. Values are what the sources publish (dates, per-share amounts); nothing about quantities or
 * money held. The table is rebuilt from its sources, so the full backup leaves it out.
 *
 * One `MarketCache` serves one request: it reads its rows in a single query when opened, collects
 * what was fetched, and writes that back in a single batch (`save`).
 */
type Stored = { value: unknown; fetchedAt: number; freshUntil: number };
type Row = { key: string; value: string; fetched_at: number; fresh_until: number };

const memory = new Map<string, Stored>();
const inflight = new Map<string, Promise<unknown>>();

/** A fetcher's answer for "not this time" (no request budget left): nothing is stored. */
export const skipLookup = Symbol.for('optionflow.market-cache.skip');

export type LoadOptions<T> = {
  /** How long a fetched value is used without asking again. */
  freshMs: number;
  /** After a failed fetch, how long the last value (or the fallback) stands before the next try. */
  retryMs: number;
  /** Whether a stored value can answer this request at all (shape, range covered). */
  usable?: (value: T) => boolean;
  /** A value that already holds what is being looked for stays in use past `freshMs`, up to `keepMs`. */
  keep?: (value: T) => boolean;
  keepMs?: number;
  /** Returned when the source fails and nothing is stored; without it the failure is thrown. */
  fallback?: T;
};

const upsert = `INSERT INTO market_cache (key, value, fetched_at, fresh_until) VALUES (?, ?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at, fresh_until = excluded.fresh_until`;
const deleteChunk = 50;

const newer = (a: Stored | undefined, b: Stored | undefined) => {
  if (!a || !b) return a ?? b ?? null;
  return b.fetchedAt > a.fetchedAt || (b.fetchedAt === a.fetchedAt && b.freshUntil > a.freshUntil) ? b : a;
};

export class MarketCache {
  readonly stats = { hit: 0, fetched: 0, failed: 0 };
  private readonly writes = new Map<string, Stored>();
  private readonly db: D1Database;
  private readonly rows: Map<string, Stored>;
  private readonly clock: () => number;

  // Fields are assigned by hand: the tests run this file with Node's type stripping, which has no parameter properties.
  private constructor(db: D1Database, rows: Map<string, Stored>, clock: () => number) {
    this.db = db;
    this.rows = rows;
    this.clock = clock;
  }

  /** Reads every stored row under `prefix` ("dividend:"). A table that can't be read just means no stored values. */
  static async open(db: D1Database, prefix: string, clock: () => number = Date.now) {
    const rows = new Map<string, Stored>();
    try {
      const result = await db.prepare('SELECT key, value, fetched_at, fresh_until FROM market_cache WHERE key LIKE ?').bind(`${prefix}%`).all<Row>();
      for (const row of result.results) {
        try {
          rows.set(row.key, { value: JSON.parse(row.value) as unknown, fetchedAt: Number(row.fetched_at) || 0, freshUntil: Number(row.fresh_until) || 0 });
        } catch { /* an unreadable row is fetched again */ }
      }
    } catch (error) {
      console.warn('Market cache unavailable:', error instanceof Error ? error.message : error);
    }
    return new MarketCache(db, rows, clock);
  }

  private remember(key: string, entry: Stored) {
    memory.set(key, entry);
    this.writes.set(key, entry);
  }

  /** The value under `key`: stored and still good, or fetched now. Requests in one isolate share a fetch. */
  load<T>(key: string, fetcher: () => Promise<T | typeof skipLookup>, options: LoadOptions<T>): Promise<T> {
    const now = this.clock();
    const stored = newer(memory.get(key), this.rows.get(key));
    const hit = stored && (options.usable?.(stored.value as T) ?? true) ? stored : null;
    if (hit) {
      const kept = options.keep?.(hit.value as T) && now - hit.fetchedAt < (options.keepMs ?? 0);
      if (now < hit.freshUntil || kept) {
        this.stats.hit += 1;
        return Promise.resolve(hit.value as T);
      }
    }
    const pending = inflight.get(key);
    if (pending) return pending as Promise<T>;

    const unavailable = (error: unknown): T => {
      if (hit) return hit.value as T;
      if ('fallback' in options) return options.fallback as T;
      throw error instanceof Error ? error : new Error(`${key} is unavailable.`);
    };
    const request = fetcher().then((value) => {
      if (value === skipLookup) return unavailable(new Error(`${key} was not looked up.`));
      this.stats.fetched += 1;
      this.remember(key, { value, fetchedAt: this.clock(), freshUntil: this.clock() + options.freshMs });
      return value as T;
    }, (error: unknown) => {
      this.stats.failed += 1;
      const value = unavailable(error);
      // The last value (or the fallback) stands for a while, so every isolate doesn't wait on a failing source.
      const at = this.clock();
      this.remember(key, { value, fetchedAt: hit ? hit.fetchedAt : at, freshUntil: at + options.retryMs });
      return value;
    }).finally(() => inflight.delete(key));
    inflight.set(key, request);
    return request;
  }

  /**
   * Writes what this request fetched, and drops stored rows `wanted` no longer covers (tickers that
   * left the book). One batch; a failure only means the next isolate fetches again.
   */
  async save(wanted?: (key: string) => boolean) {
    const statements = [...this.writes].map(([key, entry]) => this.db.prepare(upsert).bind(key, JSON.stringify(entry.value), entry.fetchedAt, entry.freshUntil));
    const gone = wanted ? [...this.rows.keys()].filter((key) => !wanted(key) && !this.writes.has(key)) : [];
    for (const key of gone) memory.delete(key);
    for (let index = 0; index < gone.length; index += deleteChunk) {
      const chunk = gone.slice(index, index + deleteChunk);
      statements.push(this.db.prepare(`DELETE FROM market_cache WHERE key IN (${chunk.map(() => '?').join(', ')})`).bind(...chunk));
    }
    if (!statements.length) return;
    try {
      await this.db.batch(statements);
      this.writes.clear();
    } catch (error) {
      console.warn('Market cache not saved:', error instanceof Error ? error.message : error);
    }
  }
}
