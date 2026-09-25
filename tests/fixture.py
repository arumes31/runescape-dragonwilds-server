"""Docker integration fixtures only. This is not the Dragonwilds game."""
from datetime import datetime, timezone
import uuid
import os
from pathlib import Path
import signal
import socket
import time
import sys

root = Path('/home/steam/server-files')
config = root / 'RSDragonwilds/Saved/Config/LinuxServer/DedicatedServer.ini'
text = config.read_text()
if 'ServerGuid=' not in text:
    config.write_text(text + 'ServerGuid=fixture-stable-identity\nKnownPlayerList=fixture-banned-player\n')
sockets = []
port = int(os.environ.get('DEFAULT_PORT', '7777'))
assert f'-Port={port}' in sys.argv, 'Game port argument missing'
assert f'-ini:Engine:[/Script/OnlineSubsystemUtils.OnlineBeaconHost]:ListenPort={port + 1111}' in sys.argv, 'Beacon port argument missing'
for value in (port, port + 1111):
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(('127.0.0.1', value))
    sockets.append(sock)
log = root / 'RSDragonwilds/Saved/Logs/RSDragonwilds.log'
log.parent.mkdir(parents=True, exist_ok=True)
code = uuid.uuid4().hex[:8].upper()
code = code[:4] + '-' + code[4:]
(root / 'fixture-join-code.txt').write_text(code)
stamp = datetime.now(timezone.utc).strftime('%Y.%m.%d-%H.%M.%S:%f')[:23]
join_line = f'[{stamp}][119]LogNetSessionSettings: Setting ["JoinCode"] written with key[xz] value[{code}]'
log.write_text(join_line + '\n' + 'Fixture subsequent output\n' * 250)
print(join_line, flush=True)
print('TEST FIXTURE ONLY: lifecycle and UDP probe, not the Dragonwilds game', flush=True)
print(f'Fixture running as uid={os.getuid()} on {port}/{port+1111}', flush=True)

def stop(*_):
    (root / 'graceful-stop.txt').write_text('SIGTERM received')
    print('Fixture saved and stopped gracefully', flush=True)
    raise SystemExit(0)

signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
while True:
    time.sleep(1)
