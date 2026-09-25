import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
function ui() {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { hidden: false, disabled: false, textContent: '', addEventListener() {} });
    return elements.get(id);
  };
  const context = { document: { getElementById: element, querySelectorAll: () => [], body: {classList: {add() {}, remove() {}}} }, setInterval() {}, fetch: async () => {throw new Error('signed out');} };
  runInNewContext(readFileSync(new URL('../admin/public/app.js', import.meta.url), 'utf8'), context);
  return {element, render: context.renderServerAccess};
}
test('only Start is visible when stopped; running exposes Restart and Stop', () => {
  const {element, render} = ui();
  render({state: 'exited', running: false, busy: false});
  assert.equal(element('start').hidden, false); assert.equal(element('start').disabled, false);
  assert.equal(element('restart').hidden, true); assert.equal(element('stop').hidden, true);
  render({state: 'running', running: true, busy: false, joinCode: {code: 'VJLW-ZGXX'}});
  assert.equal(element('start').hidden, true);
  assert.equal(element('restart').hidden, false); assert.equal(element('stop').hidden, false);
  assert.equal(element('restart').disabled, false); assert.equal(element('join-code').textContent, 'VJLW-ZGXX');
});
test('busy and unavailable states cannot offer actions or a stale join code', () => {
  const {element, render} = ui();
  render({state: 'running', running: true, busy: true, joinCode: {code: 'OLDX-CODE'}});
  assert.equal(element('restart').disabled, true); assert.equal(element('stop').disabled, true);
  assert.equal(element('join-code').textContent, 'Unavailable');
  render(null);
  for (const id of ['start','restart','stop']) assert.equal(element(id).hidden, true);
  assert.equal(element('join-code').textContent, 'Unavailable');
  render({state: 'restarting', running: true});
  for (const id of ['start','restart','stop']) assert.equal(element(id).hidden, true);
});
