import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createApp, Controller, nextMaintenance, decodeLogs } from '../admin/server.mjs';

const password = 'a-long-test-only-password';
const inspect = () => ({ Id: 'a'.repeat(64), Name: '/dragonwilds-game', State: { Running: true, Status: 'running', Health: { Status: 'healthy' } }, Config: { Labels: { 'com.docker.compose.project': 'dragonwilds', 'com.docker.compose.service': 'game' }, Env: ['ADMIN_PASSWORD=hidden-game-secret', 'UPDATE_ON_START=true'] } });
async function fixture(t, options = {}) {
  const calls = [];
  const docker = async (method, path) => { calls.push([method, path]); return path.endsWith('/json') ? inspect() : Buffer.from('log hidden-game-secret'); };
  const controller = new Controller({ docker, project: 'dragonwilds', container: 'dragonwilds-game', ...options });
  const app = createApp({ password, controller, origins: ['http://localhost:8080'], ...options });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { app.close(resolve); app.closeAllConnections(); }));
  const base = `http://127.0.0.1:${app.address().port}`;
  const request = (path, init = {}) => new Promise((resolve, reject) => {
    const req = http.request(base + path, { method: init.method ?? 'GET', headers: { Host: 'localhost:8080', ...init.headers } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })));
    }); req.on('error', reject); req.end(init.body);
  });
  const login = async () => {
    const response = await request('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'DragonwildsAdmin', Origin: 'http://localhost:8080' }, body: JSON.stringify({ password }) });
    assert.equal(response.status, 200);
    return { Cookie: response.headers.get('set-cookie').split(';')[0], 'X-Requested-With': 'DragonwildsAdmin', Origin: 'http://localhost:8080' };
  };
  return { request, login, calls, controller };
}

