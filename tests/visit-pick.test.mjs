import { test } from 'node:test';
import assert from 'node:assert/strict';

// A browser-like window with localStorage, before the module is loaded.
const store = new Map();
globalThis.window = { localStorage: { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)) } };
const { visitPick, nextPhotoKey } = await import('@/lib/wafu/asset-slots');

const asset = (slot) => ({ slot, version: '1', type: 'image/jpeg', size: 1, name: '', updatedAt: '', url: `/api/wafu-assets?slot=${slot}&v=1` });
const assets = { 'bg-kikyo': asset('bg-kikyo'), 'bg-kikyo-2': asset('bg-kikyo-2') };

test('the backdrop chosen on the last visit is this visit\'s backdrop, and the next one is chosen', () => {
  store.set(nextPhotoKey, JSON.stringify({ kikyo: assets['bg-kikyo-2'].url }));
  assert.equal(visitPick(assets, 'bg', 'kikyo')?.slot, 'bg-kikyo-2');
  const next = JSON.parse(store.get(nextPhotoKey)).kikyo;
  assert.ok([assets['bg-kikyo'].url, assets['bg-kikyo-2'].url].includes(next));
  // Still the same picture for the rest of the visit, whatever was stored for the next one.
  store.set(nextPhotoKey, JSON.stringify({ kikyo: assets['bg-kikyo'].url }));
  assert.equal(visitPick(assets, 'bg', 'kikyo')?.slot, 'bg-kikyo-2');
});

test('a stored picture that is no longer uploaded is ignored', () => {
  store.set(nextPhotoKey, JSON.stringify({ shigure: '/api/wafu-assets?slot=bg-shigure&v=old' }));
  const only = { 'bg-shigure-2': asset('bg-shigure-2') };
  assert.equal(visitPick(only, 'bg', 'shigure')?.slot, 'bg-shigure-2');
});
