// Run with `pnpm test`. Fictional tickers and amounts only.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildPositions, concentration, defaultGroupMode, exposureGroups, optionTools, parseCashLike, sanitizeCustomEvents, sanitizeThemes,
  scenarioLoss, sectorLabel, stressScenarios, upcomingEvents,
} from '@/lib/exposure';

const close = (actual, expected, digits = 6) => assert.ok(Math.abs(actual - expected) < 10 ** -digits, `${actual} ≠ ${expected}`);

// A fictional book: two chip names, one bank, a T-bill ETF and some dollars.
const inputs = [
  { ticker: 'AAA', symbol: 'AAA', kind: 'stock', value: 4000, shares: 40 },
  { ticker: 'AAA', symbol: 'AAA', kind: 'stock', value: 1000, shares: 10 },
  { ticker: 'BBB', symbol: 'BBB', kind: 'stock', value: 3000, shares: 150 },
  { ticker: 'CCC', symbol: 'CCC', kind: 'stock', value: 2000, shares: 20 },
  { ticker: 'TBIL', symbol: 'TBIL', kind: 'stock', value: 6000, shares: 60 },
  { ticker: 'USD', symbol: 'USD', kind: 'cash', value: 4000 },
  { ticker: 'DDD', symbol: 'DDD', kind: 'option', value: 0, unpriced: true },
];
const sectors = { AAA: '科技', BBB: '科技', CCC: '金融' };

describe('positions', () => {
  test('merges lots per ticker and flags cash and cash-like tickers', () => {
    const positions = buildPositions(inputs, ['tbil']);
    const aaa = positions.find((position) => position.ticker === 'AAA');
    assert.equal(aaa.value, 5000);
    assert.equal(aaa.shares, 50);
    assert.equal(positions.find((position) => position.ticker === 'TBIL').cashLike, true);
    assert.equal(positions.find((position) => position.ticker === 'USD').cashLike, true);
    const ddd = positions.find((position) => position.ticker === 'DDD');
    assert.equal(ddd.unpricedOptions, 1);
    assert.equal(ddd.value, 0);
  });

  test('reads a free-text cash-like list', () => {
    assert.deepEqual(parseCashLike('tbil, sgov  bil，TBIL、bad ticker!'), ['TBIL', 'SGOV', 'BIL', 'BAD']);
    assert.deepEqual(parseCashLike(''), []);
  });
});

describe('groups and concentration', () => {
  const positions = buildPositions(inputs, ['TBIL']);

  test('groups by sector with cash-like last; shares sum to one', () => {
    const { groups, total } = exposureGroups(positions, { mode: 'sector', sectors, themes: {}, includeCash: true });
    assert.deepEqual(groups.map((group) => group.name), ['科技', '金融', '未分類', '類現金']);
    assert.equal(total, 20000);
    close(groups[0].share, 0.4);
    close(groups.at(-1).share, 0.5);
    close(groups.reduce((sum, group) => sum + group.share, 0), 1);
  });

  test('themes override sectors only in theme mode, and become the default once set', () => {
    const themes = { AAA: '晶片', CCC: '晶片' };
    assert.equal(defaultGroupMode(positions, {}), 'sector');
    assert.equal(defaultGroupMode(positions, themes), 'theme');
    const { groups } = exposureGroups(positions, { mode: 'theme', sectors, themes, includeCash: false });
    assert.deepEqual(groups.map((group) => [group.name, group.value]), [['晶片', 7000], ['科技', 3000], ['未分類', 0]]);
  });

  test('effective number of positions and level', () => {
    const conc = concentration(positions, false);
    // AAA 5000, BBB 3000, CCC 2000 → weights .5 .3 .2
    close(conc.top1.share, 0.5);
    assert.equal(conc.top1.ticker, 'AAA');
    close(conc.top3, 1);
    close(conc.effective, 1 / (0.25 + 0.09 + 0.04));
    assert.equal(conc.level, 'high');
    assert.equal(concentration([], true), null);
  });
});

describe('scenarios', () => {
  const positions = buildPositions(inputs, ['TBIL']);
  const { groups } = exposureGroups(positions, { mode: 'sector', sectors, themes: {}, includeCash: false });

  test('largest −25%, second −15%, all non-cash −20%', () => {
    const scenarios = stressScenarios(groups, positions);
    assert.deepEqual(scenarios.map((scenario) => [scenario.id, scenario.name]), [['top', '科技'], ['second', '金融'], ['all', null]]);
    close(scenarios[0].loss, 2000);
    close(scenarios[1].loss, 300);
    close(scenarios[2].loss, 2000);
  });

  test('short exposure and cash produce no loss; shocks are capped', () => {
    assert.equal(scenarioLoss(-500, 0.3), 0);
    assert.equal(scenarioLoss(1000, 2), 1000);
    const cashOnly = buildPositions([{ ticker: 'USD', symbol: 'USD', kind: 'cash', value: 1000 }], []);
    assert.deepEqual(stressScenarios(exposureGroups(cashOnly, { mode: 'sector', sectors: {}, themes: {}, includeCash: false }).groups, cashOnly), []);
  });
});

describe('events', () => {
  const positions = buildPositions(inputs, ['TBIL']);

  test('keeps held tickers inside the window, soonest first, with weights', () => {
    const earnings = [
      { symbol: 'BBB', source: 'yahoo', date: '2026-03-12', endDate: null, estimate: true, timing: null, daysAway: 10 },
      { symbol: 'ZZZ', source: 'yahoo', date: '2026-03-05', endDate: null, estimate: false, timing: 'pre', daysAway: 3 },
    ];
    const custom = sanitizeCustomEvents([
      { id: 'a', date: '2026-03-04', ticker: 'aaa', label: '  新品發表  ' },
      { id: 'b', date: '2026-02-20', ticker: 'AAA', label: '已過去' },
      { id: 'c', date: '2026-05-30', ticker: 'AAA', label: '太遠' },
      { id: 'd', date: 'not a date', ticker: 'AAA', label: 'x' },
    ], '2026-03-02');
    assert.equal(custom.length, 2);
    const events = upcomingEvents(earnings, custom, positions, '2026-03-02');
    assert.deepEqual(events.map((event) => [event.date, event.ticker, event.label, event.kind]), [['2026-03-04', 'AAA', '新品發表', 'custom'], ['2026-03-12', 'BBB', '財報', 'earnings']]);
    close(events[0].share, 5000 / 20000);
  });

  test('stored themes are cleaned', () => {
    assert.deepEqual(sanitizeThemes({ aaa: ' 晶片 ', 'bad ticker': 'x', BBB: '', CCC: 3, DDD: '類現金' }), { AAA: '晶片' });
    assert.deepEqual(sanitizeThemes(['x']), {});
  });
});

describe('option tools and sectors', () => {
  test('covered calls need 100 shares; put strike cap is cash-like ÷ 100', () => {
    const tools = optionTools(buildPositions(inputs, ['TBIL']));
    assert.deepEqual(tools.coveredCalls, [{ ticker: 'BBB', contracts: 1 }]);
    assert.equal(tools.cashLike, 10000);
    assert.equal(tools.putStrikeCap, 100);
  });

  test('sector labels', () => {
    assert.equal(sectorLabel('Financial Services'), '金融');
    assert.equal(sectorLabel(null, 'ETF'), 'ETF');
    assert.equal(sectorLabel('Something New'), 'Something New');
    assert.equal(sectorLabel(undefined), null);
  });
});
