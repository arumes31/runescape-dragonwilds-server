import { JoinCodeMonitor } from './join-code.mjs';
import { trustedProxyMatcher, clientAddress } from './proxy.mjs';
import { promisify } from 'node:util';
import { parseWindow, windowStatus, readProgress, startupProgress } from './maintenance.mjs';
import { querySteam, installedBuild } from './steam.mjs';
import http from 'node:http';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';

const passwordHash = promisify(scrypt);
const publicDir = join(dirname(fileURLToPath(import.meta.url)), 'public');
export function dockerClient(socketPath = '/var/run/docker.sock') {
  return (method, path) => new Promise((resolve, reject) => {
    const request = http.request({ socketPath, method, path: '/v1.45' + path }, response => {
      const chunks = []; let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) { response.destroy(); reject(new Error('Docker response too large')); }
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        if (response.statusCode >= 400) return reject(new Error(`Docker request failed (${response.statusCode})`));
        const body = Buffer.concat(chunks);
        try { resolve((path.endsWith('/json') || path.includes('/stats?')) ? JSON.parse(body) : body); } catch { reject(new Error('Invalid Docker response')); }
      });
    });
    request.setTimeout(150000, () => request.destroy(new Error('Docker request timed out')));
    request.on('error', reject); request.end();
  });
}
export function decodeLogs(buffer) {
  if (buffer.length < 8 || buffer[0] > 2 || buffer[1] !== 0) return buffer.toString('utf8');
  const chunks = [];
  for (let offset = 0; offset + 8 <= buffer.length;) {
    const length = buffer.readUInt32BE(offset + 4); offset += 8;
    if (offset + length > buffer.length) break;
    chunks.push(buffer.subarray(offset, offset + length)); offset += length;
  }
  return Buffer.concat(chunks).toString('utf8');
}
export function resourceUsage(stats) {
  const cpuDelta = (stats.cpu_stats?.cpu_usage?.total_usage ?? 0) - (stats.precpu_stats?.cpu_usage?.total_usage ?? 0);
  const systemDelta = (stats.cpu_stats?.system_cpu_usage ?? 0) - (stats.precpu_stats?.system_cpu_usage ?? 0);
  const cpus = stats.cpu_stats?.online_cpus ?? 1;
  return { cpuPercent: systemDelta > 0 ? Math.max(0, cpuDelta / systemDelta * cpus * 100) : 0,
    memoryBytes: Math.max(0, (stats.memory_stats?.usage ?? 0) - (stats.memory_stats?.stats?.inactive_file ?? 0)),
    memoryLimitBytes: stats.memory_stats?.limit ?? 0 };
}
export function nextMaintenance(hour, now = new Date()) {
  if (hour === null) return null;
  const next = new Date(now); next.setUTCHours(hour, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}
export class Controller {
  constructor({ docker = dockerClient(), container, project, hour = null, stateFile = null, autoUpdate = true, versionProvider = querySteam, installedProvider = installedBuild, maintenanceWindow = 'anytime', progressProvider = readProgress, joinCodes = new JoinCodeMonitor(), clock = () => new Date() }) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/.test(container)) throw new Error('Invalid container name');
    if (hour !== null && (!Number.isInteger(hour) || hour < 0 || hour > 23)) throw new Error('Invalid update hour');
    this.clock = clock;
    this.joinCodes = joinCodes;
    this.defaultWindow = parseWindow(maintenanceWindow);
    this.maintenanceWindow = this.defaultWindow;
    this.windowOverride = null;
    this.progressProvider = progressProvider;
    this.lastManualCheckAt = 0;
    Object.assign(this, { docker, container, project, hour, stateFile, busy: false, lastAction: null, lastDate: null, lastAutoRestartAt: null, autoUpdate, versionProvider, installedProvider, checkingVersions: false, versions: { installedBuild: null, latestBuild: null, checkedAt: null, error: null, updateAvailable: false } });
    if (stateFile) {
      try { const saved = JSON.parse(readFileSync(stateFile, 'utf8')); this.windowOverride = saved.maintenanceWindow ?? null; this.maintenanceWindow = this.windowOverride === null ? this.defaultWindow : parseWindow(this.windowOverride); this.lastDate = saved.lastDate ?? null; this.lastAction = saved.lastAction ?? null; this.lastAutoRestartAt = saved.lastAutoRestartAt ?? null; if (this.lastAutoRestartAt && !Number.isFinite(Date.parse(this.lastAutoRestartAt))) throw new Error('Invalid persisted automatic restart timestamp'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      this.busy = false;
    }
  }
  save() {
    if (!this.stateFile) return;
    mkdirSync(dirname(this.stateFile), { recursive: true });
    writeFileSync(this.stateFile + '.tmp', JSON.stringify({ maintenanceWindow: this.windowOverride, lastDate: this.lastDate, lastAction: this.lastAction, lastAutoRestartAt: this.lastAutoRestartAt }), { mode: 0o600 });
    renameSync(this.stateFile + '.tmp', this.stateFile);
  }
  setMaintenanceWindow(value) {
    const next = value === null ? this.defaultWindow : parseWindow(value);
    const previous = { window: this.maintenanceWindow, override: this.windowOverride };
    this.maintenanceWindow = next; this.windowOverride = value;
    try { this.save(); } catch (error) { this.maintenanceWindow = previous.window; this.windowOverride = previous.override; throw error; }
    return this.maintenanceStatus();
  }
  maintenanceStatus(now = new Date()) {
    return { ...windowStatus(this.maintenanceWindow, now), source: this.windowOverride === null ? 'environment' : 'panel', defaultWindow: this.defaultWindow.value };
  }
  progress(data) {
    if (this.busy) return { phase: this.lastAction?.action === 'start' ? 'starting' : 'stopping', message: 'Waiting for Docker to complete the server action.', updatedAt: this.lastAction?.at };
    return startupProgress(data, this.progressProvider());
  }
  async inspect() {
    const data = await this.docker('GET', `/containers/${encodeURIComponent(this.container)}/json`);
    const labels = data.Config?.Labels;
    if (labels?.['com.docker.compose.project'] !== this.project || labels?.['com.docker.compose.service'] !== 'game') throw new Error('Container does not belong to the configured project/service');
    if (!/^[a-f0-9]{64}$/.test(data.Id)) throw new Error('Invalid Docker container ID');
    return data;
  }
  async monitorJoinCode(data = null) {
    const current = data ?? await this.inspect();
    if (this.busy) return { code: null, state: 'unavailable' };
    const result = await this.joinCodes.read(current);
    return this.busy ? { code: null, state: 'unavailable' } : result;
  }
  async status() {
    const data = await this.inspect();
    const installed = this.installedProvider();
    const versions = { ...this.versions, installedBuild: installed,
      updateAvailable: !this.versions.error && installed !== null && this.versions.latestBuild !== null && BigInt(this.versions.latestBuild) > BigInt(installed) };
    const joinCode = await this.monitorJoinCode(data);
    return { joinCode, maintenance: this.maintenanceStatus(), progress: this.progress(data), checkingVersions: this.checkingVersions, nextManualCheckAt: this.lastManualCheckAt ? new Date(this.lastManualCheckAt + 60000).toISOString() : null, name: this.container, state: data.State.Status, running: data.State.Running,
      health: data.State.Health?.Status ?? 'unknown', startedAt: data.State.StartedAt,
      exitCode: data.State.ExitCode, oomKilled: data.State.OOMKilled, restarts: data.RestartCount,
      updatesOnStart: data.Config.Env?.includes('UPDATE_ON_START=true') ?? false,
      updateHour: this.hour, nextUpdate: nextMaintenance(this.hour), busy: this.busy, lastAction: this.lastAction, versions, autoUpdate: this.autoUpdate, lastAutoRestartAt: this.lastAutoRestartAt, nextAutoRestartAllowedAt: this.lastAutoRestartAt ? new Date(Date.parse(this.lastAutoRestartAt) + 7200000).toISOString() : null };
  }
  async resources() {
    const data = await this.inspect();
    if (!data.State.Running) return resourceUsage({});
    return resourceUsage(await this.docker('GET', `/containers/${data.Id}/stats?stream=false`));
  }
  async logs() {
    const data = await this.inspect();
    let logs = decodeLogs(await this.docker('GET', `/containers/${data.Id}/logs?stdout=1&stderr=1&timestamps=1&tail=200`));
    for (const variable of data.Config.Env ?? []) {
      const split = variable.indexOf('=');
      const key = variable.slice(0, split); const value = variable.slice(split + 1);
      if (/PASSWORD|SECRET|TOKEN|OWNER_ID/i.test(key) && value) logs = logs.split(value).join('[redacted]');
    }
    return logs;
  }
  action(action, source = 'admin', inspected = null) {
    if (!['start', 'stop', 'restart'].includes(action)) throw new Error('Invalid action');
    if (this.busy) throw new Error('An action is already in progress');
    this.busy = true;
    this.lastAction = { action, source, at: new Date().toISOString(), ok: null, message: 'Request in progress' };
    try { this.save(); } catch (error) { this.busy = false; throw error; }
    this.perform(action, inspected).catch(error => {
      this.lastAction = { ...this.lastAction, ok: false, message: error.message };
      console.error(JSON.stringify({ event: 'action_failed', action, source, error: error.message }));
    }).finally(() => {
      this.busy = false;
      try { this.save(); } catch (error) { console.error('Unable to persist maintenance state:', error.message); }
    });
  }
  async perform(action, inspected = null) {
    const data = inspected ?? await this.inspect();
    await this.docker('POST', `/containers/${data.Id}/${action}${action === 'start' ? '' : '?t=120'}`);
    this.lastAction = { ...this.lastAction, ok: true, message: 'Docker accepted the action. Check health for readiness.' };
    console.log(JSON.stringify({ event: 'action_complete', action, source: this.lastAction.source }));
  }
  async automaticRestart(source, now) {
    const currentTime = () => now ?? this.clock();
    const allowed = () => windowStatus(this.maintenanceWindow, currentTime()).open && !this.busy && (!this.lastAutoRestartAt || currentTime().getTime() - Date.parse(this.lastAutoRestartAt) >= 7200000);
    if (!allowed()) return;
    const data = await this.inspect();
    if (!allowed() || !data.State.Running) return;
    const phase = startupProgress(data, this.progressProvider()).phase;
    if (['backing_up', 'downloading', 'configuring', 'failed'].includes(phase) || data.State.Health?.Status === 'starting') return;
    if (!data.Config.Env?.includes('UPDATE_ON_START=true')) throw new Error('Automatic update skipped: UPDATE_ON_START is disabled');
    this.lastAutoRestartAt = currentTime().toISOString();
    this.save(); // Fail closed if the cooldown cannot be persisted.
    this.action('restart', source, data);
  }
  async checkUpdates(now, { allowRestart = true } = {}) {
    if (this.checkingVersions) return;
    this.checkingVersions = true;
    try {
      const latest = await this.versionProvider();
      const installed = this.installedProvider();
      if (!/^[1-9][0-9]*$/.test(latest)) throw new Error('Invalid Steam build ID');
      const available = installed !== null && BigInt(latest) > BigInt(installed);
      this.versions = { installedBuild: installed, latestBuild: latest, checkedAt: (now ?? this.clock()).toISOString(), error: null, updateAvailable: available };
      if (available && this.autoUpdate && allowRestart) await this.automaticRestart('steam-update', now);
    } catch (error) {
      this.versions = { ...this.versions, checkedAt: (now ?? this.clock()).toISOString(), error: error.message, updateAvailable: false };
    } finally { this.checkingVersions = false; }
  }
  async maintain(now) {
    const at = now ?? this.clock();
    if (this.hour === null || at.getUTCHours() !== this.hour || this.busy || !windowStatus(this.maintenanceWindow, at).open) return;
    const date = at.toISOString().slice(0, 10);
    if (this.lastDate === date) return;
    // Persist before Docker mutation: admin restarts cannot repeat today's maintenance.
    this.lastDate = date; this.save();
    try {
      const data = await this.inspect();
      if (!data.State.Running) {
        this.lastAction = { at: at.toISOString(), source: 'schedule', ok: true, message: 'Skipped: server is stopped' };
      } else if (!data.Config.Env?.includes('UPDATE_ON_START=true')) {
        throw new Error('Scheduled update skipped: UPDATE_ON_START is disabled');
      } else { await this.automaticRestart('schedule', now); }
    } catch (error) {
      this.lastAction = { at: at.toISOString(), source: 'schedule', ok: false, message: error.message };
    }
    this.save();
  }
}

function reply(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(data));
}
async function body(request) {
  let text = '';
  for await (const chunk of request) { text += chunk; if (text.length > 4096) throw new Error('Body too large'); }
  return JSON.parse(text);
}
export function createApp({ password, controller, origins, secureCookies = false, sessionMs = 8 * 60 * 60 * 1000, trustedProxies = [] }) {
  if (!password || password.length < 20) throw new Error('Admin password must contain at least 20 characters');
  const salt = randomBytes(32); const hash = scryptSync(password, salt, 64);
  const trusted = trustedProxyMatcher(trustedProxies);
  let activeLogins = 0;
  const sessions = new Map(); const attempts = new Map();
  const hosts = new Set(origins.map(origin => new URL(origin).host));
  return http.createServer({ requestTimeout: 10000, headersTimeout: 10000 }, async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    if (secureCookies) response.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
      const path = new URL(request.url, 'http://localhost').pathname;
      if (path === '/healthz' && request.method === 'GET') return reply(response, 200, { ok: true });
      if (!hosts.has(request.headers.host)) return reply(response, 403, { error: 'Unrecognized host' });
      const staticFiles = { '/assets/dragonwilds-realm.png': ['assets/dragonwilds-realm.png', 'image/png'], '/assets/rune.svg': ['assets/rune.svg', 'image/svg+xml'], '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
      if (request.method === 'GET' && staticFiles[path]) {
        const [file, type] = staticFiles[path]; if (path.startsWith('/assets/')) response.setHeader('Cache-Control', 'public, max-age=3600'); response.writeHead(200, { 'Content-Type': type }); return response.end(readFileSync(join(publicDir, file)));
      }
      const now = Date.now();
      for (const [token, expiry] of sessions) if (expiry <= now) sessions.delete(token);
      for (const [ip, attempt] of attempts) if (attempt.until <= now) attempts.delete(ip);
      const cookie = request.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('dw_session='))?.slice(11);
      if (path !== '/api/login' && !sessions.has(cookie)) return reply(response, 401, { error: 'Sign in to continue' });
      if (request.method !== 'GET' && (request.headers['x-requested-with'] !== 'DragonwildsAdmin' || (request.headers.origin && !origins.includes(request.headers.origin)))) return reply(response, 403, { error: 'Request origin rejected' });
      if (path === '/api/login' && request.method === 'POST') {
        const ip = clientAddress(request, trusted);
        const attempt = attempts.get(ip) ?? { count: 0, until: now + 15 * 60 * 1000 };
        if (attempt.count >= 10 || (!attempts.has(ip) && attempts.size >= 1000) || activeLogins >= 4) return reply(response, 429, { error: 'Too many attempts. Try again in 15 minutes.' });
        attempt.count++; attempts.set(ip, attempt);
        if (!request.headers['content-type']?.startsWith('application/json')) return reply(response, 415, { error: 'JSON required' });
        const input = await body(request);
        if (typeof input?.password !== 'string') return reply(response, 401, { error: 'Incorrect admin password' });
        // Keep password hashing off the HTTP event loop and bound expensive concurrent work.
        if (activeLogins >= 4) return reply(response, 429, { error: 'Login service busy; try again shortly' });
        activeLogins++;
        let matches;
        try { matches = timingSafeEqual(await passwordHash(input.password, salt, 64), hash); }
        finally { activeLogins--; }
        if (!matches) return reply(response, 401, { error: 'Incorrect admin password' });
        attempts.delete(ip);
        if (sessions.size >= 100) sessions.delete(sessions.keys().next().value);
        const token = randomBytes(32).toString('hex'); sessions.set(token, now + sessionMs);
        response.setHeader('Set-Cookie', `dw_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(sessionMs / 1000)}${secureCookies ? '; Secure' : ''}`);
        return reply(response, 200, { ok: true });
      }
      if (path === '/api/logout' && request.method === 'POST') {
        sessions.delete(cookie); response.setHeader('Set-Cookie', 'dw_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return reply(response, 200, { ok: true });
      }
      if (path === '/api/status' && request.method === 'GET') return reply(response, 200, await controller.status());
      if (path === '/api/resources' && request.method === 'GET') return reply(response, 200, await controller.resources());
      if (path === '/api/logs' && request.method === 'GET') return reply(response, 200, { logs: await controller.logs() });
      if (path === '/api/check-steam' && request.method === 'POST') {
        if (controller.checkingVersions) return reply(response, 409, { error: 'A Steam check is already running' });
        if (now - controller.lastManualCheckAt < 60000) {
          response.setHeader('Retry-After', Math.ceil((60000 - now + controller.lastManualCheckAt) / 1000));
          return reply(response, 429, { error: 'Wait one minute between manual Steam checks' });
        }
        controller.lastManualCheckAt = now;
        void controller.checkUpdates(new Date(now), { allowRestart: false });
        return reply(response, 202, { ok: true });
      }
      if (path === '/api/maintenance' && request.method === 'POST') {
        const input = await body(request);
        if (!input || !Object.hasOwn(input, 'window') || (input.window !== null && typeof input.window !== 'string')) return reply(response, 400, { error: 'A maintenance window or null is required' });
        if (input.window !== null) { try { parseWindow(input.window); } catch (error) { return reply(response, 400, { error: error.message }); } }
        return reply(response, 200, controller.setMaintenanceWindow(input.window));
      }
      if (['/api/start', '/api/stop', '/api/restart'].includes(path) && request.method === 'POST') {
        if (controller.busy) return reply(response, 409, { error: 'An action is already in progress' });
        controller.action(path.slice(5)); return reply(response, 202, { ok: true });
      }
      reply(response, 404, { error: 'Not found' });
    } catch (error) {
      console.error('Request failed:', error.message);
      reply(response, error.statusCode === 400 ? 400 : error instanceof SyntaxError ? 400 : 502, { error: error.statusCode === 400 ? error.message : error instanceof SyntaxError ? 'Invalid JSON' : 'Request failed. Check the admin service logs and Docker connection.' });
    }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const hour = process.env.AUTO_UPDATE_UTC_HOUR ?? 'off';
  const controller = new Controller({ container: process.env.GAME_CONTAINER ?? 'dragonwilds-game', project: process.env.COMPOSE_PROJECT_NAME ?? 'dragonwilds', hour: hour === 'off' ? null : Number(hour), maintenanceWindow: process.env.AUTO_UPDATE_WINDOW_UTC ?? 'anytime', autoUpdate: process.env.AUTO_UPDATE !== 'false', stateFile: process.env.STATE_FILE ?? '/data/maintenance.json' });
  const origins = (process.env.ADMIN_ORIGINS ?? 'http://localhost:8080,http://127.0.0.1:8080').split(',').map(value => value.trim());
  if (origins.some(origin => !/^https?:\/\//.test(origin) || new URL(origin).origin !== origin)) throw new Error('ADMIN_ORIGINS requires exact HTTP(S) origins without paths');
  const password = process.env.ADMIN_GUI_PASSWORD ?? (process.env.ADMIN_PASSWORD_FILE ? readFileSync(process.env.ADMIN_PASSWORD_FILE, 'utf8').trim() : '');
  const trustedProxies = (process.env.ADMIN_TRUSTED_PROXIES ?? '').split(',').map(value => value.trim()).filter(Boolean);
  const app = createApp({ password, controller, origins, trustedProxies, secureCookies: origins.every(origin => origin.startsWith('https://')) });
  controller.checkUpdates();
  const monitor = () => controller.monitorJoinCode().catch(error => console.error('Join code monitor failed:', error.message));
  void monitor();
  const joinCodeTimer = setInterval(monitor, 5000);
  const versionTimer = setInterval(() => controller.checkUpdates(), 600000);
  const timer = setInterval(() => controller.maintain().catch(error => console.error('Maintenance failed:', error.message)), 30000);
  app.listen(Number(process.env.PORT ?? 8080), '0.0.0.0', () => console.log('Dragonwilds admin listening'));
  process.on('SIGTERM', () => { clearInterval(timer); clearInterval(versionTimer); clearInterval(joinCodeTimer); app.close(() => process.exit(0)); });
}
