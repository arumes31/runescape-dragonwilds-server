const $ = id => document.getElementById(id);
let signedIn = false, refreshing = false, pendingAction = null;
let latestLogs = "";
function message(text = '', error = false) { $('message').textContent = text; $('message').classList.toggle('error', error); }
function showLogin() { document.body.classList.add('login-screen'); signedIn = false; $('login').hidden = false; $('dashboard').hidden = true; }
async function api(path, method = 'GET', body) {
  const response = await fetch('/api/' + path, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'DragonwildsAdmin' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(12000) });
  const result = await response.json();
  if (!response.ok) { if (response.status === 401) showLogin(); throw new Error(result.error ?? 'Request failed'); }
  return result;
}
function date(value) { return value && !value.startsWith('0001') ? new Date(value).toLocaleString() : '—'; }
async function refresh() {
  if (!signedIn || refreshing) return;
  refreshing = true;
  try {
    const status = await api('status');
    $('server-name').textContent = status.name;
    $('state').textContent = status.state;
    $('health').textContent = status.health;
    $('started').textContent = date(status.startedAt);
    const cooldown = status.nextAutoRestartAllowedAt && new Date(status.nextAutoRestartAllowedAt) > new Date();
    $('next-update').textContent = !status.autoUpdate ? 'Off' : cooldown ? `After ${date(status.nextAutoRestartAllowedAt)}` : 'Monitoring Steam';
    $('installed-version').textContent = status.versions.installedBuild ?? 'Unknown / not installed';
    $('latest-version').textContent = status.versions.latestBuild ?? 'Unavailable';
    $('version-check').textContent = status.versions.error ? status.versions.error : status.versions.checkedAt ? `${status.versions.updateAvailable ? 'Update available' : status.versions.installedBuild ? 'No newer build detected' : 'Installed build not confirmed'} · ${date(status.versions.checkedAt)}` : 'Contacting Steam…';
    $('schedule-title').textContent = status.autoUpdate ? 'Update when a patch lands.' : 'Automatic updates off';
    $('schedule-detail').textContent = !status.updatesOnStart ? 'Startup updates are disabled. Automatic patching will be skipped.' : status.autoUpdate ? 'Steam is checked every 5 minutes. A newer build triggers a graceful restart after the cooldown. Stopped servers stay stopped.' : 'Start or restart manually to install available game patches.';
    $('last-action').textContent = status.lastAction ? `${date(status.lastAction.at)} · ${status.lastAction.source} · ${status.lastAction.message}` : 'No server actions recorded yet.';
    $('start').disabled = status.busy || status.running;
    $('stop').disabled = status.busy || !status.running;
    $('restart').disabled = status.busy || !status.running;
    const logs = await api('logs'); const nearBottom = $('logs').scrollHeight - $('logs').scrollTop - $('logs').clientHeight < 80;
    latestLogs = logs.logs; renderLogs();
    if (nearBottom) $('logs').scrollTop = $('logs').scrollHeight;
    try {
      const resources = await api('resources');
      $('cpu').textContent = `${resources.cpuPercent.toFixed(1)}%`;
      $('memory').textContent = `${(resources.memoryBytes / 1048576).toFixed(0)} MiB / ${(resources.memoryLimitBytes / 1073741824).toFixed(1)} GiB`;
    } catch { $('cpu').textContent = 'Unavailable'; $('memory').textContent = 'Unavailable'; }
    message();
  } catch (error) {
    for (const button of document.querySelectorAll('.action')) button.disabled = true;
    $('health').textContent = 'Unavailable';
    message(error.message, true);
  } finally { refreshing = false; }
}
$('login-form').addEventListener('submit', async event => {
  event.preventDefault(); $('sign-in').disabled = true; message();
  try { await api('login', 'POST', { password: $('password').value }); $('password').value = ''; signedIn = true; document.body.classList.remove('login-screen'); $('login').hidden = true; $('dashboard').hidden = false; await refresh(); }
  catch (error) { message(error.message, true); }
  finally { $('sign-in').disabled = false; }
});
$('logout').addEventListener('click', async () => { try { await api('logout', 'POST'); showLogin(); message(); } catch (error) { message(error.message, true); } });
$('refresh').addEventListener('click', refresh);
for (const button of document.querySelectorAll('.action')) button.addEventListener('click', () => {
  pendingAction = button.dataset.action;
  $('confirm-title').textContent = `${pendingAction[0].toUpperCase() + pendingAction.slice(1)} server?`;
  $('confirm-action').textContent = `Confirm ${pendingAction}`;
  $('confirm-detail').textContent = pendingAction === 'start' ? 'The server will start and may install available updates. This can take several minutes.' : 'This disconnects current players. Restarting may take several minutes while updates are installed.';
  $('confirm').showModal();
});
$('confirm').addEventListener('close', async () => {
  if ($('confirm').returnValue !== 'confirm' || !pendingAction) return;
  const action = pendingAction; pendingAction = null;
  try { await api(action, 'POST'); message('Action requested. Waiting for Docker…'); await refresh(); } catch (error) { message(error.message, true); }
});
setInterval(refresh, 5000);
// Resume an existing HttpOnly session without persisting credentials in browser storage.
(async () => { try { await api('status'); signedIn = true; document.body.classList.remove('login-screen'); $('login').hidden = true; $('dashboard').hidden = false; await refresh(); } catch { showLogin(); } })();

function renderLogs() {
  const query = $('log-filter').value.toLowerCase();
  const filtered = latestLogs.split('\n').filter(line => line.toLowerCase().includes(query)).join('\n');
  $('logs').textContent = filtered || (query ? 'No matching log lines.' : 'No output yet. Start the server to see its logs.');
}
$('log-filter').addEventListener('input', renderLogs);
$('download-log').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([latestLogs], { type: 'text/plain' }));
  const link = document.createElement('a'); link.href = url; link.download = 'dragonwilds-server.log'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
