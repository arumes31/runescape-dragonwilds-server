"""Validate environment and merge only container-owned Unreal INI settings."""
import os
from pathlib import Path
import re
import sys
import tempfile

SECTION = '/Script/Dominion.DedicatedServerSettings'
FIELDS = {'AdminPassword': 'ADMIN_PASSWORD', 'OwnerId': 'OWNER_ID',
          'WorldPassword': 'WORLD_PASSWORD', 'ServerName': 'SERVER_NAME',
          'DefaultWorldName': 'DEFAULT_WORLD_NAME'}
DEFAULTS = {'SERVER_NAME': 'DragonWildsServer', 'DEFAULT_WORLD_NAME': 'MyWorld',
            'WORLD_PASSWORD': '', 'DEFAULT_PORT': '7777', 'MAX_PLAYERS': '6',
            'PUID': '1000', 'PGID': '1000', 'UPDATE_ON_START': 'true',
            'BACKUP_KEEP': '7', 'GENERATE_SETTINGS': 'true'}


def validate(env):
    values = {**DEFAULTS, **env}
    for key in FIELDS.values():
        value = values.get(key, '')
        if any(ord(c) < 32 for c in value) or '"' in value:
            raise ValueError(f'{key} contains a control character or unsupported quote')
    if not re.fullmatch(r'[0-9a-fA-F]{32}', values.get('OWNER_ID', '')):
        raise ValueError('OWNER_ID must be the 32 hexadecimal character Player ID from in-game Settings')
    if not values.get('ADMIN_PASSWORD', '').strip():
        raise ValueError('ADMIN_PASSWORD is required')
    world = values['DEFAULT_WORLD_NAME']
    if not world.strip() or any(c in world for c in '/\\:*?<>|') or world in ('.', '..') or re.search(r'\s#', world):
        raise ValueError('DEFAULT_WORLD_NAME must be a filename-safe name; put .env comments on separate lines')
    for key, low, high in [('DEFAULT_PORT', 1024, 64424), ('MAX_PLAYERS', 1, 6),
                           ('PUID', 1, 2147483647), ('PGID', 1, 2147483647), ('BACKUP_KEEP', 1, 100)]:
        value = values[key]
        if not re.fullmatch(r'[0-9]+', value) or not low <= int(value) <= high:
            raise ValueError(f'{key} must be an integer from {low} to {high}')
    for key in ('UPDATE_ON_START', 'GENERATE_SETTINGS', 'REGENERATE_SERVER_INI_ON_RESTART'):
        if key in values and values[key] not in ('true', 'false'):
            raise ValueError(f'{key} must be true or false')
    beacon = int(values['DEFAULT_PORT']) + 1111
    if 'BEACON_PORT' in values and values['BEACON_PORT'] != str(beacon):
        raise ValueError('BEACON_PORT must equal DEFAULT_PORT + 1111')
    return values


def render(text, env):
    values = validate(env)
    section = None
    seen = set()
    output = []

    def missing():
        for key, variable in FIELDS.items():
            if key not in seen:
                output.append(f'{key}={values[variable]}')
                seen.add(key)

    found = False
    for line in text.splitlines():
        match = re.fullmatch(r'\s*\[([^\]]+)\]\s*', line)
        if match:
            if section == SECTION:
                missing()
            section = match[1]
            found |= section == SECTION
        key = line.split('=', 1)[0].strip() if '=' in line else None
        if section == SECTION and key in FIELDS:
            if key not in seen:
                output.append(f'{key}={values[FIELDS[key]]}')
                seen.add(key)
        else:
            output.append(line)
    if not found:
        if not text:
            output.extend(['[SectionsToSave]', 'bCanSaveAllSections=true', ''])
        output.append(f'[{SECTION}]')
    missing()
    return '\n'.join(output) + '\n'


def configure(path, env):
    values = validate(env)
    manual = values['GENERATE_SETTINGS'] == 'false' or values.get('REGENERATE_SERVER_INI_ON_RESTART') == 'false'
    if manual and path.exists():
        return
    old = path.read_text(encoding='utf-8-sig') if path.exists() else ''
    result = render(old, values)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, encoding='utf-8', newline='\n', delete=False) as stream:
        temporary = Path(stream.name)
        stream.write(result)
    try:
        temporary.chmod(0o600)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == '__main__':
    try:
        if '--check' in sys.argv:
            validate(os.environ)
        else:
            configure(Path(os.environ.get('SERVER_FILES', '/home/steam/server-files')) / 'RSDragonwilds/Saved/Config/LinuxServer/DedicatedServer.ini', os.environ)
    except ValueError as error:
        sys.exit(f'Configuration error: {error}')
