"""Local process and UDP probe, not a player connectivity test."""
import os
from pathlib import Path


def healthy():
    executable = b'/RSDragonwilds/Binaries/Linux/RSDragonwildsServer-Linux-Shipping'
    process = False
    for path in Path('/proc').glob('[0-9]*/cmdline'):
        try:
            if executable in path.read_bytes().split(b'\0')[0]:
                process = True
                break
        except (FileNotFoundError, PermissionError, ProcessLookupError):
            continue
    port = int(os.environ.get('DEFAULT_PORT', '7777'))
    bound = set()
    for filename in ('/proc/net/udp', '/proc/net/udp6'):
        for line in Path(filename).read_text().splitlines()[1:]:
            bound.add(int(line.split()[1].rsplit(':', 1)[1], 16))
    return process and {port, port + 1111}.issubset(bound)


if __name__ == '__main__':
    raise SystemExit(0 if healthy() else 1)
