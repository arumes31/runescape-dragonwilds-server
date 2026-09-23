import { readFileSync } from 'node:fs';

export function parseWindow(value) {
  if (value === 'anytime') return { value, start: null, end: null };
  if (typeof value !== 'string' || !/^([01][0-9]|2[0-3]):[0-5][0-9]-([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value)) throw new Error('Invalid maintenance window; use HH:MM-HH:MM UTC or anytime');
  const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const [start, end] = value.split('-').map(minutes);
  if (start === end) throw new Error('Maintenance window start and end must differ; use anytime for all day');
  return { value, start, end };
}
export function windowStatus(window, now = new Date()) {
  const minute = now.getUTCHours() * 60 + now.getUTCMinutes();
  const open = window.start === null || (window.start < window.end ? minute >= window.start && minute < window.end : minute >= window.start || minute < window.end);
  const next = new Date(now);
  if (!open) {
    next.setUTCHours(Math.floor(window.start / 60), window.start % 60, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  }
  return { window: window.value, open, nextOpenAt: open ? null : next.toISOString() };
}
export function readProgress(path = '/game-data/.dragonwilds-startup.json') {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}
const messages = {
  backing_up: 'Backing up saved worlds before updating.',
  downloading: 'Steam is downloading or verifying game files. See the server log for details.',
  configuring: 'Applying server configuration.',
  starting: 'Starting the game; waiting for local process and UDP health checks.',
  running: 'Game process and UDP ports are healthy. Player connectivity is a separate check.',
  failed: 'The server or startup failed. Check the server log.',
  stopped: 'The server is stopped.',
};
export function startupProgress(container, record) {
  const state = container.State;
  let phase;
  const current = record && Number.isFinite(Date.parse(record.startedAt)) && Date.parse(record.startedAt) >= Date.parse(state.StartedAt);
  if (state.OOMKilled) phase = 'failed';
  else if (!state.Running) phase = state.ExitCode && ![0, 137, 143].includes(state.ExitCode) ? 'failed' : 'stopped';
  else if (current && ['backing_up', 'downloading', 'configuring', 'failed'].includes(record.phase)) phase = record.phase;
  else phase = state.Health?.Status === 'unhealthy' ? 'failed' : state.Health?.Status === 'healthy' ? 'running' : 'starting';
  return { phase, message: messages[phase], updatedAt: current ? record.updatedAt ?? null : null };
}
