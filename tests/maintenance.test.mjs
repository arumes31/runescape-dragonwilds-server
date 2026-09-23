import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Controller } from '../admin/server.mjs';
import { parseWindow, windowStatus, startupProgress } from '../admin/maintenance.mjs';
const data = () => ({ Id: 'a'.repeat(64), State: { Running: true, Status: 'running', StartedAt: '2026-09-23T01:00:00Z', Health: { Status: 'healthy' } }, Config: { Env: ['UPDATE_ON_START=true'], Labels: { 'com.docker.compose.project': 'dragonwilds', 'com.docker.compose.service': 'game' } } });
const options = { project: 'dragonwilds', container: 'dragonwilds-game', installedProvider: () => '100', versionProvider: async () => '200', progressProvider: () => null };
const settle = () => new Promise(resolve => setImmediate(resolve));
test('UTC windows have inclusive starts, exclusive ends and wrap midnight', () => {
  const window = parseWindow('23:30-01:15');
  assert.equal(windowStatus(window, new Date('2026-09-23T23:30:00Z')).open, true);
  assert.equal(windowStatus(window, new Date('2026-09-24T01:14:59Z')).open, true);
  const closed = windowStatus(window, new Date('2026-09-24T01:15:00Z'));
  assert.equal(closed.open, false);
  assert.equal(closed.nextOpenAt, '2026-09-24T23:30:00.000Z');
  assert.equal(windowStatus(parseWindow('anytime')).open, true);
  for (const value of ['24:00-02:00', '04:00-04:00', '', null, '4:00-6:00']) assert.throws(() => parseWindow(value), /window/i);
});
test('window defers automatic patches without consuming cooldown; manual restart bypasses it', async () => {
  let restarts = 0;
  const controller = new Controller({ ...options, maintenanceWindow: '04:00-06:00', docker: async method => method === 'POST' ? ++restarts : data() });
  await controller.checkUpdates(new Date('2026-09-23T03:00:00Z'));
  assert.equal(controller.versions.updateAvailable, true);
  assert.equal(restarts, 0); assert.equal(controller.lastAutoRestartAt, null);
  controller.action('restart'); await settle(); assert.equal(restarts, 1);
  assert.equal(controller.lastAutoRestartAt, null);
  await controller.checkUpdates(new Date('2026-09-23T04:00:00Z')); await settle();
  assert.equal(restarts, 2);
  await controller.checkUpdates(new Date('2026-09-23T05:00:00Z')); assert.equal(restarts, 2);
});
test('manual version checks never restart and concurrent queries are coalesced', async () => {
  let finish, calls = 0, restarts = 0;
  const controller = new Controller({ ...options, versionProvider: () => { calls++; return new Promise(resolve => { finish = resolve; }); }, docker: async method => method === 'POST' ? ++restarts : data() });
  const check = controller.checkUpdates(new Date(), { allowRestart: false });
  await controller.checkUpdates(new Date(), { allowRestart: false });
  assert.equal(calls, 1); assert.equal(controller.checkingVersions, true);
  finish('200'); await check; await settle();
  assert.equal(controller.versions.latestBuild, '200'); assert.equal(restarts, 0);
});
test('UI maintenance window persists across panel restarts; invalid changes preserve it', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dw-window-'));
  try {
    const config = { ...options, stateFile: join(directory, 'state.json') };
    const controller = new Controller(config);
    controller.setMaintenanceWindow('02:00-04:00');
    assert.throws(() => controller.setMaintenanceWindow('oops'));
    const restored = new Controller(config);
    assert.equal(restored.maintenanceWindow.value, '02:00-04:00');
    restored.setMaintenanceWindow(null);
    assert.equal(new Controller({ ...config, maintenanceWindow: '05:00-07:00' }).maintenanceWindow.value, '05:00-07:00');
  } finally { rmSync(directory, { recursive: true }); }
});
test('progress distinguishes startup phases, local health, stale records and failures', () => {
  const container = data(); container.State.Health.Status = 'starting';
  const record = { phase: 'downloading', startedAt: container.State.StartedAt, updatedAt: container.State.StartedAt };
  assert.equal(startupProgress(container, record).phase, 'downloading');
  assert.equal(startupProgress(container, { ...record, startedAt: '2026-09-22T01:00:00Z' }).phase, 'starting');
  container.State.Health.Status = 'healthy';
  assert.equal(startupProgress(container, { ...record, phase: 'starting' }).phase, 'running');
  container.State.Running = false; container.State.ExitCode = 1;
  assert.equal(startupProgress(container, record).phase, 'failed');
  container.State.ExitCode = 143;
  assert.equal(startupProgress(container, record).phase, 'stopped');
});
test('automatic restart cannot interrupt a startup download', async () => {
  let mutations = 0; const container = data(); container.State.Health.Status = 'starting';
  const controller = new Controller({ ...options, progressProvider: () => ({ phase: 'downloading', startedAt: container.State.StartedAt }), docker: async method => method === 'POST' ? ++mutations : container });
  await controller.checkUpdates(); assert.equal(mutations, 0); assert.equal(controller.lastAutoRestartAt, null);
});

test('slow Steam response cannot restart after the maintenance window closes', async () => {
  let now = new Date('2026-09-23T05:59:59Z'), mutations = 0;
  const controller = new Controller({ ...options, maintenanceWindow: '04:00-06:00', clock: () => now,
    versionProvider: async () => { now = new Date('2026-09-23T06:00:01Z'); return '200'; },
    docker: async method => method === 'POST' ? ++mutations : data() });
  await controller.checkUpdates(); await settle();
  assert.equal(mutations, 0); assert.equal(controller.lastAutoRestartAt, null);
});
test('slow Docker inspection cannot restart after the maintenance window closes', async () => {
  let now = new Date('2026-09-23T05:59:59Z'), mutations = 0;
  const controller = new Controller({ ...options, maintenanceWindow: '04:00-06:00', clock: () => now,
    docker: async method => { if (method === 'POST') return ++mutations; now = new Date('2026-09-23T06:00:01Z'); return data(); } });
  await controller.automaticRestart('steam-update'); await settle();
  assert.equal(mutations, 0); assert.equal(controller.lastAutoRestartAt, null);
});
test('out of memory and failed local health are shown as failures', () => {
  const container = data(); container.State.Health.Status = 'unhealthy';
  assert.equal(startupProgress(container, null).phase, 'failed');
  container.State.Running = false; container.State.ExitCode = 137; container.State.OOMKilled = true;
  assert.equal(startupProgress(container, null).phase, 'failed');
});