test('requires authentication on status, logs and all actions', async t => {
  const f = await fixture(t);
  for (const path of ['/api/status', '/api/logs', '/api/restart']) {
    assert.equal((await f.request(path, path.endsWith('restart') ? { method: 'POST' } : {})).status, 401);
  }
  assert.equal(f.calls.length, 0);
});
test('login sets protected cookie and logout revokes it', async t => {
  const f = await fixture(t);
  const headers = await f.login();
  assert.equal((await f.request('/api/status', { headers })).status, 200);
  assert.equal((await f.request('/api/logout', { method: 'POST', headers })).status, 200);
  assert.equal((await f.request('/api/status', { headers })).status, 401);
});
test('rejects cross-origin mutation, missing custom header and unrelated routes', async t => {
  const f = await fixture(t);
  const headers = await f.login();
  assert.equal((await f.request('/api/restart', { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await f.request('/api/restart', { method: 'POST', headers: { Cookie: headers.Cookie } })).status, 403);
  assert.equal((await f.request('/api/exec', { method: 'POST', headers })).status, 404);
  assert.equal((await f.request('/api/status', { headers: { ...headers, Host: 'evil.example' } })).status, 403);
});
test('restart targets only the inspected ID; status excludes environment; logs redact passwords', async t => {
  const f = await fixture(t);
  const headers = await f.login();
  const status = await (await f.request('/api/status', { headers })).text();
  assert.ok(!status.includes('hidden-game-secret'));
  assert.ok(!(await (await f.request('/api/logs', { headers })).text()).includes('hidden-game-secret'));
  assert.equal((await f.request('/api/restart', { method: 'POST', headers })).status, 202);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.ok(f.calls.some(([method, path]) => method === 'POST' && path === `/containers/${'a'.repeat(64)}/restart?t=120`));
});
test('refuses container from another Compose project', async () => {
  const controller = new Controller({ docker: async () => inspect(), project: 'other', container: 'dragonwilds-game' });
  await assert.rejects(controller.inspect(), /project/);
});
test('one action at a time; Docker errors remain visible', async () => {
  let release;
  const controller = new Controller({ project: 'dragonwilds', container: 'dragonwilds-game', docker: async (method) => method === 'GET' ? inspect() : new Promise((resolve, reject) => { release = () => reject(new Error('Docker unavailable')); }) });
  controller.action('restart');
  assert.throws(() => controller.action('stop'), /progress/);
  await new Promise(resolve => setTimeout(resolve, 10));
  release();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(controller.busy, false);
  assert.equal(controller.lastAction.ok, false);
});
test('maintenance runs once per date and never starts deliberately stopped containers', async () => {
  let restarts = 0;
  const data = inspect();
  const controller = new Controller({ project: 'dragonwilds', container: 'dragonwilds-game', hour: 4, docker: async method => { if (method === 'POST') { restarts++; return ''; } return data; } });
  await controller.maintain(new Date('2026-09-22T04:00:00Z'));
  await new Promise(resolve => setTimeout(resolve, 10));
  await controller.maintain(new Date('2026-09-22T04:01:00Z'));
  assert.equal(restarts, 1);
  data.State.Running = false;
  await controller.maintain(new Date('2026-09-23T04:00:00Z'));
  assert.equal(restarts, 1);
});
test('maintenance is disabled when startup updates are disabled', async () => {
  const data = inspect(); data.Config.Env = ['UPDATE_ON_START=false'];
  const controller = new Controller({ project: 'dragonwilds', container: 'dragonwilds-game', hour: 4, docker: async method => { assert.equal(method, 'GET'); return data; } });
  await controller.maintain(new Date('2026-09-22T04:00:00Z'));
  assert.equal(controller.lastAction.ok, false);
});
test('UTC schedule advances across midnight', () => {
  assert.equal(nextMaintenance(4, new Date('2026-09-22T05:00:00Z')), '2026-09-23T04:00:00.000Z');
  assert.equal(nextMaintenance(null), null);
});
test('Docker multiplexed logs are decoded', () => {
  const text = Buffer.from('hello'); const header = Buffer.alloc(8); header[0] = 1; header.writeUInt32BE(text.length, 4);
  assert.equal(decodeLogs(Buffer.concat([header, text])), 'hello');
});

test('resource metrics handle missing samples and Docker memory cache', async () => {
  const mod = await import('../admin/server.mjs');
  const stats = mod.resourceUsage({ cpu_stats: { cpu_usage: { total_usage: 400 }, system_cpu_usage: 1000, online_cpus: 2 }, precpu_stats: { cpu_usage: { total_usage: 200 }, system_cpu_usage: 500 }, memory_stats: { usage: 3000, limit: 9000, stats: { inactive_file: 1000 } } });
  assert.equal(stats.cpuPercent, 80);
  assert.equal(stats.memoryBytes, 2000);
  assert.equal(stats.memoryLimitBytes, 9000);
  assert.equal(mod.resourceUsage({}).cpuPercent, 0);
});
test('login cookies are HttpOnly, SameSite and Secure behind HTTPS', async t => {
  const f = await fixture(t, { secureCookies: true });
  const response = await f.request('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'DragonwildsAdmin' }, body: JSON.stringify({ password }) });
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/); assert.match(cookie, /Secure/);
});
test('expired sessions are rejected', async t => {
  const f = await fixture(t, { sessionMs: 1 }); const headers = await f.login();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal((await f.request('/api/status', { headers })).status, 401);
});
test('incorrect passwords are rate limited', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 10; i++) assert.equal((await f.request('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'DragonwildsAdmin' }, body: JSON.stringify({ password: 'wrong' }) })).status, 401);
  assert.equal((await f.request('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'DragonwildsAdmin' }, body: JSON.stringify({ password }) })).status, 429);
});

test('new settings and Steam endpoints require authentication and valid origin', async t => {
  const f = await fixture(t, { autoUpdate: false, versionProvider: async () => '200', installedProvider: () => '100' });
  for (const path of ['/api/check-steam', '/api/maintenance']) {
    assert.equal((await f.request(path, { method: 'POST' })).status, 401);
  }
  const headers = { ...await f.login(), 'Content-Type': 'application/json' };
  for (const path of ['/api/check-steam', '/api/maintenance']) {
    assert.equal((await f.request(path, { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' }, body: '{}' })).status, 403);
  }
  assert.equal((await f.request('/api/maintenance', { method: 'POST', headers, body: JSON.stringify({ window: '23:00-02:00' }) })).status, 200);
  assert.equal((await f.controller.status()).maintenance.window, '23:00-02:00');
  assert.equal((await f.request('/api/maintenance', { method: 'POST', headers, body: JSON.stringify({ window: 'invalid' }) })).status, 400);
  assert.equal((await f.controller.status()).maintenance.window, '23:00-02:00');
  assert.equal((await f.request('/api/check-steam', { method: 'POST', headers })).status, 202);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.controller.versions.latestBuild, '200');
  assert.ok(!f.calls.some(([method]) => method === 'POST'));
  assert.equal((await f.request('/api/check-steam', { method: 'POST', headers })).status, 429);
});

test('join code is authenticated and suppressed during an in-flight server action', async t => {
  const f = await fixture(t, { joinCodes: {read: async () => ({code: 'VJLW-ZGXX', state: 'available'})} });
  assert.equal((await f.request('/api/status')).status, 401);
  const headers = await f.login();
  assert.equal((await (await f.request('/api/status', {headers})).json()).joinCode.code, 'VJLW-ZGXX');
  f.controller.busy = true;
  assert.equal((await (await f.request('/api/status', {headers})).json()).joinCode.code, null);
});
