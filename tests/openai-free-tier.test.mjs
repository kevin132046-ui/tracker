// Run with `pnpm test`. The offer texts are OpenAI's public wording (help article and data-sharing page); no keys.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  accountFreeTierHeader, accountFreeTierList, builtinFreeTier, groupOfModel, limitLabel, parseAccountFreeTier,
  parseAccountFreeTierHeader, parseFreeTierText, tierOfAccount,
} from '@/lib/openai-free-tier';
import { checkOpenAiQuota, quotaReport } from '@/lib/server/openai-quota';

const accountText = `You're eligible for free daily usage on traffic shared with OpenAI.

• Up to 250 thousand tokens per day across gpt-5.4, gpt-5.2, gpt-5.1, gpt-5, gpt-4.1, gpt-4o, o1, and o3
• Up to 2.5 million tokens per day across gpt-5.4-mini, gpt-5.4-nano, gpt-5-mini, gpt-5-nano, gpt-4.1-mini, gpt-4.1-nano, gpt-4o-mini, o3-mini, and o4-mini.

Usage beyond these limits, as well as usage for other models, will be billed at standard rates. Some limitations apply. Learn more.`;

const big = ['gpt-5.4', 'gpt-5.2', 'gpt-5.1', 'gpt-5', 'gpt-4.1', 'gpt-4o', 'o1', 'o3'];
const small = ['gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5-mini', 'gpt-5-nano', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4o-mini', 'o3-mini', 'o4-mini'];

describe('help article', () => {
  const article = (heading1, heading2) => [
    'Some intro text.',
    heading1, 'gpt-6-sol', 'gpt-5.4-2026-03-05', 'gpt-4.5-preview-2025-02-27 (deprecated and shut down as of 7/14/25)', 'o3-2025-04-16',
    heading2, 'gpt-5.6-terra', 'gpt-5.4-mini-2026-03-17', 'o4-mini-2025-04-16',
    'How does the token quota limit work and when does it refresh?',
  ].join('\n');

  test('reads the current headings ("for Launch and Grow (250K for Build)")', () => {
    const groups = parseFreeTierText(article('• 1M token group for Launch and Grow (250K for Build):', '• 10M token group for Launch and Grow (2.5M for Build):'));
    assert.equal(groups.length, 2);
    assert.deepEqual([groups[0].highLimit, groups[0].lowLimit, groups[1].highLimit, groups[1].lowLimit], [1_000_000, 250_000, 10_000_000, 2_500_000]);
    assert.deepEqual(groups[0].models, ['gpt-6-sol', 'gpt-5.4-2026-03-05', 'o3-2025-04-16']);
    assert.deepEqual(groups[1].models, ['gpt-5.6-terra', 'gpt-5.4-mini-2026-03-17', 'o4-mini-2025-04-16']);
  });

  test('still reads the earlier headings ("(250K for usage tiers 1-2)")', () => {
    const groups = parseFreeTierText(article('1M token group (250K for usage tiers 1-2):', '10M token group (2.5M for usage tiers 1–2):'));
    assert.deepEqual(groups.map((group) => group.lowLimit), [250_000, 2_500_000]);
  });

  test('the built-in copy is the 11/12 list', () => {
    assert.equal(builtinFreeTier.asOf, '2026-11-12');
    assert.ok(builtinFreeTier.groups[0].models.includes('gpt-6.1-sol'));
  });
});

describe('data-sharing page text', () => {
  test('reads both groups, the limits and the status', () => {
    const offer = parseAccountFreeTier(accountText);
    assert.notEqual(typeof offer, 'string');
    assert.equal(offer.status, 'eligible');
    assert.deepEqual(offer.groups, [{ limit: 250_000, models: big }, { limit: 2_500_000, models: small }]);
  });

  test('reads it pasted on one line, without bullets', () => {
    const offer = parseAccountFreeTier(accountText.replace(/\s*•\s*/g, ' ').replace(/\n+/g, ' '));
    assert.deepEqual(offer.groups.map((group) => group.models), [big, small]);
  });

  test('reads "enrolled" and short units', () => {
    const offer = parseAccountFreeTier("You're enrolled for complimentary daily tokens. Up to 1M tokens per day across gpt-5.4 and o3. Up to 10M tokens per day across gpt-5.4-mini.");
    assert.equal(offer.status, 'enrolled');
    assert.deepEqual(offer.groups, [{ limit: 1_000_000, models: ['gpt-5.4', 'o3'] }, { limit: 10_000_000, models: ['gpt-5.4-mini'] }]);
  });

  test('explains text without a model list', () => {
    assert.equal(typeof parseAccountFreeTier("You're enrolled for up to 11 million complimentary tokens per day."), 'string');
    assert.equal(typeof parseAccountFreeTier(''), 'string');
  });

  test('labels groups by their daily limit, and infers the usage tier', () => {
    assert.deepEqual([limitLabel(250_000), limitLabel(2_500_000), limitLabel(10_000_000)], ['25 萬組', '250 萬組', '1,000 萬組']);
    const offer = parseAccountFreeTier(accountText);
    assert.equal(tierOfAccount(offer.groups), 'low');
    assert.equal(tierOfAccount([{ limit: 10_000_000, models: ['gpt-5.4-mini'] }]), 'high');
  });
});

describe('which group a model belongs to', () => {
  const groups = accountFreeTierList(parseAccountFreeTier(accountText).groups).groups;
  const label = (model) => groupOfModel(groups, model)?.label ?? null;

  test('the same name as on the page', () => assert.equal(label('gpt-5.4'), '25 萬組'));
  test('a dated snapshot of a listed family', () => assert.equal(label('gpt-5.4-2026-03-05'), '25 萬組'));
  test('a mini snapshot goes to its own family, not to gpt-5.4', () => assert.equal(label('gpt-5.4-mini-2026-03-17'), '250 萬組'));
  test('variants the page does not name count as billed', () => {
    assert.equal(label('gpt-5-chat-latest'), null);
    assert.equal(label('gpt-5-codex'), null);
  });
  test('models only the help article lists count as billed', () => {
    assert.equal(label('gpt-6-sol'), null);
    assert.equal(label('gpt-5.6-terra'), null);
  });
  test('an alias still matches a single dated snapshot in the article list', () => {
    assert.equal(groupOfModel(builtinFreeTier.groups, 'gpt-5.5')?.id, '1M');
  });
});

describe('the header that carries a pasted list', () => {
  const offer = parseAccountFreeTier(accountText);

  test('round-trips', () => {
    assert.deepEqual(parseAccountFreeTierHeader(accountFreeTierHeader(offer.groups)), offer.groups);
  });

  test('refuses lists out of bounds', () => {
    assert.equal(parseAccountFreeTierHeader(''), null);
    assert.equal(parseAccountFreeTierHeader('20000000:gpt-5.4'), null);
    assert.equal(parseAccountFreeTierHeader('250000:gpt 5.4'), null);
    assert.equal(parseAccountFreeTierHeader(`250000:${Array.from({ length: 41 }, (_, i) => `m${i}x`).join(',')}`), null);
    assert.equal(parseAccountFreeTierHeader(Array.from({ length: 5 }, () => '1000:gpt-5').join('|')), null);
    assert.equal(parseAccountFreeTierHeader('abc'), null);
  });
});

describe('quota check with a pasted list', () => {
  const account = parseAccountFreeTier(accountText).groups;

  test('uses the pasted limits (95%) whatever the tier setting, without reading the article', async () => {
    const report = await quotaReport('gpt-5.4-2026-03-05', 'high', null, Date.parse('2026-11-12T03:00:00Z'), account);
    assert.equal(report.list.source, 'account');
    assert.equal(report.selected.group.label, '25 萬組');
    assert.equal(report.selected.group.limit, 237_500);
    assert.deepEqual(report.groups.map((group) => group.limit), [237_500, 2_375_000]);
  });

  test('a model the page does not list has no group (so it is blocked)', async () => {
    const report = await quotaReport('gpt-6-sol', 'low', null, Date.now(), account);
    assert.equal(report.selected.group, null);
  });

  test('without usage data nothing is sent, pasted list or not', async () => {
    const check = await checkOpenAiQuota('gpt-5.4', 'low', 1_000, null, account);
    assert.equal(check.ok, false);
    assert.match(check.message, /管理金鑰/);
  });
});
