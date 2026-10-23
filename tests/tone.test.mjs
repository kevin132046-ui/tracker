import { test } from 'node:test';
import assert from 'node:assert/strict';

const { resolveTone, toneChoices, toneBootSnippet, nasaFontsHref } = await import('@/lib/wafu/tone');

test('NASA is a fixed tone: chosen as is, never picked by 暖色自動', () => {
  assert.equal(resolveTone('nasa'), 'nasa');
  for (const hour of [3, 9, 15, 21]) assert.notEqual(resolveTone('auto', new Date(2026, 9, 24, hour)), 'nasa');
  assert.ok(toneChoices.some(([value, label]) => value === 'nasa' && label === 'NASA'));
});

test('the boot script sets the NASA tone before the first paint and loads its font only then', () => {
  const run = (saved) => {
    const root = { dataset: {} };
    const appended = [];
    const storage = { getItem: (key) => (key === 'optionflow-wafu-tone' ? saved : null) };
    const doc = { createElement: () => ({}), head: { appendChild: (node) => appended.push(node) } };
    new Function('r', 'localStorage', 'document', toneBootSnippet)(root, storage, doc);
    return { tone: root.dataset.tone, fonts: appended.map((node) => node.href) };
  };
  assert.deepEqual(run('nasa'), { tone: 'nasa', fonts: [nasaFontsHref] });
  assert.deepEqual(run('washi'), { tone: 'washi', fonts: [] });
  assert.deepEqual(run(null), { tone: undefined, fonts: [] });
});
