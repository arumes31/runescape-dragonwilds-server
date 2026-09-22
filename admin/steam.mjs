import { readFileSync, existsSync, cpSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
const APP = '4019830';

export function parseVdf(text) {
  const tokens = [...text.matchAll(/"((?:\\.|[^"\\])*)"|([{}])/g)].map(match => match[2] ?? match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
  let at = 0;
  function object(nested = false) {
    const result = {};
    while (at < tokens.length) {
      const key = tokens[at++];
      if (key === '}') { if (!nested) throw new Error('Unexpected VDF close'); return result; }
      const value = tokens[at++];
      if (value === undefined || value === '}') throw new Error('Incomplete VDF');
      result[key] = value === '{' ? object(true) : value;
    }
    if (nested) throw new Error('Unclosed VDF');
    return result;
  }
  return object();
}
function buildId(value) { return typeof value === 'string' && /^[1-9][0-9]*$/.test(value) ? value : null; }
export function installedBuild(path = '/game-data/steamapps/appmanifest_4019830.acf') {
  try {
    const app = parseVdf(readFileSync(path, 'utf8')).AppState;
    return app?.appid === APP && app.StateFlags === '4' ? buildId(app.buildid) : null;
  } catch { return null; }
}
export function latestBuild(output) {
  const begin = output.indexOf('"' + APP + '"');
  if (begin < 0) throw new Error('Steam did not return app information');
  // Isolate the app's balanced object; Steam appends human-readable shutdown logs.
  const text = output.slice(begin); let depth = 0, quoted = false, escaped = false, end = 0;
  for (let i = text.indexOf('{'); i < text.length; i++) {
    const c = text[i];
    if (escaped) { escaped = false; continue; }
    if (c === '\\' && quoted) { escaped = true; continue; }
    if (c === '"') quoted = !quoted;
    if (!quoted && c === '{') depth++;
    if (!quoted && c === '}' && --depth === 0) { end = i + 1; break; }
  }
  const value = end && buildId(parseVdf(text.slice(0, end))[APP]?.depots?.branches?.public?.buildid);
  if (!value) throw new Error('Steam public build ID unavailable');
  return value;
}
export async function querySteam() {
  const directory = '/data/steamcmd';
  if (!existsSync(directory + '/steamcmd.sh')) cpSync('/opt/steamcmd', directory, { recursive: true });
  let stdout;
  try { ({ stdout } = await execute(directory + '/steamcmd.sh', ['+login', 'anonymous', '+app_info_update', '1', '+app_info_print', APP, '+quit'], { timeout: 120000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, HOME: '/data' } })); }
  catch { throw new Error('Steam metadata check failed or timed out; automatic patching is paused until a successful check'); }
  return latestBuild(stdout);
}
