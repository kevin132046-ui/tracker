import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPendingChanges } from '../lib/i18n-changes.ts';

const text = (name, isConnected = true) => ({ nodeType: 3, name, isConnected });
const element = (name, isConnected = true) => ({ nodeType: 1, name, isConnected });
const names = (nodes) => nodes.map((node) => node.name);

test('a clock tick asks for its one text node, not the page', () => {
  const pending = createPendingChanges();
  const clock = text('clock');
  pending.add([{ type: 'characterData', target: clock }]);
  pending.add([{ type: 'characterData', target: clock }]);
  assert.deepEqual(pending.take(), { whole: false, texts: [clock], subtrees: [], attributes: [] });
});

test('added text, added elements and changed attributes go to their own lists', () => {
  const pending = createPendingChanges();
  const parent = element('parent');
  pending.add([
    { type: 'childList', target: parent, addedNodes: [text('new text'), element('new panel'), { nodeType: 8, name: 'comment' }] },
    { type: 'attributes', target: element('input') },
    // A removal alone leaves nothing to translate.
    { type: 'childList', target: parent, addedNodes: [] },
  ]);
  const taken = pending.take();
  assert.equal(taken.whole, false);
  assert.deepEqual(names(taken.texts), ['new text']);
  assert.deepEqual(names(taken.subtrees), ['new panel']);
  assert.deepEqual(names(taken.attributes), ['input']);
});

test('nodes removed from the page before the frame are left out', () => {
  const pending = createPendingChanges();
  pending.add([
    { type: 'characterData', target: text('gone', false) },
    { type: 'childList', target: element('parent'), addedNodes: [element('gone panel', false), element('kept panel')] },
  ]);
  const taken = pending.take();
  assert.deepEqual(names(taken.texts), []);
  assert.deepEqual(names(taken.subtrees), ['kept panel']);
});

test('take starts over', () => {
  const pending = createPendingChanges();
  pending.add([{ type: 'characterData', target: text('a') }]);
  pending.take();
  assert.deepEqual(pending.take(), { whole: false, texts: [], subtrees: [], attributes: [] });
});

test('past the limit the whole page is asked for once, and the lists do not keep growing', () => {
  const pending = createPendingChanges(3);
  pending.add([1, 2, 3, 4].map((index) => ({ type: 'characterData', target: text(`t${index}`) })));
  // Later changes while still waiting for a frame (a tab in the background) add nothing more.
  pending.add([{ type: 'characterData', target: text('later') }]);
  assert.deepEqual(pending.take(), { whole: true, texts: [], subtrees: [], attributes: [] });
  pending.add([{ type: 'characterData', target: text('after') }]);
  const next = pending.take();
  assert.equal(next.whole, false);
  assert.deepEqual(names(next.texts), ['after']);
});
