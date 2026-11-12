// Run with `pnpm test`. In-memory SQLite stands in for D1; model names are public OpenAI ids.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { cleanModelRoles, roleOfTask } from '@/lib/ai-model-roles';
import { forgetModelRolesCache, parseStoredModelRoles, readModelRoles, writeModelRoles } from '@/lib/server/ai-model-roles-store';
import { parseAccountFreeTier } from '@/lib/openai-free-tier';
import { quotaReport, selectQuota } from '@/lib/server/openai-quota';

function fakeD1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const statement = (sql, args = []) => ({
    bind: (...values) => statement(sql, values),
    run: async () => sqlite.prepare(sql).run(...args),
    first: async () => sqlite.prepare(sql).get(...args) ?? null,
  });
  return { sqlite, db: { prepare: (sql) => statement(sql) } };
}

describe('model roles', () => {
  test('every AI task has a role: what you ask is chat, what the site looks up is lookup', () => {
    assert.deepEqual(Object.entries(roleOfTask).filter(([, role]) => role === 'chat').map(([task]) => task).sort(), ['earnings-analysis', 'filing-question', 'portfolio-chat']);
    assert.deepEqual(Object.entries(roleOfTask).filter(([, role]) => role === 'lookup').map(([task]) => task).sort(), ['company-figures', 'dcf-assumptions', 'earnings-date', 'parse-trades']);
  });

  test('keeps model names and drops anything else', () => {
    assert.deepEqual(cleanModelRoles({ chat: ' gpt-5.4 ', lookup: 'gpt-5.4-mini-2026-03-17' }), { chat: 'gpt-5.4', lookup: 'gpt-5.4-mini-2026-03-17' });
    assert.deepEqual(cleanModelRoles({ chat: 'gpt 5.4', lookup: 42 }), { chat: '', lookup: '' });
    assert.deepEqual(cleanModelRoles(null), { chat: '', lookup: '' });
  });

  test('are stored in app_meta and read back', async () => {
    const { db } = fakeD1();
    forgetModelRolesCache();
    assert.equal(await readModelRoles(db), null);
    await writeModelRoles(db, { chat: 'gpt-5.4', lookup: 'gpt-5.4-mini' }, new Date('2026-11-12T04:00:00Z'));
    forgetModelRolesCache();
    const read = await readModelRoles(db);
    assert.deepEqual([read.chat, read.lookup, read.updatedAt], ['gpt-5.4', 'gpt-5.4-mini', '2026-11-12T04:00:00.000Z']);
    assert.equal(parseStoredModelRoles('not json'), null);
  });
});

describe('quota for the second role', () => {
  test('the lookup model is placed in its own group from the same report', async () => {
    const account = parseAccountFreeTier("You're eligible. Up to 250 thousand tokens per day across gpt-5.4 and o3. Up to 2.5 million tokens per day across gpt-5.4-mini and o4-mini.").groups;
    const now = Date.parse('2026-11-12T03:00:00Z');
    const report = await quotaReport('gpt-5.4', 'low', null, now, account);
    assert.equal(report.selected.group.label, '25 萬組');
    assert.equal(selectQuota(report, 'gpt-5.4-mini', now).group.label, '250 萬組');
    assert.equal(selectQuota(report, 'gpt-6-sol', now).group, null);
    assert.equal(selectQuota(report, '', now), null);
  });
});
