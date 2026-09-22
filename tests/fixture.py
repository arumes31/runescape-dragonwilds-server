"""Docker integration fixtures only. This is not the Dragonwilds game."""
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
    sock.bind(('0.0.0.0', value))
    sockets.append(sock)
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
