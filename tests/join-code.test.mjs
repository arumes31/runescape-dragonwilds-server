import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JoinCodeMonitor } from '../admin/join-code.mjs';
const startedAt = '2026-09-23T18:14:00.000Z';
const container = (overrides = {}) => ({ Id: 'a'.repeat(64), State: { Running: true, Status: 'running', StartedAt: startedAt, ...overrides } });
const line = (code, time = '2026.09.23-18.14.38:061') => `[${time}][119]LogNetSessionSettings: Setting ["JoinCode"] written with key[xz] value[${code}]\n`;
function fixture(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dw-join-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'RSDragonwilds.log');
  return { path, monitor: new JoinCodeMonitor({ path, ...options }) };
}
test('finds the startup join code even beyond the live log tail; latest code wins', async t => {
  const {path, monitor} = fixture(t);
  writeFileSync(path, line('VJLW-ZGXX') + 'other output\n'.repeat(500));
  assert.equal((await monitor.read(container())).code, 'VJLW-ZGXX');
  appendFileSync(path, line('ABCD-EFGH'));
  assert.equal((await monitor.read(container())).code, 'ABCD-EFGH');
  appendFileSync(path, line(''));
  assert.equal((await monitor.read(container())).code, null);
});
test('old startup codes are rejected, and stop/restart/recreation clear the code', async t => {
  const {path, monitor} = fixture(t);
  writeFileSync(path, line('OLDX-CODE', '2026.09.23-18.13.59:999'));
  assert.equal((await monitor.read(container())).code, null);
  appendFileSync(path, line('VJLW-ZGXX'));
  assert.equal((await monitor.read(container())).code, 'VJLW-ZGXX');
  assert.equal((await monitor.read(container({Running: false, Status: 'exited'}))).code, null);
  assert.equal((await monitor.read(container({StartedAt: '2026-09-23T19:00:00Z'}))).code, null);
  assert.equal((await monitor.read({...container({StartedAt: '2026-09-24T00:00:00Z'}), Id: 'b'.repeat(64)})).code, null);
});
test('reads split lines incrementally and handles missing, truncated and rotated files', async t => {
  const {path, monitor} = fixture(t, {maxBytes: 80});
  assert.equal((await monitor.read(container())).state, 'waiting');
  writeFileSync(path, line('VJLW-ZGXX').slice(0, 70));
  assert.equal((await monitor.read(container())).code, null);
  appendFileSync(path, line('VJLW-ZGXX').slice(70));
  assert.equal((await monitor.read(container())).code, 'VJLW-ZGXX');
  writeFileSync(path, 'new log\n');
  assert.equal((await monitor.read(container())).code, null);
  renameSync(path, path + '.old'); writeFileSync(path, line('ABCD-EFGH'));
  await monitor.read(container());
  assert.equal((await monitor.read(container())).code, 'ABCD-EFGH');
});
test('invalid and unrelated log values never become a join code', async t => {
  const {path, monitor} = fixture(t);
  writeFileSync(path, line('<script>') + line('') + line('ABCD-EFGH').replace('LogNetSessionSettings', 'OtherLogger'));
  assert.equal((await monitor.read(container())).code, null);
});
test('concurrent reads serialize safely and stopped state never exposes a code', async t => {
  const {path, monitor} = fixture(t);
  writeFileSync(path, line('VJLW-ZGXX'));
  const values = await Promise.all([monitor.read(container()), monitor.read(container())]);
  assert.ok(values.every(value => value.code === 'VJLW-ZGXX'));
  assert.equal((await monitor.read(container({Status: 'restarting'}))).code, null);
});

test('replacement content with identical size is rescanned after startup', async t => {
  const {path, monitor} = fixture(t);
  writeFileSync(path, line('OLDX-CODE', '2026.09.23-18.13.59:999'));
  assert.equal((await monitor.read(container())).code, null);
  writeFileSync(path, line('NEWX-CODE'));
  assert.equal((await monitor.read(container())).code, 'NEWX-CODE');
});
