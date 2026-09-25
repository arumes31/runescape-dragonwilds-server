"""End-to-end tests against only the explicitly isolated fixture Compose project."""
import http.cookiejar
import json
from pathlib import Path
import subprocess
import time
import urllib.request

root = Path(__file__).resolve().parents[1]
env = dict(line.split('=', 1) for line in (root / '.env.test.local').read_text().splitlines() if '=' in line and not line.startswith('#'))
assert env['COMPOSE_PROJECT_NAME'] == 'dragonwilds-test', 'Refuse to control non-test project'
base = 'http://localhost:' + env['ADMIN_PORT']
client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

def api(path, payload=None):
    request = urllib.request.Request(base + '/api/' + path, data=json.dumps(payload).encode() if payload is not None else None,
        headers={'Content-Type': 'application/json', 'X-Requested-With': 'DragonwildsAdmin', 'Origin': base})
    with client.open(request, timeout=15) as response:
        return json.load(response)

def wait_for(predicate, description):
    deadline = time.monotonic() + 150
    while time.monotonic() < deadline:
        value = api('status')
        if predicate(value):
            print('PASS:', description)
            return value
        time.sleep(1)
    raise AssertionError(description + ' timed out')

api('login', {'password': env['ADMIN_GUI_PASSWORD']})
before = wait_for(lambda value: value['health'] == 'healthy', 'initial container health')
assert before['joinCode']['code'], 'Startup join code missing from authenticated status'
initial_code = before['joinCode']['code']
print('PASS: startup join code captured beyond live-log tail')
logs = api('logs')['logs']
assert 'TEST FIXTURE ONLY' in logs
assert env['ADMIN_PASSWORD'] not in logs
print('PASS: authenticated logs, fixture identification, password redaction')
api('restart', {})
wait_for(lambda value: not value['busy'] and value['startedAt'] != before['startedAt'] and value['health'] == 'healthy', 'restart through admin API')
def fixture_file(path):
    return subprocess.check_output(['docker', 'exec', 'dragonwilds-test-game', 'cat',
        '/home/steam/server-files/' + path], text=True)

assert api('status')['joinCode']['code'] == fixture_file('fixture-join-code.txt')
assert api('status')['joinCode']['code'] != initial_code, 'Restart exposed the previous join code'
print('PASS: restarted container publishes its new join code')
config = fixture_file('RSDragonwilds/Saved/Config/LinuxServer/DedicatedServer.ini')
assert 'ServerGuid=fixture-stable-identity' in config
assert 'KnownPlayerList=fixture-banned-player' in config
assert 'SIGTERM received' in fixture_file('graceful-stop.txt')
print('PASS: SIGTERM delivery and persistent server identity / ban record')
api('stop', {})
wait_for(lambda value: not value['busy'] and not value['running'], 'stop through admin API')
assert api('status')['joinCode']['code'] is None, 'Stopped server exposed stale join code'
api('start', {})
wait_for(lambda value: not value['busy'] and value['health'] == 'healthy', 'start through admin API')
resources = api('resources')
assert resources['memoryBytes'] > 0
print('PASS: actual Docker CPU / memory resource endpoint')
api('logout', {})
try:
    api('status')
    raise AssertionError('logged-out session accepted')
except urllib.error.HTTPError as error:
    assert error.code == 401
print('PASS: logout revokes the live session')

# Admin-only restart must recover the code without restarting the game.
subprocess.run(['docker', 'compose', '--env-file', '.env.test.local', 'restart', 'admin'], cwd=root, check=True, stdout=subprocess.DEVNULL)
time.sleep(2)
api('login', {'password': env['ADMIN_GUI_PASSWORD']})
recovered = wait_for(lambda value: value['joinCode']['code'] == fixture_file('fixture-join-code.txt'), 'admin restart recovers current join code')
assert recovered['running']
api('logout', {})
