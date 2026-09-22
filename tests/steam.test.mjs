import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Controller } from '../admin/server.mjs';
import { parseVdf, installedBuild, latestBuild } from '../admin/steam.mjs';

const info = 'Steam log prefix\n"4019830" { "depots" { "branches" { "public" { "buildid" "12345" } } } }\nSteam log suffix';
test('parses official Steam appinfo and installed appmanifest build IDs', () => {
  assert.equal(latestBuild(info), '12345');
  assert.equal(parseVdf('"a" { "name" "some world" }').a.name, 'some world');
  assert.throws(() => latestBuild('"4019830" { }'), /build/i);
});
test('missing or incomplete installed manifest never claims current version', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dw-steam-'));
  try {
    const path = join(directory, 'appmanifest.acf');
    assert.equal(installedBuild(path), null);
    writeFileSync(path, '"AppState" { "appid" "4019830" "buildid" "123" "StateFlags" "4" }');
    assert.equal(installedBuild(path), '123');
    writeFileSync(path, '"AppState" { "appid" "4019830" "buildid" "123" "StateFlags" "6" }');
    assert.equal(installedBuild(path), null);
  } finally { rmSync(directory, { recursive: true }); }
});
test('automatic updates persist a two-hour cooldown, including failures and admin restarts', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dw-cooldown-'));
  let restarts = 0; let fail = false;
  const options = { project: 'dragonwilds', container: 'dragonwilds-game', stateFile: join(directory, 'state.json'), autoUpdate: true,
    versionProvider: async () => '200', installedProvider: () => '100',
    docker: async method => {
      if (method === 'POST') { restarts++; if (fail) throw new Error('failed'); return ''; }
      return { Id: 'a'.repeat(64), State: { Running: true }, Config: { Env: ['UPDATE_ON_START=true'], Labels: { 'com.docker.compose.project': 'dragonwilds', 'com.docker.compose.service': 'game' } } };
    } };
  try {
    let controller = new Controller(options);
    await controller.checkUpdates(new Date('2026-09-22T04:00:00Z'));
    await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(restarts, 1);
    controller = new Controller(options);
    await controller.checkUpdates(new Date('2026-09-22T05:59:59Z'));
    assert.equal(restarts, 1);
    fail = true;
    await controller.checkUpdates(new Date('2026-09-22T06:00:00Z'));
    await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(restarts, 2);
    controller = new Controller(options);
    await controller.checkUpdates(new Date('2026-09-22T07:59:59Z')); assert.equal(restarts, 2);
  } finally { rmSync(directory, { recursive: true }); }
});
test('unknown installed version or unavailable Steam never triggers automatic restart', async () => {
  let mutations = 0;
  const controller = new Controller({ project: 'dragonwilds', container: 'dragonwilds-game', autoUpdate: true, installedProvider: () => null, versionProvider: async () => { throw new Error('Steam offline'); }, docker: async () => { mutations++; } });
  await controller.checkUpdates();
  assert.equal(mutations, 0); assert.match(controller.versions.error, /Steam offline/);
});

test('manual restart bypasses cooldown and does not reset automatic timestamp', async () => {
  let calls = 0;
  const controller = new Controller({ project: 'dragonwilds', container: 'dragonwilds-game', docker: async method => {
    if (method === 'POST') { calls++; return ''; }
    return { Id: 'a'.repeat(64), State: { Running: true }, Config: { Env: ['UPDATE_ON_START=true'], Labels: { 'com.docker.compose.project': 'dragonwilds', 'com.docker.compose.service': 'game' } } };
  } });
  controller.lastAutoRestartAt = new Date().toISOString();
  const before = controller.lastAutoRestartAt;
  controller.action('restart');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(calls, 1); assert.equal(controller.lastAutoRestartAt, before);
});

test('status clears update available as soon as the installed manifest catches up', async () => {
  let installed = '100';
  const controller = new Controller({ project: 'dragonwilds', container: 'dragonwilds-game', autoUpdate: false,
    installedProvider: () => installed, versionProvider: async () => '200',
    docker: async () => ({ Id: 'a'.repeat(64), State: { Running: true }, Config: { Env: [], Labels: { 'com.docker.compose.project': 'dragonwilds', 'com.docker.compose.service': 'game' } } }) });
  await controller.checkUpdates();
  assert.equal((await controller.status()).versions.updateAvailable, true);
  installed = '200';
  assert.equal((await controller.status()).versions.updateAvailable, false);
  installed = null;
  assert.equal((await controller.status()).versions.updateAvailable, false);
});

test('scheduled and Steam restarts share the same limit; repeated manual restarts are exempt', async () => {
  let mutations = 0;
  const controller = new Controller({ project: 'dragonwilds', container: 'dragonwilds-game', hour: 5,
    docker: async method => {
      if (method === 'POST') { mutations++; return ''; }
      return { Id: 'a'.repeat(64), State: { Running: true }, Config: { Env: ['UPDATE_ON_START=true'], Labels: { 'com.docker.compose.project': 'dragonwilds', 'com.docker.compose.service': 'game' } } };
    } });
  await controller.automaticRestart('steam-update', new Date('2026-09-22T04:00:00Z'));
  await new Promise(resolve => setTimeout(resolve, 10));
  await controller.maintain(new Date('2026-09-22T05:00:00Z'));
  assert.equal(mutations, 1);
  for (let i = 0; i < 3; i++) {
    controller.action('restart');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(mutations, 4);
  assert.equal(controller.lastAutoRestartAt, '2026-09-22T04:00:00.000Z');
  await controller.automaticRestart('steam-update', new Date('2026-09-22T05:59:59Z'));
  assert.equal(mutations, 4);
  await controller.automaticRestart('steam-update', new Date('2026-09-22T06:00:00Z'));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(mutations, 5);
});
