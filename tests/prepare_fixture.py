"""Create isolated fixture deployment settings; never overwrite a production .env."""
from pathlib import Path
import os
import secrets
import shutil

root = Path(__file__).resolve().parents[1]
env_path = root / '.env.test.local'
if not env_path.exists():
    env = (root / '.env.example').read_text(encoding='utf-8')
    changes = {
        'COMPOSE_PROJECT_NAME': 'dragonwilds-test', 'OWNER_ID': '1' * 32,
        'ADMIN_PASSWORD': secrets.token_urlsafe(24), 'ADMIN_GUI_PASSWORD': secrets.token_urlsafe(32),
        'ADMIN_PORT': '18089', 'ADMIN_ORIGINS': 'http://localhost:18089,http://127.0.0.1:18089',
        'DEFAULT_PORT': '17777', 'BEACON_PORT': '18888', 'GAME_BIND_IP': '127.0.0.1',
        'UPDATE_ON_START': 'false', 'AUTO_UPDATE': 'false', 'AUTO_UPDATE_UTC_HOUR': 'off',
        'SERVER_DATA_PATH': './test-results/server-files', 'BACKUP_PATH': './test-results/backups',
        'DOCKER_GID': str(os.stat('/var/run/docker.sock').st_gid) if os.name != 'nt' else '0',
    }
    lines = []
    for line in env.splitlines():
        key = line.split('=', 1)[0]
        lines.append(f'{key}={changes[key]}' if key in changes else line)
    env_path.write_text('\n'.join(lines) + '\n', encoding='utf-8', newline='\n')
    env_path.chmod(0o600)
server = root / 'test-results/server-files'
exe = server / 'RSDragonwilds/Binaries/Linux/RSDragonwildsServer-Linux-Shipping'
exe.parent.mkdir(parents=True, exist_ok=True)
exe.write_text('#!/bin/bash\nexec -a "$0" /usr/bin/python3 /home/steam/server-files/fixture.py "$@"\n', encoding='utf-8', newline='\n')
shutil.copyfile(root / 'tests/fixture.py', server / 'fixture.py')
print('Fixture configured. OWNER_ID is synthetic; do not use this .env for a live game.')
